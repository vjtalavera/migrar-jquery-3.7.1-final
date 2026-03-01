const { TextDecoder } = require("node:util");

const UTF8_FATAL_DECODER = new TextDecoder("utf-8", { fatal: true });
let WINDOWS1252_DECODER = null;
try {
  WINDOWS1252_DECODER = new TextDecoder("windows-1252");
} catch {
  WINDOWS1252_DECODER = null;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean),
    ),
  );
}

function toSlug(url) {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\/|\/$/g, "");
}

function truncate(value, limit = 240) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}

function decodeTextBuffer(buffer) {
  const bytes = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer || "");

  try {
    return UTF8_FATAL_DECODER.decode(bytes);
  } catch {
    if (WINDOWS1252_DECODER) {
      return WINDOWS1252_DECODER.decode(bytes);
    }
    return bytes.toString("latin1");
  }
}

module.exports = {
  normalizeWhitespace,
  escapeRegex,
  uniqueStrings,
  toSlug,
  truncate,
  decodeTextBuffer,
};
