(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
  const notice = message => { $('notice').textContent = message; };
  let products = [], services = [], busy = false;
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(url, init) {
    const response = await fetch(url,{credentials:'same-origin',cache:'no-store',...init});
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }
  function addItem() {
    const row = document.createElement('div');
    row.className = 'sale-row';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin:16px 0;align-items:end';
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
    $('submit').disabled=busy||!rows.length||rows.some(row=>!row.querySelector('.item').value||!(Number(row.querySelector('.quantity').value)>0)||row.querySelector('.price').value===''||Number(row.querySelector('.price').value)<0);
  }
  async function loadSales() {
    const data=await request('/api/sales');
    const sales=Array.isArray(data.sales)?data.sales:[];
    $('sales').innerHTML=sales.length?'<table><thead><tr><th>Data</th><th>Situação</th><th>Total</th></tr></thead><tbody>'+
      sales.map(x=>'<tr><td>'+safe(new Date(x.created_at).toLocaleString('pt-BR'))+'</td><td>'+safe(x.status)+'</td><td>'+safe(money(x.total))+'</td></tr>').join('')+'</tbody></table>':'Nenhuma venda registrada.';
  }
  async function start() {
    try {
      const data=await request('/api/records');
      products=Array.isArray(data.products)?data.products:[];
      services=Array.isArray(data.services)?data.services:[];
      const clients=Array.isArray(data.clients)?data.clients:[];
      $('customer').innerHTML='<option value="">Consumidor não identificado</option>'+clients.filter(x=>x.active).map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join('');
      addItem();await loadSales();notice('Dados carregados da empresa conectada.');
    } catch(error) {notice(error.message);$('submit').disabled=true;$('addItem').disabled=true;}
  }
  $('addItem').addEventListener('click',addItem);
  $('saleForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const items=[...document.querySelectorAll('.sale-row')].map(row=>{
      const [kind,id]=row.querySelector('.item').value.split(':');
      return {productId:kind==='product'?id:null,serviceId:kind==='service'?id:null,quantity:Number(row.querySelector('.quantity').value),unitPrice:Number(row.querySelector('.price').value)};
    });
    busy=true;recalculate();notice('Confirmando venda...');
    try {
      await request('/api/sales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerId:$('customer').value||null,items,notes:$('notes').value})});
      $('items').replaceChildren();addItem();$('notes').value='';await loadSales();notice('Venda confirmada com sucesso.');
    }catch(error){notice(error.message);}finally{busy=false;recalculate();}
  });
  start();
})();