import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewNfeDocument, reviewFocusNfePayload } from '../lib/fiscal/nfe-document-review.ts';
import { parseNfeDraftInput } from '../lib/fiscal/nfe-draft.ts';

const valid = () => ({
  schemaVersion: 3,
  issuer: {cnpj:'12345678000195', stateRegistration:'123', taxRegime:'simples_nacional',taxRegimeConfirmed:true},
  recipient: {name:'Cliente', documentNumber:'52998224725', documentType:'cpf'},
  preflight: {dataComplete:true,issues:[]},
  items: [{ncm:'85176299',cfop:'5102',csosn:'102',subtotalCents:3085,
    taxProfile:{id:'profile-1',reviewStatus:'reviewed'}}],
  totalCents:3085,
  taxPreview:{provisional:true,validForEmission:false,sumOfEstimatesCents:200},
  pending:[],
});

const check = (review, key) => review.checks.find(row => row.key === key);

test('revisa estrutura interna e totais comerciais sem habilitar emissão', () => {
  const result = reviewNfeDocument(valid());
  assert.equal(check(result,'items').ok,true);
  assert.equal(check(result,'version').ok,true);
  assert.equal(result.fiscalApproved,false);
  assert.equal(result.transmissionEnabled,false);
  assert.equal(result.canGenerateFiscalXml,false);
  assert.equal(check(result,'transmission').ok,false);
  assert.equal(check(result,'taxPreview').ok,false);
});
test('divergência entre soma e total comercial é bloqueio', () => {
  const payload=valid();payload.totalCents=3084;
  assert.equal(check(reviewNfeDocument(payload),'items').ok,false);
});
test('regime sem confirmação contábil não passa na revisão do emitente', () => {
  const payload=valid();payload.issuer.taxRegimeConfirmed=false;
  assert.equal(check(reviewNfeDocument(payload),'issuer').ok,false);
});
test('pendências e perfis não revisados são exibidos', () => {
  const payload=valid();payload.pending=['Revisão fiscal'];payload.items[0].taxProfile.reviewStatus='draft';
  const result=reviewNfeDocument(payload);
  assert.equal(check(result,'pending').ok,false);
  assert.equal(check(result,'profiles').ok,false);
});
test('rascunho antigo ou sem dados não causa erro e não autoriza transmissão', () => {
  const result=reviewNfeDocument({});
  assert.equal(check(result,'version').ok,false);
  assert.equal(check(result,'items').ok,false);
  assert.equal(result.transmissionEnabled,false);
});

const focusPayload = () => ({
  nature:'Venda de mercadoria', purpose:1, issuer:{cnpj:'12345678000195',legalName:'Empresa Exemplo',stateRegistration:'123456789',
    taxRegime:'simples_nacional',taxRegimeConfirmed:true,state:'SP',address:{street:'Rua A',number:'1',district:'Centro',
      cityCode:'3550308',city:'São Paulo',state:'SP',postalCode:'01001000'}},
  recipient:{name:'Cliente Exemplo',documentType:'cpf',documentNumber:'52998224725',state:'SP',
    address:{street:'Rua B',number:'2',district:'Centro',cityCode:'3550308',city:'São Paulo',state:'SP',postalCode:'01001000'}},
  consumerFinal:true,buyerPresence:1,recipientIeIndicator:9,transport:{mode:9},payments:[{method:'not-configured'}],
  items:[{sku:'SKU-1',description:'Produto de teste',ncm:'85176299',cfop:'5102',unit:'UN',quantity:1,
    unitPriceCents:1000,subtotalCents:1000,origin:'0',csosn:'102',
    taxRules:{pisCst:'06',cofinsCst:'06',cstIbsCbs:'000',classTrib:'000001',focusFields:{
      ibs_cbs_base_calculo:10,ibs_uf_aliquota:0,ibs_uf_valor:0,ibs_mun_aliquota:0,ibs_mun_valor:0,
      cbs_aliquota:0,cbs_valor:0,ibs_valor_total:999
    }}}],
});

test('prévia mapeia códigos e somente valores Focus permitidos, sem inventar totalização', () => {
  const result = reviewFocusNfePayload(focusPayload());
  const item = result.requestPreview.items[0];
  assert.equal(item.icms_origem,0);
  assert.equal(item.icms_situacao_tributaria,'102');
  assert.equal(item.pis_situacao_tributaria,'06');
  assert.equal(item.cofins_situacao_tributaria,'06');
  assert.equal(item.ibs_cbs_situacao_tributaria,'000');
  assert.equal(item.ibs_cbs_classificacao_tributaria,'000001');
  assert.equal(item.ibs_uf_valor,0);
  assert.equal('ibs_valor_total' in item,false);
  assert.equal('valor_total' in result.requestPreview,false);
  assert.equal('formas_pagamento' in result.requestPreview,false);
  assert.equal(result.checks.find(row=>row.key==='formas_pagamento').ok,false);
  assert.equal(result.canSend,false);
  assert.equal(result.transmissionEnabled,false);
});

test('prévia aponta os campos ICMS exigidos por CSOSN sem completar valores', () => {
  const payload=focusPayload();
  payload.items[0].csosn='101';
  const result=reviewFocusNfePayload(payload);
  const check=result.checks.find(row=>row.key==='icms_campos_condicionais');
  assert.equal(check.ok,false);
  assert.match(check.detail,/icms_aliquota_credito_simples/);
  assert.match(check.detail,/icms_valor_credito_simples/);
  assert.equal(result.canSend,false);
});

