(() => {
'use strict';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog=[],page=1,hasMore=false,busy=false,ready=false,historyBusy=false,historyError='',quoteRows=[],customers=new Map(),editingQuote=null;
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
 $('quoteTotal').textContent=money(total);
 const validRow=row=>{
  const manual=row.dataset.manual==='true';
  const hasItem=manual?!!row.querySelector('.manual-description').value.trim()&&!!row.querySelector('.manual-unit').value.trim():!!row.querySelector('.item').value;
  return hasItem&&Number(row.querySelector('.quantity').value)>0&&row.querySelector('.price').value!=='';
 };
 $('quoteAdd').disabled=!ready||busy||rows().length>=100;
 $('quoteAddManual').disabled=!ready||busy||rows().length>=100;
 $('quoteSave').disabled=!ready||busy||!rows().length||rows().some(row=>!validRow(row));
 $('quoteItemCount').textContent=rows().length+' '+(rows().length===1?'item':'itens');
}
function addRow(mode='catalog',itemData=null){
 if(!ready||busy||rows().length>=100)return;
 const manual=mode==='manual'||itemData?.manual===true||(!itemData?.productId&&!itemData?.serviceId&&!!itemData);
 const row=document.createElement('div');row.className='quote-row'+(manual?' quote-row--manual':'');row.dataset.manual=manual?'true':'false';
 const itemField=manual
  ?'<label class="manual-description-label">Descrição do item<input class="manual-description" maxlength="180" autocomplete="off" placeholder="Ex.: peça ou produto sob encomenda" required></label><label>Unidade<input class="manual-unit" maxlength="12" value="UN" autocomplete="off" required></label>'
  :'<label>Produto ou serviço cadastrado<select class="item" required><option value="">Selecione no catálogo</option>'+catalog.map(x=>'<option value="'+safe(x.kind+':'+x.id)+'">'+safe(x.name)+'</option>').join('')+'</select></label>';
 row.innerHTML=itemField+'<label>Quantidade<input class="quantity" type="number" min="0.001" max="999999" step="0.001" value="1" required></label><label>Preço unitário (R$)<input class="price" type="number" min="0" max="999999999" step="0.01" placeholder="0,00" required></label><button type="button" class="btn remove" aria-label="Remover item">Remover</button>';
 if(manual){row.querySelector('.manual-description').value=itemData?.description||'';row.querySelector('.manual-unit').value=itemData?.unit||'UN';}
 else if(itemData?.productId||itemData?.serviceId){const kind=itemData.productId?'product':'service',id=itemData.productId||itemData.serviceId,value=kind+':'+id,select=row.querySelector('.item');if(!Array.from(select.options).some(option=>option.value===value))select.insertAdjacentHTML('beforeend','<option value="'+safe(value)+'">'+safe(itemData.description||'Item inativo do orçamento')+'</option>');select.value=value;}
 if(itemData){row.querySelector('.quantity').value=String(itemData.quantity??1);row.querySelector('.price').value=Number(itemData.unitPrice||0).toFixed(2);}
 if(!manual)row.querySelector('.item').addEventListener('change',()=>{const x=catalog.find(x=>x.kind+':'+x.id===row.querySelector('.item').value);row.querySelector('.price').value=x?Number(x.price).toFixed(2):'';update();});
 row.querySelectorAll('input').forEach(el=>el.addEventListener('input',update));
 row.querySelector('.remove').addEventListener('click',()=>{row.remove();update();});
 $('quoteItems').append(row);update();return row;
}
function loadItem(item){
 const row=addRow(item.manual===true||(!item.productId&&!item.serviceId)?'manual':'catalog',item);
 if(!row)return;
 if(!row.dataset.manual||row.dataset.manual!=='true'){
  const kind=item.productId?'product':'service',value=kind+':'+(item.productId||item.serviceId),select=row.querySelector('.item');
  if(!Array.from(select.options).some(option=>option.value===value))select.insertAdjacentHTML('beforeend','<option value="'+safe(value)+'">'+safe(item.description||'Item inativo do orçamento')+'</option>');
  select.value=value;
 }
 update();
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
const statusLabels={draft:'Em elaboração',sent:'Enviado',accepted:'Aprovado pelo cliente',rejected:'Recusado',expired:'Expirado',cancelled:'Cancelado'};
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
 const next=q.status==='draft'?[['sent','Marcar enviado'],['rejected','Recusar']]:q.status==='sent'?[['accepted','Registrar aprovação'],['rejected','Recusar'],['expired','Expirar']]:[];
 const buttons=next.map(([status,label])=>'<button type="button" class="btn quote-status" data-id="'+safe(q.id)+'" data-from="'+safe(q.status)+'" data-to="'+safe(status)+'">'+safe(label)+'</button>');
 if(q.status==='accepted'){
  if(q.orderId)buttons.push('<button type="button" class="btn" disabled>'+(q.orderStatus==='cancelled'?'Pedido cancelado':'Pedido gerado')+'</button>');
  else buttons.push('<button type="button" class="btn quote-order" data-id="'+safe(q.id)+'">Gerar pedido</button>');
 }
 buttons.unshift('<button type="button" class="btn quote-details" data-id="'+safe(q.id)+'">Ver proposta</button>');
 if(q.status==='draft'||q.status==='sent')buttons.push('<button type="button" class="btn quote-edit" data-id="'+safe(q.id)+'">Editar</button>');
 buttons.push('<button type="button" class="btn quote-print" data-id="'+safe(q.id)+'">Gerar PDF</button>');
 buttons.push('<button type="button" class="btn quote-clone" data-id="'+safe(q.id)+'">Clonar</button>');
 return buttons.join(' ')||'—';
}
function cloneQuote(q){
 if(!ready||busy)return;
 if(!confirm('A cópia abrirá como um novo orçamento editável. O formulário atual será substituído; o orçamento original permanece intacto. Continuar?'))return;
 $('quoteItems').replaceChildren();
 editingQuote=null;$('quoteFormTitle').textContent='Monte seu orçamento';$('quoteSave').textContent='Salvar orçamento';$('quoteEditCancel').hidden=true;
 $('quoteCustomer').value=q.customer_id||'';
 $('quoteValidity').value='';
 $('quoteNotes').value=q.notes||'';
 (Array.isArray(q.items)?q.items:[]).forEach(loadItem);
 if(!rows().length)addRow();
 update();
 $('quoteForm').scrollIntoView({behavior:'smooth',block:'start'});
 notice('Cópia editável preparada. Revise a validade e salve para gerar um novo número.');
}
function editQuote(q){
 if(!ready||busy||!q||!['draft','sent'].includes(q.status))return;
 const hasDraft=$('quoteNotes').value.trim()||rows().some(row=>row.dataset.manual==='true'?row.querySelector('.manual-description').value.trim():row.querySelector('.item').value);
 if(hasDraft&&editingQuote===null&&!confirm('O formulário atual será substituído. Deseja continuar?'))return;
 editingQuote={id:q.id,status:q.status};
 $('quoteItems').replaceChildren();$('quoteCustomer').value=q.customer_id||'';$('quoteValidity').value=q.valid_until||'';$('quoteNotes').value=q.notes||'';
 (Array.isArray(q.items)?q.items:[]).forEach(loadItem);
 if(!rows().length)addRow();
 $('quoteFormTitle').textContent='Editar orçamento '+quoteNumber(q);$('quoteSave').textContent='Salvar alterações';$('quoteEditCancel').hidden=false;
 update();$('quoteForm').scrollIntoView({behavior:'smooth',block:'start'});
 notice(q.status==='sent'?'Ao salvar, esta proposta voltará para elaboração e precisará ser enviada novamente.':'Editando proposta em elaboração.');
}
function clearEditor(){editingQuote=null;$('quoteItems').replaceChildren();$('quoteCustomer').value='';$('quoteValidity').value='';$('quoteNotes').value='';$('quoteFormTitle').textContent='Monte seu orçamento';$('quoteSave').textContent='Salvar orçamento';$('quoteEditCancel').hidden=true;addRow();}
function showDetails(q){const items=Array.isArray(q.items)?q.items:[];$('quoteDetailsTitle').textContent='Orçamento '+quoteNumber(q);$('quoteDetailsBody').innerHTML='<dl><div><dt>Cliente</dt><dd>'+safe(customers.get(q.customer_id)||'Consumidor não identificado')+'</dd></div><div><dt>Situação</dt><dd><span class="status-pill '+(statusClasses[q.status]||'')+'">'+safe(statusLabels[q.status]||q.status)+'</span></dd></div><div><dt>Criado em</dt><dd>'+safe(new Date(q.created_at).toLocaleString('pt-BR'))+'</dd></div><div><dt>Validade</dt><dd>'+safe(q.valid_until||'Sem validade definida')+'</dd></div></dl><div class="detail-items">'+items.map(item=>'<article><span>'+safe(item.description||'Item comercial')+' · '+safe(item.quantity)+' × '+safe(money(item.unitPrice))+'</span><strong>'+safe(money(item.lineTotal))+'</strong></article>').join('')+'</div><p class="dialog-note">'+safe(q.notes||'Nenhuma observação registrada.')+'</p><div class="dialog-actions"><strong>Total: '+safe(money(q.total))+'</strong></div>';if(q.orderId)$('quoteDetailsBody').insertAdjacentHTML('beforeend',q.orderStatus==='cancelled'?'<p class="dialog-note">Pedido e orçamento de origem cancelados. Use Clonar para preparar uma nova proposta com outro número.</p>':'<p class="dialog-note">Pedido gerado. O orçamento original está bloqueado; use Clonar para iniciar outra proposta.</p>');$('quoteDetails').showModal();}
$('quoteList').addEventListener('click',async event=>{
 const editButton=event.target.closest('button.quote-edit');if(editButton){const quote=quoteRows.find(q=>q.id===editButton.dataset.id);if(quote)editQuote(quote);return;}
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
 const confirmation=to==='accepted'
  ?'Confirma que o cliente aprovou este orçamento? Só depois dessa confirmação o sistema permitirá gerar o pedido.'
  :'Alterar situação do orçamento para '+(statusLabels[to]||to)+'?';
 if(!confirm(confirmation))return;
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
$('quoteAdd').addEventListener('click',()=>addRow('catalog'));
$('quoteAddManual').addEventListener('click',()=>{const row=addRow('manual');row?.querySelector('.manual-description')?.focus();});
$('quotePrev').addEventListener('click',()=>history(page-1).catch(e=>notice(e.message)));
$('quoteNext').addEventListener('click',()=>history(page+1).catch(e=>notice(e.message)));
$('quoteSearch').addEventListener('input',renderHistory);$('quoteStatus').addEventListener('change',renderHistory);$('quoteRefresh').addEventListener('click',()=>history(page).catch(e=>notice(e.message)));$('quoteDetailsClose').addEventListener('click',()=>$('quoteDetails').close());$('quoteDetails').addEventListener('click',event=>{if(event.target===$('quoteDetails'))$('quoteDetails').close();});
$('quoteEditCancel').addEventListener('click',clearEditor);
$('quoteForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!ready||busy||$('quoteSave').disabled)return;
 const items=rows().map(row=>{
  const quantity=Number(row.querySelector('.quantity').value),unitPrice=Number(row.querySelector('.price').value);
  if(row.dataset.manual==='true')return {manual:true,description:row.querySelector('.manual-description').value.trim(),unit:row.querySelector('.manual-unit').value.trim(),quantity,unitPrice};
  const [kind,id]=row.querySelector('.item').value.split(':');return {productId:kind==='product'?id:null,serviceId:kind==='service'?id:null,quantity,unitPrice};
 });
 busy=true;update();notice('Salvando orçamento...');
 try{
  const payload={customerId:$('quoteCustomer').value||null,validUntil:$('quoteValidity').value||null,notes:$('quoteNotes').value,items};
  if(editingQuote){
   const saved=editingQuote;
   await api('/api/quotes',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,id:saved.id,fromStatus:saved.status,action:'edit'})});
   clearEditor();await history(page);notice(saved.status==='sent'?'Alterações salvas. A proposta voltou para elaboração; envie novamente ao cliente.':'Alterações da proposta salvas.');
  }else{
   const result=await api('/api/quotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   clearEditor();await history(1);
   notice('Orçamento '+(result.quoteNumber?'ORC-'+String(result.quoteNumber).padStart(6,'0'):'ORC-'+String(result.id||'').slice(0,8).toUpperCase())+' salvo como proposta em elaboração.');
  }
 }catch(error){notice(error.message);}
 finally{busy=false;if(!rows().length)addRow();update();}
});
start();
})();
