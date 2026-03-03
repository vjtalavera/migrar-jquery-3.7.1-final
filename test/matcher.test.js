const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getLineMatchesForRule,
} = require("../src/services/jquery-knowledge-service");

test("detecta .size() en cadena jQuery", () => {
  const rule = {
    slug: "size",
    detection: {
      kind: "instanceMethod",
      token: "size",
    },
  };
  const line = "$('#grid .item').size();";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 1);
});

test("detecta .click() deprecado sobre variable jQuery con prefijo $", () => {
  const rule = {
    slug: "click-shorthand",
    detection: {
      kind: "instanceMethod",
      token: "click",
    },
  };
  const line = "$headers.click(function (e) {";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 1);
});

test("detecta .click() deprecado sobre this.$alias", () => {
  const rule = {
    slug: "click-shorthand",
    detection: {
      kind: "instanceMethod",
      token: "click",
    },
  };
  const line = "this.$headers.click(function (e) {";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 1);
});

test("no detecta .click() en variable sin contexto jQuery", () => {
  const rule = {
    slug: "click-shorthand",
    detection: {
      kind: "instanceMethod",
      token: "click",
    },
  };
  const line = "headers.click(function (e) {";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 0);
});

test("detecta $.parseJSON()", () => {
  const rule = {
    slug: "jQuery.parseJSON",
    detection: {
      kind: "globalMethod",
      token: "parseJSON",
      pathParts: ["parseJSON"],
    },
  };
  const line = "const data = $.parseJSON(raw);";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 1);
});

test("no marca .load() ajax con URL literal", () => {
  const rule = {
    slug: "load-shorthand",
    detection: {
      kind: "instanceMethod",
      token: "load",
    },
  };
  const line = "$('#main').load('/ajax/panel.html');";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 0);
});

test("detecta selector :even con llamada jQuery", () => {
  const rule = {
    slug: "even-selector",
    detection: {
      kind: "selector",
      token: "even",
    },
  };
  const line = "const rows = $('table tr:even');";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 1);
});

test("detecta sintaxis .ready(...) legacy deprecada", () => {
  const rule = {
    slug: "ready-deprecated-syntax",
    detection: {
      kind: "readyDeprecatedSyntax",
    },
  };

  const lines = [
    "$jq('input[name=\"pagoGastos\"]').ready();",
    "$( document ).ready(function() {",
    "$(document).ready(function() {",
    "$jq(document).ready(function() {",
  ];

  for (const line of lines) {
    const matches = getLineMatchesForRule(line, rule);
    assert.equal(
      matches.length,
      1,
      `Se esperaba detección para la línea: ${line}`,
    );
  }
});

test("detecta attr('checked', valor) en cadena jQuery", () => {
  const rule = {
    slug: "attr-checked-legacy",
    detection: {
      kind: "legacyBooleanAttrSetter",
      token: "checked",
    },
  };

  const detectedLines = [
    "$jq('input[name=\"pagoGastos\"]').attr('checked', false);",
    "$('input[name=\"pagoGastos\"]').attr('checked', false);",
  ];
  for (const line of detectedLines) {
    const matches = getLineMatchesForRule(line, rule);
    assert.equal(matches.length, 1, `Se esperaba detección para: ${line}`);
  }

  const nonJqueryLine = "control.attr('checked', false);";
  const noMatches = getLineMatchesForRule(nonJqueryLine, rule);
  assert.equal(noMatches.length, 0);
});

test("detecta removeAttr('disabled') en cadena jQuery", () => {
  const rule = {
    slug: "removeattr-disabled-legacy",
    detection: {
      kind: "legacyBooleanAttrRemover",
      token: "disabled",
    },
  };

  const detectedLines = [
    "$jq('#divFecha').removeAttr('disabled');",
    "$('#divFecha').removeAttr(\"disabled\");",
  ];
  for (const line of detectedLines) {
    const matches = getLineMatchesForRule(line, rule);
    assert.equal(matches.length, 1, `Se esperaba detección para: ${line}`);
  }

  const nonJqueryLine = "control.removeAttr('disabled');";
  const noMatches = getLineMatchesForRule(nonJqueryLine, rule);
  assert.equal(noMatches.length, 0);
});

test("detecta .context como propiedad de instancia jQuery", () => {
  const rule = {
    slug: "context",
    detection: {
      kind: "instanceProperty",
      token: "context",
    },
  };

  const line = "$jq('#cargarSpinnerLH').context;";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 1);
});

test("no detecta APIs dentro de literales de texto", () => {
  const rule = {
    slug: "jQuery.isFunction",
    detection: {
      kind: "globalMethod",
      token: "isFunction",
      pathParts: ["isFunction"],
    },
  };

  const line = 'title: "jQuery.isFunction()",';
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 0);
});

test("no detecta selector deprecated fuera de llamada jQuery", () => {
  const rule = {
    slug: "odd-selector",
    detection: {
      kind: "selector",
      token: "odd",
    },
  };

  const line = 'const cssRule = ":odd { color: red; }";';
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 0);
});

test("detecta :first dentro de selector en argumento de metodo jQuery", () => {
  const rule = {
    slug: "first-selector",
    detection: {
      kind: "selector",
      token: "first",
    },
  };

  const line = 'var fc = $jq("#nombreForm").parents(\'form:first\').attr("name");';
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 1);
});

test("detecta selector :first sobre variable jQuery con prefijo $", () => {
  const rule = {
    slug: "first-selector",
    detection: {
      kind: "selector",
      token: "first",
    },
  };
  const line = "$headers.find('li:first').addClass('active');";
  const matches = getLineMatchesForRule(line, rule);
  assert.equal(matches.length, 1);
});
