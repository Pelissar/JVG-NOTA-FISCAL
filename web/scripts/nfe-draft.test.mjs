import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNfeDraftInput } from '../lib/fiscal/nfe-draft.ts';

const recipientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const productId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const draft = () => ({
  recipientId, nature: 'Venda de mercadoria',
  items: [{ productId, quantity: 2.5, unitPrice: 12.34, cfop: '5102', csosn: '102' }],
});

test('calcula o valor comercial do rascunho em centavos', () => {
  const result = parseNfeDraftInput(draft());
  assert.equal(result.items.length, 1);
  assert.equal(result.totalCents, 3085);
  assert.equal(result.items[0].quantityMilli, 2500);
});

test('não aceita produto nem destinatário inválidos', () => {
  assert.throws(() => parseNfeDraftInput({ ...draft(), recipientId: 'outro' }), /destinatário/i);
  assert.throws(() => parseNfeDraftInput({ ...draft(), items: [{ ...draft().items[0], productId: 'outro' }] }), /produto/i);
});

test('não permite precisão monetária e quantidade inadequadas', () => {
  assert.throws(() => parseNfeDraftInput({ ...draft(), items: [{ ...draft().items[0], unitPrice: 1.234 }] }), /preço aceito/i);
  assert.throws(() => parseNfeDraftInput({ ...draft(), items: [{ ...draft().items[0], quantity: 1.0001 }] }), /quantidade aceita/i);
  assert.throws(() => parseNfeDraftInput({ ...draft(), items: [{ ...draft().items[0], quantity: -2 }] }), /quantidade inválida/i);
});

test('valida formatos fiscais sem escolher tributação automaticamente', () => {
  assert.throws(() => parseNfeDraftInput({ ...draft(), items: [{ ...draft().items[0], cfop: 'abc' }] }), /CFOP/i);
  assert.throws(() => parseNfeDraftInput({ ...draft(), items: [{ ...draft().items[0], csosn: '999' }] }), /CSOSN/i);
  const pending = parseNfeDraftInput({ ...draft(), items: [{ ...draft().items[0], cfop: '', csosn: '' }] });
  assert.equal(pending.items[0].cfop, '');
  assert.equal(pending.items[0].csosn, '');
});

test('impede excesso de itens', () => {
  assert.throws(() => parseNfeDraftInput({ ...draft(), items: Array.from({ length: 21 }, () => draft().items[0]) }), /20 produtos/i);
});
