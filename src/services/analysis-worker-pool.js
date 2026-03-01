const path = require("node:path");
const { Worker } = require("node:worker_threads");
const {
  ANALYSIS_WORKERS,
  ANALYSIS_QUEUE_LIMIT,
  ROOT_DIR,
} = require("../config");

class QueueLimitError extends Error {
  constructor(limit) {
    super(
      `El servidor alcanzó el límite de cola de análisis (${limit}). Intenta de nuevo en unos segundos.`,
    );
    this.name = "QueueLimitError";
    this.code = "ANALYSIS_QUEUE_LIMIT";
  }
}

class AnalysisWorkerPool {
  constructor(options = {}) {
    this.size = Math.max(1, Number(options.size) || ANALYSIS_WORKERS || 1);
    this.maxQueue = Math.max(
      1,
      Number(options.maxQueue) || ANALYSIS_QUEUE_LIMIT || 1,
    );
    this.workerFile =
      options.workerFile ||
      path.join(ROOT_DIR, "src", "workers", "analyze-worker.js");

    this.workers = [];
    this.queue = [];
    this.pendingTasks = new Map();
    this.nextTaskId = 0;
    this.shuttingDown = false;

    for (let slot = 0; slot < this.size; slot += 1) {
      this.spawnWorker(slot);
    }
  }

  spawnWorker(slot) {
    const worker = new Worker(this.workerFile);
    const state = {
      slot,
      worker,
      busy: false,
      taskId: null,
    };

    this.workers[slot] = state;

    worker.on("message", (message) => {
      this.onWorkerMessage(state, message);
    });
    worker.on("error", (error) => {
      this.onWorkerError(state, error);
    });
    worker.on("exit", (code) => {
      this.onWorkerExit(state, code);
    });
  }

  rejectTask(taskId, error) {
    if (!taskId) {
      return;
    }
    const pending = this.pendingTasks.get(taskId);
    if (!pending) {
      return;
    }
    this.pendingTasks.delete(taskId);
    pending.reject(error);
  }

  resolveTask(taskId, value) {
    const pending = this.pendingTasks.get(taskId);
    if (!pending) {
      return;
    }
    this.pendingTasks.delete(taskId);
    pending.resolve(value);
  }

  onWorkerMessage(state, message) {
    const taskId = message?.taskId;
    if (!taskId) {
      return;
    }

    if (message.kind === "progress") {
      const pending = this.pendingTasks.get(taskId);
      if (pending?.onProgress) {
        pending.onProgress({
          stage: message.stage,
          message: message.message,
          progress: message.progress,
          processedFiles: message.processedFiles,
          totalFiles: message.totalFiles,
        });
      }
      return;
    }

    state.busy = false;
    state.taskId = null;

    if (message.ok) {
      this.resolveTask(taskId, message.analysis);
    } else {
      this.rejectTask(
        taskId,
        new Error(message.error || "Falló la tarea de análisis en worker."),
      );
    }

    this.dispatch();
  }

  onWorkerError(state, error) {
    if (state.taskId) {
      this.rejectTask(
        state.taskId,
        error instanceof Error
          ? error
          : new Error("Error interno en worker de análisis."),
      );
      state.busy = false;
      state.taskId = null;
    }
  }

  onWorkerExit(state, code) {
    if (state.taskId) {
      this.rejectTask(
        state.taskId,
        new Error(
          `El worker de análisis se cerró inesperadamente (exit ${code}).`,
        ),
      );
      state.busy = false;
      state.taskId = null;
    }

    if (this.shuttingDown) {
      return;
    }

    this.spawnWorker(state.slot);
    this.dispatch();
  }

  enqueue(type, payload, knowledge, options = {}) {
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new QueueLimitError(this.maxQueue));
    }

    const taskId = `task-${Date.now()}-${++this.nextTaskId}`;
    return new Promise((resolve, reject) => {
      this.pendingTasks.set(taskId, {
        resolve,
        reject,
        onProgress:
          typeof options.onProgress === "function" ? options.onProgress : null,
      });
      this.queue.push({
        taskId,
        type,
        payload,
        knowledge,
      });
      this.dispatch();
    });
  }

  dispatch() {
    if (this.shuttingDown) {
      return;
    }

    for (const state of this.workers) {
      if (!state || state.busy) {
        continue;
      }

      const task = this.queue.shift();
      if (!task) {
        return;
      }

      state.busy = true;
      state.taskId = task.taskId;

      try {
        state.worker.postMessage(task);
      } catch (error) {
        state.busy = false;
        state.taskId = null;
        this.rejectTask(
          task.taskId,
          error instanceof Error
            ? error
            : new Error("No se pudo asignar la tarea al worker."),
        );
      }
    }
  }

  analyzePaths(paths, knowledge, options = {}) {
    return this.enqueue(
      "paths",
      {
        paths,
      },
      knowledge,
      options,
    );
  }

  analyzeUploads(files, knowledge, options = {}) {
    return this.enqueue(
      "uploads",
      {
        files,
      },
      knowledge,
      options,
    );
  }

  analyzeSources(files, knowledge, options = {}) {
    return this.enqueue(
      "sources",
      {
        files,
        sourceType: options.sourceType || "path",
      },
      knowledge,
      options,
    );
  }

  getStats() {
    const busyWorkers = this.workers.filter((state) => state?.busy).length;
    return {
      workers: this.workers.length,
      busyWorkers,
      queueLength: this.queue.length,
      maxQueue: this.maxQueue,
    };
  }

  async shutdown() {
    this.shuttingDown = true;
    const terms = this.workers
      .filter(Boolean)
      .map((state) => state.worker.terminate());
    await Promise.allSettled(terms);
  }
}

let singletonPool = null;

function getAnalysisWorkerPool() {
  if (!singletonPool) {
    singletonPool = new AnalysisWorkerPool();
  }
  return singletonPool;
}

module.exports = {
  AnalysisWorkerPool,
  QueueLimitError,
  getAnalysisWorkerPool,
};
