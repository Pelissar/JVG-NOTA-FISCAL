import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../app/api/fiscal/nfe-drafts/transmit/route.ts', import.meta.url), 'utf8');
const focus = readFileSync(new URL('../lib/focus/client.ts', import.meta.url), 'utf8');
const detailApi = readFileSync(new URL('../app/api/fiscal/nfe-drafts/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/erp/nfe-drafts.js', import.meta.url), 'utf8');

test('emissão de teste exige same-origin, administrador, empresa piloto e credencial de homologação', () => {
  assert.match(route, /isSameOrigin\(request\)/);
  assert.match(route, /getPlatformRole\(user\) !== "platform_admin"/);
  assert.match(route, /JVG_FOCUS_PILOT_COMPANY_ID/);
  assert.match(route, /JVG_FOCUS_HOMOLOGACAO_TOKEN/);
  assert.match(route, /tax_regime_confirmed !== true/);
  assert.match(route, /fiscal_missing\.length/);
});

test('envio exige confirmação, gate fiscal, snapshot atual e reserva atômica do rascunho', () => {
  assert.match(route, /confirmFiscalReview !== true/);
  assert.match(route, /reviewNfeHomologationGate\(payload\)/);
  assert.match(route, /currentSnapshotIssues\(context, payload\)/);
  assert.match(route, /patchDocument\(context\.account, id, "draft", \{/);
  assert.match(route, /status: "processing", focus_reference: reference/);
  assert.match(route, /emitFocusNfeHomologacao\(context\.token, reference/);
});

test('referência persistida permite reconciliar resposta incerta sem POST duplicado', () => {
  assert.match(route, /queryFocusNfeHomologacao\(context\.token, reference, true\)/);
  assert.match(route, /phase: "outcome_unknown"/);
  assert.match(route, /Não reenvie; consulte o documento pela referência salva/);
  assert.match(route, /patchDocument\(context\.account, id, String\(document\.status\), patch\)/);
});

test('cliente Focus usa somente o host de homologação e status retorna pela API de consulta', () => {
  assert.match(focus, /https:\/\/homologacao\.focusnfe\.com\.br/);
  assert.match(focus, /emitFocusNfeHomologacao/);
  assert.match(focus, /queryFocusNfeHomologacao/);
  assert.doesNotMatch(focus, /https:\/\/api\.focusnfe\.com\.br/);
  assert.match(detailApi, /publicProviderResponse\(selected\[0\]\.provider_response\)/);
  assert.doesNotMatch(route, /caminho_xml_nota_fiscal|caminho_danfe/);
});

test('interface só oferece envio quando o servidor libera e exige confirmação explícita', () => {
  assert.match(ui, /draft\.canSubmitHomologation === true/);
  assert.match(ui, /check\.type = 'checkbox'/);
  assert.match(ui, /confirmFiscalReview: action === 'emit'/);
  assert.match(ui, /Consultar status na Focus/);
  assert.doesNotMatch(ui, /A prévia é incompleta e não pode ser enviada/);
});
