require("../utils/node18-undici-polyfill");

const {
  ensureKnowledge,
  getKnowledgeSummary,
} = require("../services/jquery-knowledge-service");

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

  const summary = getKnowledgeSummary(knowledge);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error construyendo base de conocimiento: ${error.message}\n`);
  process.exitCode = 1;
});
