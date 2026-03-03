require("./utils/node18-undici-polyfill");

const path = require("node:path");
const fs = require("node:fs/promises");
const express = require("express");
const { HOST, PORT, ROOT_DIR, REQUEST_BODY_LIMIT } = require("./config");
const {
  ensureKnowledge,
  getKnowledgeSummary,
} = require("./services/jquery-knowledge-service");
const { extractIncludedReferences } = require("./services/analyzer");
const {
  QueueLimitError,
  getAnalysisWorkerPool,
} = require("./services/analysis-worker-pool");
const {
  isAllowedFilePath,
  collectSupportedFiles,
  loadSingleFileContent,
} = require("./utils/fs-utils");
const { analysisJobStore } = require("./services/analysis-job-store");
const { analysisSessionStore } = require("./services/analysis-session-store");
const { decodeTextBuffer } = require("./utils/text");

const app = express();
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const analysisWorkerPool = getAnalysisWorkerPool();

function normalizeIncludeReferences(references) {
  if (!Array.isArray(references) || references.length === 0) {
    return [];
  }
  return references
    .map((item) => ({
      source: String(item?.source || ""),
      value: String(item?.value || ""),
    }))
    .filter((item) => item.value.length > 0);
}

function normalizeLastModified(value) {
  if (value == null || value === "") {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function compactAnalysisForUi(analysis) {
  if (!analysis || typeof analysis !== "object") {
    return analysis;
  }

  const compactFindings = Array.isArray(analysis.findings)
    ? analysis.findings.map((item) => ({
      file: String(item?.file || ""),
      line: Number(item?.line) || 0,
      severity: String(item?.severity || "info"),
      deprecatedIn: item?.deprecatedIn ? String(item.deprecatedIn) : "",
      removedIn: item?.removedIn ? String(item.removedIn) : "",
      localizedInstruction: String(
        item?.localizedInstruction || item?.sourceLine || "",
      ),
      detectedInstruction: String(item?.detectedInstruction || ""),
      correctedInstruction: String(
        item?.correctedInstruction || item?.recommendation || "",
      ),
      apiTitle: String(item?.apiTitle || ""),
      apiUrl: String(item?.apiUrl || ""),
    }))
    : [];

  const compactFiles = Array.isArray(analysis.files)
    ? analysis.files.map((file) => ({
      path: String(file?.path || ""),
      sourceType: String(file?.sourceType || "path"),
      includeReferences: normalizeIncludeReferences(file?.includeReferences),
      lastModified: normalizeLastModified(file?.lastModified),
    }))
    : [];

  return {
    ...analysis,
    files: compactFiles,
    findings: compactFindings,
  };
}

function normalizePathForCompare(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .trim()
    .toLowerCase();
}

function sanitizeIncludeValue(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[?#].*$/, "");
  if (!cleaned) {
    return "";
  }
  if (/^https?:\/\//i.test(cleaned)) {
    return "";
  }
  if (cleaned.includes("<%") || cleaned.includes("${")) {
    return "";
  }
  return cleaned;
}

function resolveRelativeCandidate(currentFilePath, includeValue) {
  if (!currentFilePath) {
    return null;
  }

  if (path.isAbsolute(currentFilePath)) {
    return path.resolve(path.dirname(currentFilePath), includeValue);
  }

  const currentPosix = String(currentFilePath || "").replace(/\\/g, "/");
  const includePosix = String(includeValue || "").replace(/\\/g, "/");
  const baseDir = path.posix.dirname(currentPosix);
  return path.posix.normalize(path.posix.join(baseDir, includePosix));
}

function buildFileLookup(files) {
  const filePaths = Array.from(
    new Set(
      (files || [])
        .map((item) => (typeof item === "string" ? item : item?.path))
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );

  const pathByNormalized = new Map();
  const normalizedByPath = new Map();
  const pathsByBase = new Map();

  for (const filePath of filePaths) {
    const normalized = normalizePathForCompare(filePath);
    if (!normalized) {
      continue;
    }
    pathByNormalized.set(normalized, filePath);
    normalizedByPath.set(filePath, normalized);

    const baseName = normalized.split("/").pop();
    if (!baseName) {
      continue;
    }
    if (!pathsByBase.has(baseName)) {
      pathsByBase.set(baseName, []);
    }
    pathsByBase.get(baseName).push(filePath);
  }

  return {
    filePaths,
    pathByNormalized,
    normalizedByPath,
    pathsByBase,
  };
}

async function enrichPathEntriesWithLastModified(filePaths) {
  const normalizedPaths = Array.from(
    new Set(
      (filePaths || [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
  const enriched = await Promise.all(
    normalizedPaths.map(async (filePath) => {
      try {
        const stats = await fs.stat(filePath);
        return {
          path: filePath,
          lastModified: normalizeLastModified(stats.mtime),
        };
      } catch {
        return {
          path: filePath,
          lastModified: "",
        };
      }
    }),
  );
  return enriched;
}

function resolveFilePathInLookup(filePath, lookup) {
  const normalized = normalizePathForCompare(filePath);
  if (!normalized) {
    return null;
  }
  return lookup.pathByNormalized.get(normalized) || null;
}

function findIncludedFilePath(includeValue, currentFilePath, lookup) {
  const cleaned = sanitizeIncludeValue(includeValue);
  if (!cleaned) {
    return null;
  }

  const normalizedCleaned = normalizePathForCompare(cleaned);
  if (lookup.pathByNormalized.has(normalizedCleaned)) {
    return lookup.pathByNormalized.get(normalizedCleaned);
  }

  const relativeCandidate = resolveRelativeCandidate(currentFilePath, cleaned);
  if (relativeCandidate) {
    const normalizedCandidate = normalizePathForCompare(relativeCandidate);
    if (lookup.pathByNormalized.has(normalizedCandidate)) {
      return lookup.pathByNormalized.get(normalizedCandidate);
    }
  }

  const includeSuffix = normalizedCleaned.replace(/^\.?\//, "");
  if (includeSuffix) {
    let bestPath = null;
    let bestScore = -1;

    for (const filePath of lookup.filePaths) {
      const normalizedFilePath =
        lookup.normalizedByPath.get(filePath) || normalizePathForCompare(filePath);
      if (normalizedFilePath.endsWith(includeSuffix)) {
        const score = includeSuffix.length + 1000;
        if (score > bestScore) {
          bestScore = score;
          bestPath = filePath;
        }
      }
    }

    if (bestPath) {
      return bestPath;
    }
  }

  const includeBase = includeSuffix.split("/").pop();
  if (!includeBase) {
    return null;
  }

  const baseCandidates = lookup.pathsByBase.get(includeBase) || [];
  if (baseCandidates.length > 0) {
    return baseCandidates[0];
  }

  return null;
}

function normalizeUploadFiles(uploadFiles, onProgress = null) {
  const incoming = Array.isArray(uploadFiles)
    ? uploadFiles.filter((item) => item && typeof item.path === "string")
    : [];
  const normalized = [];

  for (let index = 0; index < incoming.length; index += 1) {
    const item = incoming[index];
    const filePath = String(item.path || "").trim();
    if (!filePath || !isAllowedFilePath(filePath)) {
      continue;
    }

    let content = "";
    if (typeof item.contentBase64 === "string" && item.contentBase64.length > 0) {
      content = decodeTextBuffer(Buffer.from(item.contentBase64, "base64"));
    } else {
      content = String(item.content || "");
    }

    normalized.push({
      path: filePath,
      content,
      lastModified: normalizeLastModified(item.lastModified),
    });

    onProgress?.({
      processedFiles: index + 1,
      totalFiles: incoming.length,
    });
  }

  return normalized;
}

async function collectPathRecursiveSources(session, targetPath, onProgress = null) {
  const lookup = buildFileLookup(session.files || []);
  const selectedFilePath = resolveFilePathInLookup(targetPath, lookup);
  if (!selectedFilePath) {
    throw new Error("El archivo seleccionado no pertenece a la sesión activa.");
  }

  const queue = [selectedFilePath];
  const visited = new Set();
  const sources = [];
  let processed = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (!isAllowedFilePath(current)) {
      continue;
    }

    let rawContent;
    let lastModified = "";
    try {
      const [stats, contentBuffer] = await Promise.all([
        fs.stat(current),
        fs.readFile(current),
      ]);
      rawContent = contentBuffer;
      lastModified = normalizeLastModified(stats.mtime);
    } catch {
      continue;
    }
    const content = decodeTextBuffer(rawContent);
    sources.push({
      path: current,
      content,
      lastModified,
    });

    processed += 1;
    onProgress?.({
      processedFiles: processed,
      totalFiles: Math.max(processed + queue.length, processed),
    });

    const includeRefs = extractIncludedReferences(content);
    for (const ref of includeRefs) {
      const matched = findIncludedFilePath(ref.value, current, lookup);
      if (matched && !visited.has(matched)) {
        queue.push(matched);
      }
    }
  }

  return {
    selectedFilePath,
    sources,
  };
}

function collectUploadRecursiveSources(session, targetPath, onProgress = null) {
  const lookup = buildFileLookup(session.files || []);
  const selectedFilePath = resolveFilePathInLookup(targetPath, lookup);
  if (!selectedFilePath) {
    throw new Error("El archivo seleccionado no pertenece a la sesión activa.");
  }

  const contentByPath = new Map(
    (session.files || [])
      .filter((item) => item && typeof item.path === "string")
      .map((item) => [
        String(item.path),
        {
          content: String(item.content || ""),
          lastModified: normalizeLastModified(item.lastModified),
        },
      ]),
  );

  const queue = [selectedFilePath];
  const visited = new Set();
  const sources = [];
  let processed = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const sourceEntry = contentByPath.get(current);
    if (!sourceEntry) {
      continue;
    }

    sources.push({
      path: current,
      content: sourceEntry.content,
      lastModified: sourceEntry.lastModified,
    });

    processed += 1;
    onProgress?.({
      processedFiles: processed,
      totalFiles: Math.max(processed + queue.length, processed),
    });

    const includeRefs = extractIncludedReferences(sourceEntry.content);
    for (const ref of includeRefs) {
      const matched = findIncludedFilePath(ref.value, current, lookup);
      if (matched && !visited.has(matched)) {
        queue.push(matched);
      }
    }
  }

  return {
    selectedFilePath,
    sources,
  };
}

app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "jquery-3.7.1-migration-analyzer",
    timestamp: new Date().toISOString(),
    analysisPool: analysisWorkerPool.getStats(),
  });
});

app.get("/api/knowledge", async (_req, res) => {
  try {
    const knowledge = await ensureKnowledge({
      useWebFallback: false,
    });
    res.json({
      ok: true,
      summary: getKnowledgeSummary(knowledge),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/knowledge/refresh", async (req, res) => {
  const useWebFallback = Boolean(req.body?.useWebFallback);
  try {
    const knowledge = await ensureKnowledge({
      forceRefresh: true,
      useWebFallback,
      onProgress: (progress) => {
        if (!progress) {
          return;
        }
        const message = progress.message ? ` ${progress.message}` : "";
        const percent = progress.progress != null ? ` (${progress.progress}%)` : "";
        process.stdout.write(`[knowledge] ${progress.stage}${percent}${message}\n`);
      },
    });

    res.json({
      ok: true,
      summary: getKnowledgeSummary(knowledge),
    });
  } catch (error) {
    const cachedKnowledge = await ensureKnowledge({
      forceRefresh: false,
      useWebFallback: false,
    }).catch(() => null);

    if (cachedKnowledge) {
      const fallbackMessage =
        "No se pudo actualizar desde api.jquery.com; se mantiene la base local cacheada.";
      res.json({
        ok: true,
        summary: getKnowledgeSummary(cachedKnowledge),
        warning: `${fallbackMessage} Detalle técnico: ${error.message}`,
      });
      return;
    }

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/analyze/paths", async (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  const job = analysisJobStore.createJob("paths");
  res.status(202).json({
    ok: true,
    jobId: job.id,
  });

  (async () => {
    try {
      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "collect-files",
        message: "Localizando archivos compatibles...",
        progress: 5,
      });

      const { files: filePaths, missing } = await collectSupportedFiles(paths);

      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "prepare-session",
        message: `Preparando sesión de trabajo (${filePaths.length} archivos)...`,
        progress: 80,
        processedFiles: filePaths.length,
        totalFiles: filePaths.length,
      });

      const files = await enrichPathEntriesWithLastModified(filePaths);
      const session = analysisSessionStore.createSession("path", {
        files,
        missingPaths: missing,
      });
      const sessionPayload = {
        mode: "session-ready",
        session: analysisSessionStore.toPublic(session),
      };

      analysisJobStore.completeJob(job.id, sessionPayload);
    } catch (error) {
      const message =
        error instanceof QueueLimitError || error?.code === "ANALYSIS_QUEUE_LIMIT"
          ? error.message
          : error?.message || "Error preparando la sesión de rutas.";
      analysisJobStore.failJob(job.id, message);
    }
  })();
});

app.post("/api/analyze/upload", async (req, res) => {
  const uploadFiles = Array.isArray(req.body?.files) ? req.body.files : [];
  const job = analysisJobStore.createJob("upload");
  res.status(202).json({
    ok: true,
    jobId: job.id,
  });

  (async () => {
    try {
      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "prepare-upload",
        message: "Preparando archivos seleccionados...",
        progress: 5,
      });

      const files = normalizeUploadFiles(uploadFiles, (progress) => {
        const total = Number(progress.totalFiles || 0);
        const processed = Number(progress.processedFiles || 0);
        const mapped =
          total > 0
            ? Math.min(85, Math.max(5, 5 + Math.round((processed / total) * 80)))
            : 85;
        analysisJobStore.updateJob(job.id, {
          status: "running",
          stage: "prepare-upload",
          message: `Preparando archivos (${processed}/${total || uploadFiles.length})`,
          progress: mapped,
          processedFiles: processed,
          totalFiles: total || uploadFiles.length,
        });
      });

      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "prepare-session",
        message: `Preparando sesión de trabajo (${files.length} archivos)...`,
        progress: 90,
        processedFiles: files.length,
        totalFiles: files.length,
      });

      const session = analysisSessionStore.createSession("upload", {
        files,
        missingPaths: [],
      });
      const sessionPayload = {
        mode: "session-ready",
        session: analysisSessionStore.toPublic(session),
      };

      analysisJobStore.completeJob(job.id, sessionPayload);
    } catch (error) {
      const message =
        error instanceof QueueLimitError || error?.code === "ANALYSIS_QUEUE_LIMIT"
          ? error.message
          : error?.message || "Error preparando la sesión de subida.";
      analysisJobStore.failJob(job.id, message);
    }
  })();
});

