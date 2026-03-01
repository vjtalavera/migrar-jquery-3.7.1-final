const fs = require("node:fs/promises");
const path = require("node:path");
const cheerio = require("cheerio");
const { BASE_CATEGORIES, DATA_DIR, KNOWLEDGE_FILE } = require("../config");
const { fetchText } = require("../utils/http");
const {
  escapeRegex,
  normalizeWhitespace,
  toSlug,
  truncate,
  uniqueStrings,
} = require("../utils/text");
const { searchWebCorrection } = require("./web-fallback");

const MANUAL_SOLUTIONS = {
  andSelf: "Reemplaza `.andSelf()` por `.addBack()`.",
  bind: "Reemplaza `.bind()` por `.on()`.",
  delegate:
    "Reemplaza `.delegate(selector, events, handler)` por `.on(events, selector, handler)`.",
  undelegate:
    "Reemplaza `.undelegate(...)` por `.off(...)` conservando el selector delegado.",
  unbind: "Reemplaza `.unbind()` por `.off()`.",
  live: "Reemplaza `.live()` por delegación con `.on(evento, selector, handler)`.",
  die: "Reemplaza `.die()` por `.off(evento, selector, handler)` en el elemento delegado.",
  size: "Reemplaza `.size()` por la propiedad `.length`.",
  context:
    "`.context` fue removido. Pasa el contexto explícitamente en `$(selector, contexto)` o usa variables de DOM.",
  selector:
    "`.selector` fue removido. Guarda el selector manualmente en tu propio estado si lo necesitas.",
  "deferred.pipe":
    "Reemplaza `deferred.pipe(...)` por `deferred.then(doneFilter, failFilter, progressFilter)`.",
  "deferred.isRejected":
    "Reemplaza `deferred.isRejected()` por `deferred.state() === \"rejected\"`.",
  "deferred.isResolved":
    "Reemplaza `deferred.isResolved()` por `deferred.state() === \"resolved\"`.",
  "eq-selector":
    "Quita `:eq()` del selector y filtra después con `.eq(indice)`.",
  "first-selector":
    "Quita `:first` del selector y filtra después con `.first()`.",
  "last-selector":
    "Quita `:last` del selector y filtra después con `.last()`.",
  "even-selector":
    "Quita `:even` del selector y filtra después con `.even()`.",
  "odd-selector":
    "Quita `:odd` del selector y filtra después con `.odd()`.",
  "gt-selector":
    "Quita `:gt(n)` del selector y filtra después con `.slice(n + 1)`.",
  "lt-selector":
    "Quita `:lt(n)` del selector y filtra después con `.slice(0, n)`.",
  "jQuery.boxModel":
    "Reemplaza `jQuery.boxModel` por `document.compatMode === \"CSS1Compat\"`.",
  "jQuery.browser":
    "Reemplaza `jQuery.browser` por feature detection y APIs estándar del navegador.",
  "jQuery.support":
    "Reemplaza `jQuery.support` por comprobaciones directas de capacidades del navegador.",
  "jQuery.isArray": "Reemplaza `jQuery.isArray(value)` por `Array.isArray(value)`.",
  "jQuery.isFunction":
    "Reemplaza `jQuery.isFunction(value)` por `typeof value === \"function\"`.",
  "jQuery.isNumeric":
    "Reemplaza `jQuery.isNumeric(value)` por `Number.isFinite(Number(value))` según tu caso.",
  "jQuery.isWindow":
    "Reemplaza `jQuery.isWindow(obj)` por `obj != null && obj === obj.window`.",
  "jQuery.now": "Reemplaza `jQuery.now()` por `Date.now()`.",
  "jQuery.parseJSON":
    "Reemplaza `jQuery.parseJSON(texto)` por `JSON.parse(texto)` con `try/catch`.",
  "jQuery.proxy":
    "Reemplaza `jQuery.proxy(fn, contexto)` por `fn.bind(contexto)` o funciones flecha.",
  "jQuery.sub":
    "`jQuery.sub()` fue removido; usa módulos/plugins aislados en vez de clonar el objeto jQuery global.",
  "jQuery.trim":
    "Reemplaza `jQuery.trim(valor)` por `String(valor).trim()` (controla `null/undefined` según tu caso).",
  "jQuery.type":
    "Reemplaza `jQuery.type(obj)` por combinaciones de `typeof`, `Array.isArray` y `Object.prototype.toString.call(obj)`.",
  "jQuery.unique":
    "Reemplaza `jQuery.unique(array)` por `jQuery.uniqueSort(array)`.",
  "jQuery.fx.interval":
    "`jQuery.fx.interval` está deprecado; en navegadores modernos no tiene efecto con `requestAnimationFrame`.",
  "jQuery.holdReady":
    "Evita `jQuery.holdReady()`: usa `$.when($.ready, promesaPersonalizada).then(...)` para sincronizar ready + async.",
  hover:
    "Reemplaza `.hover(in, out)` por `.on(\"mouseenter\", in).on(\"mouseleave\", out)`.",
  "toggle-event":
    "La firma de `.toggle(fn1, fn2, ...)` fue removida. Usa `.on(\"click\", handler)` y maneja estado explícitamente.",
};

