import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const html=read('../public/erp/index.html');
const js=read('../public/erp/app.js');
const css=read('../public/erp/design-system.css');
const matches=(text,re)=>[...text.matchAll(re)].length;
test('navegação sem duplicatas nem links fiscais falsamente operacionais',()=>{
 for(const href of ['/erp/quotes.html','/erp/orders.html','/erp/sales.html','/erp/nfe-drafts.html','/erp/cfop.html','/erp/tax-profiles.html'])
  assert.equal(matches(html,new RegExp('href="'+href.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"','g')),1,href);
 assert.doesNotMatch(html,/Emitir NF-e|NFC-e \(65\) · Em preparação|NFS-e · Em preparação/);
 assert.doesNotMatch(html,/data-view="finance"|data-view="transport"/);
 assert.match(html,/class="nav-group"/);
});
test('painel usa atalhos comerciais e não repete grade de módulos',()=>{
 assert.match(js,/Novo orçamento/);
 assert.match(js,/Ver pedidos/);
 assert.match(js,/Registrar venda/);
 assert.doesNotMatch(js,/Módulos do sistema/);
 assert.match(js,/href="'\+x\[3\]/);
});
test('identidade visual preserva responsividade e acessibilidade',()=>{
 assert.match(html,/design-system\.css/);
 assert.match(css,/@media\(min-width:1600px\)/);
 assert.match(css,/@media\(max-width:1100px\)/);
 assert.match(css, /focus-visible/);
 assert.match(css,/prefers-reduced-motion/);
});

test('navegação mantém estado acessível e rota sincronizada',()=>{
 const navigation=read('../public/erp/navigation.js');
 assert.match(html,/aria-controls="sidebar" aria-expanded="false"/);
 assert.match(html,/src="\.\/navigation\.js"/);
 assert.match(js,/history\.pushState\(null,'','#'\+next\)/);
 assert.match(js,/setAttribute\('aria-current','page'\)/);
 assert.match(js,/setAttribute\('aria-expanded','false'\)/);
 assert.match(navigation,/event\.key==='Home'/);
 assert.match(navigation,/event\.key!=='End'/);
});

test('pesquisa preserva texto e histórico respeita voltar/avançar',()=>{
 assert.match(js,/query=searchText;render\(\)/);
 assert.match(js,/window\.addEventListener\('popstate'/);
 assert.match(js,/window\.addEventListener\('hashchange'/);
});
test('menu acessível e adaptado a telas estreitas',()=>{
 assert.match(html,/class="skip-link" href="#content"/);
 assert.match(html,/aria-label="Buscar no módulo atual"/);
 assert.match(css,/\.skip-link:focus/);
 assert.match(css,/@media\(max-width:480px\)/);
 assert.match(js,/closeSidebar\(true\)/);
 assert.match(js,/closeMenuBtn'\)\.focus\(\)/);
});

test('rotas de módulos ainda não implementados não permanecem acessíveis por hash',()=>{
 assert.doesNotMatch(js,/finance:'Financeiro'/);
 assert.doesNotMatch(js,/transport:'Transporte'/);
 assert.doesNotMatch(js,/view==='finance'/);
 assert.doesNotMatch(js,/view==='transport'/);
});
