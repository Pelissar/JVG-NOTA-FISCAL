import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const sales=read('../app/api/sales/route.ts');
const orders=read('../app/api/orders/route.ts');
const quotes=read('../app/api/quotes/route.ts');
const saleMigration=read('../../supabase/migrations/20261109_jvg_sale_idempotency.sql');
const ordersMigration=read('../../supabase/migrations/20261109_jvg_orders.sql');
const quotesMigration=read('../../supabase/migrations/20261109_jvg_quotes.sql');

test('contrato de venda exige migração da função com requestId antes da liberação',()=>{
 assert.match(sales,/p_request_id: requestId/);
 assert.match(saleMigration,/p_request_id/i);
 assert.match(sales,/jvg_confirm_sale/);
});
test('pedidos e orçamentos dependem de tabelas e RPC ainda não liberadas em produção',()=>{
 assert.match(orders,/jvg_create_order_from_quote/);
 assert.match(ordersMigration,/jvg_create_order_from_quote/);
 assert.match(quotes,/jvg_quotes/);
 assert.match(quotesMigration,/jvg_quotes/);
});
test('nenhum endpoint declara emissão SEFAZ a partir de venda, pedido ou orçamento',()=>{
 for(const api of [sales,orders,quotes]){
  assert.doesNotMatch(api,/sefaz.*(emit|authoriz)|emit.*sefaz/i);
 }
});

test('Focus homologação exige autorização por empresa e mantém emissão desativada',()=>{
 const status=read('../app/api/focus/status/route.ts');
 const client=read('../lib/focus/client.ts');
 assert.match(status,/getPlatformRole\(user\)/);
 assert.match(status,/JVG_FOCUS_PILOT_COMPANY_ID/);
 assert.match(status,/JVG_FOCUS_HOMOLOGACAO_TOKEN/);
 assert.match(status,/FOCUS_NFE_HOMOLOGACAO_TOKEN/);
 assert.match(status,/emissionEnabled: false/);
 assert.match(client,/homologacao\.focusnfe\.com\.br/);
 assert.match(client,/method: "GET"/);
 assert.doesNotMatch(client,/method: "POST"/);
});

test('Focus nunca usa URL de produção nem expõe token no cliente',()=>{
 const status=read('../app/api/focus/status/route.ts');
 const client=read('../lib/focus/client.ts');
 const runtime=read('../lib/focus/runtime-env.ts');
 assert.doesNotMatch(client,/https:\/\/api\.focusnfe\.com\.br/);
 assert.match(client,/AbortSignal\.timeout\(8000\)/);
 assert.match(status,/getPlatformRole\(user\)/);
 assert.match(status,/pilotCompany !== account\.company_id/);
 assert.match(runtime,/process\.env/);
 assert.doesNotMatch(status,/NEXT_PUBLIC_FOCUS/);
});

test('diagnóstico Focus é somente leitura e não mostra token',()=>{
 const html=read('../public/erp/nfe-drafts.html');
 const ui=read('../public/erp/focus-diagnostic.js');
 assert.match(html,/id="focusCheck"/);
 assert.match(html,/focus-diagnostic\.js/);
 assert.match(ui,/\/api\/focus\/status/);
 assert.match(ui,/method:'GET'/);
 assert.doesNotMatch(ui,/Authorization|process\.env|method:'POST'/);
 assert.match(ui,/emissionEnabled!==false/);
});

test('diagnóstico Focus tem contraste nos dois temas e informa que não emite',()=>{
 const html=read('../public/erp/nfe-drafts.html');
 const css=read('../public/erp/focus-diagnostic.css');
 assert.match(html,/focus-diagnostic\.css/);
 assert.match(html,/focus-panel-heading/);
 assert.match(html,/A verificação não transmite, autoriza ou cancela NF-e/);
 assert.match(css,/html\[data-theme=light\]/);
 assert.match(css,/focus-visible/);
 assert.match(css,/@media\(max-width:560px\)/);
});
