require("../utils/node18-undici-polyfill");

const { parentPort } = require("node:worker_threads");
const {
  analyzePathInputs,
  analyzeUploadedFiles,
  analyzeProvidedSources,
} = require("../services/analyzer");

if (!parentPort) {
  throw new Error("Worker de análisis iniciado sin parentPort.");
}

parentPort.on("message", async (task) => {
  const taskId = task?.taskId;
  if (!taskId) {
    return;
  }

  const emitProgress = (progress) => {
    parentPort.postMessage({
      taskId,
      kind: "progress",
      stage: progress?.stage || "analyze-files",
      message: progress?.message || "",
      progress: progress?.progress ?? 0,
      processedFiles: progress?.processedFiles ?? 0,
      totalFiles: progress?.totalFiles ?? 0,
    });
  };

  try {
    let analysis;
    if (task.type === "paths") {
      analysis = await analyzePathInputs(task.payload?.paths || [], task.knowledge, {
        onProgress: emitProgress,
      });
    } else if (task.type === "uploads") {
      analysis = analyzeUploadedFiles(task.payload?.files || [], task.knowledge, {
        onProgress: emitProgress,
      });
    } else if (task.type === "sources") {
      analysis = analyzeProvidedSources(task.payload?.files || [], task.knowledge, {
        onProgress: emitProgress,
        sourceType: task.payload?.sourceType || "path",
      });
    } else {
      throw new Error(`Tipo de análisis no soportado: ${task.type}`);
    }

    parentPort.postMessage({
      taskId,
      ok: true,
      analysis,
    });
  } catch (error) {
    parentPort.postMessage({
      taskId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
