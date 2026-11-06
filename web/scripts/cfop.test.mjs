import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const catalogue = JSON.parse(readFileSync(new URL('../data/cfop-official-2026.json', import.meta.url), 'utf8'));
const records = catalogue.records;
const byCode = new Map(records.map((record) => [record.code, record]));

test('catálogo fiscal é oficial, versionado e não contém códigos duplicados', () => {
  assert.equal(records.length, 619);
  assert.equal(byCode.size, records.length);
  assert.equal(catalogue.publishedOn, '2026-09-04');
  assert.match(catalogue.sourceUrl, /nfe\.fazenda\.gov\.br/);
  assert.match(catalogue.sourceSha256, /^[a-f0-9]{64}$/);
});

test('todos os códigos possuem título, nota explicativa, vigência e indicadores', () => {
  for (const record of records) {
    assert.match(record.code, /^[123567][0-9]{3}$/);
    assert.ok(record.title.length > 4, record.code);
    assert.ok(record.description.length > 15, record.code);
    assert.match(record.validFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof record.flags.indNFe, 'number');
  }
});

test('CFOPs comuns existem com título e descrição não adulterados', () => {
  assert.match(byCode.get('1102').title, /^Compra para comercialização/);
  assert.match(byCode.get('5102').title, /^Venda de mercadoria adquirida/);
  assert.match(byCode.get('6102').title, /^Venda de mercadoria adquirida/);
  assert.ok(byCode.get('5102').description.startsWith('Classificam-se neste código'));
});

test('arquivo padrão não contém apelidos de empresas ou tokens privados', () => {
  for (const record of records) assert.equal(record.customLabel, undefined);
  assert.equal('token' in catalogue, false);
});
