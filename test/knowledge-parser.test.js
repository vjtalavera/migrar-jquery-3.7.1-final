const test = require("node:test");
const assert = require("node:assert/strict");
const {
  __testables,
} = require("../src/services/jquery-knowledge-service");

test("extrae reemplazo desde frase 'use X instead of Y'", () => {
  const blocks = [
    "To avoid potential issues, use .on() instead of .bind().",
  ];

  const replacements = __testables.extractReplacementCandidates(blocks);
  assert.ok(replacements.length >= 1);
  assert.ok(replacements.includes(
    "Reemplaza `.bind()` por `.on()`",
  ));
});

test("extrae reemplazo desde frase en espanol 'utilice X en lugar de Y'", () => {
  const blocks = [
    "Para evitar posibles problemas, utilice .prop('checked', valor) en lugar de .attr('checked', valor).",
  ];

  const replacements = __testables.extractReplacementCandidates(blocks);
  assert.equal(replacements.length, 1);
  assert.equal(
    replacements[0],
    "Reemplaza `.attr('checked', valor)` por `.prop('checked', valor)`",
  );
});

test("extrae reemplazo desde frase 'use X instead:' sin 'instead of'", () => {
  const blocks = [
    "To avoid potential problems, use .prop() instead:",
  ];

  const replacements = __testables.extractReplacementCandidates(blocks);
  assert.ok(replacements.length >= 1);
  assert.ok(replacements.includes(
    "Usa `.prop()`",
  ));
});

test("extrae reemplazo desde frase 'should be used instead'", () => {
  const blocks = [
    "The deferred.then() method, which replaces it, should be used instead.",
  ];

  const replacements = __testables.extractReplacementCandidates(blocks);
  assert.equal(replacements.length, 1);
  assert.equal(
    replacements[0],
    "Usa `deferred.then()`",
  );
});
