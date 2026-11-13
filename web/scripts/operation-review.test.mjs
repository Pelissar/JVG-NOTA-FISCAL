import test from "node:test";
import assert from "node:assert/strict";
import { reviewNfeOperation } from "../lib/fiscal/operation-review.ts";

test("CFOP por item pode divergir da UF cadastral quando o destino de entrega difere", () => {
  assert.deepEqual(reviewNfeOperation("SP", "MG", "5102", 1), { operation: "interna", pending: [] });
  assert.deepEqual(reviewNfeOperation("SP", "SP", "6102", 2), { operation: "interestadual", pending: [] });
});

test("CFOP de entrada nao e aceito automaticamente em NF-e de saida", () => {
  assert.match(reviewNfeOperation("SP", "SP", "1102", 1).pending.join(" "), /entrada/);
});

test("UFs ausentes sao reportadas sem inventar o CFOP", () => {
  assert.match(reviewNfeOperation("", "SP", "5102", 1).pending.join(" "), /emitente/);
  assert.match(reviewNfeOperation("SP", "", "5102", 1).pending.join(" "), /destinat/);
});

test("CFOP de exportacao exige fluxo fiscal especifico", () => {
  assert.match(reviewNfeOperation("SP", "SP", "7101", 2).pending.join(" "), /exterior/);
});
