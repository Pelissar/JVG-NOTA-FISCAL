import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const api=read('../app/api/quotes/route.ts');
const sql=read('../../supabase/migrations/20261109_jvg_quotes.sql');
const page=read('../public/erp/quotes.html');
const client=read('../public/erp/quotes.js');
const nav=read('../public/erp/index.html');
test('orçamentos são isolados por empresa e exigem autenticação',()=>{
 assert.match(api,/getJvgUser\(\)/);
 assert.match(api,/getSiteAccount\(user\)/);
 assert.match(api,/tenant_id=\$\{filterEq\(scope\.tenant_id\)\}/);
 assert.match(api,/company_id=\$\{filterEq\(scope\.company_id\)\}/);
 assert.match(api,/scope\.role === "viewer"/);
 assert.match(api,/isSameOrigin\(request\)/);
});
test('orçamentos validam itens, cliente e totais',()=>{
 assert.match(api,/is_customer=eq\.true&active=eq\.true/);
 assert.match(api,/productById\.get\(productId\)/);
 assert.match(api,/serviceById\.get\(serviceId\)/);
 assert.match(api,/Math\.round\(unitPrice \* 100\)/);
 assert.match(api,/data\.items\.length > 100/);
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on public\.jvg_quotes/i);
});
test('interface salva orçamentos reais e exibe histórico',()=>{
 assert.match(nav,/href="\/erp\/quotes\.html"/);
 assert.match(page,/id="quoteForm"/);
 assert.match(page,/id="quoteList"/);
 assert.match(client,/api\('\/api\/quotes'/);
 assert.match(client,/await history\(1\)/);
 assert.doesNotMatch(client,/localStorage|dados fictícios/i);
});

test('situações de orçamento têm transições autorizadas e escrita condicional',()=>{
 assert.match(api,/export async function PATCH\(request: Request\)/);
 assert.match(api,/draft: \["sent", "rejected"\]/);
 assert.match(api,/sent: \["accepted", "rejected", "expired"\]/);
 assert.match(api,/status=\$\{filterEq\(from\)\}/);
 assert.match(api,/if \(!updated\.length\)/);
 assert.match(client,/data-from=/);
 assert.match(client,/method:'PATCH'/);
 assert.match(client,/history\(\)/);
});

test('orçamento vencido não pode ser aceito',()=>{
 assert.match(api,/timeZone:"America\/Sao_Paulo"/);
 assert.match(api,/valid_until\.gte\.\$\{today\}/);
 assert.match(api,/to === "accepted"/);
});
