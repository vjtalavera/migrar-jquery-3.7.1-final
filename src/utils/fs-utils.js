const fs = require("node:fs/promises");
const path = require("node:path");
const { ALLOWED_EXTENSIONS } = require("../config");
const { decodeTextBuffer } = require("./text");

const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".idea",
  ".vscode",
]);

function isAllowedFilePath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension);
}

async function pathExists(candidatePath) {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function collectSupportedFiles(inputPaths) {
  const normalized = Array.from(
    new Set(
      inputPaths
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .map((item) => path.resolve(item)),
    ),
  );

  const files = [];
  const missing = [];
  const visitedDirs = new Set();

  for (const candidatePath of normalized) {
    if (!(await pathExists(candidatePath))) {
      missing.push(candidatePath);
      continue;
    }

    const stat = await fs.stat(candidatePath);
    if (stat.isDirectory()) {
      await walkDirectory(candidatePath, files, visitedDirs);
    } else if (stat.isFile() && isAllowedFilePath(candidatePath)) {
      files.push(candidatePath);
    }
  }

  return {
    files: Array.from(new Set(files)),
    missing,
  };
}

async function walkDirectory(directoryPath, collector, visitedDirs) {
  const normalized = path.resolve(directoryPath);
  if (visitedDirs.has(normalized)) {
    return;
  }
  visitedDirs.add(normalized);

  const entries = await fs.readdir(normalized, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(normalized, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) {
        await walkDirectory(fullPath, collector, visitedDirs);
      }
      continue;
    }

    if (entry.isFile() && isAllowedFilePath(fullPath)) {
      collector.push(fullPath);
    }
  }
}

async function loadFilesContent(paths) {
  const files = [];
  for (const filePath of paths) {
    const rawContent = await fs.readFile(filePath);
    const content = decodeTextBuffer(rawContent);
    files.push({
      path: filePath,
      content,
    });
  }
  return files;
}

async function loadSingleFileContent(inputPath) {
  const normalized = path.resolve(String(inputPath || "").trim());
  if (!normalized || !isAllowedFilePath(normalized)) {
    throw new Error("Ruta de archivo no soportada para preview.");
  }

  let stats;
  try {
    stats = await fs.stat(normalized);
  } catch {
    throw new Error("No se pudo acceder al archivo solicitado.");
  }

  if (!stats.isFile()) {
    throw new Error("La ruta solicitada no es un archivo.");
  }

  const rawContent = await fs.readFile(normalized);
  return {
    path: normalized,
    content: decodeTextBuffer(rawContent),
  };
}

module.exports = {
  isAllowedFilePath,
  collectSupportedFiles,
  loadFilesContent,
  loadSingleFileContent,
};
