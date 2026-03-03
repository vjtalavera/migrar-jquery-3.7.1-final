const elements = {
  knowledgeStatus: document.querySelector("#knowledgeStatus"),
  refreshKnowledgeBtn: document.querySelector("#refreshKnowledgeBtn"),
  webFallbackCheckbox: document.querySelector("#webFallbackCheckbox"),
  pathsInput: document.querySelector("#pathsInput"),
  analyzePathsBtn: document.querySelector("#analyzePathsBtn"),
  filesPicker: document.querySelector("#filesPicker"),
  folderPicker: document.querySelector("#folderPicker"),
  analyzeUploadBtn: document.querySelector("#analyzeUploadBtn"),
  uploadSummary: document.querySelector("#uploadSummary"),
  summaryCards: document.querySelector("#summaryCards"),
  resultTime: document.querySelector("#resultTime"),
  analysisProgress: document.querySelector("#analysisProgress"),
  analysisProgressLabel: document.querySelector("#analysisProgressLabel"),
  analysisProgressValue: document.querySelector("#analysisProgressValue"),
  analysisProgressBar: document.querySelector("#analysisProgressBar"),
  groupedResults: document.querySelector("#groupedResults"),
};

const ALLOWED_EXTENSIONS = new Set([".jsp", ".js", ".html", ".htm"]);
const MAX_INITIAL_RENDERED_FILE_GROUPS = 600;
const uploadFilesByPath = new Map();
let renderedFilesByPath = new Map();
let renderedFindingsByFile = new Map();
const previewContentCache = new Map();
const previewContentLoaders = new Map();
let includesScrollSyncRaf = 0;
let activeAnalysisSession = null;
let catalogFilterText = "";

function getExtension(fileName) {
  const index = fileName.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return fileName.slice(index).toLowerCase();
}

function toPathRows(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function decodeTextFromArrayBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      return new TextDecoder("iso-8859-1").decode(bytes);
    }
  }
}

