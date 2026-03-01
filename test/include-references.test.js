const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeUploadedFiles } = require("../src/services/analyzer");

test("extrae archivos incluidos desde jsp include, directives y script", () => {
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
        detection: { kind: "instanceMethod", token: "bind" },
      },
    ],
  };

  const content = [
    '<%@ include file="/WEB-INF/jsp/header.jsp" %>',
    '<jsp:include page="/common/menu.jsp" />',
    '<script type="text/javascript" src="/static/js/app.js"></script>',
    '<script language="JavaScript" src="/legacy/old.js"></script>',
    "<script>",
    "$.getScript('/dynamic/extra.js');",
    "const tpl = '/pages/fragment.jsp';",
    "</script>",
    '$jq(document).bind("mousemove", function(m) {',
  ].join("\n");

  const report = analyzeUploadedFiles(
    [{ path: "demo.jsp", content }],
    knowledge,
  );

  assert.equal(report.files.length, 1);
  const refs = report.files[0].includeReferences || [];
  const values = refs.map((item) => `${item.source}:${item.value}`);

  assert.ok(values.includes("jsp-directive:/WEB-INF/jsp/header.jsp"));
  assert.ok(values.includes("jsp:include:/common/menu.jsp"));
  assert.ok(values.includes("script-src:/static/js/app.js"));
  assert.ok(values.includes("script-src:/legacy/old.js"));
  assert.ok(values.includes("script-inline:/dynamic/extra.js"));
  assert.ok(values.includes("script-inline:/pages/fragment.jsp"));
});
