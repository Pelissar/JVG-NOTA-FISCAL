(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
  const notice = message => { $('notice').textContent = message; };
  let products = [], services = [], busy = false, loaded = false, writable = false, pendingRequestId = null, pendingPayload = null, salesHistory = [], salesPage = 1, salesHasMore = false, loadingSales = false;
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(url, init) {
    const response = await fetch(url,{credentials:'same-origin',cache:'no-store',...init});
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }
  function addItem() {
    if(busy||!loaded&&products.length===0&&services.length===0&&document.querySelectorAll('.sale-row').length>0)return;
    if(document.querySelectorAll('.sale-row').length>=100){notice('Limite de 100 itens por venda.');return;}
    const row = document.createElement('div');
    row.className = 'sale-row';
    
    const options = [
      ...products.filter(x=>x.active).map(x=>({kind:'product',...x})),
      ...services.filter(x=>x.active).map(x=>({kind:'service',...x}))
    ];
    row.innerHTML = '<label>Item <select class="item" required><option value="">Selecione</option>'+
      options.map(x=>'<option value="'+safe(x.kind+':'+x.id)+'">'+safe((x.kind==='product'?'Produto: ':'Serviço: ')+x.name)+' — '+safe(money(x.price))+'</option>').join('')+
      '</select></label><label>Quantidade <input class="quantity" type="number" min="0.001" max="999999" step="0.001" value="1" required></label>'+
      '<label>Preço (R$) <input class="price" type="number" min="0" max="999999999" step="0.01" required></label>'+
      '<button class="btn remove" type="button">Remover</button>';
    row.querySelector('.item').addEventListener('change',()=>{const x=options.find(x=>x.kind+':'+x.id===row.querySelector('.item').value);row.querySelector('.price').value=x?Number(x.price).toFixed(2):'';recalculate();});
    row.querySelector('.remove').addEventListener('click',()=>{row.remove();recalculate();});
    row.querySelectorAll('input').forEach(x=>x.addEventListener('input',recalculate));
    $('items').append(row);recalculate();
  }
  function recalculate() {
    const rows=[...document.querySelectorAll('.sale-row')];
    const total=rows.reduce((sum,row)=>sum+(Number(row.querySelector('.quantity').value)||0)*(Number(row.querySelector('.price').value)||0),0);
    $('total').textContent='Total: '+money(total);
    $('draftValue').textContent=money(total);
    $('summaryTotal').textContent=money(total);
    $('itemCount').textContent=String(rows.length);
    $('addItem').disabled=busy||!loaded||!writable||rows.length>=100;
    $('submit').disabled=!loaded||!writable||busy||!rows.length||rows.some(row=>!row.querySelector('.item').value||!(Number(row.querySelector('.quantity').value)>0)||row.querySelector('.price').value===''||Number(row.querySelector('.price').value)<0);
  }
  function filteredSales() {
    const query = ($('salesSearch')?.value || '').trim().toLocaleLowerCase('pt-BR');
    const status = $('salesStatus')?.value || '';
    return salesHistory.filter(sale => {
      const matchesStatus = !status || sale.status === status;
      const searchable = [sale.id, sale.status, sale.notes, sale.customer_id].join(' ').toLocaleLowerCase('pt-BR');
      return matchesStatus && (!query || searchable.includes(query));
    });
  }
  function renderSales() {
    const sales = filteredSales();
    $('salesCount').textContent = String(salesHistory.length);
    $('salesValue').textContent = money(salesHistory.reduce((sum,sale)=>sum+(Number(sale.total)||0),0));
    $('salesFilteredCount').textContent = sales.length+' de '+salesHistory.length+' vendas nesta página';
    $('salesPage').textContent = 'Página '+salesPage;
    $('salesPrevious').disabled = loadingSales || salesPage <= 1;
    $('salesNext').disabled = loadingSales || !salesHasMore;
    $('sales').innerHTML = sales.length
      ? '<table><thead><tr><th>Data</th><th>Identificador</th><th>Situação</th><th>Total</th></tr></thead><tbody>'+
        sales.map(x=>'<tr><td>'+safe(new Date(x.created_at).toLocaleString('pt-BR'))+'</td><td title="'+safe(x.id)+'">'+safe(String(x.id).slice(0,8))+'</td><td>'+safe(x.status)+'</td><td>'+safe(money(x.total))+'</td></tr>').join('')+'</tbody></table>'
      : 'Nenhuma venda encontrada para os filtros selecionados.';
    $('exportSales').disabled = sales.length===0;
  }
  function exportSales() {
    const sales = filteredSales();
    if (!sales.length) return;
    const csvValue = value => {
      const text = String(value ?? '');
      // Impede que conteúdo de clientes seja interpretado como fórmula no Excel/Calc.
      const protectedText = /^[\\s\\u0000-\\u001f]*[=+@-]/.test(text) ? "'"+text : text;
      return '"'+protectedText.replace(/"/g,'""')+'"';
    };
    const lines = [['ID','Data','Situação','Cliente ID','Total','Observações'],...sales.map(s=>[
      s.id,s.created_at,s.status,s.customer_id,Number(s.total||0).toFixed(2),s.notes||''
    ])].map(row=>row.map(csvValue).join(';')).join('\\r\\n');
    const blob = new Blob(['\\uFEFF'+lines],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href=url;anchor.download='jvg-vendas-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function loadSales(page = salesPage) {
    if (loadingSales) return;
    loadingSales = true;
    $('salesPrevious').disabled = true;
    $('salesNext').disabled = true;
    try {
      const data = await request('/api/sales?page='+page);
      salesHistory = Array.isArray(data.sales) ? data.sales : [];
      salesPage = data.page || page;
      salesHasMore = data.hasMore === true;
    } finally {
      loadingSales = false;
      renderSales();
    }
  }
  async function start() {
    try {
      const data=await request('/api/records');
      products=Array.isArray(data.products)?data.products:[];
      services=Array.isArray(data.services)?data.services:[];
      const clients=Array.isArray(data.clients)?data.clients:[];
      $('customer').innerHTML='<option value="">Consumidor não identificado</option>'+clients.filter(x=>x.active && x.isCustomer === true && x.type !== 'EXT').map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join('');
      $('customer').addEventListener('change',()=>{$('customerSummary').textContent=$('customer').selectedOptions[0]?.textContent||'Consumidor não identificado';});
      addItem();await loadSales();loaded=true;writable=true;recalculate();notice('Dados carregados da empresa conectada.');
    } catch(error) {loaded=false;notice(error.message);$('submit').disabled=true;$('addItem').disabled=true;}
  }
  $('salesPrevious').addEventListener('click',()=>loadSales(salesPage-1).catch(error=>notice(error.message)));
  $('salesNext').addEventListener('click',()=>loadSales(salesPage+1).catch(error=>notice(error.message)));
  $('salesSearch').addEventListener('input',renderSales);
  $('salesStatus').addEventListener('change',renderSales);
  $('exportSales').addEventListener('click',exportSales);
  $('addItem').addEventListener('click',addItem);
  $('saleForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!loaded||!writable||$('submit').disabled)return;
    const rows=[...document.querySelectorAll('.sale-row')];
    if(!rows.length||rows.length>100){notice('Informe entre 1 e 100 itens.');return;}
    const items=rows.map(row=>{
      const [kind,id]=row.querySelector('.item').value.split(':');
      return {productId:kind==='product'?id:null,serviceId:kind==='service'?id:null,quantity:Number(row.querySelector('.quantity').value),unitPrice:Number(row.querySelector('.price').value)};
    });
    if(items.some(x=>!Number.isFinite(x.quantity)||x.quantity<=0||x.quantity>999999||!Number.isFinite(x.unitPrice)||x.unitPrice<0||x.unitPrice>999999999||Math.abs(Math.round(x.unitPrice*100)-x.unitPrice*100)>1e-7)){
      notice('Revise as quantidades e os preços dos itens.');return;
    }
    pendingRequestId ||= crypto.randomUUID();
    pendingPayload ||= {requestId:pendingRequestId,customerId:$('customer').value||null,items,notes:$('notes').value};
    busy=true;recalculate();notice('Confirmando venda...');
    try {
      const confirmed = await request('/api/sales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pendingPayload)});
      writable=false;
      pendingRequestId=null;
      pendingPayload=null;
      $('items').replaceChildren();$('notes').value='';
      notice('Venda confirmada: '+confirmed.saleId+'. Atualize a página antes de registrar outra venda.');
      try { await loadSales(); } catch(error) { notice('Venda confirmada: '+confirmed.saleId+'. Não foi possível atualizar o histórico: '+error.message); }
    }catch(error){
      // Reenvios usam exatamente o mesmo payload, mesmo que o usuário altere campos.
      // Os campos ficam bloqueados até a resposta definitiva ou recarga da página.
      $('saleForm').querySelectorAll('input,select,textarea,.remove').forEach(el=>{el.disabled=true;});
      writable=true;
      notice(error.message+' Você pode tentar novamente com os mesmos dados. Os campos foram bloqueados para evitar alterações; para iniciar outra venda, recarregue a página.');
      try { await loadSales(); } catch (_) { /* histórico indisponível */ }
    }finally{busy=false;recalculate();}
  });
  start();
})();