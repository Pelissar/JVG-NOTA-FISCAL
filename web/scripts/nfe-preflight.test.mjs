import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewNfePreparation } from '../lib/fiscal/nfe-preflight.ts';

const address = {street:'Rua A',number:'10',district:'Centro',city:'Andradina',state:'SP',postalCode:'16900000',cityCode:'3502101'};
const issuer = {cnpj:'12345678000195',stateRegistration:'123456789',state:'SP',taxRegimeConfirmed:true};
const recipient = {name:'Cliente',documentType:'cpf',documentNumber:'52998224725',address};
const items = [{description:'Produto real',ncm:'85176299',unit:'UN',origin:'0'}];

test('pré-conferência completa não habilita autorização ou emissão',()=>{
  const result=reviewNfePreparation(issuer,recipient,items);
  assert.deepEqual(result.issues,[]);
  assert.equal(result.dataComplete,true);
  assert.equal(result.fiscalValidated,false);
  assert.equal(result.transmissionEnabled,false);
});

test('CPF incorreto ou ausente é rejeitado sem bloquear armazenamento de rascunho',()=>{
  const result=reviewNfePreparation(issuer,{...recipient,documentNumber:'11111111111'},items);
  assert.match(result.issues.join(' '),/CPF inválido/);
  assert.equal(result.dataComplete,false);
});

test('regime não confirmado pela contabilidade gera pendência de emitente',()=>{
  const result=reviewNfePreparation({...issuer,taxRegimeConfirmed:false},recipient,items);
  assert.match(result.issues.join(' '),/regime tributário não confirmado/i);
  assert.equal(result.dataComplete,false);
  assert.equal(result.transmissionEnabled,false);
});

test('endereço incompleto e produto sem NCM, unidade ou origem geram pendências',()=>{
  const result=reviewNfePreparation(issuer,{...recipient,address:{...address,postalCode:'',cityCode:''}},[{description:'Produto',ncm:'',unit:'',origin:'9'}]);
  const all=result.issues.join(' | ');
  assert.match(all,/CEP/);
  assert.match(all,/IBGE/);
  assert.match(all,/NCM/);
  assert.match(all,/unidade/);
  assert.match(all,/origem/);
});

test('destinatário estrangeiro necessita de revisão específica',()=>{
  const result=reviewNfePreparation(issuer,{name:'Cliente exterior',documentType:'foreign',documentNumber:'XYZ',address:{}},items);
  assert.match(result.issues.join(' '),/tipo de documento/);
  assert.equal(result.transmissionEnabled,false);
});
