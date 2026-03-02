require("../utils/node18-undici-polyfill");

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ensureKnowledge,
  getKnowledgeSummary,
} = require("../services/jquery-knowledge-service");
const { DATA_DIR } = require("../config");

const KNOWLEDGE_REPORT_FILE = path.join(DATA_DIR, "jquery-deprecated-removed-report.md");

function sanitizeCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

async function writeKnowledgeReport(knowledge) {
  const entries = [...(knowledge.entries || [])].sort((a, b) =>
    String(a.slug || "").localeCompare(String(b.slug || "")),
  );

  const lines = [];
  lines.push("# Reporte jQuery Deprecated/Removed");
  lines.push("");
  lines.push(`Generado: ${knowledge.generatedAt}`);
  lines.push("");
  lines.push("Fuentes de categoria rastreadas:");

  for (const categoryUrl of knowledge.source?.crawledCategories || []) {
    lines.push(`- ${categoryUrl}`);
  }

  lines.push("");
  lines.push("| API | Estado | Deprecated In | Removed In | Solucion recomendada | URL |");
  lines.push("|---|---|---|---|---|---|");

  for (const entry of entries) {
    lines.push(
      `| ${sanitizeCell(entry.title || entry.slug)} | ${sanitizeCell((entry.status || []).join(", "))} | ${sanitizeCell(entry.deprecatedIn)} | ${sanitizeCell(entry.removedIn)} | ${sanitizeCell((entry.replacements || [])[0])} | ${sanitizeCell(entry.url)} |`,
    );
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(KNOWLEDGE_REPORT_FILE, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const useWebFallback = process.argv.includes("--web-fallback");
  const forceRefresh = !process.argv.includes("--no-force");

  const knowledge = await ensureKnowledge({
    forceRefresh,
    useWebFallback,
    onProgress: (progress) => {
      if (!progress) {
        return;
      }
      const pct = progress.progress != null ? ` (${progress.progress}%)` : "";
      process.stdout.write(`${progress.stage}${pct}: ${progress.message}\n`);
    },
  });

  await writeKnowledgeReport(knowledge);

  const summary = getKnowledgeSummary(knowledge);
  summary.knowledgeReportFile = KNOWLEDGE_REPORT_FILE;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error construyendo base de conocimiento: ${error.message}\n`);
  process.exitCode = 1;
});
