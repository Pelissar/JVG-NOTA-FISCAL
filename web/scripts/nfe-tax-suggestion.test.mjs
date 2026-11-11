import test from "node:test";
import assert from "node:assert/strict";
import "../public/erp/nfe-tax-suggestion.js";

const resolve = globalThis.JvgNfeTaxSuggestion.resolve;
const profile = {
  id: "profile-1",
  name: "Regra revisada pela empresa",
  review_status: "reviewed",
  rules: {
    operations: {
      interna: { cfop: "CFOP_INTERNO_TESTE", csosn: "CSOSN_INTERNO_TESTE" },
      interestadual: { cfop: "CFOP_INTERESTADUAL_TESTE", csosn: "CSOSN_INTERESTADUAL_TESTE" },
    },
  },
};
const product = { taxProfileId: "profile-1" };

test("seleciona a regra interna quando emitente e cliente estão na mesma UF", () => {
  const result = resolve(product, { state: "sp" }, "SP", [profile]);
  assert.equal(result.operation, "interna");
  assert.deepEqual(result.rule, profile.rules.operations.interna);
  assert.equal(result.profile, profile);
});

test("seleciona a regra interestadual quando as UFs são diferentes", () => {
  const result = resolve(product, { state: "RJ" }, "SP", [profile]);
  assert.equal(result.operation, "interestadual");
  assert.deepEqual(result.rule, profile.rules.operations.interestadual);
});

test("não reutiliza a regra de outra operação quando a escolhida não existe", () => {
  const internalOnly = { ...profile, rules: { operations: { interna: profile.rules.operations.interna } } };
  const result = resolve(product, { state: "RJ" }, "SP", [internalOnly]);
  assert.equal(result.operation, "interestadual");
  assert.equal(result.rule, null);
});

test("não escolhe operação sem UF válida do emitente e do destinatário", () => {
  const result = resolve(product, { state: "" }, "SP", [profile]);
  assert.equal(result.operation, null);
  assert.equal(result.rule, null);
  assert.equal(result.profile, null);
});

test("mantém a regra de rascunho identificada como não revisada", () => {
  const draft = { ...profile, review_status: "draft" };
  const result = resolve(product, { state: "SP" }, "SP", [draft]);
  assert.equal(result.rule.csosn, "CSOSN_INTERNO_TESTE");
  assert.equal(result.profile.review_status, "draft");
});
