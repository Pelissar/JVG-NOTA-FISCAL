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
 row.innerHTML='<label>Produto ou serviço<select class="item" required><option value="">Selecione</option>'+catalog.map(x=>'<option value="'+safe(x.kind+':'+x.id)+'">'+safe(x.name)+'</option>').join('')+'</select></label><label>Quantidade<input class="quantity" type="number" min="0.001" max="999999" step="0.001" value="1" required></label><label>Preço (R$)<input class="price" type="number" min="0" max="999999999" step="0.01" required></label><button type="button" class="btn remove">Remover</button>';
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
const statusLabels={draft:'Rascunho',sent:'Enviado',accepted:'Aceito',rejected:'Recusado',expired:'Expirado',cancelled:'Cancelado'};
const statusClasses={draft:'is-draft',sent:'is-sent',accepted:'is-accepted',rejected:'is-rejected',expired:'is-expired',cancelled:'is-cancelled'};
const quoteNumber=q=>q.quote_number?'ORC-'+String(q.quote_number).padStart(6,'0'):'ORC-'+String(q.id||'').slice(0,8).toUpperCase();
function renderHistory(){
 if(historyError){
  $('quoteCount').textContent='—';$('quoteWaiting').textContent='—';$('quoteValue').textContent='—';
  $('quoteFiltered').textContent='Histórico indisponível';
  $('quoteList').innerHTML='<div class="empty-state"><strong>Não foi possível carregar os orçamentos</strong><p>Confira a integração e use Atualizar para tentar novamente.</p></div>';
  return;
 }
 const query=$('quoteSearch').value.trim().toLocaleLowerCase('pt-BR'),status=$('quoteStatus').value;
 const rows=quoteRows.filter(q=>(!status||q.status===status)&&[q.id,q.quote_number,quoteNumber(q),q.status,q.notes,customers.get(q.customer_id)||''].join(' ').toLocaleLowerCase('pt-BR').includes(query));
 $('quoteCount').textContent=String(quoteRows.length);$('quoteWaiting').textContent=String(quoteRows.filter(q=>q.status==='draft'||q.status==='sent').length);$('quoteValue').textContent=money(quoteRows.reduce((sum,q)=>sum+(Number(q.total)||0),0));$('quoteFiltered').textContent=rows.length+' de '+quoteRows.length+' propostas nesta página';
 $('quoteList').innerHTML=rows.length?'<table><thead><tr><th>Data</th><th>Proposta</th><th>Cliente</th><th>Situação</th><th>Validade</th><th>Total</th><th>Ações</th></tr></thead><tbody>'+rows.map(q=>'<tr><td>'+safe(new Date(q.created_at).toLocaleDateString('pt-BR'))+'</td><td title="'+safe(q.id)+'">#'+safe(quoteNumber(q))+'</td><td>'+safe(customers.get(q.customer_id)||'Consumidor não identificado')+'</td><td><span class="status-pill '+(statusClasses[q.status]||'')+'">'+safe(statusLabels[q.status]||q.status)+'</span></td><td>'+safe(q.valid_until||'—')+'</td><td>'+safe(money(q.total))+'</td><td>'+actions(q)+'</td></tr>').join('')+'</tbody></table>':'<div class="empty-state"><strong>Nenhuma proposta encontrada</strong><p>Altere os filtros ou crie um orçamento para começar.</p></div>';
}
function actions(q){
 const next=q.status==='draft'?[['sent','Marcar enviado'],['rejected','Recusar']]:q.status==='sent'?[['accepted','Aceitar'],['rejected','Recusar'],['expired','Expirar']]:[];
 const buttons=next.map(([status,label])=>'<button type="button" class="btn quote-status" data-id="'+safe(q.id)+'" data-from="'+safe(q.status)+'" data-to="'+safe(status)+'">'+safe(label)+'</button>');
 if(q.status==='accepted'){
  if(q.orderId)buttons.push('<button type="button" class="btn" disabled>'+(q.orderStatus==='cancelled'?'Pedido cancelado':'Pedido gerado')+'</button>');
  else buttons.push('<button type="button" class="btn quote-order" data-id="'+safe(q.id)+'">Gerar pedido</button>');
 }
 buttons.unshift('<button type="button" class="btn quote-details" data-id="'+safe(q.id)+'">Ver proposta</button>');
 buttons.push('<button type="button" class="btn quote-print" data-id="'+safe(q.id)+'">Gerar PDF</button>');
 buttons.push('<button type="button" class="btn quote-clone" data-id="'+safe(q.id)+'">Clonar</button>');
 return buttons.join(' ')||'—';
}
function cloneQuote(q){
 if(!ready||busy)return;
 if(!confirm('A cópia abrirá como um novo orçamento editável. O formulário atual será substituído; o orçamento original permanece intacto. Continuar?'))return;
 $('quoteItems').replaceChildren();
 $('quoteCustomer').value=q.customer_id||'';
 $('quoteValidity').value='';
 $('quoteNotes').value=q.notes||'';
 (Array.isArray(q.items)?q.items:[]).forEach(item=>{
  const kind=item.productId?'product':'service';
  const id=item.productId||item.serviceId;
  addRow();
  const currentRows=rows();const row=currentRows[currentRows.length-1];
  row.querySelector('.item').value=kind+':'+id;
  row.querySelector('.quantity').value=String(item.quantity??1);
  row.querySelector('.price').value=Number(item.unitPrice||0).toFixed(2);
 });
 if(!rows().length)addRow();
 update();
 $('quoteForm').scrollIntoView({behavior:'smooth',block:'start'});
 notice('Cópia editável preparada. Revise a validade e salve para gerar um novo número.');
}
function showDetails(q){const items=Array.isArray(q.items)?q.items:[];$('quoteDetailsTitle').textContent='Orçamento '+quoteNumber(q);$('quoteDetailsBody').innerHTML='<dl><div><dt>Cliente</dt><dd>'+safe(customers.get(q.customer_id)||'Consumidor não identificado')+'</dd></div><div><dt>Situação</dt><dd><span class="status-pill '+(statusClasses[q.status]||'')+'">'+safe(statusLabels[q.status]||q.status)+'</span></dd></div><div><dt>Criado em</dt><dd>'+safe(new Date(q.created_at).toLocaleString('pt-BR'))+'</dd></div><div><dt>Validade</dt><dd>'+safe(q.valid_until||'Sem validade definida')+'</dd></div></dl><div class="detail-items">'+items.map(item=>'<article><span>'+safe(item.description||'Item comercial')+' · '+safe(item.quantity)+' × '+safe(money(item.unitPrice))+'</span><strong>'+safe(money(item.lineTotal))+'</strong></article>').join('')+'</div><p class="dialog-note">'+safe(q.notes||'Nenhuma observação registrada.')+'</p><div class="dialog-actions"><strong>Total: '+safe(money(q.total))+'</strong></div>';if(q.orderId)$('quoteDetailsBody').insertAdjacentHTML('beforeend',q.orderStatus==='cancelled'?'<p class="dialog-note">Pedido e orçamento de origem cancelados. Use Clonar para preparar uma nova proposta com outro número.</p>':'<p class="dialog-note">Pedido gerado. O orçamento original está bloqueado; use Clonar para iniciar outra proposta.</p>');$('quoteDetails').showModal();}
$('quoteList').addEventListener('click',async event=>{
 const detailButton=event.target.closest('button.quote-details');if(detailButton){const quote=quoteRows.find(q=>q.id===detailButton.dataset.id);if(quote)showDetails(quote);return;}
 const printButton=event.target.closest('button.quote-print');if(printButton){const quote=quoteRows.find(q=>q.id===printButton.dataset.id);if(quote&&window.JvgCommercialDocuments)window.JvgCommercialDocuments.print('quote',Object.assign({},quote,{customerId:quote.customer_id,number:quoteNumber(quote)}));else if(!window.JvgCommercialDocuments)notice('Módulo de PDF indisponível. Recarregue a página.');return;}
 const cloneButton=event.target.closest('button.quote-clone');if(cloneButton){const quote=quoteRows.find(q=>q.id===cloneButton.dataset.id);if(quote)cloneQuote(quote);return;}
 const orderButton=event.target.closest('button.quote-order');
 if(orderButton){
  if(busy||historyBusy)return;
  if(!confirm('Gerar pedido comercial deste orçamento aceito?'))return;
  orderButton.disabled=true;
  try{
   const result=await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteId:orderButton.dataset.id})});
   await history(page);
   notice('Pedido '+result.orderId+' gerado. O orçamento original fica bloqueado para alterações.');
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
async function start(){
 try{
  const data=await api('/api/records?scope=quotes');
  for(const customer of data.clients||[])customers.set(customer.id,customer.name);
  catalog=[...(data.products||[]).filter(x=>x.active).map(x=>({...x,kind:'product'})),...(data.services||[]).filter(x=>x.active).map(x=>({...x,kind:'service'}))];
  $('quoteCustomer').innerHTML='<option value="">Consumidor não identificado</option>'+(data.clients||[]).filter(x=>x.active&&x.isCustomer===true&&x.type!=='EXT').map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join('');
  ready=true;addRow();await history();if(!historyError)notice('Orçamentos conectados à empresa.');
 }catch(error){historyError=error.message||'Não foi possível carregar os dados da empresa.';renderHistory();notice(error.message);}
}
$('quoteAdd').addEventListener('click',addRow);
$('quotePrev').addEventListener('click',()=>history(page-1).catch(e=>notice(e.message)));
$('quoteNext').addEventListener('click',()=>history(page+1).catch(e=>notice(e.message)));
$('quoteSearch').addEventListener('input',renderHistory);$('quoteStatus').addEventListener('change',renderHistory);$('quoteRefresh').addEventListener('click',()=>history(page).catch(e=>notice(e.message)));$('quoteDetailsClose').addEventListener('click',()=>$('quoteDetails').close());$('quoteDetails').addEventListener('click',event=>{if(event.target===$('quoteDetails'))$('quoteDetails').close();});
$('quoteForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!ready||busy||$('quoteSave').disabled)return;
 const items=rows().map(row=>{const [kind,id]=row.querySelector('.item').value.split(':');return {productId:kind==='product'?id:null,serviceId:kind==='service'?id:null,quantity:Number(row.querySelector('.quantity').value),unitPrice:Number(row.querySelector('.price').value)};});
 busy=true;update();notice('Salvando orçamento...');
 try{
  const result=await api('/api/quotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerId:$('quoteCustomer').value||null,validUntil:$('quoteValidity').value||null,notes:$('quoteNotes').value,items})});
  $('quoteItems').replaceChildren();$('quoteNotes').value='';$('quoteValidity').value='';await history(1);
  notice('Orçamento '+(result.quoteNumber?'ORC-'+String(result.quoteNumber).padStart(6,'0'):'ORC-'+String(result.id||'').slice(0,8).toUpperCase())+' salvo como rascunho.');
 }catch(error){notice(error.message);}
 finally{busy=false;if(!rows().length)addRow();update();}
});
start();
})();