const AMBIGUOUS_RULES = new Set(["load-shorthand", "toggle-event"]);
const JQUERY_START_REGEX = /(?:\$jq|\$|jQuery)\s*(?:\(|\.)/;
const EXTRA_MIGRATION_RULES = [
  {
    title: ".ready() (syntaxis legacy deprecada)",
    slug: "ready-deprecated-syntax",
    url: "https://api.jquery.com/ready/",
    status: ["deprecated"],
    deprecatedIn: "3.0",
    removedIn: null,
    replacements: [
      "Reemplaza `$(document).ready(handler)` y variantes (`$jq(...).ready(handler)`, `$().ready(handler)`) por `$(handler)`.",
    ],
    signatures: ["$( handler )", "$( document ).ready( handler )"],
    notes:
      "As of jQuery 3.0, only $( handler ) is recommended; other .ready() syntaxes are deprecated.",
    webFallback: null,
    detection: {
      kind: "readyDeprecatedSyntax",
    },
  },
  {
    title: ".attr(\"checked\", value) para estado dinámico",
    slug: "attr-checked-legacy",
    url: "https://api.jquery.com/prop/",
    status: ["deprecated"],
    deprecatedIn: "1.6+ (usar .prop para booleanos)",
    removedIn: null,
    replacements: [
      "Reemplaza `.attr('checked', valor)` por `.prop('checked', valor)` para reflejar el estado actual.",
    ],
    signatures: [".prop( \"checked\" )", ".prop( \"checked\", value )"],
    notes:
      "The .prop() method should be used to set disabled and checked instead of the .attr() method.",
    webFallback: null,
    detection: {
      kind: "legacyBooleanAttrSetter",
      token: "checked",
    },
  },
];

let inMemoryKnowledge = null;
let buildingPromise = null;

function normalizeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return null;
  }
}

function detectStatus(url, hintedStatuses, entryMetaLinks) {
  const statuses = new Set(hintedStatuses);

  for (const link of entryMetaLinks) {
    if (link.includes("/category/removed/")) {
      statuses.add("removed");
    }
    if (link.includes("/category/deprecated/")) {
      statuses.add("deprecated");
    }
  }

  if (statuses.size === 0) {
    if (url.includes("/removed/")) {
      statuses.add("removed");
    }
    if (url.includes("/deprecated/")) {
      statuses.add("deprecated");
    }
  }

  return Array.from(statuses);
}

function extractVersions(rawText) {
  const deprecatedMatch = rawText.match(
    /version\s+deprecated:\s*([^,|]+?)(?=\s*(?:,|removed:|version|description|$))/i,
  );
  const removedMatch = rawText.match(
    /removed:\s*([^,|]+?)(?=\s*(?:,|version|description|$))/i,
  );

  return {
    deprecatedIn: deprecatedMatch
      ? normalizeWhitespace(deprecatedMatch[1].replace(/\s*\|.*$/, ""))
      : null,
    removedIn: removedMatch
      ? normalizeWhitespace(removedMatch[1].replace(/\s*\|.*$/, ""))
      : null,
  };
}

function extractReplacementCandidates(textBlocks) {
  const suggestions = [];

  const patterns = [
    /\bUse\s+(.{5,240}?)\s+instead\b/i,
    /\busing\s+(.{5,240}?)\b/i,
    /\breplaced by\s+(.{5,240}?)(?:\.|$)/i,
    /\bcheck if\s+(.{5,240}?)(?:\.|$)/i,
    /\breimplement it by yourself:\s*(function\s+isWindow\s*\([^)]*\)\s*\{[^}]+\})/i,
    /\bRemove it from your selectors and filter the results later using\s+(.{5,160}?)(?:\.|$)/i,
    /\bit's better to\s+(.{5,220}?)(?:\.|$)/i,
  ];

  for (const block of textBlocks) {
    const normalized = normalizeWhitespace(block);
    if (!normalized) {
      continue;
    }

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        const cleaned = normalizeWhitespace(match[1]).replace(/\s+\($/, "");
        suggestions.push(cleaned);
      }
    }
  }

  return uniqueStrings(suggestions).map((item) => truncate(item, 260));
}

