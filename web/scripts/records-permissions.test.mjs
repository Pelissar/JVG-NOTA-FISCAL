import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const records = readFileSync(new URL('../app/api/records/route.ts', import.meta.url), 'utf8');
const company = readFileSync(new URL('../app/api/company/route.ts', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../lib/jvg-backend.ts', import.meta.url), 'utf8');

test('cadastros exigem autenticação e empresa ativa para acesso', () => {
  assert.match(records, /getJvgUser\(\)/);
  assert.match(records, /getSiteAccount\(user\)/);
  assert.match(records, /tenant_id=\$\{filterEq\(account\.tenant_id\)\}/);
  assert.match(records, /company_id=\$\{filterEq\(account\.company_id\)\}/);
});

test('viewer pode consultar mas não alterar ou desativar cadastros', () => {
  const post = records.split('export async function POST(request: Request) {')[1].split('export async function DELETE(request: Request) {')[0];
  const remove = records.split('export async function DELETE(request: Request) {')[1];
  for (const handler of [post, remove]) {
    assert.match(handler, /isSameOrigin\(request\)/);
    assert.match(handler, /account\.role === 'viewer'/);
    assert.match(handler, /403/);
  }
  assert.doesNotMatch(records.split('export async function GET() {')[1].split('export async function POST(request: Request) {')[0], /account\.role === 'viewer'/);
});

test('dados fiscais da empresa exigem owner ou admin', () => {
  assert.match(company, /\['owner', 'admin'\]\.includes\(account\.role/);
  assert.match(backend, /user_id=\$\{filterEq\(user\.userId\)\}/);
});

test('origem usa Host público no proxy Netlify sem liberar domínios externos', () => {
  const fn = backend.split('export function isSameOrigin(request: Request): boolean {')[1]?.split('\nexport function ')[0];
  assert.ok(fn, 'função de validação presente');
  assert.match(fn, /request\.headers\.get\("host"\)/);
  assert.match(fn, /source\.host\.toLowerCase\(\) === host\.trim\(\)\.toLowerCase\(\)/);
  assert.doesNotMatch(fn, /x-forwarded-host/i);
  assert.match(fn, /if \(!origin \|\| origin === "null"\) return false/);
  const isSameOrigin = new Function('request', fn.replace(/}\s*$/, ''));
  const request = (origin, host, url = 'https://internal.netlify/functions/api') => ({
    headers: { get(name) { return name === 'origin' ? origin : name === 'host' ? host : null; } },
    url
  });
  assert.equal(isSameOrigin(request('https://deploy-preview-2--jvgnotafiscal.netlify.app', 'deploy-preview-2--jvgnotafiscal.netlify.app')), true);
  assert.equal(isSameOrigin(request('https://outro-site.example', 'deploy-preview-2--jvgnotafiscal.netlify.app')), false);
  assert.equal(isSameOrigin(request(null, 'deploy-preview-2--jvgnotafiscal.netlify.app')), false);
  assert.equal(isSameOrigin(request('null', 'deploy-preview-2--jvgnotafiscal.netlify.app')), false);
  assert.equal(isSameOrigin(request('http://deploy-preview-2--jvgnotafiscal.netlify.app', 'deploy-preview-2--jvgnotafiscal.netlify.app')), false);
});
