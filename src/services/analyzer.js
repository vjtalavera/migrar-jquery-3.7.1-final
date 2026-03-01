const path = require("node:path");
const {
  ALLOWED_EXTENSIONS,
  SEARCH_EXTENSIONS_TEXT,
} = require("../config");
const {
  collectSupportedFiles,
  isAllowedFilePath,
  loadFilesContent,
} = require("../utils/fs-utils");
const { getLineMatchesForRule } = require("./jquery-knowledge-service");
const { normalizeWhitespace, truncate, decodeTextBuffer } = require("../utils/text");

const DEFINITIVE_BY_SLUG = {
  "ready-deprecated-syntax":
    "Usa solo `$(handler)` para DOM Ready. Ejemplo: `$(function () { ... });`.",
  "attr-checked-legacy":
    "Reemplaza `.attr('checked', valor)` por `.prop('checked', valor)`.",
  context:
    "Reemplaza `.context` por acceso explícito al documento o elemento nativo según el caso.",
  live: "Reemplaza `.live(evento, handler)` por delegación con `$(document).on(evento, selector, handler)`.",
  "toggle-event":
    "Reemplaza `.toggle(fn1, fn2, ...)` por `.on(\"click\", handler)` con estado explícito.",
};

function detectSeverity(entry) {
  if (entry.status.includes("removed")) {
    return "removed";
  }
  if (entry.status.includes("deprecated")) {
    return "deprecated";
  }
  return "info";
}

function buildDefinitiveFromShorthand(entry) {
  const match = String(entry.slug || "").match(/^([A-Za-z]+)-shorthand$/);
  if (!match) {
    return null;
  }

  const eventName = match[1];
  return `Reemplaza \`.${eventName}(handler)\` por \`.on(\"${eventName}\", handler)\`.`;
}