function titleToRule(title, slug) {
  if (!title) {
    return null;
  }

  if (title.startsWith(":")) {
    const selectorMatch = title.match(/^:([A-Za-z0-9_-]+)/);
    if (!selectorMatch) {
      return null;
    }

    return {
      kind: "selector",
      token: selectorMatch[1],
    };
  }

  if (title.startsWith("jQuery.")) {
    const withoutPrefix = title.slice("jQuery.".length);
    const isMethod = /\(\)/.test(withoutPrefix);
    const cleaned = withoutPrefix.replace(/\(\).*$/, "");
    const pathParts = cleaned.split(".").filter(Boolean);
    if (pathParts.length === 0) {
      return null;
    }

    return {
      kind: isMethod ? "globalMethod" : "globalProperty",
      token: pathParts[pathParts.length - 1],
      pathParts,
    };
  }

  if (title.startsWith("deferred.")) {
    const cleaned = title.replace(/^deferred\./, "").replace(/\(\).*$/, "");
    if (!cleaned) {
      return null;
    }

    return {
      kind: "instanceMethod",
      token: cleaned,
      contextHint: "deferred",
    };
  }

  if (title.startsWith(".")) {
    const withoutDot = title.slice(1);
    const isMethod = /\(\)/.test(withoutDot);
    const cleaned = withoutDot.replace(/\(\).*$/, "");
    if (!cleaned) {
      return null;
    }

    return {
      kind: isMethod ? "instanceMethod" : "instanceProperty",
      token: cleaned,
      ambiguous: AMBIGUOUS_RULES.has(slug),
    };
  }

  return null;
}

function mergeExtraMigrationRules(entries) {
  const merged = [...entries];
  const slugs = new Set(entries.map((entry) => entry.slug));
  for (const rule of EXTRA_MIGRATION_RULES) {
    if (!slugs.has(rule.slug)) {
      merged.push(rule);
    }
  }
  return merged;
}

function buildKnowledgeIndex(entries) {
  const sourceEntries = mergeExtraMigrationRules(entries);
  return sourceEntries
    .map((entry) => {
      const detection = entry.detection || titleToRule(entry.title, entry.slug);
      if (!detection) {
        return null;
      }

      return {
        ...entry,
        detection,
      };
    })
    .filter(Boolean);
}

async function discoverCategoryPages(baseCategories, onProgress) {
  const queue = [...baseCategories];
  const visited = new Set();
  const entryUrlHints = new Map();

  while (queue.length > 0) {
    const categoryUrl = queue.shift();
    if (!categoryUrl || visited.has(categoryUrl)) {
      continue;
    }
    visited.add(categoryUrl);

    onProgress?.({
      stage: "crawl-category",
      message: `Analizando categoría ${categoryUrl}`,
    });

    const html = await fetchText(categoryUrl);
    const $ = cheerio.load(html);

    const statusHint = categoryUrl.includes("/category/removed/")
      ? "removed"
      : "deprecated";

    $("h1.entry-title a[href]").each((_, element) => {
      const href = $(element).attr("href");
      const normalized = normalizeUrl(href, categoryUrl);
      if (!normalized || normalized.includes("/category/")) {
        return;
      }

      if (!entryUrlHints.has(normalized)) {
        entryUrlHints.set(normalized, new Set());
      }
      entryUrlHints.get(normalized).add(statusHint);
    });

    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      const normalized = normalizeUrl(href, categoryUrl);
      if (!normalized) {
        return;
      }

      const isTargetCategory =
        normalized.includes("/category/deprecated/") ||
        normalized.includes("/category/removed/");
      const isPagination = /\/page\/\d+\/?$/i.test(normalized);

      if (isTargetCategory || isPagination) {
        queue.push(normalized);
      }
    });
  }

  return {
    categoryPages: Array.from(visited),
    entryUrlHints,
  };
}

