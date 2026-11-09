import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const api=read('../app/api/orders/route.ts');
const sql=read('../../supabase/migrations/20261109_jvg_orders.sql');
const ui=read('../public/erp/orders.js');
const quotes=read('../public/erp/quotes.js');
const nav=read('../public/erp/index.html');
test('pedidos usam escopo autenticado e protegem gravação',()=>{
 assert.match(api,/getJvgUser\(\)/);
 assert.match(api,/getSiteAccount\(user\)/);
 assert.match(api,/isSameOrigin\(request\)/);
 assert.match(api,/scope\.role==="viewer"/);
 assert.match(api,/p_tenant_id:scope\.tenant_id/);
 assert.match(api,/p_company_id:scope\.company_id/);
});
test('conversão de orçamento aceito é transacional e idempotente',()=>{
 assert.match(sql,/status='accepted'/);
 assert.match(sql,/on conflict \(tenant_id,company_id,quote_id\) do nothing/i);
 assert.match(sql,/unique \(tenant_id,company_id,quote_id\)/i);
 assert.match(sql,/current_user <> 'service_role'/);
 assert.match(sql,/enable row level security/i);
 assert.match(api,/jvg_create_order_from_quote/);
});
test('histórico e conversão aparecem no ERP',()=>{
 assert.match(nav,/href="\/erp\/orders\.html"/);
 assert.match(ui,/\/api\/orders\?page=/);
 assert.match(quotes,/quote-order/);
 assert.match(quotes,/method:'POST'/);
 assert.match(quotes,/quoteId:orderButton\.dataset\.id/);
});

test('cancelamento de pedido é autorizado somente quando aberto',()=>{
 assert.match(api,/export async function PATCH\(request:Request\)/);
 assert.match(api,/scope\.role==="viewer"/);
 assert.match(api,/status=eq\.open&select=id,status/);
 assert.match(api,/status:"cancelled"/);
 assert.match(api,/if\(!updated\.length\)/);
 assert.match(ui,/order-cancel/);
 assert.match(ui,/method:'PATCH'/);
 assert.match(ui,/confirm\('Cancelar este pedido/);
});

test('tela de pedidos se adapta à largura e preserva rolagem horizontal da tabela',()=>{
 const html=read('../public/erp/orders.html');
 const css=read('../public/erp/commercial-responsive.css');
 const responsive=read('../public/erp/responsive.css');
 assert.match(html,/class="commercial-page"/);
 assert.match(html,/class="commercial-table"/);
 assert.match(html,/commercial-responsive\.css/);
 assert.match(css,/overflow-x:auto/);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(responsive,/body:not\(:has\(> \.app-shell\)\)/);
});
