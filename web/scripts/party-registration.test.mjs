import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const api = readFileSync(new URL('../app/api/records/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/erp/app.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/20261109_jvg_party_registration_number.sql', import.meta.url), 'utf8');

test('cadastros suportam cliente, fornecedor e transportadora', () => {
  assert.match(api, /is_customer: isCustomer, is_supplier: isSupplier, is_carrier: isCarrier/);
  assert.match(api, /isCustomer: p\.is_customer, isSupplier: p\.is_supplier, isCarrier: p\.is_carrier/);
  assert.match(ui, /id="partyTypeFilter"/);
  assert.match(ui, /Clientes \(/);
  assert.match(ui, /Fornecedores \(/);
  assert.match(ui, /Transportadoras \(/);
});

test('IE e inscrição municipal são persistidas e exibidas', () => {
  assert.match(api, /state_registration: str\(input\.stateRegistration/);
  assert.match(api, /municipal_registration: str\(input\.municipalRegistration/);
  assert.match(api, /stateRegistration: p\.state_registration/);
  assert.match(api, /municipalRegistration: p\.municipal_registration/);
  assert.match(ui, /Inscrição Estadual \(IE\)/);
  assert.match(ui, /Inscrição Municipal \(IM\)/);
});

test('cadastro sequencial por empresa e unicidade', () => {
  assert.match(migration, /registration_number bigint/i);
  assert.match(migration, /partition by p\.company_id order by p\.created_at, p\.id/i);
  assert.match(migration, /coalesce\(e\.last_number, 0\) \+ row_number\(\)/i);
  assert.match(migration, /jvg_assign_party_registration_number/i);
  assert.match(migration, /unique index if not exists jvg_parties_company_registration_number_uidx/i);
  assert.match(api, /registration_number,display_name/);
  assert.match(ui, /Nº cadastro/);
});

test('não permite gravar pessoa sem classificação comercial', () => {
  assert.match(api, /if \(!isCustomer && !isSupplier && !isCarrier\)/);
  assert.match(ui, /if\(!isCustomer&&!isSupplier&&!isCarrier\)/);
});

test('rascunho NF-e oferece apenas destinatários cadastrados como clientes', () => {
  const draftUi = readFileSync(new URL('../public/erp/nfe-drafts.js', import.meta.url), 'utf8');
  assert.match(draftUi, /c\.active && c\.isCustomer === true/);
});

test('rascunho só fica disponível quando há cliente ativo e apto', () => {
  const draftUi = readFileSync(new URL('../public/erp/nfe-drafts.js', import.meta.url), 'utf8');
  assert.match(draftUi, /state\.clients\.some\(function \(c\) \{ return c\.active && c\.isCustomer === true && c\.type !== 'EXT'; \}\)/);
});

test('CPF brasileiro exige dígitos verificadores válidos', () => {
  assert.match(api, /function validCpf\(value: string\): boolean/);
  assert.match(api, /digit\(9\) === Number\(value\[9\]\)/);
  assert.match(api, /digit\(10\) === Number\(value\[10\]\)/);
  assert.match(api, /type === "PF" && document && !validCpf\(document\)/);
});
