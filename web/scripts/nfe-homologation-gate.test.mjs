import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewApprovedTaxProfile, reviewNfeHomologationGate } from '../lib/fiscal/nfe-homologation-gate.ts';

const completeDraft = () => ({
  schemaVersion: 7,
  nature: 'Venda de mercadoria',
  purpose: 1,
  issueAt: '2026-11-11T10:00:00-03:00',
  consumerFinal: true,
  buyerPresence: 1,
  recipientIeIndicator: 9,
  issuer: {
    companyId: '123e4567-e89b-42d3-a456-426614174000',
    cnpj: '12345678000195', legalName: 'Empresa Exemplo', stateRegistration: '123456789',
    taxRegime: 'simples_nacional', taxRegimeConfirmed: true, state: 'SP',
    address: { street: 'Rua A', number: '1', district: 'Centro', cityCode: '3550308', city: 'São Paulo', state: 'SP', postalCode: '01001000' },
  },
  recipient: {
    name: 'Cliente Exemplo', documentType: 'cpf', documentNumber: '52998224725', state: 'SP',
    address: { street: 'Rua B', number: '2', district: 'Centro', cityCode: '3550308', city: 'São Paulo', state: 'SP', postalCode: '01001000' },
  },
  preflight: { dataComplete: true, issues: [] },
  transport: { mode: 9, volumes: [] },
  payments: [],
  items: [{
    productId: '123e4567-e89b-42d3-a456-426614174001',
    sku: 'SKU-1', description: 'Produto de teste', ncm: '85176299', cfop: '5102', unit: 'UN',
    quantity: 1, unitPriceCents: 1000, subtotalCents: 1000, origin: '0', csosn: '102', operation: 'interna',
    taxProfile: { id: 'profile-1', reviewStatus: 'reviewed', operationRuleConfigured: true, accountantReviewDeclared: true },
    taxRules: { pisCst: '06', cofinsCst: '06', cstIbsCbs: '000', classTrib: '000001', focusFields: {
      ibs_cbs_base_calculo: 10, ibs_uf_aliquota: 0, ibs_uf_valor: 0, ibs_mun_aliquota: 0,
      ibs_mun_valor: 0, cbs_aliquota: 0, cbs_valor: 0,
    } },
  }],
  totalCents: 1000,
  taxPreview: { provisional: true, validForEmission: false, calculationMethod: 'not_calculated' },
  pending: [],
});

test('preparação pode passar quando a regra revisada contém todos os campos do contrato Focus', () => {
  const gate = reviewNfeHomologationGate(completeDraft());
  assert.equal(gate.ready, true);
  assert.deepEqual(gate.issues, []);
  assert.equal(gate.focusRequestPreview.items[0].icms_situacao_tributaria, '102');
  assert.equal('valor_total' in gate.focusRequestPreview, false);
  assert.equal('taxPreview' in gate.focusRequestPreview, false);
});

test('Simples Nacional omite IBS/CBS e estimativas nao substituem valores exigidos pela regra Focus', () => {
  const draft = completeDraft();
  draft.items[0].taxRules.focusFields = {};
  draft.taxPreview = { provisional: false, validForEmission: true, calculationMethod: 'approved_rule_engine', lines: [{ tax: 'IBS', estimateCents: 500 }] };
  const gate = reviewNfeHomologationGate(draft);
  assert.equal(gate.ready, true);
  assert.equal(gate.issues.some(issue => issue.includes('IBS/CBS')), false);
  assert.equal('taxPreview' in gate.focusRequestPreview, false);
  assert.equal('ibs_cbs_situacao_tributaria' in gate.focusRequestPreview.items[0], false);
});

test('pendências fiscais bloqueiam mas perfil ausente ou não revisado é opcional', () => {
  const draft = completeDraft();
  draft.pending = ['CFOP precisa de confirmação contábil'];
  draft.items[0].taxProfile.reviewStatus = 'draft';
  draft.items[0].taxProfile.operationRuleConfigured = false;
  draft.items[0].taxProfile.accountantReviewDeclared = false;
  const gate = reviewNfeHomologationGate(draft);
  assert.equal(gate.ready, false);
  assert.ok(gate.issues.some(issue => issue.includes('CFOP precisa de confirmação contábil')));
  assert.equal(gate.issues.some(issue => issue.includes('perfil tributário')), false);
  assert.equal(gate.issues.some(issue => issue.includes('declaração de revisão contábil')), false);
  const noProfile = completeDraft();
  delete noProfile.items[0].taxProfile;
  assert.equal(reviewNfeHomologationGate(noProfile).ready, true);
});

test('perfil exige declaração registrada de revisão contábil consistente', () => {
  const reviewer = '123e4567-e89b-42d3-a456-426614174002';
  const profile = {
    review_status: 'reviewed', reviewed_by: reviewer,
    rules: { requiresAccountantReview: false, accountantReview: {
      name: 'Contabilidade Exemplo', declaredBy: reviewer, declaredAt: '2026-11-11T10:00:00-03:00',
    } },
  };
  assert.equal(reviewApprovedTaxProfile(profile).ready, true);
  profile.rules.accountantReview.declaredBy = '123e4567-e89b-42d3-a456-426614174003';
  assert.equal(reviewApprovedTaxProfile(profile).ready, false);
});