app.post("/api/analyze/session-file", (req, res) => {
  const sessionId = String(req.body?.sessionId || "").trim();
  const filePath = String(req.body?.filePath || "").trim();
  if (!sessionId) {
    res.status(400).json({
      ok: false,
      error: "Debes indicar una sesión de análisis válida.",
    });
    return;
  }
  if (!filePath) {
    res.status(400).json({
      ok: false,
      error: "Debes indicar el archivo a analizar.",
    });
    return;
  }

  const session = analysisSessionStore.touchSession(sessionId);
  if (!session) {
    res.status(404).json({
      ok: false,
      error: "No se encontró la sesión de análisis indicada.",
    });
    return;
  }

  const job = analysisJobStore.createJob("session-file");
  res.status(202).json({
    ok: true,
    jobId: job.id,
  });

  (async () => {
    try {
      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "load-knowledge",
        message: "Cargando conocimiento de jQuery...",
        progress: 2,
      });

      const knowledge = await ensureKnowledge({ useWebFallback: false });

      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "resolve-includes",
        message: "Resolviendo includes recursivos...",
        progress: 8,
      });

      const resolverProgress = (progress) => {
        const total = Number(progress.totalFiles || 0);
        const processed = Number(progress.processedFiles || 0);
        const mapped = Math.min(25, Math.max(8, 8 + Math.min(processed, 17)));
        analysisJobStore.updateJob(job.id, {
          status: "running",
          stage: "resolve-includes",
          message: `Resolviendo includes (${processed}/${total || processed})`,
          progress: mapped,
          processedFiles: processed,
          totalFiles: total,
        });
      };

      const recursive =
        session.type === "upload"
          ? collectUploadRecursiveSources(session, filePath, resolverProgress)
          : await collectPathRecursiveSources(session, filePath, resolverProgress);

      const sources = recursive.sources || [];
      if (sources.length === 0) {
        throw new Error(
          "No se pudieron cargar archivos del árbol recursivo para el análisis.",
        );
      }

      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "queue",
        message: "Esperando turno en la cola de análisis...",
        progress: 26,
        processedFiles: 0,
        totalFiles: sources.length,
      });

      const analysis = await analysisWorkerPool.analyzeSources(sources, knowledge, {
        sourceType: session.type === "upload" ? "upload" : "path",
        onProgress: (progress) => {
          const mapped = Math.min(
            99,
            Math.max(26, 26 + Math.round((Number(progress.progress || 0) / 100) * 73)),
          );
          analysisJobStore.updateJob(job.id, {
            status: "running",
            stage: progress.stage || "analyze-files",
            message:
              progress.message || "Analizando archivo seleccionado y sus includes...",
            progress: mapped,
            processedFiles: progress.processedFiles,
            totalFiles: progress.totalFiles,
          });
        },
      });

      const compactAnalysis = compactAnalysisForUi(analysis);
      compactAnalysis.sessionId = session.id;
      compactAnalysis.selectedFile = recursive.selectedFilePath;
      analysisJobStore.completeJob(job.id, compactAnalysis);
    } catch (error) {
      const message =
        error instanceof QueueLimitError || error?.code === "ANALYSIS_QUEUE_LIMIT"
          ? error.message
          : error?.message || "Error en el análisis por archivo seleccionado.";
      analysisJobStore.failJob(job.id, message);
    }
  })();
});

