const { randomUUID } = require("node:crypto");

class AnalysisSessionStore {
  constructor(options = {}) {
    this.maxSessions = Math.max(8, Number(options.maxSessions) || 96);
    this.ttlMs = Math.max(5 * 60_000, Number(options.ttlMs) || 30 * 60_000);
    this.sessions = new Map();
  }

  createSession(type, data = {}) {
    this.prune();
    if (this.sessions.size >= this.maxSessions) {
      this.prune(true);
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const session = {
      id,
      type: String(type || "unknown"),
      files: Array.isArray(data.files) ? data.files : [],
      missingPaths: Array.isArray(data.missingPaths) ? data.missingPaths : [],
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(id, session);
    return session;
  }

  getSession(id) {
    this.prune();
    return this.sessions.get(String(id || "").trim()) || null;
  }

  touchSession(id) {
    const session = this.getSession(id);
    if (!session) {
      return null;
    }
    session.updatedAt = new Date().toISOString();
    return session;
  }

  toPublic(session) {
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      type: session.type,
      totalFiles: Array.isArray(session.files) ? session.files.length : 0,
      files: (session.files || []).map((item) => {
        if (typeof item === "string") {
          return {
            path: item,
            sourceType: session.type === "upload" ? "upload" : "path",
          };
        }
        return {
          path: String(item.path || ""),
          sourceType: session.type === "upload" ? "upload" : "path",
        };
      }),
      missingPaths: session.missingPaths || [],
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  prune(forceTrim = false) {
    const now = Date.now();
    const ordered = Array.from(this.sessions.values()).sort((a, b) =>
      String(a.updatedAt).localeCompare(String(b.updatedAt)),
    );

    for (const session of ordered) {
      if (now - new Date(session.updatedAt).getTime() > this.ttlMs) {
        this.sessions.delete(session.id);
      }
    }

    if (!forceTrim || this.sessions.size < this.maxSessions) {
      return;
    }

    const survivors = Array.from(this.sessions.values()).sort((a, b) =>
      String(a.updatedAt).localeCompare(String(b.updatedAt)),
    );
    while (this.sessions.size > this.maxSessions && survivors.length > 0) {
      const oldest = survivors.shift();
      if (!oldest) {
        break;
      }
      this.sessions.delete(oldest.id);
    }
  }
}

const analysisSessionStore = new AnalysisSessionStore();

module.exports = {
  AnalysisSessionStore,
  analysisSessionStore,
};

