const { randomUUID } = require("node:crypto");

class AnalysisJobStore {
  constructor(options = {}) {
    this.maxJobs = Math.max(64, Number(options.maxJobs) || 320);
    this.ttlMs = Math.max(60_000, Number(options.ttlMs) || 30 * 60_000);
    this.jobs = new Map();
  }

  createJob(type) {
    this.prune();
    if (this.jobs.size >= this.maxJobs) {
      this.prune(true);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const job = {
      id,
      type: String(type || "unknown"),
      status: "queued",
      stage: "queued",
      message: "En cola para análisis.",
      progress: 0,
      processedFiles: 0,
      totalFiles: 0,
      error: null,
      analysis: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);
    return job;
  }

  updateJob(id, patch = {}) {
    const job = this.jobs.get(id);
    if (!job) {
      return null;
    }

    if (patch.status) {
      job.status = String(patch.status);
    }
    if (patch.stage) {
      job.stage = String(patch.stage);
    }
    if (patch.message != null) {
      job.message = String(patch.message);
    }
    if (patch.error != null) {
      job.error = String(patch.error);
    }
    if (patch.analysis !== undefined) {
      job.analysis = patch.analysis;
    }

    if (patch.progress != null) {
      const numeric = Number(patch.progress);
      if (Number.isFinite(numeric)) {
        job.progress = Math.max(0, Math.min(100, Math.round(numeric)));
      }
    }
    if (patch.processedFiles != null) {
      const numeric = Number(patch.processedFiles);
      if (Number.isFinite(numeric) && numeric >= 0) {
        job.processedFiles = Math.round(numeric);
      }
    }
    if (patch.totalFiles != null) {
      const numeric = Number(patch.totalFiles);
      if (Number.isFinite(numeric) && numeric >= 0) {
        job.totalFiles = Math.round(numeric);
      }
    }

    job.updatedAt = new Date().toISOString();
    return job;
  }

  completeJob(id, analysis) {
    return this.updateJob(id, {
      status: "done",
      stage: "done",
      message: "Análisis completado.",
      progress: 100,
      analysis,
      error: null,
    });
  }

  failJob(id, errorMessage) {
    return this.updateJob(id, {
      status: "error",
      stage: "error",
      message: "Error durante el análisis.",
      progress: 100,
      error: String(errorMessage || "Error desconocido en el análisis."),
    });
  }

  getJob(id) {
    this.prune();
    return this.jobs.get(id) || null;
  }

  toPublic(job, options = {}) {
    if (!job) {
      return null;
    }
    const includeAnalysis = Boolean(options.includeAnalysis);

    const base = {
      id: job.id,
      type: job.type,
      status: job.status,
      stage: job.stage,
      message: job.message,
      progress: job.progress,
      processedFiles: job.processedFiles,
      totalFiles: job.totalFiles,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    if (includeAnalysis && job.status === "done") {
      base.analysis = job.analysis;
    }
    return base;
  }

  prune(forceTrim = false) {
    const now = Date.now();
    const rows = Array.from(this.jobs.values()).sort((a, b) =>
      String(a.updatedAt).localeCompare(String(b.updatedAt)),
    );

    for (const job of rows) {
      if (
        (job.status === "done" || job.status === "error") &&
        now - new Date(job.updatedAt).getTime() > this.ttlMs
      ) {
        this.jobs.delete(job.id);
      }
    }

    if (!forceTrim || this.jobs.size < this.maxJobs) {
      return;
    }

    const survivors = Array.from(this.jobs.values()).sort((a, b) =>
      String(a.updatedAt).localeCompare(String(b.updatedAt)),
    );
    while (this.jobs.size > this.maxJobs && survivors.length > 0) {
      const oldest = survivors.shift();
      if (!oldest) {
        break;
      }
      this.jobs.delete(oldest.id);
    }
  }
}

const analysisJobStore = new AnalysisJobStore();

module.exports = {
  AnalysisJobStore,
  analysisJobStore,
};
