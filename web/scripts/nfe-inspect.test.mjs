import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('../app/api/fiscal/nfe-drafts/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/erp/nfe-drafts.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../public/erp/nfe-drafts.html', import.meta.url), 'utf8');
test('detalhe exige UUID e respeita empresa, tipo e ambiente em qualquer estado fiscal', () => {
  assert.match(api, /requestedId !== null/);
  assert.match(api, /Identificador do rascunho inválido/);
  assert.match(api, /scope\(account\).*id=\$\{filterEq\(requestedId\)\}.*document_type=eq\.nfe.*environment=eq\.homologacao/);
  assert.doesNotMatch(api, /requestedId\)\}.*status=eq\.draft/);
});
test('detalhe mantém a revisão de transmissão e revela elegibilidade restrita de homologação', () => {
  assert.match(api, /readyToTransmit: false, transmissionEnabled: false/);
  assert.match(api, /readyToTransmit: false,/);
  assert.match(api, /canSubmitHomologation: selected\[0\]\.status === "draft" && homologationGate\.ready && canUseHomologation/);
  assert.match(api, /getPlatformRole/);
  assert.match(api, /JVG_FOCUS_PILOT_COMPANY_ID/);
});
test('tela rende dados de API usando textContent sem HTML não confiável', () => {
  assert.match(ui, /function inspectDraft\(id\)/);
  assert.match(ui, /node\.textContent = value/);
  assert.doesNotMatch(ui, /innerHTML\s*=\s*.*draft\./);
  assert.match(page, /id="draftDetails"/);
});