function formatDateTime(value) {
  if (value == null || value === "") {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function clearPreviewState() {
  renderedFilesByPath = new Map();
  renderedFindingsByFile = new Map();
  previewContentCache.clear();
  previewContentLoaders.clear();
}

async function callApi(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
    },
    ...options,
  });

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const isJson = contentType.includes("application/json");
  const data = isJson
    ? await response.json().catch(() => ({}))
    : (() => ({}))();

  if (!isJson) {
    const rawText = await response.text().catch(() => "");
    const normalizedText = String(rawText || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalizedText) {
      data.error = normalizedText.slice(0, 240);
    }
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Error HTTP ${response.status} en ${url}`);
  }

  return data;
}

function setKnowledgeStatus(message, type = "loading") {
  elements.knowledgeStatus.className = `status-box ${type}`;
  elements.knowledgeStatus.textContent = message;
}

function renderKnowledgeSummary(summary) {
  if (!summary) {
    setKnowledgeStatus("No hay datos de conocimiento cargados.", "loading");
    return;
  }

  const lines = [
    `Última actualización: ${new Date(summary.generatedAt).toLocaleString()}`,
    `Entradas analizadas: ${summary.entries}`,
    `Deprecadas: ${summary.deprecatedEntries}`,
    `Removidas: ${summary.removedEntries}`,
  ];

  setKnowledgeStatus(lines.join(" | "), "ready");
}

function renderSummaryCards(summary) {
  const cards = [
    ["Archivos analizados", summary.totalFilesAnalyzed],
    ["Archivos con hallazgos", summary.filesWithFindings],
    ["Hallazgos totales", summary.totalFindings],
    ["Removed", summary.bySeverity.removed],
    ["Deprecated", summary.bySeverity.deprecated],
  ];

  elements.summaryCards.innerHTML = cards
    .map(
      ([label, value]) => `
      <article class="summary-card">
        <div class="label">${label}</div>
        <div class="value">${value}</div>
      </article>
    `,
    )
    .join("");
}

function renderSessionCards(session) {
  if (!session) {
    elements.summaryCards.innerHTML = "";
    return;
  }

  const cards = [
    ["Archivos disponibles", session.totalFiles || 0],
    ["Modo", session.type === "upload" ? "Selección local" : "Rutas"],
    ["Estado", "Pendiente de análisis"],
  ];

  elements.summaryCards.innerHTML = cards
    .map(
      ([label, value]) => `
      <article class="summary-card">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
      </article>
    `,
    )
    .join("");
}

function clearRenderedResults() {
  clearPreviewState();
  activeAnalysisSession = null;
  catalogFilterText = "";
  elements.resultTime.textContent = "Sin ejecución";
  hideAnalysisProgress();
  elements.summaryCards.innerHTML = "";
  elements.groupedResults.innerHTML = `
    <div class="empty-row empty-block">Selecciona archivos o carpeta y ejecuta un análisis.</div>
  `;
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function showAnalysisProgress(initialMessage = "Preparando análisis...") {
  elements.analysisProgress.classList.remove("hidden");
  elements.analysisProgress.classList.remove("error");
  elements.analysisProgressLabel.textContent = initialMessage;
  elements.analysisProgressValue.textContent = "0%";
  elements.analysisProgressBar.style.width = "0%";
}

function updateAnalysisProgress(progress, message = "", state = "running") {
  const percent = formatPercent(progress);
  elements.analysisProgress.classList.remove("hidden");
  elements.analysisProgress.classList.toggle("error", state === "error");
  elements.analysisProgressBar.style.width = `${percent}%`;
  elements.analysisProgressValue.textContent = `${percent}%`;
  if (message) {
    elements.analysisProgressLabel.textContent = message;
  }
}

function hideAnalysisProgress() {
  elements.analysisProgress.classList.add("hidden");
  elements.analysisProgress.classList.remove("error");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function flushUi() {
  await nextFrame();
  await sleep(0);
}

function fallbackStageMessage(job) {
  if (!job || typeof job !== "object") {
    return "Procesando solicitud...";
  }

  if (job.stage === "queue" || job.status === "queued") {
    return "Esperando turno en la cola de análisis...";
  }
  if (job.stage === "load-knowledge") {
    return "Cargando conocimiento de jQuery...";
  }
  if (job.stage === "collect-files") {
    return "Localizando archivos compatibles...";
  }
  if (job.stage === "read-files") {
    return "Cargando contenido de archivos...";
  }
  if (job.stage === "prepare-session") {
    return "Preparando sesión de archivos...";
  }
  if (job.stage === "prepare-upload") {
    return "Preparando archivos seleccionados...";
  }
  if (job.stage === "resolve-includes") {
    return "Resolviendo includes recursivos...";
  }
  if (job.stage === "done" || job.status === "done") {
    return "Proceso completado.";
  }
  return "Procesando solicitud...";
}

async function waitForAnalysisJob(jobId) {
  const normalizedJobId = String(jobId || "").trim();
  const safeJobId = encodeURIComponent(normalizedJobId);
  if (!normalizedJobId) {
    throw new Error("No se recibió un identificador válido de análisis.");
  }

  while (true) {
    const data = await callApi(`/api/analyze/jobs/${safeJobId}`);
    const job = data.job || {};
    const message = job.message || fallbackStageMessage(job);
    const processedFiles = Number(job.processedFiles || 0);
    const totalFiles = Number(job.totalFiles || 0);
    const finishedScanning = totalFiles > 0 && processedFiles >= totalFiles;
    const canUseFastCompleteHint =
      job.stage === "analyze-files" || job.stage === "resolve-includes";
    if (
      job.status !== "done" &&
      job.status !== "error" &&
      finishedScanning &&
      canUseFastCompleteHint
    ) {
      updateAnalysisProgress(
        100,
        "Archivos procesados. Finalizando...",
        "running",
      );
    } else {
      updateAnalysisProgress(
        job.progress ?? 0,
        message,
        job.status === "error" ? "error" : "running",
      );
    }

    if (job.status === "done") {
      updateAnalysisProgress(
        100,
        "Descargando resultado...",
        "running",
      );
      await flushUi();
      const result = await callApi(`/api/analyze/jobs/${safeJobId}/result`);
      updateAnalysisProgress(100, "Análisis completado.", "running");
      await flushUi();
      return result.analysis;
    }
    if (job.status === "error") {
      throw new Error(job.error || "Falló la ejecución del análisis.");
    }

    await sleep(finishedScanning ? 1100 : 550);
  }
}

function clearSelectedInputs(options = {}) {
  const clearFilesPicker = options.clearFilesPicker ?? false;
  const clearFolderPicker = options.clearFolderPicker ?? false;

  uploadFilesByPath.clear();
  updateUploadSummary();

  if (clearFilesPicker) {
    elements.filesPicker.value = "";
  }
  if (clearFolderPicker) {
    elements.folderPicker.value = "";
  }
}

function severityClass(severity) {
  if (severity === "removed") {
    return "sev-pill sev-removed";
  }
  if (severity === "deprecated") {
    return "sev-pill sev-deprecated";
  }
  return "sev-pill sev-info";
}

function filePathToAnchorId(filePath, index) {
  const normalized = encodeURIComponent(filePath).replace(/%/g, "");
  return `file-group-${index}-${normalized}`;
}

function normalizePathForCompare(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function findIncludedFilePath(includeValue, analyzedFilePaths) {
  const normalizedInclude = normalizePathForCompare(includeValue).replace(/^\.?\//, "");
  if (!normalizedInclude) {
    return null;
  }

  let bestPath = null;
  let bestScore = -1;

  for (const filePath of analyzedFilePaths) {
    const normalizedFilePath = normalizePathForCompare(filePath);
    if (normalizedFilePath.endsWith(normalizedInclude)) {
      const score = normalizedInclude.length + 1000;
      if (score > bestScore) {
        bestScore = score;
        bestPath = filePath;
      }
      continue;
    }

    const includeBase = normalizedInclude.split("/").pop();
    const fileBase = normalizedFilePath.split("/").pop();
    if (includeBase && fileBase === includeBase) {
      const score = includeBase.length;
      if (score > bestScore) {
        bestScore = score;
        bestPath = filePath;
      }
    }
  }

  return bestPath;
}

function renderIncludeReferences(
  includeReferences,
  analyzedFilePaths,
  groupedByFile,
  fileIdByPath,
) {
  if (!includeReferences.length) {
    return '<span class="no-includes">Sin includes detectados.</span>';
  }

  return includeReferences
    .map((ref) => {
      const matchedFilePath = findIncludedFilePath(ref.value, analyzedFilePaths);
      const includeFindings = matchedFilePath
        ? groupedByFile.get(matchedFilePath) || []
        : [];
      const hasIncludeIssues = Boolean(matchedFilePath && includeFindings.length > 0);
      const targetId = matchedFilePath ? fileIdByPath.get(matchedFilePath) : "";
      const includeRefHtml = matchedFilePath
        ? `<a class="include-file-link" href="#${escapeAttribute(targetId)}" data-target-id="${escapeAttribute(targetId)}"><code>${escapeHtml(ref.value)}</code></a>`
        : /^https?:\/\//i.test(ref.value)
          ? `<a href="${escapeAttribute(ref.value)}" target="_blank" rel="noreferrer"><code>${escapeHtml(ref.value)}</code></a>`
          : `<code>${escapeHtml(ref.value)}</code>`;

      const statusHtml = matchedFilePath
        ? `<span class="include-inline-status ${includeFindings.length > 0 ? "issue-note" : "ok-note"}">${includeFindings.length} problemas</span>`
        : '<span class="include-inline-status neutral-note">No analizado</span>';
      const findingsHtml =
        hasIncludeIssues
          ? `
              <div class="include-findings-list">
                ${includeFindings
                  .map((finding) => {
                    const localizedInstruction =
                      finding.detectedInstruction || finding.localizedInstruction || finding.sourceLine || "";
                    const correctedInstruction =
                      finding.correctedInstruction || finding.recommendation || "";

                    return `
                      <div class="include-finding-item">
                        <div class="include-finding-line">
                          Línea
                          <a
                            class="finding-line-jump"
                            href="#"
                            data-file-path="${escapeAttribute(matchedFilePath)}"
                            data-line="${escapeAttribute(finding.line)}"
                          >
                            <code>${escapeHtml(finding.line)}</code>
                          </a>
                        </div>
                        <div class="include-finding-content">
                          <code class="include-finding-code include-finding-content-code">${escapeHtml(localizedInstruction)}</code>
                        </div>
                        <div class="include-finding-content">
                          <code class="include-finding-code include-finding-solution-code">${escapeHtml(correctedInstruction)}</code>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            `
          : "";

      const headerHtml = `
        <span class="include-source">${escapeHtml(ref.source)}</span>
        <span class="include-file-main">${includeRefHtml}</span>
        ${statusHtml}
      `;

      if (hasIncludeIssues) {
        return `
          <details class="include-item include-item-issues">
            <summary class="include-head include-head-toggle">
              ${headerHtml}
            </summary>
            ${findingsHtml}
          </details>
        `;
      }

      return `
        <div class="include-item">
          <div class="include-head">
            ${headerHtml}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderPreviewContent(content) {
  const normalized = String(content || "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  const lines = normalized.split("\n");

  return lines
    .map(
      (lineText, lineIndex) => `
        <div class="preview-line" data-line-number="${lineIndex + 1}">
          <span class="preview-line-number">${lineIndex + 1}</span>
          <span class="preview-line-text">${escapeHtml(lineText)}</span>
        </div>
      `,
    )
    .join("");
}

function fileBaseName(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const chunks = normalized.split("/").filter(Boolean);
  return chunks[chunks.length - 1] || normalized;
}

function buildCorrectedDownloadName(filePath) {
  const original = fileBaseName(filePath) || "archivo";
  const dotIndex = original.lastIndexOf(".");
  if (dotIndex <= 0) {
    return `${original}.corregido`;
  }
  return `${original.slice(0, dotIndex)}.corregido${original.slice(dotIndex)}`;
}

function buildCorrectedLinesByNumber(findings) {
  const corrections = new Map();
  for (const item of findings || []) {
    const lineNumber = Number(item?.line);
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      continue;
    }
    const correctedLine = String(item?.correctedInstruction || "");
    if (!correctedLine.trim()) {
      continue;
    }
    const existing = corrections.get(lineNumber) || "";
    if (!existing || correctedLine.length > existing.length) {
      corrections.set(lineNumber, correctedLine);
    }
  }
  return corrections;
}

function applyCorrectionsToContent(content, correctionsByLine) {
  const raw = String(content || "");
  const normalized = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");

  correctionsByLine.forEach((correctedLine, lineNumber) => {
    const index = lineNumber - 1;
    if (index >= 0 && index < lines.length) {
      lines[index] = correctedLine;
    }
  });

  const eol = raw.includes("\r\n") ? "\r\n" : raw.includes("\r") ? "\r" : "\n";
  return lines.join(eol);
}

function downloadTextFile(fileName, content) {
  const blob = new Blob(["\uFEFF", String(content || "")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadCorrectedFile(filePath) {
  const fileFindings = renderedFindingsByFile.get(filePath) || [];
  const correctionsByLine = buildCorrectedLinesByNumber(fileFindings);
  if (correctionsByLine.size === 0) {
    throw new Error("Este archivo no tiene correcciones recomendadas para exportar.");
  }

  const originalContent = await loadPreviewContent(filePath);
  const correctedContent = applyCorrectionsToContent(originalContent, correctionsByLine);
  const downloadName = buildCorrectedDownloadName(filePath);
  downloadTextFile(downloadName, correctedContent);
}

function getFilteredSessionFiles(session) {
  const files = Array.isArray(session?.files) ? session.files : [];
  const needle = catalogFilterText.trim().toLowerCase();
  if (!needle) {
    return files;
  }
  return files.filter((item) => String(item.path || "").toLowerCase().includes(needle));
}

function renderSessionCatalog(session) {
  const files = getFilteredSessionFiles(session);
  const visibleFiles = files;

  elements.groupedResults.innerHTML = `
    <div class="session-catalog">
      <div class="session-catalog-head">
        <input
          id="sessionCatalogFilter"
          class="session-catalog-filter"
          type="search"
          placeholder="Filtrar por ruta o archivo..."
          value="${escapeAttribute(catalogFilterText)}"
        />
        <span class="session-catalog-count">${files.length} archivos</span>
      </div>
      <div class="session-catalog-list">
        ${
          visibleFiles.length > 0
            ? visibleFiles
                .map(
                  (item) => {
                    const lastUpdatedLabel = formatDateTime(item.lastModified) || "N/D";
                    return `
                    <button
                      type="button"
                      class="session-file-item"
                      data-file-path="${escapeAttribute(item.path)}"
                    >
                      <code class="session-file-path">${escapeHtml(item.path)}</code>
                      <span class="session-file-meta">| Última actualización: ${escapeHtml(lastUpdatedLabel)}</span>
                    </button>
                  `;
                  },
                )
                .join("")
            : '<div class="empty-row">No hay archivos que coincidan con el filtro.</div>'
        }
      </div>
    </div>
  `;
}

function renderFindingsRows(findings, files = [], options = {}) {
  const collapseAll = Boolean(options.collapseAll);
  const selectedFilePath = String(options.selectedFile || "").trim();
  const maxFileGroups =
    Number.isInteger(options.maxFileGroups) && options.maxFileGroups > 0
      ? options.maxFileGroups
      : 0;
  const filesByPath = new Map(
    files.map((file) => [file.path, file]),
  );
  renderedFilesByPath = filesByPath;
  const analyzedFilePaths = files.map((file) => file.path);

  if (!findings.length && analyzedFilePaths.length === 0) {
    renderedFindingsByFile = new Map();
    elements.groupedResults.innerHTML = `
      <div class="empty-row empty-block">No se detectaron APIs deprecadas/obsoletas con las reglas cargadas.</div>
    `;
    return;
  }

  const groupedByFile = new Map();
  for (const finding of findings) {
    if (!groupedByFile.has(finding.file)) {
      groupedByFile.set(finding.file, []);
    }
    groupedByFile.get(finding.file).push(finding);
  }
  renderedFindingsByFile = groupedByFile;

  const includeTargetPaths = new Set();
  for (const file of files) {
    const references = Array.isArray(file.includeReferences)
      ? file.includeReferences
      : [];
    for (const ref of references) {
      const matched = findIncludedFilePath(ref.value, analyzedFilePaths);
      if (matched) {
        includeTargetPaths.add(matched);
      }
    }
  }

  const sortedFiles = Array.from(
    new Set([...analyzedFilePaths, ...groupedByFile.keys(), ...includeTargetPaths]),
  ).sort((a, b) => a.localeCompare(b));

  if (selectedFilePath) {
    const selectedIndex = sortedFiles.indexOf(selectedFilePath);
    if (selectedIndex > 0) {
      sortedFiles.splice(selectedIndex, 1);
      sortedFiles.unshift(selectedFilePath);
    }
  }
  const visibleFiles = maxFileGroups > 0
    ? sortedFiles.slice(0, maxFileGroups)
    : sortedFiles;
  const hasHiddenFiles = visibleFiles.length < sortedFiles.length;
  const fileIdByPath = new Map(
    visibleFiles.map((filePath, index) => [filePath, filePathToAnchorId(filePath, index)]),
  );

  elements.groupedResults.innerHTML = visibleFiles
    .map((filePath, fileIndex) => {
      const fileFindings = groupedByFile.get(filePath) || [];
      const hasFindings = fileFindings.length > 0;
      const fileInfo = filesByPath.get(filePath) || {};
      const lastUpdatedLabel = formatDateTime(fileInfo.lastModified) || "N/D";
      const includeReferences = Array.isArray(fileInfo.includeReferences)
        ? fileInfo.includeReferences
        : [];
      const severityCounts = {
        removed: fileFindings.filter((item) => item.severity === "removed").length,
        deprecated: fileFindings.filter((item) => item.severity === "deprecated").length,
      };
      const hasDownloadableCorrection = fileFindings.some((item) =>
        String(item.correctedInstruction || "").trim().length > 0,
      );
      const includedFilesWithIssues = new Set();
      for (const ref of includeReferences) {
        const matchedFilePath = findIncludedFilePath(ref.value, analyzedFilePaths);
        if (!matchedFilePath || matchedFilePath === filePath) {
          continue;
        }
        const matchedFindings = groupedByFile.get(matchedFilePath) || [];
        if (matchedFindings.length > 0) {
          includedFilesWithIssues.add(matchedFilePath);
        }
      }
      const includesWithIssuesCount = includedFilesWithIssues.size;
      const includeHtml = renderIncludeReferences(
        includeReferences,
        analyzedFilePaths,
        groupedByFile,
        fileIdByPath,
      );
      const rowSpanCount = hasFindings ? fileFindings.length + 1 : 2;

      const rows = hasFindings
        ? fileFindings
            .map((item, itemIndex) => {
              const apiMeta = [
                item.deprecatedIn ? `dep: ${item.deprecatedIn}` : "",
                item.removedIn ? `rem: ${item.removedIn}` : "",
              ]
                .filter(Boolean)
                .join(" | ");
              const correctedInstructionText = String(
                item.correctedInstruction || item.recommendation || "",
              ).replace(/^\s+/, "");

              return `
                <tr>
                  <td><span class="${severityClass(item.severity)}">${item.severity}</span></td>
                  <td>
                    <a
                      class="finding-line-jump"
                      href="#"
                      data-file-path="${escapeAttribute(filePath)}"
                      data-line="${escapeAttribute(item.line)}"
                    >
                      <code>${escapeHtml(item.line)}</code>
                    </a>
                  </td>
                  <td>
                    <a
                      class="finding-line-jump"
                      href="#"
                      data-file-path="${escapeAttribute(filePath)}"
                      data-line="${escapeAttribute(item.line)}"
                    >
                      <code class="localized-line">${escapeHtml(item.localizedInstruction || item.sourceLine)}</code>
                    </a>
                  </td>
                  <td><code class="corrected-line">${escapeHtml(correctedInstructionText)}</code></td>
                  <td class="api-col">
                    <span class="api-single-line">
                      <a href="${item.apiUrl}" target="_blank" rel="noreferrer">${escapeHtml(item.apiTitle)}</a>
                      ${apiMeta ? `<span class="api-meta">| ${escapeHtml(apiMeta)}</span>` : ""}
                    </span>
                  </td>
                  ${
                    itemIndex === 0
                      ? `<td class="includes-col" rowspan="${rowSpanCount}"><div class="includes-scroll">${includeHtml}</div></td>`
                      : ""
                  }
                </tr>
              `;
            })
            .join("")
        : `
          <tr>
            <td colspan="5" class="no-file-findings-cell">Sin incidencias detectadas en este archivo.</td>
            <td class="includes-col" rowspan="${rowSpanCount}"><div class="includes-scroll">${includeHtml}</div></td>
          </tr>
        `;

      const previewRow = `
        <tr class="preview-row hidden" data-preview-row-path="${escapeAttribute(filePath)}">
          <td colspan="5" class="preview-main-col">
            <div class="inline-file-preview-table">
              <div class="inline-file-preview-body">
                <div class="preview-placeholder">Selecciona una línea para cargar el preview del archivo.</div>
              </div>
            </div>
          </td>
        </tr>
      `;

      return `
        <details id="${escapeAttribute(fileIdByPath.get(filePath) || "")}" data-file-path="${escapeAttribute(filePath)}" class="file-group" ${!collapseAll && fileIndex === 0 ? "open" : ""}>
          <summary>
            <span class="file-summary-main">
              <code>${escapeHtml(filePath)}</code>
              <span class="file-summary-updated">| Última actualización: ${escapeHtml(lastUpdatedLabel)}</span>
            </span>
            <span class="file-chip">${fileFindings.length} incidencias</span>
            <span class="file-chip removed-chip">${severityCounts.removed} removed</span>
            <span class="file-chip deprecated-chip">${severityCounts.deprecated} deprecated</span>
            <span class="file-chip include-issue-chip">${includesWithIssuesCount} incluidos con incidencias</span>
            ${
              hasDownloadableCorrection
                ? `<button type="button" class="file-download-corrected-btn" data-file-path="${escapeAttribute(filePath)}">Descargar corregido</button>`
                : ""
            }
          </summary>
          <div class="table-wrap">
            <table class="file-results-table">
              <thead>
                <tr>
                  <th>Severidad</th>
                  <th>Línea</th>
                  <th>Instrucción localizada</th>
                  <th>Corrección recomendada</th>
                  <th>Api detectada</th>
                  <th class="includes-col">Archivos incluidos</th>
                </tr>
              </thead>
              <tbody>${rows}${previewRow}</tbody>
            </table>
          </div>
        </details>
      `;
    })
    .join("");

  if (hasHiddenFiles) {
    const hiddenCount = sortedFiles.length - visibleFiles.length;
    elements.groupedResults.insertAdjacentHTML(
      "beforeend",
      `
        <div class="results-overflow-note">
          Se muestran ${visibleFiles.length} de ${sortedFiles.length} archivos para mantener la interfaz fluida.
          <button id="showAllResultsBtn" class="btn btn-primary" type="button">
            Mostrar ${hiddenCount} archivos restantes
          </button>
        </div>
      `,
    );
  }
}

function syncIncludesScrollHeights() {
  const fileGroups = elements.groupedResults.querySelectorAll(".file-group");
  fileGroups.forEach((group) => {
    if (!(group instanceof HTMLElement)) {
      return;
    }

    const includesScroll = group.querySelector(".includes-scroll");
    if (!(includesScroll instanceof HTMLElement)) {
      return;
    }

    if (group instanceof HTMLDetailsElement && !group.open) {
      includesScroll.style.removeProperty("--includes-scroll-max-height");
      return;
    }

    const tbody = group.querySelector("tbody");
    if (!(tbody instanceof HTMLElement)) {
      return;
    }

    const bodyHeight = Math.floor(tbody.getBoundingClientRect().height);
    if (bodyHeight <= 0) {
      return;
    }

    const includesCell = includesScroll.closest("td.includes-col");
    const styles = includesCell instanceof HTMLElement ? getComputedStyle(includesCell) : null;
    const paddingTop = styles ? Number.parseFloat(styles.paddingTop) || 0 : 0;
    const paddingBottom = styles ? Number.parseFloat(styles.paddingBottom) || 0 : 0;
    const maxHeight = Math.max(56, bodyHeight - paddingTop - paddingBottom);
    includesScroll.style.setProperty("--includes-scroll-max-height", `${maxHeight}px`);
  });
}

function scheduleIncludesScrollSync() {
  if (includesScrollSyncRaf) {
    cancelAnimationFrame(includesScrollSyncRaf);
  }
  includesScrollSyncRaf = requestAnimationFrame(() => {
    includesScrollSyncRaf = 0;
    syncIncludesScrollHeights();
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadPreviewContent(filePath) {
  if (previewContentCache.has(filePath)) {
    return previewContentCache.get(filePath);
  }
  if (previewContentLoaders.has(filePath)) {
    return previewContentLoaders.get(filePath);
  }

  const loader = (async () => {
    const fileInfo = renderedFilesByPath.get(filePath) || {};
    let content = "";

    if (fileInfo.sourceType === "upload") {
      const uploadItem = uploadFilesByPath.get(filePath);
      if (!uploadItem?.file) {
        throw new Error(`No se encontró el archivo cargado para preview: ${filePath}`);
      }
      const arrayBuffer = await uploadItem.file.arrayBuffer();
      content = decodeTextFromArrayBuffer(arrayBuffer);
    } else {
      const data = await callApi("/api/file-preview", {
        method: "POST",
        body: JSON.stringify({
          path: filePath,
        }),
      });
      content = String(data.content || "");
    }

    previewContentCache.set(filePath, content);
    return content;
  })().finally(() => {
    previewContentLoaders.delete(filePath);
  });

  previewContentLoaders.set(filePath, loader);
  return loader;
}

async function ensurePreviewRendered(filePath, targetPreview) {
  if (!(targetPreview instanceof HTMLElement)) {
    return;
  }
  if (targetPreview.dataset.previewReady === "true") {
    return;
  }

  const previewBody = targetPreview.querySelector(".inline-file-preview-body");
  if (!(previewBody instanceof HTMLElement)) {
    return;
  }

  previewBody.innerHTML = '<div class="preview-loading">Cargando contenido del archivo...</div>';
  try {
    const content = await loadPreviewContent(filePath);
    previewBody.innerHTML = renderPreviewContent(content);
    targetPreview.dataset.previewReady = "true";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    previewBody.innerHTML = `<div class="preview-error">${escapeHtml(message)}</div>`;
    targetPreview.dataset.previewReady = "error";
  }
}

async function showInlineFilePreview(filePath) {
  const previewBlocks = elements.groupedResults.querySelectorAll(".preview-row");
  previewBlocks.forEach((block) => {
    block.classList.add("hidden");
  });

  const targetPreview = elements.groupedResults.querySelector(
    `.preview-row[data-preview-row-path="${CSS.escape(filePath)}"]`,
  );
  if (!(targetPreview instanceof HTMLElement)) {
    return;
  }

  targetPreview.classList.remove("hidden");
  await ensurePreviewRendered(filePath, targetPreview);
  scheduleIncludesScrollSync();
  targetPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function jumpToPreviewLine(filePath, lineValue) {
  const fileGroup = elements.groupedResults.querySelector(
    `.file-group[data-file-path="${CSS.escape(filePath)}"]`,
  );
  if (fileGroup instanceof HTMLDetailsElement) {
    fileGroup.open = true;
  }

  await showInlineFilePreview(filePath);

  const lineMatch = String(lineValue || "").match(/\d+/);
  if (!lineMatch) {
    return;
  }
  const lineNumber = Number.parseInt(lineMatch[0], 10);
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
    return;
  }

  const targetPreview = elements.groupedResults.querySelector(
    `.preview-row[data-preview-row-path="${CSS.escape(filePath)}"]`,
  );
  if (!(targetPreview instanceof HTMLElement)) {
    return;
  }

  elements.groupedResults
    .querySelectorAll(".preview-line.focus-line")
    .forEach((line) => line.classList.remove("focus-line"));

  const lineNode = targetPreview.querySelector(
    `.preview-line[data-line-number="${lineNumber}"]`,
  );
  if (!(lineNode instanceof HTMLElement)) {
    return;
  }

  lineNode.classList.add("focus-line");
  lineNode.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}

function enableFindingLineNavigation() {
  elements.groupedResults.querySelectorAll(".finding-line-jump").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const filePath = link.dataset.filePath;
      const line = link.dataset.line;
      if (!filePath || !line) {
        return;
      }
      jumpToPreviewLine(filePath, line).catch(showError);
    });
  });
}

function enableFilePreviewBySummary() {
  elements.groupedResults
    .querySelectorAll(".file-group > summary")
    .forEach((summary) => {
      summary.addEventListener("click", () => {
        const group = summary.parentElement;
        if (!(group instanceof HTMLElement)) {
          return;
        }
        const filePath = group.dataset.filePath;
        if (!filePath) {
          return;
        }
        setTimeout(() => {
          if (group instanceof HTMLDetailsElement && !group.open) {
            return;
          }
          showInlineFilePreview(filePath).catch(showError);
        }, 0);
      });
    });
}

function enableIncludeNavigation() {
  elements.groupedResults
    .querySelectorAll(".include-file-link[data-target-id]")
    .forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const targetId = link.dataset.targetId;
        if (!targetId) {
          return;
        }

        const target = document.getElementById(targetId);
        if (!(target instanceof HTMLElement)) {
          return;
        }

        if (target.tagName.toLowerCase() === "details") {
          target.open = true;
        }
        scheduleIncludesScrollSync();

        target.classList.add("focus-file-group");
        setTimeout(() => {
          target.classList.remove("focus-file-group");
        }, 900);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
}

function enableCorrectedFileDownload() {
  elements.groupedResults
    .querySelectorAll(".file-download-corrected-btn[data-file-path]")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!(button instanceof HTMLButtonElement) || button.disabled) {
          return;
        }
        const filePath = button.dataset.filePath;
        if (!filePath) {
          return;
        }
        button.disabled = true;
        downloadCorrectedFile(filePath)
          .catch(showError)
          .finally(() => {
            button.disabled = false;
          });
      });
    });
}

function bindResultsInteractions() {
  enableFindingLineNavigation();
  enableFilePreviewBySummary();
  enableIncludeNavigation();
  enableCorrectedFileDownload();
  scheduleIncludesScrollSync();

  const showAllBtn = document.getElementById("showAllResultsBtn");
  if (showAllBtn instanceof HTMLButtonElement) {
    showAllBtn.addEventListener("click", () => {
      showAllBtn.disabled = true;
      updateAnalysisProgress(100, "Cargando vista completa de resultados...", "running");
      setTimeout(() => {
        try {
          const files = Array.from(renderedFilesByPath.values());
          const findings = [];
          elements.groupedResults
            .querySelectorAll(".file-group[data-file-path]")
            .forEach((group) => {
              if (!(group instanceof HTMLElement)) {
                return;
              }
              const filePath = group.dataset.filePath;
              if (!filePath) {
                return;
              }
            });
        } catch {}
      }, 0);
    });
  }

  const backToCatalogBtn = document.getElementById("backToCatalogBtn");
  if (backToCatalogBtn instanceof HTMLButtonElement) {
    backToCatalogBtn.addEventListener("click", () => {
      if (!activeAnalysisSession) {
        return;
      }
      renderSessionCards(activeAnalysisSession);
      renderSessionCatalog(activeAnalysisSession);
      bindSessionCatalogInteractions();
    });
  }
}

function bindSessionCatalogInteractions() {
  const filterInput = document.getElementById("sessionCatalogFilter");
  if (filterInput instanceof HTMLInputElement) {
    filterInput.addEventListener("input", () => {
      catalogFilterText = filterInput.value || "";
      const cursorStart =
        typeof filterInput.selectionStart === "number"
          ? filterInput.selectionStart
          : catalogFilterText.length;
      const cursorEnd =
        typeof filterInput.selectionEnd === "number"
          ? filterInput.selectionEnd
          : catalogFilterText.length;
      renderSessionCatalog(activeAnalysisSession);
      bindSessionCatalogInteractions();

      const nextFilterInput = document.getElementById("sessionCatalogFilter");
      if (nextFilterInput instanceof HTMLInputElement) {
        nextFilterInput.focus();
        const maxPos = nextFilterInput.value.length;
        const safeStart = Math.min(cursorStart, maxPos);
        const safeEnd = Math.min(cursorEnd, maxPos);
        nextFilterInput.setSelectionRange(safeStart, safeEnd);
      }
    });
  }

  elements.groupedResults.querySelectorAll(".session-file-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filePath = btn.dataset.filePath;
      if (!filePath) {
        return;
      }
      analyzeSelectedSessionFile(filePath).catch(showError);
    });
  });

}

async function analyzeSelectedSessionFile(filePath) {
  if (!activeAnalysisSession?.id) {
    throw new Error("No hay una sesión activa para analizar.");
  }

  const shortName = fileBaseName(filePath);
  elements.analyzePathsBtn.disabled = true;
  elements.analyzeUploadBtn.disabled = true;
  showAnalysisProgress(`Preparando análisis de ${shortName}...`);
  elements.resultTime.textContent = `Analizando ${shortName}...`;

  try {
    const data = await callApi("/api/analyze/session-file", {
      method: "POST",
      body: JSON.stringify({
        sessionId: activeAnalysisSession.id,
        filePath,
      }),
    });

    const analysis = await waitForAnalysisJob(data.jobId);
    updateAnalysisProgress(100, "Renderizando resultados...", "running");
    await flushUi();
    renderAnalysis(analysis, { collapseAll: false });
  } finally {
    elements.analyzePathsBtn.disabled = false;
    elements.analyzeUploadBtn.disabled = false;
  }
}

function renderAnalysis(analysis, options = {}) {
  clearPreviewState();
  elements.resultTime.textContent = `Último análisis: ${new Date().toLocaleTimeString()}`;
  renderSummaryCards(analysis.summary);
  const rowsOptions = {
    ...options,
    selectedFile:
      options.selectedFile === undefined ? analysis.selectedFile : options.selectedFile,
    maxFileGroups:
      options.maxFileGroups === undefined
        ? MAX_INITIAL_RENDERED_FILE_GROUPS
        : options.maxFileGroups,
  };
  renderFindingsRows(analysis.findings, analysis.files || [], rowsOptions);
  if (activeAnalysisSession) {
    elements.groupedResults.insertAdjacentHTML(
      "afterbegin",
      `
        <div class="session-analysis-actions">
          <button id="backToCatalogBtn" type="button" class="btn btn-primary">
            Seleccionar otro archivo
          </button>
        </div>
      `,
    );
  }
  bindResultsInteractions();

  const missing = analysis.summary.missingPaths || [];
  if (missing.length > 0) {
    setKnowledgeStatus(
      `Aviso: ${missing.length} rutas no existen y fueron omitidas.`,
      "loading",
    );
  }
}

function updateUploadSummary() {
  const files = Array.from(uploadFilesByPath.values());
  if (!files.length) {
    elements.uploadSummary.textContent = "Sin archivos seleccionados.";
    return;
  }

  const grouped = files.reduce(
    (acc, file) => {
      const ext = getExtension(file.path || file.name);
      acc[ext] = (acc[ext] || 0) + 1;
      return acc;
    },
    {},
  );
  const groups = Object.entries(grouped)
    .map(([ext, count]) => `${ext}: ${count}`)
    .join(" | ");
  elements.uploadSummary.textContent = `${files.length} archivos listos (${groups})`;
}

function mergeInputFiles(fileList) {
  const incoming = Array.from(fileList || []);
  for (const file of incoming) {
    const relative = file.webkitRelativePath || file.name;
    if (!ALLOWED_EXTENSIONS.has(getExtension(relative))) {
      continue;
    }
    uploadFilesByPath.set(relative, {
      path: relative,
      file,
    });
  }
  updateUploadSummary();
}

async function loadKnowledgeSummary() {
  setKnowledgeStatus("Cargando estado de conocimiento...", "loading");
  const data = await callApi("/api/knowledge");
  renderKnowledgeSummary(data.summary);
}

async function refreshKnowledge() {
  elements.refreshKnowledgeBtn.disabled = true;
  setKnowledgeStatus("Actualizando base desde api.jquery.com...", "loading");
  try {
    const data = await callApi("/api/knowledge/refresh", {
      method: "POST",
      body: JSON.stringify({
        useWebFallback: elements.webFallbackCheckbox.checked,
      }),
    });
    renderKnowledgeSummary(data.summary);
    if (data.warning) {
      setKnowledgeStatus(
        `${elements.knowledgeStatus.textContent} | Aviso: ${data.warning}`,
        "loading",
      );
    }
  } finally {
    elements.refreshKnowledgeBtn.disabled = false;
  }
}

function handlePreparedSession(payload) {
  const session = payload?.session || payload;
  if (!session?.id || !Array.isArray(session.files)) {
    throw new Error("No se pudo preparar la sesión de archivos.");
  }

  activeAnalysisSession = session;
  catalogFilterText = "";
  clearPreviewState();
  renderSessionCards(session);
  renderSessionCatalog(session);
  bindSessionCatalogInteractions();

  const missing = Array.isArray(session.missingPaths) ? session.missingPaths : [];
  if (missing.length > 0) {
    setKnowledgeStatus(
      `Aviso: ${missing.length} rutas no existen y fueron omitidas.`,
      "loading",
    );
  }
}

async function analyzePaths() {
  const paths = toPathRows(elements.pathsInput.value);
  if (!paths.length) {
    throw new Error("Indica al menos una ruta para analizar.");
  }

  elements.analyzePathsBtn.disabled = true;
  elements.resultTime.textContent = "Preparando sesión de rutas...";
  showAnalysisProgress("Preparando sesión de rutas...");
  try {
    const data = await callApi("/api/analyze/paths", {
      method: "POST",
      body: JSON.stringify({ paths }),
    });
    if (data.analysis?.session) {
      updateAnalysisProgress(100, "Sesión preparada.");
      handlePreparedSession(data.analysis);
      return;
    }

    const payload = await waitForAnalysisJob(data.jobId);
    updateAnalysisProgress(100, "Cargando listado de archivos...", "running");
    await flushUi();
    handlePreparedSession(payload);
    elements.resultTime.textContent = "Sesión preparada. Selecciona un archivo para analizar.";
  } finally {
    elements.analyzePathsBtn.disabled = false;
  }
}

async function analyzeUploads() {
  const files = Array.from(uploadFilesByPath.values());
  if (!files.length) {
    throw new Error("Selecciona archivos o una carpeta antes de analizar.");
  }

  elements.analyzeUploadBtn.disabled = true;
  elements.resultTime.textContent = "Preparando sesión de selección...";
  showAnalysisProgress("Preparando sesión de archivos seleccionados...");
  try {
    const payload = [];
    for (const item of files) {
      const binaryContent = await item.file.arrayBuffer();
      payload.push({
        path: item.path,
        contentBase64: arrayBufferToBase64(binaryContent),
        lastModified: Number.isFinite(Number(item.file.lastModified))
          ? Number(item.file.lastModified)
          : null,
      });
    }

    const data = await callApi("/api/analyze/upload", {
      method: "POST",
      body: JSON.stringify({
        files: payload,
      }),
    });
    if (data.analysis?.session) {
      updateAnalysisProgress(100, "Sesión preparada.");
      handlePreparedSession(data.analysis);
      return;
    }

    const prepared = await waitForAnalysisJob(data.jobId);
    updateAnalysisProgress(100, "Cargando listado de archivos...", "running");
    await flushUi();
    handlePreparedSession(prepared);
    elements.resultTime.textContent = "Sesión preparada. Selecciona un archivo para analizar.";
  } finally {
    elements.analyzeUploadBtn.disabled = false;
  }
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  elements.resultTime.textContent = `Error: ${message}`;
  updateAnalysisProgress(100, message, "error");
}

async function init() {
  elements.refreshKnowledgeBtn.addEventListener("click", () => {
    refreshKnowledge().catch(showError);
  });
  elements.analyzePathsBtn.addEventListener("click", () => {
    analyzePaths().catch(showError);
  });
  elements.analyzeUploadBtn.addEventListener("click", () => {
    analyzeUploads().catch(showError);
  });
  elements.filesPicker.addEventListener("change", (event) => {
    clearRenderedResults();
    clearSelectedInputs({ clearFolderPicker: true });
    mergeInputFiles(event.target.files);
  });
  elements.folderPicker.addEventListener("change", (event) => {
    clearRenderedResults();
    clearSelectedInputs({ clearFilesPicker: true });
    mergeInputFiles(event.target.files);
  });
  window.addEventListener("resize", () => {
    scheduleIncludesScrollSync();
  });

  await loadKnowledgeSummary();
}

init().catch(showError);
