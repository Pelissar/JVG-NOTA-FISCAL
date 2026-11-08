import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreviewRate, calculateTaxPreview } from '../lib/fiscal/tax-preview.ts';
test('taxa decimal informada é normalizada e validada', () => {
  assert.equal(parsePreviewRate('1.2500'), '1.2500');
  assert.equal(parsePreviewRate('0'), '0');
  assert.equal(parsePreviewRate(''), null);
  assert.throws(() => parsePreviewRate('101'), /100%/);
  assert.throws(() => parsePreviewRate('1,2'), /ponto decimal/);
  assert.throws(() => parsePreviewRate('0.12345'), /4 casas/);
});
test('estimativa usa centavos e arredondamento exato', () => {
  const result = calculateTaxPreview(10000, { pis: '1.65', cofins: '7.6', ibs: '0.1', cbs: '0' });
  assert.deepEqual(result.lines.map(line => line.estimateCents), [165, 760, 10, 0]);
  assert.equal(result.sumOfEstimatesCents, 935);
  assert.equal(result.validForEmission, false);
  assert.equal(result.provisional, true);
});
test('estimativa pode ficar vazia e nunca autoriza transmissão', () => {
  const result = calculateTaxPreview(3085, {});
  assert.equal(result.lines.length, 0);
  assert.equal(result.sumOfEstimatesCents, 0);
  assert.equal(result.validForEmission, false);
});
test('evita bases inválidas e taxa acima de 100 por cento', () => {
  assert.throws(() => calculateTaxPreview(-1, { pis: '1' }), /Base/);
  assert.throws(() => calculateTaxPreview(100, { pis: '100.0001' }), /100%/);
});