app.get("/api/analyze/jobs/:jobId", (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  const job = analysisJobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({
      ok: false,
      error: "No se encontró el análisis solicitado.",
    });
    return;
  }

  res.json({
    ok: true,
    job: analysisJobStore.toPublic(job, { includeAnalysis: false }),
  });
});

app.get("/api/analyze/jobs/:jobId/result", (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  const job = analysisJobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({
      ok: false,
      error: "No se encontró el análisis solicitado.",
    });
    return;
  }

  if (job.status === "error") {
    res.status(409).json({
      ok: false,
      error: job.error || "El análisis terminó con error.",
    });
    return;
  }

  if (job.status !== "done") {
    res.status(409).json({
      ok: false,
      error: "El análisis aún no ha finalizado.",
    });
    return;
  }

  res.json({
    ok: true,
    job: analysisJobStore.toPublic(job, { includeAnalysis: false }),
    analysis: job.analysis,
  });
});

app.post("/api/file-preview", async (req, res) => {
  const inputPath = String(req.body?.path || "").trim();
  if (!inputPath) {
    res.status(400).json({
      ok: false,
      error: "Debes indicar la ruta del archivo para preview.",
    });
    return;
  }

  try {
    const file = await loadSingleFileContent(inputPath);
    res.json({
      ok: true,
      filePath: file.path,
      content: file.content,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo cargar preview del archivo.",
    });
  }
});

app.use((error, _req, res, next) => {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    res.status(413).json({
      ok: false,
      error:
        `La subida supera el límite permitido del servidor (${REQUEST_BODY_LIMIT}). ` +
        "Reduce la selección o aumenta REQUEST_BODY_LIMIT.",
    });
    return;
  }
  next(error);
});

app.use((_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const server = app.listen(PORT, HOST, () => {
  const publicHost = HOST === "0.0.0.0" ? "<IP-VDI>" : HOST;
  process.stdout.write(
    `Servidor iniciado en http://${publicHost}:${PORT} - Analizador jQuery 3.7.1\n`,
  );
});

async function shutdown() {
  await analysisWorkerPool.shutdown().catch(() => {});
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