async function parseEntry(entryUrl, hintedStatuses, options = {}) {
  const html = await fetchText(entryUrl);
  const $ = cheerio.load(html);

  const title = normalizeWhitespace($("h1.entry-title").first().text());
  const slug = toSlug(entryUrl);
  const rawText = normalizeWhitespace($(".entry-wrapper, .entry-content").first().text());

  const entryMetaLinks = [];
  $(".entry-meta a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const normalized = normalizeUrl(href, entryUrl);
    if (normalized) {
      entryMetaLinks.push(normalized);
    }
  });

  const status = detectStatus(entryUrl, hintedStatuses, entryMetaLinks);
  const versions = extractVersions(rawText);

  const textBlocks = [];
  $(".entry-wrapper p, .entry-wrapper li, .entry-content p, .entry-content li").each(
    (_, element) => {
      textBlocks.push($(element).text());
    },
  );
  textBlocks.push(rawText);

  const autoReplacements = extractReplacementCandidates(textBlocks);
  const manualReplacement = MANUAL_SOLUTIONS[slug];
  const replacements = uniqueStrings([
    manualReplacement || "",
    ...autoReplacements,
  ]);

  let webFallback = null;
  if (replacements.length === 0 && options.useWebFallback) {
    try {
      webFallback = await searchWebCorrection(title || slug);
      if (webFallback?.correction) {
        replacements.push(webFallback.correction);
      }
    } catch {
      // Mantener robustez del crawler aunque una búsqueda externa falle.
    }
  }

  const signatures = [];
  $(".entry-content h4 a, .entry-wrapper h4 a").each((_, element) => {
    signatures.push($(element).text());
  });

  return {
    title,
    slug,
    url: entryUrl,
    status,
    deprecatedIn: versions.deprecatedIn,
    removedIn: versions.removedIn,
    replacements,
    signatures: uniqueStrings(signatures),
    notes: truncate(rawText, 380),
    webFallback,
  };
}

async function crawlKnowledge(options = {}) {
  const onProgress = options.onProgress;
  const useWebFallback = options.useWebFallback ?? true;
  const startedAt = new Date().toISOString();

  const { categoryPages, entryUrlHints } = await discoverCategoryPages(
    BASE_CATEGORIES,
    onProgress,
  );

  const entryUrls = Array.from(entryUrlHints.keys()).sort();
  const entries = [];

  for (let index = 0; index < entryUrls.length; index += 1) {
    const entryUrl = entryUrls[index];
    const hintedStatuses = Array.from(entryUrlHints.get(entryUrl) || []);

    onProgress?.({
      stage: "crawl-entry",
      message: `Leyendo ${entryUrl} (${index + 1}/${entryUrls.length})`,
      progress: Number((((index + 1) / entryUrls.length) * 100).toFixed(1)),
    });

    const parsedEntry = await parseEntry(entryUrl, hintedStatuses, {
      useWebFallback,
    });
    entries.push(parsedEntry);
  }

  const indexedEntries = buildKnowledgeIndex(entries);

  return {
    generatedAt: new Date().toISOString(),
    startedAt,
    source: {
      baseCategories: BASE_CATEGORIES,
      crawledCategories: categoryPages,
      entryCount: indexedEntries.length,
      rawEntryCount: entries.length,
    },
    entries: indexedEntries,
  };
}

