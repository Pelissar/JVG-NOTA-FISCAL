import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('../app/api/fiscal/nfe-drafts/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/erp/nfe-drafts.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../public/erp/nfe-drafts.html', import.meta.url), 'utf8');
test('detalhe exige UUID e respeita empresa e homologação', () => {
  assert.match(api, /requestedId !== null/);
  assert.match(api, /Identificador do rascunho inválido/);
  assert.match(api, /document_type=eq\.nfe&environment=eq\.homologacao/);
  assert.doesNotMatch(api, /api\.focusnfe\.com\.br/);
});
test('transmissão fica na rota própria e só em homologação', () => {
  const transmit = readFileSync(new URL('../app/api/fiscal/nfe-transmit/route.ts', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../lib/focus/nfe-api.ts', import.meta.url), 'utf8');
  assert.match(transmit, /JVG_FOCUS_PILOT_COMPANY_ID/);
  assert.match(transmit, /viewer/);
  assert.match(client, /homologacao\.focusnfe\.com\.br/);
  assert.doesNotMatch(client, /https:\/\/api\.focusnfe\.com\.br/);
});
test('tela rende dados de API usando textContent sem HTML não confiável', () => {
  assert.match(ui, /function inspectDraft\(id\)/);
  assert.match(ui, /node\.textContent = value/);
  assert.doesNotMatch(ui, /innerHTML\s*=\s*.*draft\./);
  assert.match(page, /id="draftDetails"/);
});
