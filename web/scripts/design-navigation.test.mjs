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
