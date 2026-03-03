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
const {
  normalizeWhitespace,
  truncate,
  decodeTextBuffer,
  escapeRegex,
} = require("../utils/text");

const DEFINITIVE_BY_SLUG = {
  "ready-deprecated-syntax":
    "Usa solo `$(handler)` para DOM Ready. Ejemplo: `$(function () { ... });`.",
  "attr-checked-legacy":
    "Reemplaza `.attr('checked', valor)` por `.prop('checked', valor)`.",
  "removeattr-disabled-legacy":
    "Reemplaza `.removeAttr('disabled')` por `.prop('disabled', false)`.",
  context:
    "Reemplaza `.context` por acceso explícito al documento o elemento nativo según el caso.",
  live: "Reemplaza `.live(evento, handler)` por delegación con `$(document).on(evento, selector, handler)`.",
  "toggle-event":
    "Reemplaza `.toggle(fn1, fn2, ...)` por `.on(\"click\", handler)` con estado explícito.",
};
const SELECTOR_ARG_METHODS = new Set([
  "add",
  "addBack",
  "children",
  "closest",
  "find",
  "filter",
  "has",
  "next",
  "nextAll",
  "nextUntil",
  "not",
  "parent",
  "parents",
  "parentsUntil",
  "prev",
  "prevAll",
  "prevUntil",
  "siblings",
]);

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