function normalizeRecommendation(text) {
  let value = normalizeWhitespace(text);
  if (!value) {
    return value;
  }

  if (/\s+or\s+/i.test(value)) {
    value = value.split(/\s+or\s+/i)[0];
  }

  value = value.replace(/,\s*respectively\.?$/i, "");
  value = value.replace(/\s+\($/, "");

  if (!/[.!?]$/.test(value)) {
    value = `${value}.`;
  }

  return value;
}

function buildSuggestion(entry) {
  if (DEFINITIVE_BY_SLUG[entry.slug]) {
    return DEFINITIVE_BY_SLUG[entry.slug];
  }

  const shorthandSuggestion = buildDefinitiveFromShorthand(entry);
  if (shorthandSuggestion) {
    return shorthandSuggestion;
  }

  if (entry.replacements.length > 0) {
    const normalized = normalizeRecommendation(entry.replacements[0]);
    if (
      /^(Reemplaza|Usa|Quita|Evita|No use|Conserva|Migra|Elimina|Sustituye)/i.test(
        normalized,
      )
    ) {
      return normalized;
    }
    return `Usa ${normalized}`;
  }

  return "No se detectó una corrección explícita. Revisa la documentación del API enlazada.";
}

function extractAttributeReferences(fragment, attributeNames) {
  const refs = [];
  const names = attributeNames.map((name) => name.toLowerCase());
  const attrRegex = /\b([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = attrRegex.exec(fragment)) !== null) {
    const attrName = String(match[1] || "").toLowerCase();
    if (names.includes(attrName)) {
      refs.push(match[3].trim());
    }
  }
  return refs;
}

function extractInlineScriptFileReferences(scriptContent) {
  const refs = [];
  const quotePathRegex =
    /["']([^"'`]+?\.(?:js|jsp|html?|mjs|cjs)(?:\?[^"'`]+)?)["']/gi;
  let match;
  while ((match = quotePathRegex.exec(scriptContent)) !== null) {
    refs.push(match[1].trim());
  }
  return refs;
}

function dedupeIncludeReferences(references) {
  const seen = new Set();
  const output = [];
  for (const item of references) {
    const source = String(item.source || "").trim();
    const value = String(item.value || "").trim();
    if (!value) {
      continue;
    }
    const key = `${source}|${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push({ source, value });
    }
  }
  return output;
}

function extractIncludedReferences(content) {
  const references = [];
  const sourceText = String(content || "");

  const jspIncludeTagRegex = /<jsp:include\b[\s\S]*?>/gi;
  let match;
  while ((match = jspIncludeTagRegex.exec(sourceText)) !== null) {
    const attrs = extractAttributeReferences(match[0], ["file", "page"]);
    for (const value of attrs) {
      references.push({ source: "jsp:include", value });
    }
  }

  const jspDirectiveRegex = /<%@\s*:?\s*include\b[\s\S]*?%>/gi;
  while ((match = jspDirectiveRegex.exec(sourceText)) !== null) {
    const attrs = extractAttributeReferences(match[0], ["file", "page"]);
    for (const value of attrs) {
      references.push({ source: "jsp-directive", value });
    }
  }

  const scriptTagRegex = /<script\b([\s\S]*?)>([\s\S]*?)<\/script>/gi;
  while ((match = scriptTagRegex.exec(sourceText)) !== null) {
    const attrsFragment = match[1] || "";
    const body = match[2] || "";
    const srcRefs = extractAttributeReferences(attrsFragment, ["src"]);
    for (const value of srcRefs) {
      references.push({ source: "script-src", value });
    }

    if (srcRefs.length === 0) {
      const inlineRefs = extractInlineScriptFileReferences(body);
      for (const value of inlineRefs) {
        references.push({ source: "script-inline", value });
      }
    }
  }

  return dedupeIncludeReferences(references);
}

function transformReadyLine(line) {
  const pattern = /((\$jq|\$|jQuery)\s*\([^)]*\))\s*\.\s*ready\s*\(/i;
  const matched = line.match(pattern);
  if (!matched) {
    return null;
  }

  const alias = matched[2] || "$";
  if (/\.\s*ready\s*\(\s*\)\s*;?\s*$/i.test(line)) {
    return `${alias}(function() {});`;
  }

  return line.replace(pattern, `${alias}(`);
}

function transformAttrCheckedLine(line) {
  if (!/\.\s*attr\s*\(\s*(['"])checked\1\s*,/i.test(line)) {
    return null;
  }
  return line.replace(
    /(\.\s*)attr(\s*\(\s*(['"])checked\3\s*,)/i,
    "$1prop$2",
  );
}

function transformShorthandLine(line, slug) {
  const shorthand = String(slug || "").match(/^([A-Za-z]+)-shorthand$/);
  if (!shorthand) {
    return null;
  }
  const eventName = shorthand[1];
  const emptyEventCall = new RegExp(`\\.\\s*${eventName}\\s*\\(\\s*\\)`, "i");
  if (emptyEventCall.test(line)) {
    return line.replace(emptyEventCall, `.trigger("${eventName}")`);
  }

  const eventCallWithArgs = new RegExp(`\\.\\s*${eventName}\\s*\\(`, "i");
  if (!eventCallWithArgs.test(line)) {
    return null;
  }
  return line.replace(eventCallWithArgs, `.on("${eventName}", `);
}

function transformSizeLine(line) {
  if (!/\.\s*size\s*\(\s*\)/i.test(line)) {
    return null;
  }
  return line.replace(/\.\s*size\s*\(\s*\)/i, ".length");
}

function transformParseJsonLine(line) {
  if (!/(?:\$jq|\$|jQuery)\s*\.\s*parseJSON\s*\(/i.test(line)) {
    return null;
  }
  return line.replace(/(?:\$jq|\$|jQuery)\s*\.\s*parseJSON\s*\(/i, "JSON.parse(");
}

function transformDeferredPipeLine(line) {
  if (/\)\s*deferred\s*\.\s*pipe\s*\(/i.test(line)) {
    return line.replace(/\)\s*deferred\s*\.\s*pipe\s*\(/i, ").deferred.then(");
  }
  if (/deferred\s*\.\s*pipe\s*\(/i.test(line)) {
    return line.replace(/deferred\s*\.\s*pipe\s*\(/i, "deferred.then(");
  }
  if (/\.\s*pipe\s*\(/i.test(line)) {
    return line.replace(/\.\s*pipe\s*\(/i, ".then(");
  }
  return null;
}

function transformDieLine(line) {
  if (!/\.\s*die\s*\(/i.test(line)) {
    return null;
  }
  return line.replace(/\.\s*die\s*\(/i, ".off(");
}

function transformIsFunctionLine(line) {
  if (!/(?:\$jq|\$|jQuery)\s*\.\s*isFunction\s*\(/i.test(line)) {
    return null;
  }
  return line.replace(
    /(?:\$jq|\$|jQuery)\s*\.\s*isFunction\s*\(([^)]+)\)/i,
    'typeof $1 === "function"',
  );
}

function transformBindLine(line) {
  if (!/\.\s*bind\s*\(/i.test(line)) {
    return null;
  }
  return line.replace(/\.\s*bind\s*\(/i, ".on(");
}

function transformContextLine(line) {
  if (!/\.\s*context\b/i.test(line)) {
    return null;
  }
  return line.replace(/\.\s*context\b/i, ".get(0).ownerDocument");
}

function findFirstTopLevelComma(text) {
  let quote = null;
  let escaped = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      if (parenDepth > 0) {
        parenDepth -= 1;
      }
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      if (bracketDepth > 0) {
        bracketDepth -= 1;
      }
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      if (braceDepth > 0) {
        braceDepth -= 1;
      }
      continue;
    }

    if (
      char === "," &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return i;
    }
  }

  return -1;
}

function transformLiveLine(line) {
  const liveCallMatch = line.match(
    /^(.*?)(\$jq|\$|jQuery)\s*\(\s*([^)]*?)\s*\)\s*\.\s*live\s*\(\s*([\s\S]*)$/i,
  );
  if (!liveCallMatch) {
    return null;
  }

  const prefix = liveCallMatch[1] || "";
  const alias = liveCallMatch[2] || "$";
  const selectorExpr = (liveCallMatch[3] || "").trim();
  const argsTail = liveCallMatch[4] || "";

  if (!selectorExpr || !argsTail) {
    return null;
  }

  const commaIndex = findFirstTopLevelComma(argsTail);
  if (commaIndex < 0) {
    return null;
  }

  const eventExpr = argsTail.slice(0, commaIndex).trim();
  const afterEvent = argsTail.slice(commaIndex + 1).trimStart();
  if (!eventExpr || !afterEvent) {
    return null;
  }

  return `${prefix}${alias}(document).on(${eventExpr}, ${selectorExpr}, ${afterEvent}`;
}

function transformEqSelectorLine(line) {
  const pattern =
    /((?:\$jq|\$|jQuery)\s*\(\s*)(['"])([^"'`]*?):eq\(\s*([^)]+?)\s*\)([^"'`]*)\2\s*\)/i;
  const match = line.match(pattern);
  if (!match) {
    return null;
  }

  const beforeCall = match[1];
  const quote = match[2];
  const selectorBeforeEq = match[3] || "";
  const eqIndex = (match[4] || "").trim();
  const selectorAfterEq = match[5] || "";

  if (!eqIndex) {
    return null;
  }

  const replacement =
    `${beforeCall}${quote}${selectorBeforeEq}${selectorAfterEq}${quote})` +
    `.eq(${eqIndex})`;

  return line.replace(pattern, replacement);
}

function buildCorrectedInstruction(rule, sourceLine) {
  const transforms = [
    () => {
      if (rule.slug === "ready-deprecated-syntax") {
        return transformReadyLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "attr-checked-legacy") {
        return transformAttrCheckedLine(sourceLine);
      }
      return null;
    },
    () => transformShorthandLine(sourceLine, rule.slug),
    () => {
      if (rule.slug === "size") {
        return transformSizeLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "jQuery.parseJSON") {
        return transformParseJsonLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "deferred.pipe") {
        return transformDeferredPipeLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "die") {
        return transformDieLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "jQuery.isFunction") {
        return transformIsFunctionLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "bind") {
        return transformBindLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "context") {
        return transformContextLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "live") {
        return transformLiveLine(sourceLine);
      }
      return null;
    },
    () => {
      if (rule.slug === "eq-selector") {
        return transformEqSelectorLine(sourceLine);
      }
      return null;
    },
  ];

  for (const transform of transforms) {
    const result = transform();
    if (result && result !== sourceLine) {
      return result;
    }
  }

  return null;
}

function buildRecommendationWithInstruction(rule, sourceLine) {
  const guidance = buildSuggestion(rule);
  const detectedInstruction = sourceLine;
  const correctedInstruction =
    buildCorrectedInstruction(rule, sourceLine) || sourceLine;

  return {
    recommendation: correctedInstruction,
    detectedInstruction,
    correctedInstruction,
    guidance,
  };
}

function analyzeTextByLines(filePath, content, rules) {
  const findings = [];
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!/(?:\$jq|\$|jQuery)/.test(line)) {
      continue;
    }

    for (const rule of rules) {
      const matches = getLineMatchesForRule(line, rule);
      for (const match of matches) {
        const correction = buildRecommendationWithInstruction(rule, line);
        findings.push({
          file: filePath,
          line: lineIndex + 1,
          column: match.index + 1,
          matchedText: match.value,
          sourceLine: truncate(line, 320),
          localizedInstruction: line.trim(),
          apiTitle: rule.title,
          apiUrl: rule.url,
          slug: rule.slug,
          severity: detectSeverity(rule),
          deprecatedIn: rule.deprecatedIn,
          removedIn: rule.removedIn,
          recommendation: correction.recommendation,
          detectedInstruction: correction.detectedInstruction,
          correctedInstruction: correction.correctedInstruction,
          guidance: correction.guidance,
          confidence: rule.detection.ambiguous ? "medium" : "high",
        });
      }
    }
  }

  return findings;
}

function dedupeFindings(findings) {
  const map = new Map();
  for (const finding of findings) {
    const key = [
      finding.file,
      finding.line,
      finding.column,
      finding.slug,
      finding.matchedText,
    ].join("|");
    if (!map.has(key)) {
      map.set(key, finding);
    }
  }
  return Array.from(map.values());
}

function summarize(files, findings, missingPaths = []) {
  const bySeverity = {
    removed: findings.filter((item) => item.severity === "removed").length,
    deprecated: findings.filter((item) => item.severity === "deprecated").length,
    info: findings.filter((item) => item.severity === "info").length,
  };

  const filesWithIssues = new Map();
  for (const finding of findings) {
    const current = filesWithIssues.get(finding.file) || 0;
    filesWithIssues.set(finding.file, current + 1);
  }

  return {
    totalFilesAnalyzed: files.length,
    filesWithFindings: filesWithIssues.size,
    totalFindings: findings.length,
    bySeverity,
    missingPaths,
    supportedExtensions: SEARCH_EXTENSIONS_TEXT,
  };
}

function analyzeSources(inputFiles, knowledge, options = {}) {
  const sourceType = options.sourceType || "path";
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const files = inputFiles.filter((item) =>
    isAllowedFilePath(item.path || ""),
  );
  const findings = [];
  const totalFiles = files.length;
  let lastProgress = -1;
  let lastProgressAt = 0;

  const reportProgress = (processedFiles) => {
    if (!onProgress) {
      return;
    }
    if (totalFiles <= 0) {
      onProgress({
        stage: "analyze-files",
        message: "No hay archivos válidos para analizar.",
        progress: 100,
        processedFiles: 0,
        totalFiles: 0,
      });
      return;
    }

    const numericProcessed = Math.max(0, Math.min(totalFiles, processedFiles));
    const progress = Math.max(
      1,
      Math.min(100, Math.round((numericProcessed / totalFiles) * 100)),
    );
    const now = Date.now();
    const shouldSkip =
      numericProcessed < totalFiles &&
      progress === lastProgress &&
      now - lastProgressAt < 200;
    if (shouldSkip) {
      return;
    }

    lastProgress = progress;
    lastProgressAt = now;
    onProgress({
      stage: "analyze-files",
      message: `Analizando archivos (${numericProcessed}/${totalFiles})`,
      progress,
      processedFiles: numericProcessed,
      totalFiles,
    });
  };

  reportProgress(0);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    findings.push(...analyzeTextByLines(file.path, file.content, knowledge.entries));
    reportProgress(index + 1);
  }

  const dedupedFindings = dedupeFindings(findings).sort((a, b) => {
    if (a.file !== b.file) {
      return a.file.localeCompare(b.file);
    }
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return a.column - b.column;
  });

  return {
    summary: summarize(files, dedupedFindings),
    files: files.map((file) => ({
      path: file.path,
      extension: path.extname(file.path).toLowerCase(),
      includeReferences: extractIncludedReferences(file.content),
      sourceType,
    })),
    findings: dedupedFindings,
  };
}

async function analyzePathInputs(paths, knowledge, options = {}) {
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const normalized = Array.isArray(paths)
    ? paths.map((value) => normalizeWhitespace(value))
    : [];

  onProgress?.({
    stage: "collect-files",
    message: "Localizando archivos compatibles...",
    progress: 1,
  });

  const { files, missing } = await collectSupportedFiles(normalized);

  onProgress?.({
    stage: "read-files",
    message: `Cargando ${files.length} archivos para análisis...`,
    progress: files.length > 0 ? 4 : 100,
    totalFiles: files.length,
    processedFiles: 0,
  });

  const contentFiles = await loadFilesContent(files);
  const analysis = analyzeSources(contentFiles, knowledge, {
    sourceType: "path",
    onProgress: (progress) => {
      const mapped = Math.min(
        99,
        Math.max(4, 10 + Math.round((Number(progress.progress || 0) / 100) * 89)),
      );
      onProgress?.({
        ...progress,
        progress: mapped,
      });
    },
  });
  analysis.summary.missingPaths = missing;

  onProgress?.({
    stage: "done",
    message: "Análisis completado.",
    progress: 100,
    totalFiles: analysis.summary.totalFilesAnalyzed,
    processedFiles: analysis.summary.totalFilesAnalyzed,
  });
  return analysis;
}

function analyzeUploadedFiles(uploadFiles, knowledge, options = {}) {
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;

  const incoming = Array.isArray(uploadFiles)
    ? uploadFiles.filter((item) => item && typeof item.path === "string")
    : [];
  const normalized = [];

  for (let index = 0; index < incoming.length; index += 1) {
    const item = incoming[index];
    normalized.push({
      path: item.path,
      content:
        typeof item.contentBase64 === "string" && item.contentBase64.length > 0
          ? decodeTextBuffer(Buffer.from(item.contentBase64, "base64"))
          : String(item.content || ""),
    });

    if (onProgress) {
      const prepProgress = Math.min(
        9,
        Math.max(1, Math.round(((index + 1) / incoming.length) * 9)),
      );
      onProgress({
        stage: "prepare-upload",
        message: `Preparando archivos (${index + 1}/${incoming.length})`,
        progress: prepProgress,
        processedFiles: index + 1,
        totalFiles: incoming.length,
      });
    }
  }

  const analysis = analyzeSources(normalized, knowledge, {
    sourceType: "upload",
    onProgress: (progress) => {
      const mapped = Math.min(
        99,
        Math.max(10, 10 + Math.round((Number(progress.progress || 0) / 100) * 89)),
      );
      onProgress?.({
        ...progress,
        progress: mapped,
      });
    },
  });

  onProgress?.({
    stage: "done",
    message: "Análisis completado.",
    progress: 100,
    totalFiles: analysis.summary.totalFilesAnalyzed,
    processedFiles: analysis.summary.totalFilesAnalyzed,
  });
  return analysis;
}

function analyzeProvidedSources(files, knowledge, options = {}) {
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const sourceType = options.sourceType || "path";
  const normalized = Array.isArray(files)
    ? files
        .filter((item) => item && typeof item.path === "string")
        .map((item) => ({
          path: item.path,
          content: String(item.content || ""),
        }))
    : [];

  const analysis = analyzeSources(normalized, knowledge, {
    sourceType,
    onProgress,
  });

  onProgress?.({
    stage: "done",
    message: "Análisis completado.",
    progress: 100,
    totalFiles: analysis.summary.totalFilesAnalyzed,
    processedFiles: analysis.summary.totalFilesAnalyzed,
  });

  return analysis;
}

module.exports = {
  analyzePathInputs,
  analyzeUploadedFiles,
  analyzeProvidedSources,
  extractIncludedReferences,
};
