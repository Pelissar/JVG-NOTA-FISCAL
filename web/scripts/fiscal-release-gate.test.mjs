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
