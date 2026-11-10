(() => {
'use strict';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog=[],page=1,hasMore=false,busy=false,ready=false,historyBusy=false,historyError='',quoteRows=[],customers=new Map();
const notice=message=>{$('quoteNotice').textContent=message;};
async function api(url,options){
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Operação indisponível.');
 return data;
}
function rows(){return [...$('quoteItems').querySelectorAll('.quote-row')];}
function update(){
 const total=rows().reduce((sum,row)=>sum+(Number(row.querySelector('.quantity').value)||0)*(Number(row.querySelector('.price').value)||0),0);
 $('quoteTotal').textContent='Total: '+money(total);
 $('quoteAdd').disabled=!ready||busy||rows().length>=100;
 $('quoteSave').disabled=!ready||busy||!rows().length||rows().some(row=>!row.querySelector('.item').value||!(Number(row.querySelector('.quantity').value)>0)||row.querySelector('.price').value==='');
}
function addRow(){
 if(!ready||busy||rows().length>=100)return;
 const row=document.createElement('div');row.className='quote-row';
 row.innerHTML='<label>Produto ou serviço<select class="item" required><option value="">Selecione</option>'+catalog.map(x=>'<option value="'+safe(x.kind+':'+x.id)+'">'+safe(x.name)+'</option>').join('')+'</select></label><label>Quantidade<input class="quantity" type="number" min="0.001" max="999999" step="0.001" value="1" required></label><label>Preço (R$)<input class="price" type="number" min="0" max="999999999" step="0.01" required></label><details class="quote-item-extra"><summary>Detalhes opcionais do item</summary><div><label>Marca<input class="brand" maxlength="80"></label><label>Modelo<input class="model" maxlength="120"></label><label>Número de série<input class="serial-number" maxlength="120"></label><label>Descrição do serviço<input class="service-description" maxlength="2000"></label></div></details><button type="button" class="btn remove">Remover</button>';
 row.querySelector('.item').addEventListener('change',()=>{const x=catalog.find(x=>x.kind+':'+x.id===row.querySelector('.item').value);row.querySelector('.price').value=x?Number(x.price).toFixed(2):'';update();});
 row.querySelectorAll('input').forEach(el=>el.addEventListener('input',update));
 row.querySelector('.remove').addEventListener('click',()=>{row.remove();update();});
 $('quoteItems').append(row);update();
}
async function history(nextPage=page){
 if(historyBusy)return;
 historyBusy=true;$('quotePrev').disabled=true;$('quoteNext').disabled=true;
 historyError='';
 try{
 const data=await api('/api/quotes?page='+nextPage);page=data.page;hasMore=data.hasMore===true;
 quoteRows=Array.isArray(data.quotes)?data.quotes:[];
 renderHistory();
 $('quotePage').textContent='Página '+page;
 }catch(error){
  historyError=error.message||'Não foi possível carregar os orçamentos.';
  quoteRows=[];hasMore=false;
  renderHistory();notice(historyError);
 }finally{historyBusy=false;$('quotePrev').disabled=page<=1;$('quoteNext').disabled=!hasMore;}
}
const statusLabels={draft:'Rascunho',sent:'Enviado',accepted:'Aceito',rejected:'Recusado',expired:'Expirado'};
const statusClasses={draft:'is-draft',sent:'is-sent',accepted:'is-accepted',rejected:'is-rejected',expired:'is-expired'};
function renderHistory(){
 if(historyError){
  $('quoteCount').textContent='—';$('quoteWaiting').textContent='—';$('quoteValue').textContent='—';
  $('quoteFiltered').textContent='Histórico indisponível';
  $('quoteList').innerHTML='<div class="empty-state"><strong>Não foi possível carregar os orçamentos</strong><p>Confira a integração e use Atualizar para tentar novamente.</p></div>';
  return;
 }
 const query=$('quoteSearch').value.trim().toLocaleLowerCase('pt-BR'),status=$('quoteStatus').value;
 const rows=quoteRows.filter(q=>(!status||q.status===status)&&[q.id,q.status,q.notes,customers.get(q.customer_id)||''].join(' ').toLocaleLowerCase('pt-BR').includes(query));
 $('quoteCount').textContent=String(quoteRows.length);$('quoteWaiting').textContent=String(quoteRows.filter(q=>q.status==='draft'||q.status==='sent').length);$('quoteValue').textContent=money(quoteRows.reduce((sum,q)=>sum+(Number(q.total)||0),0));$('quoteFiltered').textContent=rows.length+' de '+quoteRows.length+' propostas nesta página';
 $('quoteList').innerHTML=rows.length?'<table><thead><tr><th>Data</th><th>Proposta</th><th>Cliente</th><th>Situação</th><th>Validade</th><th>Total</th><th>Ações</th></tr></thead><tbody>'+rows.map(q=>'<tr><td>'+safe(new Date(q.created_at).toLocaleDateString('pt-BR'))+'</td><td title="'+safe(q.id)+'">#'+safe(q.id.slice(0,8).toUpperCase())+'</td><td>'+safe(customers.get(q.customer_id)||'Consumidor não identificado')+'</td><td><span class="status-pill '+(statusClasses[q.status]||'')+'">'+safe(statusLabels[q.status]||q.status)+'</span></td><td>'+safe(q.valid_until||'—')+'</td><td>'+safe(money(q.total))+'</td><td>'+actions(q)+'</td></tr>').join('')+'</tbody></table>':'<div class="empty-state"><strong>Nenhuma proposta encontrada</strong><p>Altere os filtros ou crie um orçamento para começar.</p></div>';
}
function actions(q){
 const next=q.status==='draft'?[['sent','Marcar enviado'],['rejected','Recusar']]:q.status==='sent'?[['accepted','Aceitar'],['rejected','Recusar'],['expired','Expirar']]:[];
 const buttons=next.map(([status,label])=>'<button type="button" class="btn quote-status" data-id="'+safe(q.id)+'" data-from="'+safe(q.status)+'" data-to="'+safe(status)+'">'+safe(label)+'</button>');
 if(q.status==='accepted')buttons.push('<button type="button" class="btn quote-order" data-id="'+safe(q.id)+'">Gerar pedido</button>');
 buttons.unshift('<button type="button" class="btn quote-print" data-id="'+safe(q.id)+'">PDF / Imprimir</button>');
 buttons.unshift('<button type="button" class="btn quote-details" data-id="'+safe(q.id)+'">Ver proposta</button>');
 return buttons.join(' ')||'—';
}
function lineMeta(item){return [item.brand?'Marca: '+item.brand:'',item.model?'Modelo: '+item.model:'',item.serialNumber?'Nº de série: '+item.serialNumber:'',item.serviceDescription||''].filter(Boolean).map(safe).join(' · ');}
function printQuote(q){if(window.JvgCommercialDocuments)window.JvgCommercialDocuments.print('quote',Object.assign({},q,{customerId:q.customer_id}));else notice('O módulo de impressão não foi carregado. Recarregue a página.');}
function showDetails(q){const items=Array.isArray(q.items)?q.items:[];$('quoteDetailsTitle').textContent='Orçamento #'+q.id.slice(0,8).toUpperCase();$('quoteDetailsBody').innerHTML='<dl><div><dt>Cliente</dt><dd>'+safe(customers.get(q.customer_id)||'Consumidor não identificado')+'</dd></div><div><dt>Situação</dt><dd><span class="status-pill '+(statusClasses[q.status]||'')+'">'+safe(statusLabels[q.status]||q.status)+'</span></dd></div><div><dt>Criado em</dt><dd>'+safe(new Date(q.created_at).toLocaleString('pt-BR'))+'</dd></div><div><dt>Validade</dt><dd>'+safe(q.valid_until||'Sem validade definida')+'</dd></div></dl><div class="detail-items">'+items.map(item=>'<article><span>'+safe(item.description||'Item comercial')+' · '+safe(item.quantity)+' × '+safe(money(item.unitPrice))+(lineMeta(item)?'<small class="line-detail">'+lineMeta(item)+'</small>':'')+'</span><strong>'+safe(money(item.lineTotal))+'</strong></article>').join('')+'</div><p class="dialog-note">'+safe(q.notes||'Nenhuma observação registrada.')+'</p><div class="dialog-actions"><strong>Total: '+safe(money(q.total))+'</strong><button type="button" class="btn quote-print-detail" data-id="'+safe(q.id)+'">PDF / Imprimir</button></div>';$('quoteDetails').showModal();}
$('quoteList').addEventListener('click',async event=>{
 const printButton=event.target.closest('button.quote-print');if(printButton){const quote=quoteRows.find(q=>q.id===printButton.dataset.id);if(quote)printQuote(quote);return;}
 const detailButton=event.target.closest('button.quote-details');if(detailButton){const quote=quoteRows.find(q=>q.id===detailButton.dataset.id);if(quote)showDetails(quote);return;}
 const orderButton=event.target.closest('button.quote-order');
 if(orderButton){
  if(busy||historyBusy)return;
  if(!confirm('Gerar pedido comercial deste orçamento aceito?'))return;
  orderButton.disabled=true;
  try{
   const result=await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteId:orderButton.dataset.id})});
   notice('Pedido registrado: '+result.orderId+'. A criação repetida retorna o mesmo pedido.');
  }catch(error){notice(error.message);orderButton.disabled=false;}
  return;
 }
 const button=event.target.closest('button.quote-status');
 if(!button||busy||historyBusy)return;
 const {id,from,to}=button.dataset;
 if(!confirm('Alterar situação do orçamento para '+(statusLabels[to]||to)+'?'))return;
 button.disabled=true;
 try{
  await api('/api/quotes',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,fromStatus:from,status:to})});
  await history();notice('Situação do orçamento atualizada.');
 }catch(error){notice(error.message);button.disabled=false;}
});
function setOptionalFields(row,item){row.querySelector('.brand').value=item.brand||'';row.querySelector('.model').value=item.model||'';row.querySelector('.serial-number').value=item.serialNumber||'';row.querySelector('.service-description').value=item.serviceDescription||'';}
async function loadSourceOrder(){
 const orderId=new URLSearchParams(location.search).get('fromOrder');if(!orderId)return;
 try{
  const data=await api('/api/orders?id='+encodeURIComponent(orderId)),order=data.order;
  if(!order)throw Error('Pedido não encontrado.');
  $('quoteCustomer').value=order.customer_id||'';$('quoteItems').replaceChildren();
  const unavailable=[];
  (Array.isArray(order.items)?order.items:[]).forEach(item=>{
   const kind=item.serviceId?'service':'product',id=item.serviceId||item.productId;
   if(!id||!catalog.some(x=>x.kind===kind&&x.id===id)){unavailable.push(item.description||'Item sem cadastro ativo');return;}
   addRow();const row=rows().at(-1);row.querySelector('.item').value=kind+':'+id;row.querySelector('.item').dispatchEvent(new Event('change'));
   row.querySelector('.quantity').value=String(item.quantity||1);row.querySelector('.price').value=Number(item.unitPrice||0).toFixed(2);setOptionalFields(row,item);
  });
  if(!rows().length)addRow();
  const reference='Reorçamento baseado no pedido #'+String(order.id).slice(0,8).toUpperCase();
  $('quoteNotes').value=[reference,order.notes||''].filter(Boolean).join('\n');update();
  notice((unavailable.length?'Alguns itens não estão mais ativos no catálogo e foram omitidos. ':'')+'Pedido carregado como novo rascunho de orçamento. Confira os dados e salve a proposta.');
 }catch(error){notice('Não foi possível carregar o pedido para reorçamento: '+error.message);}
}
async function start(){
 try{
  const data=await api('/api/records');
  for(const customer of data.clients||[])customers.set(customer.id,customer.name);
  catalog=[...(data.products||[]).filter(x=>x.active).map(x=>({...x,kind:'product'})),...(data.services||[]).filter(x=>x.active).map(x=>({...x,kind:'service'}))];
  $('quoteCustomer').innerHTML='<option value="">Consumidor não identificado</option>'+(data.clients||[]).filter(x=>x.active&&x.isCustomer===true&&x.type!=='EXT').map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join('');
  ready=true;addRow();await history();if(!historyError)notice('Orçamentos conectados à empresa.');await loadSourceOrder();
 }catch(error){historyError=error.message||'Não foi possível carregar os dados da empresa.';renderHistory();notice(error.message);}
}
$('quoteAdd').addEventListener('click',addRow);
$('quotePrev').addEventListener('click',()=>history(page-1).catch(e=>notice(e.message)));
$('quoteNext').addEventListener('click',()=>history(page+1).catch(e=>notice(e.message)));
$('quoteSearch').addEventListener('input',renderHistory);$('quoteStatus').addEventListener('change',renderHistory);$('quoteRefresh').addEventListener('click',()=>history(page).catch(e=>notice(e.message)));$('quoteDetailsClose').addEventListener('click',()=>$('quoteDetails').close());$('quoteDetails').addEventListener('click',event=>{if(event.target===$('quoteDetails'))$('quoteDetails').close();});
$('quoteDetailsBody').addEventListener('click',event=>{const button=event.target.closest('button.quote-print-detail');if(!button)return;const quote=quoteRows.find(q=>q.id===button.dataset.id);if(quote)printQuote(quote);});
$('quoteForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!ready||busy||$('quoteSave').disabled)return;
 const items=rows().map(row=>{const [kind,id]=row.querySelector('.item').value.split(':');return {productId:kind==='product'?id:null,serviceId:kind==='service'?id:null,quantity:Number(row.querySelector('.quantity').value),unitPrice:Number(row.querySelector('.price').value),brand:row.querySelector('.brand').value.trim(),model:row.querySelector('.model').value.trim(),serialNumber:row.querySelector('.serial-number').value.trim(),serviceDescription:row.querySelector('.service-description').value.trim()};});
 busy=true;update();notice('Salvando orçamento...');
 try{
  const result=await api('/api/quotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerId:$('quoteCustomer').value||null,validUntil:$('quoteValidity').value||null,notes:$('quoteNotes').value,items})});
  $('quoteItems').replaceChildren();$('quoteNotes').value='';$('quoteValidity').value='';await history(1);
  notice('Orçamento salvo: '+result.id);
 }catch(error){notice(error.message);}
 finally{busy=false;if(!rows().length)addRow();update();}
});
start();
})();
