import assert from 'node:assert/strict';
import test from 'node:test';
import { fiscalMissing } from '../lib/fiscal-company-profile.ts';

const company = {
  legal_name: 'Exemplo Fiscal Ltda',
  cnpj: '11222333000181',
  state_registration: '123456789',
  municipal_registration: null,
  cnae: null,
  address: {
    street: 'Rua Um', number: '10', district: 'Centro', city: 'São Paulo',
    state: 'SP', postalCode: '01001000', cityCode: '3550308',
  },
  nfe_series_homologacao: null,
  nfe_next_number_homologacao: null,
};

test('Focus permite CNAE/inscrição municipal e numeração automática como opcionais', () => {
  assert.deepEqual(fiscalMissing(company), []);
});

test('CNAE e inscrição municipal precisam ser informados juntos quando usados', () => {
  assert.ok(fiscalMissing({ ...company, municipal_registration: '12345' })
    .includes('CNAE (obrigatório com inscrição municipal)'));
  assert.ok(fiscalMissing({ ...company, cnae: '6201501' })
    .includes('Inscrição Municipal (obrigatória com CNAE)'));
  assert.deepEqual(fiscalMissing({ ...company, municipal_registration: '12345', cnae: '6201501' }), []);
});

