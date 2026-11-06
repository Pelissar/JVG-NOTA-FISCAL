import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const shell = readFileSync(new URL('../public/erp/app.js', import.meta.url), 'utf8');
const productApi = readFileSync(new URL('../app/api/records/route.ts', import.meta.url), 'utf8');

test('ERP inicia vazio e não possui cadastros fictícios', () => {
  assert.match(shell, /function emptyState\(\)\{return \{products:\[\],clients:\[\],services:\[\],movements:\[\]/);
  assert.doesNotMatch(shell, /PROD-001|Cliente demonstração|localStorage|reset-demo|persist\(\)/);
});

test('cadastros e estoque exigem Supabase disponível', () => {
  assert.match(shell, /if\(cloud\.status!==['"]ready['"]\)\{toast\(['"]Cadastro indisponível/);
  assert.match(shell, /if\(cloud\.status!==['"]ready['"]\)\{toast\(['"]Ajuste indisponível/);
  assert.match(shell, /state=emptyState\(\);render\(\)/);
});

test('servidor valida CFOP sugerido contra catálogo oficial', () => {
  assert.match(productApi, /isOfficialCfopCode\(defaultCfop\)/);
  assert.match(productApi, /default_cfop: defaultCfop \|\| null/);
});