async function readKnowledgeFromDisk() {
  try {
    const raw = await fs.readFile(KNOWLEDGE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeKnowledgeToDisk(knowledge) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(KNOWLEDGE_FILE, JSON.stringify(knowledge, null, 2), "utf8");
}

function normalizeKnowledgePayload(knowledge) {
  if (!knowledge || !Array.isArray(knowledge.entries)) {
    return null;
  }

  const entries = buildKnowledgeIndex(knowledge.entries);
  return {
    ...knowledge,
    entries,
    source: {
      ...(knowledge.source || {}),
      entryCount: entries.length,
    },
  };
}

async function ensureKnowledge(options = {}) {
  if (inMemoryKnowledge && !options.forceRefresh) {
    return inMemoryKnowledge;
  }

  if (!options.forceRefresh) {
    const diskKnowledge = await readKnowledgeFromDisk();
    const normalizedDiskKnowledge = normalizeKnowledgePayload(diskKnowledge);
    if (normalizedDiskKnowledge) {
      inMemoryKnowledge = normalizedDiskKnowledge;
      return normalizedDiskKnowledge;
    }
  }

  if (!buildingPromise) {
    buildingPromise = crawlKnowledge(options)
      .then(async (knowledge) => {
        const normalizedKnowledge = normalizeKnowledgePayload(knowledge);
        if (!normalizedKnowledge) {
          throw new Error("No fue posible normalizar la base de conocimiento de jQuery.");
        }
        inMemoryKnowledge = normalizedKnowledge;
        await writeKnowledgeToDisk(normalizedKnowledge);
        return normalizedKnowledge;
      })
      .finally(() => {
        buildingPromise = null;
      });
  }

  return buildingPromise;
}

function getKnowledgeSummary(knowledge) {
  if (!knowledge) {
    return null;
  }

  const removed = knowledge.entries.filter((item) =>
    item.status.includes("removed"),
  ).length;
  const deprecated = knowledge.entries.filter((item) =>
    item.status.includes("deprecated"),
  ).length;

  return {
    generatedAt: knowledge.generatedAt,
    entries: knowledge.entries.length,
    deprecatedEntries: deprecated,
    removedEntries: removed,
    knowledgeFile: KNOWLEDGE_FILE,
  };
}

function getLineMatchesForRule(line, rule) {
  const matches = [];
  const { detection } = rule;

  if (!line || !detection) {
    return matches;
  }

  if (detection.kind === "readyDeprecatedSyntax") {
    const pattern = /(?:\$jq|\$|jQuery)\s*\([^)]*\)\s*\.\s*ready\s*\(/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      matches.push({
        index: match.index,
        value: match[0].trim(),
      });
    }
  } else if (detection.kind === "legacyBooleanAttrSetter") {
    const token = detection.token || "checked";
    const pattern = new RegExp(
      `\\.\\s*attr\\s*\\(\\s*(['"])${escapeRegex(token)}\\1\\s*,`,
      "gi",
    );
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const left = line.slice(0, match.index);
      if (!JQUERY_START_REGEX.test(left)) {
        continue;
      }

      matches.push({
        index: match.index,
        value: match[0].trim(),
      });
    }
  } else if (
    detection.kind === "instanceMethod" ||
    detection.kind === "instanceProperty"
  ) {
    const suffix = detection.kind === "instanceMethod" ? "\\s*\\(" : "\\b";
    const pattern = new RegExp(`\\.\\s*${escapeRegex(detection.token)}${suffix}`, "g");
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const left = line.slice(0, match.index);
      if (!JQUERY_START_REGEX.test(left)) {
        continue;
      }

      const isLikelyLoadAjax =
        rule.slug === "load-shorthand" && /\.\s*load\s*\(\s*["'`]/i.test(match[0] + line.slice(match.index + match[0].length));
      if (isLikelyLoadAjax) {
        continue;
      }

      if (rule.slug === "toggle-event") {
        const after = line.slice(match.index);
        const argsMatch = after.match(/toggle\s*\((.*)\)/i);
        const args = argsMatch ? argsMatch[1] : "";
        const commaCount = (args.match(/,/g) || []).length;
        const hasFunctionWord = /\bfunction\b|=>/.test(args);
        if (!(commaCount >= 1 && hasFunctionWord)) {
          continue;
        }
      }

      matches.push({
        index: match.index,
        value: match[0].trim(),
      });
    }
  } else if (
    detection.kind === "globalMethod" ||
    detection.kind === "globalProperty"
  ) {
    const suffix = detection.kind === "globalMethod" ? "\\s*\\(" : "\\b";
    const joinedPath = detection.pathParts
      .map((part) => `\\s*\\.\\s*${escapeRegex(part)}`)
      .join("");
    const pattern = new RegExp(`(?:\\$jq|\\$|jQuery)${joinedPath}${suffix}`, "g");
    let match;
    while ((match = pattern.exec(line)) !== null) {
      matches.push({
        index: match.index,
        value: match[0].trim(),
      });
    }
  } else if (detection.kind === "selector") {
    if (!JQUERY_START_REGEX.test(line)) {
      return matches;
    }
    const pattern = new RegExp(`:${escapeRegex(detection.token)}(?:\\b|\\s*\\()`, "g");
    let match;
    while ((match = pattern.exec(line)) !== null) {
      matches.push({
        index: match.index,
        value: match[0].trim(),
      });
    }
  }

  return matches;
}

module.exports = {
  ensureKnowledge,
  getKnowledgeSummary,
  getLineMatchesForRule,
};
