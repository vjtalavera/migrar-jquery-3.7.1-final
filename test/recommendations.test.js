const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeUploadedFiles } = require("../src/services/analyzer");

test("genera correccion definitiva para click shorthand", () => {
  const knowledge = {
    entries: [
      {
        title: ".click()",
        slug: "click-shorthand",
        url: "https://api.jquery.com/click-shorthand/",
        status: ["deprecated"],
        deprecatedIn: "3.3",
        removedIn: null,
        replacements: [
          '.on( "click", handler ) or .on( "click", eventData, handler ), respectively.',
        ],
        detection: {
          kind: "instanceMethod",
          token: "click",
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [{ path: "demo.js", content: "$('#btn').click(function(){});" }],
    knowledge,
  );

  assert.equal(report.findings.length, 1);
  assert.equal(
    report.findings[0].correctedInstruction,
    `$('#btn').on("click", function(){});`,
  );
  assert.equal(
    report.findings[0].recommendation,
    `$('#btn').on("click", function(){});`,
  );
});

test("genera correccion definitiva para ready y attr checked", () => {
  const knowledge = {
    entries: [
      {
        title: ".ready() (syntaxis legacy deprecada)",
        slug: "ready-deprecated-syntax",
        url: "https://api.jquery.com/ready/",
        status: ["deprecated"],
        deprecatedIn: "3.0",
        removedIn: null,
        replacements: ["texto ambiguo"],
        detection: {
          kind: "readyDeprecatedSyntax",
        },
      },
      {
        title: '.attr("checked", value) para estado dinámico',
        slug: "attr-checked-legacy",
        url: "https://api.jquery.com/prop/",
        status: ["deprecated"],
        deprecatedIn: "1.6+",
        removedIn: null,
        replacements: ["texto ambiguo"],
        detection: {
          kind: "legacyBooleanAttrSetter",
          token: "checked",
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [
      {
        path: "demo.js",
        content: "$(document).ready(function(){});\n$jq('input').attr('checked', false);",
      },
    ],
    knowledge,
  );

  assert.equal(report.findings.length, 2);
  assert.equal(
    report.findings[0].correctedInstruction,
    "$(function(){});",
  );
  assert.equal(
    report.findings[1].correctedInstruction,
    "$jq('input').prop('checked', false);",
  );
  assert.equal(report.findings[0].recommendation, "$(function(){});");
  assert.equal(
    report.findings[1].recommendation,
    "$jq('input').prop('checked', false);",
  );
});

test("genera correccion para deferred.pipe, die e isFunction", () => {
  const knowledge = {
    entries: [
      {
        title: "deferred.pipe()",
        slug: "deferred.pipe",
        url: "https://api.jquery.com/deferred.pipe/",
        status: ["deprecated"],
        deprecatedIn: "1.8",
        removedIn: null,
        replacements: ["Reemplaza por .then()."],
        detection: {
          kind: "instanceMethod",
          token: "pipe",
        },
      },
      {
        title: ".die()",
        slug: "die",
        url: "https://api.jquery.com/die/",
        status: ["removed"],
        deprecatedIn: "1.7",
        removedIn: "1.9",
        replacements: ["Reemplaza por .off()."],
        detection: {
          kind: "instanceMethod",
          token: "die",
        },
      },
      {
        title: "jQuery.isFunction()",
        slug: "jQuery.isFunction",
        url: "https://api.jquery.com/jQuery.isFunction/",
        status: ["deprecated"],
        deprecatedIn: "3.3",
        removedIn: "4.0",
        replacements: ['Usa `typeof value === "function"`'],
        detection: {
          kind: "globalMethod",
          token: "isFunction",
          pathParts: ["isFunction"],
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [
      {
        path: "demo.js",
        content: [
          "$jq('#cargarSpinnerLH')deferred.pipe();",
          "$('input[name=\"pagoGastos\"]').die();",
          "if ($jq.isFunction(callback)) {",
        ].join("\n"),
      },
    ],
    knowledge,
  );

  assert.equal(report.findings.length, 3);
  assert.equal(
    report.findings[0].correctedInstruction,
    "$jq('#cargarSpinnerLH').deferred.then();",
  );
  assert.equal(
    report.findings[1].correctedInstruction,
    "$('input[name=\"pagoGastos\"]').off();",
  );
  assert.equal(
    report.findings[2].correctedInstruction,
    'if (typeof callback === "function") {',
  );
});

test("corrige todas las llamadas jQuery.isFunction en la misma línea", () => {
  const knowledge = {
    entries: [
      {
        title: "jQuery.isFunction()",
        slug: "jQuery.isFunction",
        url: "https://api.jquery.com/jQuery.isFunction/",
        status: ["deprecated"],
        deprecatedIn: "3.3",
        removedIn: "4.0",
        replacements: ['Usa `typeof value === "function"`'],
        detection: {
          kind: "globalMethod",
          token: "isFunction",
          pathParts: ["isFunction"],
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [
      {
        path: "demo.js",
        content: 'return jQuery.isFunction(fn) && jQuery.isFunction(fn2) ?',
      },
    ],
    knowledge,
  );

  assert.equal(report.findings.length, 2);
  assert.equal(
    report.findings[0].correctedInstruction,
    'return typeof fn === "function" && typeof fn2 === "function" ?',
  );
  assert.equal(
    report.findings[1].correctedInstruction,
    'return typeof fn === "function" && typeof fn2 === "function" ?',
  );
});

test("genera correccion para bind a on", () => {
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
        content: '$jq(document).bind("mousemove", function(m) {',
      },
    ],
    knowledge,
  );

  assert.equal(report.findings.length, 1);
  assert.equal(
    report.findings[0].correctedInstruction,
    '$jq(document).on("mousemove", function(m) {',
  );
  assert.equal(
    report.findings[0].recommendation,
    '$jq(document).on("mousemove", function(m) {',
  );
});

test("genera correccion para context a ownerDocument", () => {
  const knowledge = {
    entries: [
      {
        title: ".context",
        slug: "context",
        url: "https://api.jquery.com/context/",
        status: ["deprecated", "removed"],
        deprecatedIn: "1.10",
        removedIn: "3.0",
        replacements: [
          "Reemplaza `.context` por acceso explícito al documento con `.get(0).ownerDocument`.",
        ],
        detection: {
          kind: "instanceProperty",
          token: "context",
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [
      {
        path: "demo.js",
        content: "$jq('#cargarSpinnerLH').context;",
      },
    ],
    knowledge,
  );

  assert.equal(report.findings.length, 1);
  assert.equal(
    report.findings[0].correctedInstruction,
    "$jq('#cargarSpinnerLH').get(0).ownerDocument;",
  );
  assert.equal(
    report.findings[0].recommendation,
    "$jq('#cargarSpinnerLH').get(0).ownerDocument;",
  );
});

test("genera correccion para live a on delegado", () => {
  const knowledge = {
    entries: [
      {
        title: ".live()",
        slug: "live",
        url: "https://api.jquery.com/live/",
        status: ["removed"],
        deprecatedIn: "1.7",
        removedIn: "1.9",
        replacements: ["Reemplaza .live() por .on() con delegación."],
        detection: {
          kind: "instanceMethod",
          token: "live",
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [
      {
        path: "demo.js",
        content:
          "$jq('#dialog-detalle_operacion').live('pagehide', function () {",
      },
    ],
    knowledge,
  );

  assert.equal(report.findings.length, 1);
  assert.equal(
    report.findings[0].correctedInstruction,
    "$jq(document).on('pagehide', '#dialog-detalle_operacion', function () {",
  );
  assert.equal(
    report.findings[0].recommendation,
    "$jq(document).on('pagehide', '#dialog-detalle_operacion', function () {",
  );
});

test("genera correccion para selector :eq() a .eq()", () => {
  const knowledge = {
    entries: [
      {
        title: ":eq() selector",
        slug: "eq-selector",
        url: "https://api.jquery.com/eq-selector/",
        status: ["deprecated"],
        deprecatedIn: "3.4",
        removedIn: "4.0",
        replacements: ["Quita :eq() del selector y filtra después con .eq(indice)."],
        detection: {
          kind: "selector",
          token: "eq",
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [
      {
        path: "demo.js",
        content:
          'if(!$jq("#fechasVigencia div:eq(0)").hasClass("none"))',
      },
    ],
    knowledge,
  );

  assert.equal(report.findings.length, 1);
  assert.equal(
    report.findings[0].correctedInstruction,
    'if(!$jq("#fechasVigencia div").eq(0).hasClass("none"))',
  );
  assert.equal(
    report.findings[0].recommendation,
    'if(!$jq("#fechasVigencia div").eq(0).hasClass("none"))',
  );
});

test("genera correccion para click shorthand sin argumentos a trigger", () => {
  const knowledge = {
    entries: [
      {
        title: ".click()",
        slug: "click-shorthand",
        url: "https://api.jquery.com/click-shorthand/",
        status: ["deprecated"],
        deprecatedIn: "3.3",
        removedIn: null,
        replacements: ['Usa `.trigger("click")` o `.on("click", handler)` según el caso.'],
        detection: {
          kind: "instanceMethod",
          token: "click",
        },
      },
    ],
  };

  const report = analyzeUploadedFiles(
    [
      {
        path: "demo.js",
        content: '$jq("#txtLblCondicionada").click();',
      },
    ],
    knowledge,
  );

  assert.equal(report.findings.length, 1);
  assert.equal(
    report.findings[0].correctedInstruction,
    '$jq("#txtLblCondicionada").trigger("click");',
  );
  assert.equal(
    report.findings[0].recommendation,
    '$jq("#txtLblCondicionada").trigger("click");',
  );
});
