import test from "node:test";
import assert from "node:assert/strict";
import "../public/erp/nfe-tax-suggestion.js";

const resolve = globalThis.JvgNfeTaxSuggestion.resolve;
const profile = {
  id: "profile-1",
  name: "Regra opcional da empresa",
  rules: {
    operations: {
      interna: { cfop: "5102", csosn: "102" },
      interestadual: { cfop: "6102", csosn: "102" },
    },
  },
};
const product = { taxProfileId: "profile-1" };

test("usa o CFOP escolhido no item para localizar apenas uma referencia interna", () => {
  const result = resolve(product, "5102", [profile]);
  assert.equal(result.operation, "interna");
  assert.deepEqual(result.rule, profile.rules.operations.interna);
  assert.equal(result.profile, profile);
});

test("usa o CFOP escolhido no item para localizar apenas uma referencia interestadual", () => {
  const result = resolve(product, "6102", [profile]);
  assert.equal(result.operation, "interestadual");
  assert.deepEqual(result.rule, profile.rules.operations.interestadual);
});

test("nao escolhe regra sem CFOP do item nem decide pela UF do destinatario", () => {
  assert.deepEqual(resolve(product, "", [profile]), { rule: null, operation: null, profile });
});

test("nao reutiliza regra de outro grupo de CFOP", () => {
  const internalOnly = { ...profile, rules: { operations: { interna: profile.rules.operations.interna } } };
  assert.deepEqual(resolve(product, "6102", [internalOnly]), { rule: null, operation: "interestadual", profile: internalOnly });
});
