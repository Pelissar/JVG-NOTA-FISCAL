import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('../app/api/fiscal/nfe-drafts/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/erp/nfe-drafts.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../public/erp/nfe.html', import.meta.url), 'utf8');
test('detalhe exige UUID e respeita empresa, tipo e ambiente em qualquer estado fiscal', () => {
  assert.match(api, /requestedId !== null/);
  assert.match(api, /Identificador do documento inválido/);
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

test('checklist explica bloqueios de homologação sem expor credenciais', () => {
  assert.match(api, /async function homologationSetup\(account: SiteAccount\)/);
  assert.match(api, /focusTokenConfigured = Boolean\(/);
  assert.match(api, /pilotCompanyMatches/);
  assert.match(api, /issuerMissing/);
  assert.match(api, /return \{[\s\S]*?focusTokenConfigured,[\s\S]*?accessIssues/);
  const setup = api.slice(api.indexOf('async function homologationSetup'), api.indexOf('export async function GET'));
  assert.doesNotMatch(setup, /return \{[^}]*\btoken\s*:/i);
  assert.match(page, /id="homologationReadiness"/);
  assert.match(ui, /function renderHomologationReadiness\(\)/);
  assert.match(ui, /draft\.homologationSetup\.accessIssues/);
  assert.match(ui, /NCM pendente/);
  assert.match(ui, /Token da API Focus no servidor/);
  assert.match(ui, /certificado digital anexado no painel Focus; use/);
});