test('data de emissao e obrigatoria no payload e nao e declarada como automatica pela Focus', () => {
  const payload=focusPayload();
  const result=reviewFocusNfePayload(payload);
  assert.equal(result.checks.find(row=>row.key==='data_emissao').ok,false);
  assert.equal('data_emissao' in result.requestPreview,false);
  assert.equal(result.autoAssignedFields.some(field=>field.includes('data_emissao')),false);
  payload.issueAt='2026-11-10T18:00:00-03:00';
  const withIssueAt=reviewFocusNfePayload(payload);
  assert.equal(withIssueAt.checks.find(row=>row.key==='data_emissao').ok,true);
  assert.equal(withIssueAt.requestPreview.data_emissao,payload.issueAt);
});

test('modalidades de frete oficiais 3 e 4 sao aceitas e CSOSN 900 nao exige grupo opcional', () => {
  for (const mode of [3,4]) {
    const payload=focusPayload();
    payload.transport.mode=mode;
    assert.equal(reviewFocusNfePayload(payload).checks.find(row=>row.key==='modalidade_frete').ok,true);
  }
  const payload=focusPayload();
  payload.items[0].csosn='900';
  const result=reviewFocusNfePayload(payload);
  assert.equal(result.checks.find(row=>row.key==='icms_campos_condicionais').ok,true);
});

test('cabecalho incompleto permanece pendente sem converter campos vazios em zero', () => {
  const payload=focusPayload();
  payload.purpose=null;
  payload.issueAt=null;
  payload.consumerFinal=null;
  payload.buyerPresence='';
  payload.transport.mode=null;
  const result=reviewFocusNfePayload(payload);
  for (const key of ['finalidade_emissao','data_emissao','consumidor_final','presenca_comprador','modalidade_frete']) {
    assert.equal(result.checks.find(row=>row.key===key).ok,false);
    assert.equal(key in result.requestPreview,false);
  }
});

test('prepara apenas finalidade normal e mapeia os campos explicitamente informados', () => {
  const payload=focusPayload();
  payload.issueAt='2026-11-10T18:00:00-03:00';
  payload.consumerFinal=false;
  payload.buyerPresence=2;
  payload.transport.mode=4;
  const result=reviewFocusNfePayload(payload);
  assert.equal(result.requestPreview.finalidade_emissao,1);
  assert.equal(result.requestPreview.data_emissao,payload.issueAt);
  assert.equal(result.requestPreview.consumidor_final,0);
  assert.equal(result.requestPreview.presenca_comprador,2);
  assert.equal(result.requestPreview.modalidade_frete,4);
  payload.purpose=2;
  const complementary=reviewFocusNfePayload(payload);
  assert.equal(complementary.checks.find(row=>row.key==='finalidade_emissao').ok,false);
  assert.equal('finalidade_emissao' in complementary.requestPreview,false);
});

test('parser salva campos opcionais sem presumir valores e rejeita codigos ou data invalidos', () => {
  const base={recipientId:'123e4567-e89b-42d3-a456-426614174000',nature:'Venda de mercadoria',items:[{
    productId:'123e4567-e89b-42d3-a456-426614174001',quantity:1,unitPrice:10,cfop:'',csosn:''
  }]};
  const incomplete=parseNfeDraftInput(base);
  assert.equal(incomplete.purpose,null);
  assert.equal(incomplete.issueAt,null);
  assert.equal(incomplete.consumerFinal,null);
  assert.equal(incomplete.buyerPresence,null);
  assert.equal(incomplete.transportMode,null);
  const complete=parseNfeDraftInput({...base,purpose:'1',issueAt:'2026-11-10T18:00:00-03:00',consumerFinal:'0',buyerPresence:'2',transportMode:'4'});
  assert.equal(complete.purpose,1);
  assert.equal(complete.consumerFinal,false);
  assert.equal(complete.buyerPresence,2);
  assert.equal(complete.transportMode,4);
  assert.throws(()=>parseNfeDraftInput({...base,purpose:'5'}),/Finalidade/);
  assert.throws(()=>parseNfeDraftInput({...base,buyerPresence:'6'}),/Presen/);
  assert.throws(()=>parseNfeDraftInput({...base,issueAt:'2026-11-10T18:00'}),/fuso/);
  assert.throws(()=>parseNfeDraftInput({...base,issueAt:'2026-02-30T18:00:00-03:00'}),/fuso/);
  assert.throws(()=>parseNfeDraftInput({...base,nature:'x'.repeat(61)}),/3 a 60/);
});

test('pagamento usa o contrato Focus e nao repassa objetos internos sem validacao', () => {
  const payload=focusPayload();
  payload.payments=[{indicator:0,method:'01',amountCents:1000}];
  const result=reviewFocusNfePayload(payload);
  assert.deepEqual(result.requestPreview.formas_pagamento,[{
    indicador_pagamento:0,forma_pagamento:'01',valor_pagamento:10
  }]);
  payload.payments=[{indicator:0,method:'03',amountCents:1000}];
  const cardResult=reviewFocusNfePayload(payload);
  assert.equal(cardResult.checks.find(row=>row.key==='formas_pagamento').ok,false);
  assert.equal('formas_pagamento' in cardResult.requestPreview,false);
});
