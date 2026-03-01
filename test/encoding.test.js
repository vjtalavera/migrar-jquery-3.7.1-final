const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadFilesContent } = require("../src/utils/fs-utils");
const { analyzeUploadedFiles } = require("../src/services/analyzer");

test("carga archivos locales legacy preservando acentos", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jq-encoding-"));
  const filePath = path.join(tempDir, "legacy.js");
  const sourceLine = "$jq('#btn').bind('click', function(){ var titulo = 'Canción'; });";

  try {
    await fs.writeFile(filePath, Buffer.from(sourceLine, "latin1"));
    const loaded = await loadFilesContent([filePath]);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].content, sourceLine);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("procesa uploads en base64 preservando acentos", () => {
  const sourceLine = "$jq('#btn').bind('click', function(){ var titulo = 'Canción'; });";
  const knowledge = {
    entries: [
      {
        title: ".bind()",
        slug: "bind",
        url: "https://api.jquery.com/bind/",
        status: ["deprecated"],
        deprecatedIn: "3.0",
        removedIn: null,
        replacements: ["Reemplaza por .on()."],
        detection: {
          kind: "instanceMethod",
          token: "bind",
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [
      {
        path: "demo.js",
        contentBase64: Buffer.from(sourceLine, "latin1").toString("base64"),
      },
    ],
    knowledge,
  );

  assert.equal(report.files[0].sourceType, "upload");
  assert.equal(
    report.findings[0].correctedInstruction,
    "$jq('#btn').on('click', function(){ var titulo = 'Canción'; });",
  );
});
