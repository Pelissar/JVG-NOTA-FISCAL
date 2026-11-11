(function(){
  'use strict';
  var docs=[], products=[], suppliers=[], selectedDoc=null;
  var $=function(id){return document.getElementById(id);};
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
  function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function date(value){if(!value)return 'Data não informada';var parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Data não informada':parsed.toLocaleDateString('pt-BR');}
  async function api(url,options){var response=await fetch(url,Object.assign({credentials:'same-origin',cache:'no-store'},options||{}));var body;try{body=await response.json();}catch{body={};}if(!response.ok)throw new Error(body.error||'Não foi possível concluir a operação.');return body;}
  function setStatus(message,error){$('pageStatus').textContent=message;$('pageStatus').classList.toggle('error',!!error);}
  function render(){
    var root=$('documents');
    if(!docs.length){root.innerHTML='<p class="empty-documents">Nenhuma NF-e de entrada importada nesta empresa ainda.</p>';return;}
    root.innerHTML=docs.map(function(doc){
      var received=doc.status==='received';
      var receivedWithoutStock=received&&doc.receivedWithoutStock===true;
      var itemCount=Array.isArray(doc.items)?doc.items.length:0;
      return '<article class="document-row"><div class="document-main"><strong>NF-e '+escapeHtml(doc.invoiceNumber||'—')+' · '+escapeHtml(doc.issuerName||'Fornecedor')+'</strong><small>Emitida em '+date(doc.issuedAt)+' · Série '+escapeHtml(doc.series||'—')+' · chave '+escapeHtml(doc.accessKey)+(doc.carrierName?' · Transportadora: '+escapeHtml(doc.carrierName):'')+'</small></div><div class="document-meta"><b>'+money(doc.total)+'</b><small>'+itemCount+' item(ns) · cStat '+escapeHtml(doc.authorizationStatus)+'</small></div><div class="document-meta total"><span class="status-chip '+(received?(receivedWithoutStock?'recovery':'received'):'')+'">'+(received?(receivedWithoutStock?'Recebida sem estoque':'Recebida'):'Pendente de conferência')+'</span></div><div class="document-actions">'+(received?'<button class="secondary-button" type="button" data-open="'+escapeHtml(doc.id)+'">'+(receivedWithoutStock?'Corrigir estoque':'Ver')+'</button>':'<button class="secondary-button" type="button" data-open="'+escapeHtml(doc.id)+'">Conferir</button>')+'<a class="secondary-button" href="/api/inbound-nfe?xml='+encodeURIComponent(doc.id)+'">XML</a></div></article>';
    }).join('');
  }
  function supplierOptions(selected, doc){
    var options=suppliers.map(function(supplier){return '<option value="'+escapeHtml(supplier.id)+'" '+(supplier.id===selected?'selected':'')+'>'+escapeHtml(supplier.name)+' · '+escapeHtml(supplier.document||'sem CPF/CNPJ')+'</option>';});
    if(selected&&!suppliers.some(function(supplier){return supplier.id===selected;}))options.unshift('<option value="'+escapeHtml(selected)+'" selected>'+escapeHtml((doc&&doc.issuerName)||'Fornecedor vinculado')+' · '+escapeHtml((doc&&doc.issuerDocument)||'cadastro inativo')+'</option>');
    return '<option value="">Selecione fornecedor...</option>'+options.join('');
  }
  function productOptions(selected){
    return '<option value="">Não vincular a produto...</option>'+products.map(function(product){return '<option value="'+escapeHtml(product.id)+'" '+(product.id===selected?'selected':'')+'>'+escapeHtml(product.sku)+' · '+escapeHtml(product.name)+' ('+escapeHtml(product.unit)+')</option>';}).join('');
  }
  function itemMarkup(item){
    var canTrack=!!(item.productId&&products.some(function(product){return product.id===item.productId&&product.tracksStock;}));
    var product=products.find(function(row){return row.id===item.productId;});
    var taxDetails=item.taxes&&Object.keys(item.taxes).length?'<details class="item-tax-details"><summary>Impostos do XML</summary><pre>'+escapeHtml(JSON.stringify(item.taxes,null,2))+'</pre></details>':'<small class="stock-hint">XML sem grupo de impostos detalhado neste item.</small>';
    return '<article class="review-item" data-line="'+escapeHtml(item.lineNumber)+'"><div class="review-item-main"><strong>'+escapeHtml(item.description)+'</strong><small>Item '+escapeHtml(item.lineNumber)+' · código fornecedor '+escapeHtml(item.supplierCode||'—')+' · GTIN '+escapeHtml(item.gtin||'sem GTIN')+'</small>'+taxDetails+'</div><label class="review-field"><span>Produto cadastrado</span><select name="productId">'+productOptions(item.productId)+'</select></label><div class="review-item-meta">'+escapeHtml(item.quantity)+' '+escapeHtml(item.unit)+'<small>Qtd. recebida</small></div><div class="review-item-meta">'+money(item.total)+'<small>Total do item</small></div><label class="stock-choice"><input type="checkbox" name="trackStock" '+(item.trackStock&&canTrack?'checked':'')+' '+(canTrack?'':'disabled')+'><span>Lançar no estoque</span></label><small class="stock-hint">'+(product&&!product.tracksStock?'Produto sem controle de estoque':!item.productId?'Associe um produto':'')+'</small></article>';
  }
  function showFiscalData(doc){
    var root=$('fiscalDataReview'), fiscal=doc.fiscalData||{}, info=fiscal.infNFe||{}, totals=info.total||{};
    var taxes=(doc.items||[]).filter(function(item){return item.taxes&&Object.keys(item.taxes).length;});
    root.innerHTML='<div class="fiscal-data-heading"><strong>Dados fiscais importados do XML</strong><span>Valores e tributos são exibidos como constam no documento; o ERP não recalcula.</span></div>'+
      '<div class="fiscal-data-chips"><span>Emitente · '+escapeHtml(doc.issuerDocument)+'</span><span>Destinatário · '+escapeHtml(doc.destinationDocument||'—')+'</span><span>Itens com imposto detalhado · '+taxes.length+'</span><span>Transportadora · '+escapeHtml(doc.carrierName||'Não informada')+'</span></div>'+
      '<details><summary>Tributos e totais declarados no XML</summary><pre>'+escapeHtml(JSON.stringify(totals,null,2))+'</pre></details>'+
      '<details><summary>Todos os campos estruturados da NF-e e do protocolo</summary><pre>'+escapeHtml(JSON.stringify(fiscal,null,2))+'</pre></details>';
  }
  async function openReview(id){
    selectedDoc=docs.find(function(doc){return doc.id===id;});
    if(!selectedDoc)return;
    var received=selectedDoc.status==='received';
    var recoverable=received&&selectedDoc.receivedWithoutStock===true;
    var locked=received&&!recoverable;
    $('reviewHeading').textContent=recoverable?'Corrigir entrada da NF-e '+selectedDoc.invoiceNumber:'Conferir NF-e '+selectedDoc.invoiceNumber;
    $('reviewSummary').textContent=selectedDoc.issuerName+' · '+date(selectedDoc.issuedAt)+' · '+money(selectedDoc.total);
    $('supplierSelect').innerHTML=supplierOptions(selectedDoc.supplierId,selectedDoc);
    $('authorizationSummary').textContent=recoverable?'Esta NF-e foi marcada como recebida, mas não gerou movimentos de estoque. Associe o produto, marque o lançamento e confirme novamente.':'Protocolo informado no XML: cStat '+selectedDoc.authorizationStatus+' — '+(selectedDoc.authorizationReason||'Autorização de uso')+'. Assinatura ainda precisa ser conferida no portal oficial.';
    $('authorizationSummary').classList.toggle('recovery',recoverable);
    $('fiscalDataReview').innerHTML='<p>Carregando dados fiscais do XML...</p>';
    $('reviewItems').innerHTML=(selectedDoc.items||[]).map(itemMarkup).join('');
    $('officialStatus').checked=false;
    $('officialStatus').disabled=locked;
    $('supplierSelect').disabled=locked;
    $('reviewItems').querySelectorAll('select,input').forEach(function(input){input.disabled=input.disabled||locked;});
    $('saveReviewButton').hidden=locked;
    $('receiveButton').hidden=locked;
    $('receiveButton').textContent=recoverable?'Reabrir e lançar no estoque':'Confirmar entrada no estoque';
    $('closeReview').textContent='Fechar';
    $('reviewCard').hidden=false;
    $('reviewCard').scrollIntoView({behavior:'smooth',block:'start'});
    try{
      var response=await api('/api/inbound-nfe?id='+encodeURIComponent(id));
      if(!selectedDoc||selectedDoc.id!==id)return;
      selectedDoc=response.document;
      $('supplierSelect').innerHTML=supplierOptions(selectedDoc.supplierId,selectedDoc);
      $('reviewItems').innerHTML=(selectedDoc.items||[]).map(itemMarkup).join('');
      showFiscalData(selectedDoc);
      var updatedReceived=selectedDoc.status==='received';
      var updatedRecoverable=updatedReceived&&selectedDoc.receivedWithoutStock===true;
      var updatedLocked=updatedReceived&&!updatedRecoverable;
      $('authorizationSummary').textContent=updatedRecoverable?'Esta NF-e foi marcada como recebida, mas não gerou movimentos de estoque. Associe o produto, marque o lançamento e confirme novamente.':'Protocolo informado no XML: cStat '+selectedDoc.authorizationStatus+' — '+(selectedDoc.authorizationReason||'Autorização de uso')+'. Assinatura ainda precisa ser conferida no portal oficial.';
      $('authorizationSummary').classList.toggle('recovery',updatedRecoverable);
      $('supplierSelect').disabled=updatedLocked;
      $('reviewItems').querySelectorAll('select,input').forEach(function(input){input.disabled=input.disabled||updatedLocked;});
      $('officialStatus').disabled=updatedLocked;
      $('saveReviewButton').hidden=updatedLocked;
      $('receiveButton').hidden=updatedLocked;
      $('receiveButton').textContent=updatedRecoverable?'Reabrir e lançar no estoque':'Confirmar entrada no estoque';
    }catch(error){$('fiscalDataReview').innerHTML='<p class="error">Não foi possível abrir os dados completos do XML: '+escapeHtml(error.message)+'</p>';}
  }
  async function load(){
    setStatus('Carregando lançamentos...');
    try{
      var result=await Promise.all([api('/api/inbound-nfe'),api('/api/records?scope=products'),api('/api/records?scope=clients')]);
      docs=Array.isArray(result[0].documents)?result[0].documents:[];
      products=(result[1].products||[]).filter(function(product){return product.active;});
      suppliers=(result[2].clients||[]).filter(function(person){return person.active&&person.isSupplier;});
      setStatus(docs.length?docs.length+' NF-e(s) nesta empresa.':'Nenhum lançamento encontrado.');
      render();
    }catch(error){
      setStatus(error.message+' Se a migration fiscal/histórico ainda não foi aplicada, aplique supabase/migrations/20261110_jvg_fiscal_document_history.sql no Supabase e atualize.',true);
      $('documents').innerHTML='';
    }
  }
  $('uploadForm').addEventListener('submit',async function(event){
    event.preventDefault();
    var file=$('xmlFile').files&&$('xmlFile').files[0];
    if(!file){$('uploadStatus').textContent='Selecione o XML original.';$('uploadStatus').classList.add('error');return;}
    var data=new FormData();data.append('xml',file);
    $('uploadButton').disabled=true;$('uploadStatus').classList.remove('error');$('uploadStatus').textContent='Lendo XML e conferindo chave, protocolo e destinatário...';
    try{
      var result=await api('/api/inbound-nfe',{method:'POST',body:data});
      $('uploadStatus').textContent='XML analisado. '+result.itemCount+' item(ns) importado(s). '+(result.supplierCreated?'Fornecedor cadastrado e vinculado pelo CPF/CNPJ.':result.supplierMatched?'Fornecedor existente vinculado pelo CPF/CNPJ.':'Fornecedor precisa ser conferido.');
      $('xmlFile').value='';
      await load();
      if(result.id)openReview(result.id);
    }catch(error){$('uploadStatus').textContent=error.message;$('uploadStatus').classList.add('error');}
    finally{$('uploadButton').disabled=false;}
  });
  $('documents').addEventListener('click',function(event){var button=event.target.closest('[data-open]');if(button)openReview(button.dataset.open);});
  $('reviewItems').addEventListener('change',function(event){
    if(event.target.name!=='productId')return;
    var row=event.target.closest('[data-line]'),checkbox=row&&row.querySelector('[name="trackStock"]');
    var product=products.find(function(item){return item.id===event.target.value;});
    if(checkbox){checkbox.disabled=!product||!product.tracksStock;checkbox.checked=!!product&&product.tracksStock;}
  });
  $('closeReview').addEventListener('click',function(){$('reviewCard').hidden=true;selectedDoc=null;});
  $('reloadButton').addEventListener('click',load);
  $('reviewForm').addEventListener('submit',async function(event){
    event.preventDefault();
    if(!selectedDoc)return;
    var receive=event.submitter&&event.submitter.dataset.receive==='true';
    var supplierId=$('supplierSelect').value||null;
    var items=Array.from($('reviewItems').querySelectorAll('[data-line]')).map(function(row){
      return {lineNumber:Number(row.dataset.line),productId:row.querySelector('[name="productId"]').value||null,trackStock:row.querySelector('[name="trackStock"]').checked};
    });
    if(receive&&!$('officialStatus').checked){setStatus('Marque que conferiu a autorização no portal oficial da NF-e.',true);return;}
    if(receive&&!items.some(function(item){return item.trackStock;})){setStatus('Marque “Lançar no estoque” em pelo menos um item. Se quiser apenas guardar os vínculos, use “Salvar conferência”.',true);return;}
    if(receive&&items.some(function(item){return item.trackStock&&!item.productId;})){setStatus('Associe um produto a cada item marcado para movimentar o estoque.',true);return;}
    var buttons=[$('saveReviewButton'),$('receiveButton')];buttons.forEach(function(button){button.disabled=true;});
    try{
      if(receive&&selectedDoc.receivedWithoutStock===true){
        await api('/api/inbound-nfe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reopen-empty',id:selectedDoc.id})});
      }
      await api('/api/inbound-nfe',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selectedDoc.id,supplierId:supplierId,items:items})});
      if(receive){
        var confirmation=await api('/api/inbound-nfe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm',id:selectedDoc.id,checkedOfficialStatus:true})});
        var stockLines=confirmation.result&&Number(confirmation.result.stockLines||0);
        $('uploadStatus').textContent='NF-e recebida. '+stockLines+' item(ns) geraram movimentos de estoque vinculados à chave.';
      }else $('uploadStatus').textContent='Conferência salva sem movimentar estoque.';
      $('reviewCard').hidden=true;selectedDoc=null;await load();
    }catch(error){setStatus(error.message,true);}
    finally{buttons.forEach(function(button){button.disabled=false;});}
  });
  load();
})();
