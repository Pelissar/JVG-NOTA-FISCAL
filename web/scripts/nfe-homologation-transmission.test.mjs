import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../app/api/fiscal/nfe-drafts/transmit/route.ts', import.meta.url), 'utf8');
const focus = readFileSync(new URL('../lib/focus/client.ts', import.meta.url), 'utf8');
const detailApi = readFileSync(new URL('../app/api/fiscal/nfe-drafts/route.ts', import.meta.url), 'utf8');
const draftsApi = detailApi;
const ui = readFileSync(new URL('../public/erp/nfe-drafts.js', import.meta.url), 'utf8');

test('emissão de teste exige same-origin, administrador, empresa piloto e credencial de homologação', () => {
  assert.match(route, /isSameOrigin\(request\)/);
  assert.match(route, /getPlatformRole\(user\) !== "platform_admin"/);
  assert.match(route, /JVG_FOCUS_PILOT_COMPANY_ID/);
  assert.match(route, /JVG_FOCUS_HOMOLOGACAO_TOKEN/);
  assert.match(route, /tax_regime_confirmed !== true/);
  assert.match(route, /fiscal_missing\.length/);
});

test('envio exige confirmação de homologação, gate fiscal, snapshot atual e reserva atômica do rascunho', () => {
  assert.match(route, /confirmHomologation !== true/);
  assert.doesNotMatch(route, /confirmFiscalReview/);
  assert.doesNotMatch(route, /taxProfile\.reviewStatus|accountantReviewDeclared/);
  assert.match(route, /reviewNfeHomologationGate\(payload\)/);
  assert.match(route, /currentSnapshotIssues\(context, payload\)/);
  assert.match(route, /patchDocument\(context\.account, id, "draft", \{/);
  assert.match(route, /status: "processing", focus_reference: reference/);
  assert.match(route, /emitFocusNfeHomologacao\(context\.token, reference/);
  assert.match(route, /savedProductSnapshot/);
});

test('rascunho mapeia edição fiscal por item, sem perfil obrigatório, e mantém snapshot do cadastro', () => {
  assert.match(draftsApi, /input\.ncm \?\?/);
  assert.match(draftsApi, /input\.cest \?\?/);
  assert.match(draftsApi, /input\.origin \?\?/);
  assert.match(draftsApi, /productSnapshot:/);
  assert.match(ui, /ncm: row\.querySelector\('\.item-ncm'\)/);
  assert.match(ui, /cest: row\.querySelector\('\.item-cest'\)/);
  assert.match(ui, /origin: row\.querySelector\('\.item-origin'\)/);
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
  assert.match(route, /caminho_xml_nota_fiscal/);
  assert.match(route, /caminho_danfe/);
  assert.match(route, /eventos/);
  assert.match(route, /createFocusAttemptEvent/);
  assert.match(route, /finishFocusAttemptEvent/);
  assert.match(route, /jvg_fiscal_events/);
  assert.match(detailApi, /caminho_xml_nota_fiscal/);
  assert.match(detailApi, /caminho_danfe/);
  assert.match(ui, /Caminho do XML na Focus/);
  assert.match(ui, /Caminho do DANFE na Focus/);
});

test('interface só oferece envio quando o servidor libera e exige confirmação explícita', () => {
  assert.match(ui, /draft\.canSubmitHomologation === true/);
  assert.match(ui, /check\.type = 'checkbox'/);
  assert.match(ui, /confirmHomologation: action === 'emit'/);
  assert.match(ui, /Consultar status na Focus/);
  assert.doesNotMatch(ui, /A prévia é incompleta e não pode ser enviada/);
});
