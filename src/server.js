require("./utils/node18-undici-polyfill");

const path = require("node:path");
const express = require("express");
const { HOST, PORT, ROOT_DIR, REQUEST_BODY_LIMIT } = require("./config");
const {
  ensureKnowledge,
  getKnowledgeSummary,
} = require("./services/jquery-knowledge-service");
const {
  QueueLimitError,
  getAnalysisWorkerPool,
} = require("./services/analysis-worker-pool");
const { loadSingleFileContent } = require("./utils/fs-utils");
const { analysisJobStore } = require("./services/analysis-job-store");

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
    }))
    : [];

  return {
    ...analysis,
    files: compactFiles,
    findings: compactFindings,
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
        stage: "load-knowledge",
        message: "Cargando conocimiento de jQuery...",
        progress: 1,
      });

      const knowledge = await ensureKnowledge({ useWebFallback: false });

      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "queue",
        message: "Esperando turno en la cola de análisis...",
        progress: 2,
      });

      const analysis = await analysisWorkerPool.analyzePaths(paths, knowledge, {
        onProgress: (progress) => {
          analysisJobStore.updateJob(job.id, {
            status: "running",
            stage: progress.stage || "analyze-files",
            message: progress.message || "Analizando archivos...",
            progress: progress.progress,
            processedFiles: progress.processedFiles,
            totalFiles: progress.totalFiles,
          });
        },
      });

      analysisJobStore.completeJob(job.id, compactAnalysisForUi(analysis));
    } catch (error) {
      const message =
        error instanceof QueueLimitError || error?.code === "ANALYSIS_QUEUE_LIMIT"
          ? error.message
          : error?.message || "Error en el análisis de rutas.";
      analysisJobStore.failJob(job.id, message);
    }
  })();
});

app.post("/api/analyze/upload", async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const job = analysisJobStore.createJob("upload");
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
        progress: 1,
      });

      const knowledge = await ensureKnowledge({ useWebFallback: false });

      analysisJobStore.updateJob(job.id, {
        status: "running",
        stage: "queue",
        message: "Esperando turno en la cola de análisis...",
        progress: 2,
      });

      const analysis = await analysisWorkerPool.analyzeUploads(files, knowledge, {
        onProgress: (progress) => {
          analysisJobStore.updateJob(job.id, {
            status: "running",
            stage: progress.stage || "analyze-files",
            message: progress.message || "Analizando archivos...",
            progress: progress.progress,
            processedFiles: progress.processedFiles,
            totalFiles: progress.totalFiles,
          });
        },
      });

      analysisJobStore.completeJob(job.id, compactAnalysisForUi(analysis));
    } catch (error) {
      const message =
        error instanceof QueueLimitError || error?.code === "ANALYSIS_QUEUE_LIMIT"
          ? error.message
          : error?.message || "Error en el análisis por subida.";
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
