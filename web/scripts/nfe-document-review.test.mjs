import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewNfeDocument } from '../lib/fiscal/nfe-document-review.ts';

const valid = () => ({
  schemaVersion: 3,
  issuer: {cnpj:'12345678000195', stateRegistration:'123', taxRegime:'simples_nacional'},
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
});
test('divergência entre soma e total comercial é bloqueio', () => {
  const payload=valid();payload.totalCents=3084;
  assert.equal(check(reviewNfeDocument(payload),'items').ok,false);
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
