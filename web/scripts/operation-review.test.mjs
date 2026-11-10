import test from "node:test";
import assert from "node:assert/strict";
import { reviewNfeOperation, reviewProfileConsistency } from "../lib/fiscal/operation-review.ts";

test("CFOP de saída interna e interestadual coerentes", () => {
  assert.deepEqual(reviewNfeOperation("SP","SP","5102",1), { operation:"interna", pending:[] });
  assert.deepEqual(reviewNfeOperation("SP","MG","6102",1), { operation:"interestadual", pending:[] });
});
test("não libera CFOP com UF incompatível", () => {
  assert.match(reviewNfeOperation("SP","MG","5102",1).pending.join(" "), /interestadual/);
  assert.match(reviewNfeOperation("SP","SP","6102",1).pending.join(" "), /interna/);
  assert.match(reviewNfeOperation("SP","SP","1102",1).pending.join(" "), /entrada/);
});
test("destinatário ou emitente sem UF gera pendência", () => {
  assert.match(reviewNfeOperation("","SP","5102",1).pending.join(" "), /emitente/);
  assert.match(reviewNfeOperation("SP","","5102",1).pending.join(" "), /destinatário/);
});
test("CFOP do exterior não é automaticamente aceito", () => {
  assert.match(reviewNfeOperation("SP","SP","7101",2).pending.join(" "), /exterior/);
});
test("perfil divergente gera pendências e não calcula tributos", () => {
  const rules = {regime:"simples_nacional",cfop:"5102",csosn:"102",pisCst:"01",cofinsCst:"01",cstIbsCbs:"000",classTrib:"000001"};
  assert.deepEqual(reviewProfileConsistency(rules,"5102","102",1,"interna"),[]);
  const issues=reviewProfileConsistency(rules,"6102","500",1,"interestadual").join(" ");
  assert.match(issues,/CFOP/);
  assert.match(issues,/CSOSN/);
  assert.match(reviewProfileConsistency({}, "5102", "102", 1, "interna").join(" "),/IBS\/CBS/);
  assert.match(reviewProfileConsistency(undefined, "5102", "102", 1, "interestadual").join(" "),/interestadual/);
});
