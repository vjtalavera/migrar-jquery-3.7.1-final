const path = require("path");
const os = require("os");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_ANALYSIS_WORKERS = Math.max(
  1,
  Math.min(4, (os.cpus()?.length || 2) - 1),
);

module.exports = {
  ROOT_DIR,
  HOST: String(process.env.HOST || "0.0.0.0"),
  PORT: Number(process.env.PORT || 4307),
  DATA_DIR: path.join(ROOT_DIR, "data"),
  KNOWLEDGE_FILE: path.join(ROOT_DIR, "data", "jquery-knowledge.json"),
  ALLOWED_EXTENSIONS: new Set([".jsp", ".js", ".html", ".htm"]),
  SEARCH_EXTENSIONS_TEXT: ".jsp, .js, .html, .htm",
  BASE_CATEGORIES: [
    "https://api.jquery.com/category/deprecated/",
    "https://api.jquery.com/category/removed/",
  ],
  ANALYSIS_WORKERS: Number(process.env.ANALYSIS_WORKERS || DEFAULT_ANALYSIS_WORKERS),
  ANALYSIS_QUEUE_LIMIT: Number(process.env.ANALYSIS_QUEUE_LIMIT || 48),
  REQUEST_BODY_LIMIT: String(process.env.REQUEST_BODY_LIMIT || "80mb"),
};