function transformRemoveAttrDisabledLine(line) {
  if (!/\.\s*removeAttr\s*\(\s*(['"])disabled\1\s*\)/i.test(line)) {
    return null;
  }
  return line.replace(
    /(\.\s*)removeAttr(\s*\(\s*(['"])disabled\3\s*\))/i,
    "$1prop('disabled', false)",
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
  if (!/\.\s*size\s*\(/i.test(line)) {
    return null;
  }
  return line.replace(/\.\s*size\s*\([^)]*\)/i, ".length");
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
    /(?:\$jq|\$|jQuery)\s*\.\s*isFunction\s*\(([^)]+)\)/gi,
    (_fullMatch, valueExpr) => `typeof ${valueExpr} === "function"`,
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

function findMatchingParen(text, openParenIndex) {
  if (openParenIndex < 0 || text[openParenIndex] !== "(") {
    return -1;
  }

  let quote = null;
  let escaped = false;
  let depth = 0;

  for (let i = openParenIndex; i < text.length; i += 1) {
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
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function splitTopLevelArguments(text) {
  const input = String(text || "");
  if (!input.trim()) {
    return [];
  }

  const args = [];
  let quote = null;
  let escaped = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let start = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

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
      args.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }

  args.push(input.slice(start).trim());
  return args.filter((arg) => arg.length > 0);
}

function findCallRange(line, callRegex) {
  const match = line.match(callRegex);
  if (!match || typeof match.index !== "number") {
    return null;
  }

  const start = match.index;
  const openParen = start + match[0].lastIndexOf("(");
  if (openParen < 0 || line[openParen] !== "(") {
    return null;
  }

  const closeParen = findMatchingParen(line, openParen);
  if (closeParen < 0) {
    return null;
  }

  return {
    start,
    openParen,
    closeParen,
    argsText: line.slice(openParen + 1, closeParen),
    match,
  };
}

function parseInstanceCall(line, methodName) {
  return findCallRange(
    line,
    new RegExp(`\\.\\s*${escapeRegex(methodName)}\\s*\\(`, "i"),
  );
}

function parseGlobalCall(line, pathParts) {
  const chain = pathParts
    .map((part) => `\\s*\\.\\s*${escapeRegex(part)}`)
    .join("");
  const call = findCallRange(
    line,
    new RegExp(`(\\$jq|\\$|jQuery)${chain}\\s*\\(`, "i"),
  );
  if (!call) {
    return null;
  }

  return {
    ...call,
    alias: call.match[1] || "jQuery",
  };
}

function replaceCallRange(line, call, replacement) {
  return `${line.slice(0, call.start)}${replacement}${line.slice(call.closeParen + 1)}`;
}

function isStringLiteral(text) {
  return /^(['"`])[\s\S]*\1$/.test(String(text || "").trim());
}

function isLikelySelectorArgument(argExpression) {
  const raw = String(argExpression || "").trim();
  if (!raw) {
    return false;
  }

  const unquoted = raw.replace(/^(['"`])([\s\S]*)\1$/, "$2");
  const eventLike = /^[A-Za-z]+(?:\.[A-Za-z0-9_-]+)*(?:\s+[A-Za-z]+(?:\.[A-Za-z0-9_-]+)*)*$/;
  if (eventLike.test(unquoted)) {
    return false;
  }

  if (/^[#.\[:]/.test(unquoted)) {
    return true;
  }

  return /[>+~\s]/.test(unquoted);
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
    return transformSelectorInMethodArgLine(
      line,
      "eq",
      (indexExpr) => `.eq(${indexExpr})`,
      { mode: "indexed" },
    );
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

function transformMethodRenameLine(line, fromMethod, toMethod) {
  const pattern = new RegExp(`\\.\\s*${escapeRegex(fromMethod)}\\s*\\(`, "i");
  if (!pattern.test(line)) {
    return null;
  }
  return line.replace(pattern, `.${toMethod}(`);
}

function transformAndSelfLine(line) {
  return transformMethodRenameLine(line, "andSelf", "addBack");
}

function transformUnbindLine(line) {
  return transformMethodRenameLine(line, "unbind", "off");
}

function transformUndelegateLine(line) {
  const call = parseInstanceCall(line, "undelegate");
  if (!call) {
    return null;
  }

  const args = splitTopLevelArguments(call.argsText);
  let rewrittenArgs = [];

  if (args.length >= 2) {
    rewrittenArgs = [args[1], args[0], ...args.slice(2)];
  } else if (args.length === 1) {
    if (isLikelySelectorArgument(args[0])) {
      rewrittenArgs = ["undefined", args[0]];
    } else {
      rewrittenArgs = [args[0]];
    }
  }

  const replacement =
    rewrittenArgs.length > 0
      ? `.off(${rewrittenArgs.join(", ")})`
      : ".off()";
  return replaceCallRange(line, call, replacement);
}

function transformDelegateLine(line) {
  const call = parseInstanceCall(line, "delegate");
  if (!call) {
    return null;
  }

  const args = splitTopLevelArguments(call.argsText);
  if (args.length < 2) {
    return transformMethodRenameLine(line, "delegate", "on");
  }

  const rewrittenArgs = [args[1], args[0], ...args.slice(2)];
  return replaceCallRange(line, call, `.on(${rewrittenArgs.join(", ")})`);
}

function transformHoverLine(line) {
  const call = parseInstanceCall(line, "hover");
  if (!call) {
    return null;
  }

  const args = splitTopLevelArguments(call.argsText);
  if (args.length === 0) {
    return null;
  }
  if (args.length === 1) {
    return replaceCallRange(
      line,
      call,
      `.on("mouseenter mouseleave", ${args[0]})`,
    );
  }

  return replaceCallRange(
    line,
    call,
    `.on("mouseenter", ${args[0]}).on("mouseleave", ${args[1]})`,
  );
}

function transformToggleEventLine(line) {
  const call = parseInstanceCall(line, "toggle");
  if (!call) {
    return null;
  }

  const args = splitTopLevelArguments(call.argsText);
  if (args.length < 2) {
    return null;
  }

  const handlers = `[${args.join(", ")}]`;
  const replacement =
    `.on("click", (function(__handlers){ ` +
    `let __i = 0; ` +
    `return function(event){ ` +
    `const __h = __handlers[__i % __handlers.length]; ` +
    `__i += 1; ` +
    `return __h.call(this, event); ` +
    `}; ` +
    `})(${handlers}))`;

  return replaceCallRange(line, call, replacement);
}

function transformDeferredStateLine(line, oldMethod, expectedState) {
  const call = parseInstanceCall(line, oldMethod);
  if (!call) {
    return null;
  }
  return replaceCallRange(line, call, `.state() === "${expectedState}"`);
}

function transformSelectorInMethodArgLine(
  line,
  selectorToken,
  buildSuffix,
  options = {},
) {
  const mode = options.mode || "simple";
  const text = String(line || "");
  const methodArgPattern =
    /\.\s*([A-Za-z_$][\w$]*)\s*\(\s*(['"])((?:\\.|(?!\2).)*)\2/g;
  let methodMatch;

  while ((methodMatch = methodArgPattern.exec(text)) !== null) {
    const methodName = String(methodMatch[1] || "");
    if (!SELECTOR_ARG_METHODS.has(methodName)) {
      continue;
    }

    const selector = methodMatch[3] || "";
    let normalizedSelector = selector;
    let suffix = null;

    if (mode === "indexed") {
      const indexedPattern = new RegExp(
        `:${escapeRegex(selectorToken)}\\(\\s*([^)]+?)\\s*\\)`,
        "i",
      );
      const selectorMatch = selector.match(indexedPattern);
      if (!selectorMatch) {
        continue;
      }

      const indexExpr = String(selectorMatch[1] || "").trim();
      if (!indexExpr) {
        continue;
      }
      normalizedSelector = selector.replace(indexedPattern, "");
      suffix = buildSuffix(indexExpr);
    } else {
      const simplePattern = new RegExp(`:${escapeRegex(selectorToken)}\\b`, "i");
      if (!simplePattern.test(selector)) {
        continue;
      }
      normalizedSelector = selector.replace(simplePattern, "");
      suffix = buildSuffix();
    }

    normalizedSelector = normalizedSelector.replace(/\s{2,}/g, " ").trim();
    if (!normalizedSelector) {
      normalizedSelector = "*";
    }

    const start = methodMatch.index;
    const openParen = text.indexOf("(", start);
    if (openParen < 0) {
      continue;
    }
    const closeParen = findMatchingParen(text, openParen);
    if (closeParen < 0) {
      continue;
    }

    const callText = text.slice(start, closeParen + 1);
    const argReplacePattern =
      /^(\.\s*[A-Za-z_$][\w$]*\s*\(\s*)(['"])((?:\\.|(?!\2).)*)\2/i;
    if (!argReplacePattern.test(callText)) {
      continue;
    }

    const quote = methodMatch[2];
    const rewrittenCall = callText.replace(
      argReplacePattern,
      `$1${quote}${normalizedSelector}${quote}`,
    );

    return `${text.slice(0, start)}${rewrittenCall}${suffix}${text.slice(closeParen + 1)}`;
  }

  return null;
}

function transformSimpleSelectorLine(line, selectorToken, replacementMethod) {
  const pattern = new RegExp(
    `((?:\\$jq|\\$|jQuery)\\s*\\(\\s*)(['"])([^"'` +
      "`" +
      `]*?):${escapeRegex(selectorToken)}([^"'` +
      "`" +
      `]*)\\2\\s*\\)`,
    "i",
  );
  const match = line.match(pattern);
  if (!match) {
    return transformSelectorInMethodArgLine(
      line,
      selectorToken,
      () => `.${replacementMethod}()`,
      { mode: "simple" },
    );
  }

  const replacement =
    `${match[1]}${match[2]}${match[3]}${match[4]}${match[2]})` +
    `.${replacementMethod}()`;
  const transformedInConstructor = line.replace(pattern, replacement);
  if (transformedInConstructor !== line) {
    return transformedInConstructor;
  }

  return transformSelectorInMethodArgLine(
    line,
    selectorToken,
    () => `.${replacementMethod}()`,
    { mode: "simple" },
  );
}

function transformSelectorWithIndexLine(line, selectorToken, replacementBuilder) {
  const pattern = new RegExp(
    `((?:\\$jq|\\$|jQuery)\\s*\\(\\s*)(['"])([^"'` +
      "`" +
      `]*?):${escapeRegex(selectorToken)}\\(\\s*([^)]+?)\\s*\\)([^"'` +
      "`" +
      `]*)\\2\\s*\\)`,
    "i",
  );
  const match = line.match(pattern);
  if (!match) {
    return transformSelectorInMethodArgLine(
      line,
      selectorToken,
      (value) => replacementBuilder(value),
      { mode: "indexed" },
    );
  }

  const indexExpr = String(match[4] || "").trim();
  if (!indexExpr) {
    return null;
  }

  const replacement =
    `${match[1]}${match[2]}${match[3]}${match[5]}${match[2]})` +
    replacementBuilder(indexExpr);
  const transformedInConstructor = line.replace(pattern, replacement);
  if (transformedInConstructor !== line) {
    return transformedInConstructor;
  }

  return transformSelectorInMethodArgLine(
    line,
    selectorToken,
    (value) => replacementBuilder(value),
    { mode: "indexed" },
  );
}

function transformFirstSelectorLine(line) {
  return transformSimpleSelectorLine(line, "first", "first");
}

function transformLastSelectorLine(line) {
  return transformSimpleSelectorLine(line, "last", "last");
}

function transformEvenSelectorLine(line) {
  return transformSimpleSelectorLine(line, "even", "even");
}

function transformOddSelectorLine(line) {
  return transformSimpleSelectorLine(line, "odd", "odd");
}

function transformGtSelectorLine(line) {
  return transformSelectorWithIndexLine(
    line,
    "gt",
    (indexExpr) => `.slice((${indexExpr}) + 1)`,
  );
}

function transformLtSelectorLine(line) {
  return transformSelectorWithIndexLine(
    line,
    "lt",
    (indexExpr) => `.slice(0, ${indexExpr})`,
  );
}

function transformGlobalMethodRewrite(line, pathParts, rewrite) {
  const call = parseGlobalCall(line, pathParts);
  if (!call) {
    return null;
  }

  const args = splitTopLevelArguments(call.argsText);
  const replacement = rewrite({
    alias: call.alias,
    args,
    argsText: call.argsText,
  });
  if (!replacement) {
    return null;
  }

  return replaceCallRange(line, call, replacement);
}

function transformJQueryIsArrayLine(line) {
  return transformGlobalMethodRewrite(line, ["isArray"], ({ args }) => {
    if (args.length === 0) {
      return "Array.isArray()";
    }
    return `Array.isArray(${args[0]})`;
  });
}

function transformJQueryIsNumericLine(line) {
  return transformGlobalMethodRewrite(line, ["isNumeric"], ({ args }) => {
    const valueExpr = args[0] || "value";
    return `Number.isFinite(Number(${valueExpr}))`;
  });
}

function transformJQueryIsWindowLine(line) {
  return transformGlobalMethodRewrite(line, ["isWindow"], ({ args }) => {
    const valueExpr = args[0] || "obj";
    return `(${valueExpr}) != null && (${valueExpr}) === (${valueExpr}).window`;
  });
}

function transformJQueryNowLine(line) {
  return transformGlobalMethodRewrite(line, ["now"], () => "Date.now()");
}

function transformJQueryTrimLine(line) {
  return transformGlobalMethodRewrite(line, ["trim"], ({ args }) => {
    const valueExpr = args[0] || "value";
    return `String(${valueExpr}).trim()`;
  });
}

function transformJQueryTypeLine(line) {
  return transformGlobalMethodRewrite(line, ["type"], ({ args }) => {
    const valueExpr = args[0] || "value";
    return `Object.prototype.toString.call(${valueExpr}).slice(8, -1).toLowerCase()`;
  });
}

function transformJQueryUniqueLine(line) {
  return transformGlobalMethodRewrite(line, ["unique"], ({ alias, args }) => {
    const valueExpr = args[0] || "array";
    return `${alias}.uniqueSort(${valueExpr})`;
  });
}

function transformJQueryProxyLine(line) {
  return transformGlobalMethodRewrite(line, ["proxy"], ({ args }) => {
    if (args.length < 2) {
      return null;
    }

    const restArgs = args.slice(2);
    const withRest = restArgs.length > 0 ? `, ${restArgs.join(", ")}` : "";

    if (isStringLiteral(args[1])) {
      return `${args[0]}[${args[1]}].bind(${args[0]}${withRest})`;
    }

    return `${args[0]}.bind(${args[1]}${withRest})`;
  });
}

function transformJQueryDeferredGetStackHookLine(line) {
  return transformGlobalMethodRewrite(
    line,
    ["Deferred", "getStackHook"],
    ({ alias, argsText }) => `${alias}.Deferred.getErrorHook(${argsText})`,
  );
}

function transformGlobalPropertyLine(line, pathParts, replacement) {
  const chain = pathParts
    .map((part) => `\\s*\\.\\s*${escapeRegex(part)}`)
    .join("");
  const pattern = new RegExp(`(?:\\$jq|\\$|jQuery)${chain}\\b`, "i");
  if (!pattern.test(line)) {
    return null;
  }
  return line.replace(pattern, replacement);
}

function transformJQueryBoxModelLine(line) {
  return transformGlobalPropertyLine(
    line,
    ["boxModel"],
    '(document.compatMode === "CSS1Compat")',
  );
}

function transformJQueryBrowserLine(line) {
  const browserSpecific = line.match(
    /(?:\$jq|\$|jQuery)\s*\.\s*browser\s*\.\s*([A-Za-z_$][\w$]*)\b/i,
  );
  if (browserSpecific) {
    const browserName = browserSpecific[1].toLowerCase();
    const map = {
      msie: '/msie|trident/i.test(navigator.userAgent)',
      mozilla:
        '/mozilla/i.test(navigator.userAgent) && !/webkit|trident/i.test(navigator.userAgent)',
      webkit: '/webkit/i.test(navigator.userAgent)',
      opera: '/opera|opr/i.test(navigator.userAgent)',
    };
    const replacement = map[browserName] || "navigator.userAgent";
    return line.replace(
      /(?:\$jq|\$|jQuery)\s*\.\s*browser\s*\.\s*[A-Za-z_$][\w$]*\b/i,
      replacement,
    );
  }

  return transformGlobalPropertyLine(line, ["browser"], "navigator.userAgent");
}

function transformJQuerySupportLine(line) {
  const supportSpecific = line.match(
    /(?:\$jq|\$|jQuery)\s*\.\s*support\s*\.\s*([A-Za-z_$][\w$]*)\b/i,
  );
  if (supportSpecific) {
    const feature = supportSpecific[1].toLowerCase();
    const map = {
      cors: '("withCredentials" in new XMLHttpRequest())',
      ajax: '("XMLHttpRequest" in window)',
      boxmodel: '(document.compatMode === "CSS1Compat")',
      opacity:
        '(typeof CSS !== "undefined" && CSS.supports ? CSS.supports("opacity", "0.5") : true)',
    };
    const replacement =
      map[feature] ||
      `(typeof CSS !== "undefined" && CSS.supports ? CSS.supports("${feature}") : false)`;
    return line.replace(
      /(?:\$jq|\$|jQuery)\s*\.\s*support\s*\.\s*[A-Za-z_$][\w$]*\b/i,
      replacement,
    );
  }

  return transformGlobalPropertyLine(
    line,
    ["support"],
    '(typeof CSS !== "undefined" ? CSS.supports : undefined)',
  );
}

function transformJQueryFxIntervalLine(line) {
  const assignmentPattern =
    /(?:\$jq|\$|jQuery)\s*\.\s*fx\s*\.\s*interval\s*=\s*[^;]+;?/i;
  if (assignmentPattern.test(line)) {
    return line.replace(
      assignmentPattern,
      "/* Removed jQuery.fx.interval assignment: no effect in modern jQuery */",
    );
  }

  return transformGlobalPropertyLine(line, ["fx", "interval"], "0");
}

function transformJQueryHoldReadyLine(line) {
  return transformGlobalMethodRewrite(line, ["holdReady"], ({ args }) => {
    const arg = (args[0] || "").trim().toLowerCase();
    if (arg === "false") {
      return "window.__jqReadyGateResolve && window.__jqReadyGateResolve()";
    }
    if (arg === "true") {
      return "window.__jqReadyGatePromise || (window.__jqReadyGatePromise = new Promise((resolve) => { window.__jqReadyGateResolve = resolve; }))";
    }
    return "window.__jqReadyGatePromise || Promise.resolve()";
  });
}

function transformJQuerySubLine(line) {
  return transformGlobalMethodRewrite(line, ["sub"], ({ alias }) => alias);
}

function transformSelectorPropertyLine(line) {
  if (!/\.\s*selector\b/i.test(line)) {
    return null;
  }
  return line.replace(/\.\s*selector\b/i, '.data("legacySelector")');
}

function buildCorrectedInstruction(rule, sourceLine) {
  const slug = String(rule.slug || "");
  const transforms = [
    () => (slug.endsWith("-shorthand") ? transformShorthandLine(sourceLine, slug) : null),
    () => {
      if (slug === "ready-deprecated-syntax") {
        return transformReadyLine(sourceLine);
      }
      if (slug === "attr-checked-legacy") {
        return transformAttrCheckedLine(sourceLine);
      }
      if (slug === "removeattr-disabled-legacy") {
        return transformRemoveAttrDisabledLine(sourceLine);
      }
      if (slug === "size") {
        return transformSizeLine(sourceLine);
      }
      if (slug === "jQuery.parseJSON") {
        return transformParseJsonLine(sourceLine);
      }
      if (slug === "deferred.pipe") {
        return transformDeferredPipeLine(sourceLine);
      }
      if (slug === "deferred.isRejected") {
        return transformDeferredStateLine(sourceLine, "isRejected", "rejected");
      }
      if (slug === "deferred.isResolved") {
        return transformDeferredStateLine(sourceLine, "isResolved", "resolved");
      }
      if (slug === "die") {
        return transformDieLine(sourceLine);
      }
      if (slug === "jQuery.isFunction") {
        return transformIsFunctionLine(sourceLine);
      }
      if (slug === "jQuery.isArray") {
        return transformJQueryIsArrayLine(sourceLine);
      }
      if (slug === "jQuery.isNumeric") {
        return transformJQueryIsNumericLine(sourceLine);
      }
      if (slug === "jQuery.isWindow") {
        return transformJQueryIsWindowLine(sourceLine);
      }
      if (slug === "jQuery.now") {
        return transformJQueryNowLine(sourceLine);
      }
      if (slug === "jQuery.trim") {
        return transformJQueryTrimLine(sourceLine);
      }
      if (slug === "jQuery.type") {
        return transformJQueryTypeLine(sourceLine);
      }
      if (slug === "jQuery.unique") {
        return transformJQueryUniqueLine(sourceLine);
      }
      if (slug === "jQuery.proxy") {
        return transformJQueryProxyLine(sourceLine);
      }
      if (slug === "jQuery.Deferred.getStackHook") {
        return transformJQueryDeferredGetStackHookLine(sourceLine);
      }
      if (slug === "bind") {
        return transformBindLine(sourceLine);
      }
      if (slug === "andSelf") {
        return transformAndSelfLine(sourceLine);
      }
      if (slug === "delegate") {
        return transformDelegateLine(sourceLine);
      }
      if (slug === "unbind") {
        return transformUnbindLine(sourceLine);
      }
      if (slug === "undelegate") {
        return transformUndelegateLine(sourceLine);
      }
      if (slug === "hover") {
        return transformHoverLine(sourceLine);
      }
      if (slug === "toggle-event") {
        return transformToggleEventLine(sourceLine);
      }
      if (slug === "context") {
        return transformContextLine(sourceLine);
      }
      if (slug === "selector") {
        return transformSelectorPropertyLine(sourceLine);
      }
      if (slug === "live") {
        return transformLiveLine(sourceLine);
      }
      if (slug === "eq-selector") {
        return transformEqSelectorLine(sourceLine);
      }
      if (slug === "first-selector") {
        return transformFirstSelectorLine(sourceLine);
      }
      if (slug === "last-selector") {
        return transformLastSelectorLine(sourceLine);
      }
      if (slug === "even-selector") {
        return transformEvenSelectorLine(sourceLine);
      }
      if (slug === "odd-selector") {
        return transformOddSelectorLine(sourceLine);
      }
      if (slug === "gt-selector") {
        return transformGtSelectorLine(sourceLine);
      }
      if (slug === "lt-selector") {
        return transformLtSelectorLine(sourceLine);
      }
      if (slug === "jQuery.boxModel") {
        return transformJQueryBoxModelLine(sourceLine);
      }
      if (slug === "jQuery.browser") {
        return transformJQueryBrowserLine(sourceLine);
      }
      if (slug === "jQuery.support") {
        return transformJQuerySupportLine(sourceLine);
      }
      if (slug === "jQuery.fx.interval") {
        return transformJQueryFxIntervalLine(sourceLine);
      }
      if (slug === "jQuery.holdReady") {
        return transformJQueryHoldReadyLine(sourceLine);
      }
      if (slug === "jQuery.sub") {
        return transformJQuerySubLine(sourceLine);
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

function buildFullyCorrectedLine(sourceLine, rules) {
  let currentLine = sourceLine;
  const seenLines = new Set([currentLine]);
  const maxPasses = 8;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changedInPass = false;

    for (const rule of rules) {
      const matches = getLineMatchesForRule(currentLine, rule);
      if (matches.length === 0) {
        continue;
      }

      const candidate = buildCorrectedInstruction(rule, currentLine);
      if (!candidate || candidate === currentLine) {
        continue;
      }

      currentLine = candidate;
      changedInPass = true;

      if (seenLines.has(currentLine)) {
        return currentLine;
      }
      seenLines.add(currentLine);
    }

    if (!changedInPass) {
      break;
    }
  }

  return currentLine !== sourceLine ? currentLine : null;
}

function buildRecommendationWithInstruction(rule, sourceLine, lineWideCorrection = null) {
  const guidance = buildSuggestion(rule);
  const detectedInstruction = sourceLine;
  const correctedInstruction =
    lineWideCorrection || buildCorrectedInstruction(rule, sourceLine);
  const recommendation = correctedInstruction || guidance;

  return {
    recommendation,
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

    const lineWideCorrection = buildFullyCorrectedLine(line, rules);

    for (const rule of rules) {
      const matches = getLineMatchesForRule(line, rule);
      for (const match of matches) {
        const correction = buildRecommendationWithInstruction(
          rule,
          line,
          lineWideCorrection,
        );
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

function normalizeLastModified(value) {
  if (value == null || value === "") {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
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
      lastModified: normalizeLastModified(file.lastModified),
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
      lastModified: normalizeLastModified(item.lastModified),
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
          lastModified: normalizeLastModified(item.lastModified),
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
