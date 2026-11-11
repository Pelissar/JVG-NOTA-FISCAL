import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brasilApiCnpjFields, focusCnpjFields, mergeCnpjFields } from '../lib/cnpj-lookup.ts';

test('mapeia o contrato oficial da consulta CNPJ da Focus sem confundir SIAFI com IBGE', () => {
  const focus = focusCnpjFields({
    razao_social: 'EMPRESA DE TESTE LTDA',
    cnpj: '12345678000195',
    situacao_cadastral: 'ativa',
    cnae_principal: '6201501',
    optante_simples_nacional: true,
    optante_mei: false,
    endereco: {
      codigo_siafi: '7107',
      codigo_ibge: '3550308',
      nome_municipio: 'SAO PAULO',
      tipo_logradouro: 'RUA',
      logradouro: 'DAS FLORES',
      numero: '10',
      bairro: 'CENTRO',
      cep: '01001000',
      uf: 'SP',
    },
  }, '12345678000195');

  assert.equal(focus.legalName, 'EMPRESA DE TESTE LTDA');
  assert.equal(focus.street, 'RUA DAS FLORES');
  assert.equal(focus.cityCode, '3550308');
  assert.equal(focus.postalCode, '01001000');
  assert.equal(focus.simplesNational, true);
  assert.equal(focus.mei, false);
  assert.equal(focus.email, '');
});

test('complementa apenas campos ausentes e preserva a prioridade da Focus', () => {
  const focus = focusCnpjFields({ razao_social: 'RAZAO FOCUS', cnae_principal: '6201501' }, '12345678000195');
  const brasil = brasilApiCnpjFields({
    razao_social: 'RAZAO COMPLEMENTAR',
    nome_fantasia: 'LOJA EXEMPLO',
    email: 'contato@example.com',
    ddd_telefone_1: '1133334444',
    logradouro: 'AVENIDA CENTRAL',
    numero: '20',
    municipio: 'CAMPINAS',
    uf: 'SP',
    codigo_municipio_ibge: 3509502,
    cep: '13010000',
    opcao_pelo_simples: false,
  }, '12345678000195');
  const merged = mergeCnpjFields('12345678000195', focus, brasil);

  assert.equal(merged.legalName, 'RAZAO FOCUS');
  assert.equal(merged.tradeName, 'LOJA EXEMPLO');
  assert.equal(merged.email, 'contato@example.com');
  assert.equal(merged.phone, '1133334444');
  assert.equal(merged.cnae, '6201501');
  assert.equal(merged.cityCode, '3509502');
  assert.equal(merged.simplesNational, false);
});

test('mantem consulta Focus e Token Master no servidor e mapeia nome fantasia para o nome do cliente', () => {
  const route = readFileSync(new URL('../app/api/lookup/route.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/erp/app.js', import.meta.url), 'utf8');

  assert.match(route, /JVG_FOCUS_MASTER_TOKEN/);
  assert.match(route, /https:\/\/api\.focusnfe\.com\.br\/v2\/cnpjs\//);
  assert.match(route, /Authorization: "Basic " \+ authorization/);
  assert.doesNotMatch(app, /JVG_FOCUS_MASTER_TOKEN/);
  assert.match(app, /setLookupField\(form,'name',data\.tradeName\|\|data\.legalName\)/);
  assert.match(app, /setLookupField\(form,'legalName',data\.legalName\)/);
  assert.match(app, /!String\(target\.value\|\|'\'\)\.trim\(\)/);
});

test('nao transforma valores vazios em classificacoes fiscais ou inscricoes', () => {
  const focus = focusCnpjFields({ razao_social: 'EMPRESA DE TESTE', endereco: { codigo_municipio: '7107' } }, '12345678000195');
  assert.equal(focus.cityCode, '');
  assert.equal(focus.simplesNational, null);
  assert.equal(focus.mei, null);
  assert.equal('stateRegistration' in focus, false);
  assert.equal('municipalRegistration' in focus, false);
});
