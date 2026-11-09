import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidCpf } from '../lib/fiscal/cpf.ts';

test('aceita CPF com dígitos verificadores válidos', () => {
  assert.equal(isValidCpf('52998224725'), true);
  assert.equal(isValidCpf('11144477735'), true);
});

test('rejeita CPF com dígitos incorretos, repetidos ou tamanho inválido', () => {
  assert.equal(isValidCpf('52998224724'), false);
  assert.equal(isValidCpf('11111111111'), false);
  assert.equal(isValidCpf('123'), false);
  assert.equal(isValidCpf(''), false);
});
