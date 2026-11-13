(function(){
  'use strict';
  var docs=[], products=[], suppliers=[], selectedDoc=null;
  var $=function(id){return document.getElementById(id);};
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
  function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function date(value){if(!value)return 'Data não informada';var parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Data não informada':parsed.toLocaleDateString('pt-BR');}
  async function api(url,options){var response=await fetch(url,Object.assign({credentials:'same-origin',cache:'no-store'},options||{}));var body;try{body=await response.json();}catch{body={};}if(!response.ok)throw new Error(body.error||'Não foi possível concluir a operação.');return body;}
  function setStatus(message,error){$('pageStatus').textContent=message;$('pageStatus').classList.toggle('error',!!error);}
  function supplierOptions(selected, doc){
    var options=suppliers.map(function(supplier){return '<option value="'+escapeHtml(supplier.id)+'" '+(supplier.id===selected?'selected':'')+'>'+escapeHtml(supplier.name)+' · '+escapeHtml(supplier.document||'sem CPF/CNPJ')+'</option>';});
    if(selected&&!suppliers.some(function(supplier){return supplier.id===selected;}))options.unshift('<option value="'+escapeHtml(selected)+'" selected>'+escapeHtml((doc&&doc.issuerName)||'Fornecedor vinculado')+' · '+escapeHtml((doc&&doc.issuerDocument)||'cadastro inativo')+'</option>');
    return '<option value="">Selecione fornecedor...</option>'+options.join('');
  }
  function productOptions(selected){
    return '<option value="">Não vincular a produto...</option>'+products.map(function(product){return '<option value="'+escapeHtml(product.id)+'" '+(product.id===selected?'selected':'')+'>'+escapeHtml(product.sku)+' · '+escapeHtml(product.name)+' ('+escapeHtml(product.unit)+')</option>';}).join('');
  }
  function collectReviewItems(){
    return Array.from($('reviewItems').querySelectorAll('[data-line]')).map(function(row){
      return {
        lineNumber:Number(row.dataset.line),
        productId:row.querySelector('[name="productId"]').value||null,
        trackStock:row.querySelector('[name="trackStock"]').checked
      };
    });
  }
  async function persistReviewDraft(items){
    if(!selectedDoc)throw new Error('Abra uma NF-e antes de salvar a conferência.');
    if(selectedDoc.status==='cancelled')throw new Error('Este lançamento está cancelado no ERP.');
    if(selectedDoc.receivedWithoutStock===true){
      await api('/api/inbound-nfe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reopen-empty',id:selectedDoc.id})});
      selectedDoc.status='draft';
      selectedDoc.receivedWithoutStock=false;
    }
    var nextItems=Array.isArray(items)?items:collectReviewItems();
    var supplierId=$('supplierSelect').value||null;
    await api('/api/inbound-nfe',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selectedDoc.id,supplierId:supplierId,items:nextItems})});
    var byLine=new Map(nextItems.map(function(item){return [Number(item.lineNumber),item];}));
    selectedDoc.items=(selectedDoc.items||[]).map(function(item){
      var change=byLine.get(Number(item.lineNumber));
      return change?Object.assign({},item,change):item;
    });
    selectedDoc.supplierId=supplierId||'';
    selectedDoc.status='draft';
    selectedDoc.receivedWithoutStock=false;
    return nextItems;
  }
  function xmlObject(value){if(Array.isArray(value))return xmlObject(value[0]);return value&&typeof value==='object'?value:{};}
  function xmlValue(parent,key){var value=xmlObject(parent)[key];return typeof value==='string'||typeof value==='number'?String(value).trim():'';}
  function xmlMoney(value){var amount=Number(value);return Number.isFinite(amount)?money(amount):String(value||'—');}
  function taxId(value){var digits=String(value||'').replace(/\D/g,'');if(digits.length===14)return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(digits.length===11)return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return value||'Não informado';}
  function postal(value){var digits=String(value||'').replace(/\D/g,'');return digits.length===8?digits.replace(/^(\d{5})(\d{3})$/,'$1-$2'):value||'';}
  function addressText(address){address=xmlObject(address);var line=[xmlValue(address,'xLgr'),xmlValue(address,'nro'),xmlValue(address,'xCpl')].filter(Boolean).join(', ');var city=[xmlValue(address,'xBairro'),xmlValue(address,'xMun'),xmlValue(address,'UF')].filter(Boolean).join(' · ');var zip=postal(xmlValue(address,'CEP'));return [line,city,zip].filter(Boolean).join(' · ')||'Endereço não informado no XML';}
  function partyCard(title,person,addressKey,docFallback){person=xmlObject(person);var address=xmlObject(person[addressKey]);var name=xmlValue(person,'xNome')||title;var document=taxId(xmlValue(person,'CNPJ')||xmlValue(person,'CPF')||docFallback);var fields=[['CNPJ / CPF',document],['Inscrição estadual',xmlValue(person,'IE')||'Não informada'],['E-mail',xmlValue(person,'email')||'Não informado'],['Telefone',xmlValue(address,'fone')||'Não informado']];return '<article class="party-detail-card"><div class="party-detail-heading"><span>'+escapeHtml(title)+'</span><strong>'+escapeHtml(name)+'</strong>'+(xmlValue(person,'xFant')?'<small>'+escapeHtml(xmlValue(person,'xFant'))+'</small>':'')+'</div><p>'+escapeHtml(addressText(address))+'</p><div class="party-detail-fields">'+fields.map(function(field){return '<div><small>'+escapeHtml(field[0])+'</small><strong>'+escapeHtml(field[1])+'</strong></div>';}).join('')+'</div></article>';}
  var taxFieldNames={orig:'Origem da mercadoria',CST:'Situação tributária',CSOSN:'Situação tributária do Simples Nacional',modBC:'Modalidade da base de cálculo',vBC:'Base de cálculo',pRedBC:'Redução da base (%)',pICMS:'Alíquota ICMS (%)',vICMS:'ICMS',vICMSDeson:'ICMS desonerado',vBCST:'Base de cálculo ICMS-ST',pMVAST:'Margem de valor agregado (%)',pRedBCST:'Redução da base ICMS-ST (%)',pICMSST:'Alíquota ICMS-ST (%)',vICMSST:'ICMS-ST',vBCSTRet:'Base ICMS-ST retida',vICMSSTRet:'ICMS-ST retido',vFCP:'FCP',vFCPST:'FCP-ST',vIPI:'IPI',pIPI:'Alíquota IPI (%)',vPIS:'PIS',pPIS:'Alíquota PIS (%)',vCOFINS:'Cofins',pCOFINS:'Alíquota Cofins (%)',vII:'Imposto de Importação',vBCISSQN:'Base ISSQN',vISSQN:'ISSQN',pISSQN:'Alíquota ISSQN (%)',vTotTrib:'Tributos aproximados informados no XML',cEnq:'Enquadramento informado',indTot:'Composição do total da NF-e'};
  var taxGroupNames={ICMS:'ICMS',IPI:'IPI',II:'Imposto de Importação',PIS:'PIS',PISST:'PIS-ST',COFINS:'Cofins',COFINSST:'Cofins-ST',ISSQN:'ISSQN',ICMSUFDest:'ICMS da UF de destino'};
  function scalarRows(value,path,rows){if(Array.isArray(value)){value.forEach(function(item){scalarRows(item,path,rows);});return;}if(value&&typeof value==='object'){Object.keys(value).forEach(function(key){if(key.indexOf('@_')===0)return;scalarRows(value[key],path.concat(key),rows);});return;}if(value!==undefined&&value!==null&&String(value)!=='')rows.push({key:path[path.length-1]||'',value:String(value)});}
  function originText(value){var labels={'0':'Nacional','1':'Importação direta','2':'Adquirida no mercado interno','3':'Nacional com conteúdo de importação superior a 40%','4':'Produção conforme processo produtivo básico','5':'Nacional com conteúdo de importação de até 40%','6':'Importação direta sem similar nacional','7':'Adquirida no mercado interno sem similar nacional','8':'Nacional com conteúdo de importação superior a 70%'};return labels[String(value)]||'Não informado no XML';}
  function fiscalProductData(item){var rows=[['NCM',item.ncm||'Não informado'],['CEST',item.cest||'Não informado'],['CFOP da compra',item.cfop||'Não informado'],['Origem da mercadoria',originText(item.origin)],['GTIN / código de barras',item.gtin&&item.gtin!=='SEMGTIN'?item.gtin:'Sem GTIN no XML']];return '<div class="product-fiscal-grid">'+rows.map(function(field){return '<div><small>'+escapeHtml(field[0])+'</small><strong>'+escapeHtml(field[1])+'</strong></div>';}).join('')+'</div>';}
  function catalogProductData(product,item){
    if(!product)return '';
    function compare(label,fromXml,fromCatalog){
      var xml=String(fromXml||'').trim()||'Não informado no XML',catalog=String(fromCatalog||'').trim()||'Não cadastrado';
      var mismatch=fromXml&&fromCatalog&&String(fromXml).trim().toUpperCase()!==String(fromCatalog).trim().toUpperCase();
      return '<div class="catalog-product-value'+(mismatch?' mismatch':'')+'"><small>'+escapeHtml(label)+(mismatch?' · conferir diferença':'')+'</small><strong><span>XML: '+escapeHtml(xml)+'</span><span>Cadastro: '+escapeHtml(catalog)+'</span></strong></div>';
    }
    var originCatalog=product.origin?originText(product.origin):'Não cadastrado';
    return '<section class="catalog-product-review"><div class="catalog-product-heading"><strong>Comparação com o produto cadastrado</strong><span>Revise diferenças antes de concluir a entrada.</span></div><div class="catalog-product-grid">'+
      '<div><small>SKU interno</small><strong>'+escapeHtml(product.sku||'—')+'</strong></div><div><small>Descrição no cadastro</small><strong>'+escapeHtml(product.name||'—')+'</strong></div><div><small>Categoria</small><strong>'+escapeHtml(product.category||'Não informada')+'</strong></div><div><small>Unidade no cadastro</small><strong>'+escapeHtml(product.unit||'—')+'</strong></div>'+compare('NCM',item.ncm,product.ncm)+compare('CEST',item.cest,product.cest)+compare('GTIN',item.gtin==='SEMGTIN'?'':item.gtin,product.gtin==='SEM GTIN'?'':product.gtin)+compare('Origem da mercadoria',item.origin?originText(item.origin):'',originCatalog)+
      '<div><small>Custo unitário atual</small><strong>'+money(product.cost)+'</strong></div><div><small>Preço de venda atual</small><strong>'+money(product.price)+'</strong></div><div><small>Saldo atual no estoque</small><strong>'+String(product.stock||0)+' '+escapeHtml(product.unit||'unidades')+'</strong></div><div><small>Controle de estoque</small><strong>'+(product.tracksStock?'Ativo':'Desativado')+'</strong></div></div></section>';
  }
  function itemMarkup(item){
    var product=products.find(function(row){return row.id===item.productId;});
    var canTrack=!!(product&&product.tracksStock);
    var ncm=/^\d{8}$/.test(String(item.ncm||''))?String(item.ncm):'';
    var cest=/^\d{7}$/.test(String(item.cest||''))?String(item.cest):'';
    var xmlOrigin=String(item.origin||'');
    var hasCatalogGtin=!!product&&product.gtin&&product.gtin!=='SEM GTIN';
    var canImportClassification=!!product&&((!product.ncm&&ncm)||(!product.cest&&cest)||(!product.origin&&xmlOrigin)||(!hasCatalogGtin&&item.gtin&&item.gtin!=='SEMGTIN'));
    var classificationImport=canImportClassification?'<button class="secondary-button product-classification-import" type="button" data-fill-classification>Preencher dados fiscais ausentes com o XML</button><small class="classification-source-note">Ação opcional: confira os dados do fornecedor e valide a classificação com a contabilidade.</small>':'';
    var createProduct='<button class="secondary-button product-create-trigger" type="button" data-create-product'+(item.productId?' hidden':'')+'>Cadastrar produto com dados desta nota</button><div class="product-create-panel" hidden><div class="product-create-heading"><strong>Novo produto para o estoque</strong><span>Os campos fiscais vêm do XML. Confira antes de salvar.</span></div><div class="product-create-grid">'+
      '<label class="review-field"><span>SKU interno *</span><input name="newProductSku" maxlength="40" value="'+escapeHtml(String(item.supplierCode||'').slice(0,40))+'"></label>'+
      '<label class="review-field"><span>Descrição *</span><input name="newProductName" maxlength="160" value="'+escapeHtml(item.description||'')+'"></label>'+
      '<label class="review-field"><span>Unidade de compra *</span><input name="newProductUnit" maxlength="8" value="'+escapeHtml(item.unit||'UN')+'"></label>'+
      '<label class="review-field"><span>GTIN / código de barras</span><input name="newProductGtin" maxlength="20" value="'+escapeHtml(item.gtin==='SEMGTIN'?'':item.gtin||'')+'" placeholder="Sem GTIN"></label>'+
      '<label class="review-field"><span>NCM (XML)</span><input name="newProductNcm" maxlength="8" inputmode="numeric" value="'+escapeHtml(ncm)+'" placeholder="Não informado"></label>'+
      '<label class="review-field"><span>CEST (XML)</span><input name="newProductCest" maxlength="7" inputmode="numeric" value="'+escapeHtml(cest)+'" placeholder="Não informado"></label>'+
      '<label class="review-field"><span>Origem da mercadoria (XML)</span><select name="newProductOrigin"><option value="">Não informada</option>'+['0','1','2','3','4','5','6','7','8'].map(function(value){return '<option value="'+value+'" '+(String(item.origin||'')===value?'selected':'')+'>'+escapeHtml(value+' · '+originText(value))+'</option>';}).join('')+'</select></label>'+
      '<label class="review-field"><span>Categoria</span><input name="newProductCategory" maxlength="80" placeholder="Opcional"></label>'+
      '<label class="review-field"><span>Custo unitário conforme XML (R$)</span><input name="newProductCostPrice" type="number" min="0" step="0.0001" value="'+Number(item.unitPrice||0).toFixed(4)+'"></label>'+
      '<label class="review-field"><span>Preço de venda (R$) *</span><input name="newProductSalePrice" type="number" min="0" step="0.01" value="0.00"></label></div><label class="stock-choice create-stock-choice"><input name="newProductTracksStock" type="checkbox" checked><span>Controlar este produto no estoque e lançar a quantidade desta nota</span></label><div class="product-create-actions"><button class="primary-button" type="button" data-save-product>Salvar produto, vincular e preparar entrada</button><button class="secondary-button" type="button" data-cancel-product>Cancelar</button></div></div>';
    var stockControl=!item.productId?'<small class="stock-hint">Cadastre ou selecione o produto para habilitar a entrada.</small>':!canTrack?'<button class="secondary-button enable-stock-button" type="button" data-enable-stock>Habilitar controle de estoque neste produto</button>':'';
    var quantity=item.quantity||0,unit=item.unit||'';
    var values=[['Quantidade comprada',String(quantity)+' '+unit],['Valor unitário',money(item.unitPrice)],['Desconto',money(item.discount||0)],['Frete do item',money(item.freight||0)],['Seguro',money(item.insurance||0)],['Outras despesas',money(item.otherAmount||0)],['Total do produto no XML',money(item.total)]];
    if(item.taxQuantity!==null&&item.taxQuantity!==undefined)values.splice(1,0,['Quantidade tributável',String(item.taxQuantity)+' '+(item.taxUnit||unit)]);
    if(item.taxUnitPrice!==null&&item.taxUnitPrice!==undefined)values.splice(2,0,['Valor unitário tributável',money(item.taxUnitPrice)]);
    return '<article class="review-item" data-line="'+escapeHtml(item.lineNumber)+'"><header class="review-item-title"><div><span class="item-number">Item '+escapeHtml(item.lineNumber)+'</span><strong>'+escapeHtml(item.description)+'</strong><small>Referência do fornecedor: '+escapeHtml(item.supplierCode||'Não informada')+'</small></div><strong class="item-total">'+money(item.total)+'</strong></header><div class="item-review-grid"><label class="review-field product-link-field"><span>Produto vinculado no seu estoque</span><select name="productId">'+productOptions(item.productId)+'</select></label>'+values.map(function(field){return '<div class="item-value"><small>'+escapeHtml(field[0])+'</small><strong>'+escapeHtml(field[1])+'</strong></div>';}).join('')+'</div>'+fiscalProductData(item)+catalogProductData(product,item)+'<label class="stock-choice item-stock-choice"><input type="checkbox" name="trackStock" '+(item.trackStock&&canTrack?'checked':'')+' '+(canTrack?'':'disabled')+'><span>Incluir '+escapeHtml(String(quantity)+' '+unit)+' no estoque ao confirmar</span></label>'+stockControl+createProduct+classificationImport+itemTaxMarkup(item.taxes)+'</article>';
  }
  function totalRowsMarkup(title,group){group=xmlObject(group);var labels={vBC:'Base de cálculo ICMS',vICMS:'ICMS',vICMSDeson:'ICMS desonerado',vFCP:'FCP',vBCST:'Base ICMS-ST',vST:'ICMS-ST',vFCPST:'FCP-ST',vProd:'Produtos',vFrete:'Frete',vSeg:'Seguro',vDesc:'Descontos',vII:'Imposto de Importação',vIPI:'IPI',vIPIDevol:'IPI devolvido',vPIS:'PIS',vCOFINS:'Cofins',vOutro:'Outras despesas',vNF:'Total da NF-e',vTotTrib:'Tributos aproximados informados'};var rows=Object.keys(labels).filter(function(key){return group[key]!==undefined&&group[key]!==null&&String(group[key])!=='';});if(!rows.length)return '';return '<section class="invoice-tax-total"><h4>'+escapeHtml(title)+'</h4><div class="tax-value-grid">'+rows.map(function(key){return taxValueMarkup(key,group[key]);}).join('')+'</div></section>';}
  function render(){
    var root=$('documents'),activeDocs=docs.filter(function(doc){return doc.status!=='cancelled';});
    if(!activeDocs.length){root.innerHTML='<p class="empty-documents">Nenhuma NF-e pendente ou recebida nesta empresa. Para lançar novamente uma nota cancelada, importe o XML outra vez.</p>';return;}
    root.innerHTML=activeDocs.map(function(doc){var received=doc.status==='received',recovery=received&&doc.receivedWithoutStock===true;var status=received?(recovery?'Recebida sem estoque':'Entrada concluída'):'Pendente de conferência';var statusClass=received?(recovery?'recovery':'received'):'';return '<article class="document-row"><div class="document-main"><strong>NF-e '+escapeHtml(doc.invoiceNumber||'—')+' · '+escapeHtml(doc.issuerName||'Fornecedor')+'</strong><small>Emitida em '+date(doc.issuedAt)+' · Série '+escapeHtml(doc.series||'—')+' · Fornecedor '+escapeHtml(taxId(doc.issuerDocument))+(doc.carrierName?' · Transporte: '+escapeHtml(doc.carrierName):'')+'</small></div><div class="document-meta"><b>'+money(doc.total)+'</b><small>'+(Array.isArray(doc.items)?doc.items.length:0)+' produto(s) · autorização consta no XML</small></div><div class="document-meta total"><span class="status-chip '+statusClass+'">'+status+'</span></div><div class="document-actions"><button class="secondary-button" type="button" data-open="'+escapeHtml(doc.id)+'">'+(recovery?'Corrigir estoque':received?'Ver entrada':'Conferir nota')+'</button><a class="secondary-button" href="/api/inbound-nfe?xml='+encodeURIComponent(doc.id)+'">Baixar XML</a></div></article>';}).join('');
  }
  function showFiscalData(doc){
    var root=$('fiscalDataReview'),fiscal=xmlObject(doc.fiscalData),info=xmlObject(fiscal.infNFe),issuer=xmlObject(info.emit),destination=xmlObject(info.dest),totals=xmlObject(info.total),transport=xmlObject(info.transp),carrier=xmlObject(transport.transporta);
    var items=doc.items||[],detailedCount=items.filter(function(item){return item.taxes&&Object.keys(item.taxes).length;}).length;
    var icmsTotals=xmlObject(totals.ICMSTot),issTotals=xmlObject(totals.ISSQNtot);
    var summary='<div class="invoice-summary-grid"><div><small>Nota fiscal</small><strong>'+escapeHtml(doc.invoiceNumber)+' · Série '+escapeHtml(doc.series||'—')+'</strong></div><div><small>Emissão</small><strong>'+escapeHtml(date(doc.issuedAt))+'</strong></div><div><small>Valor total</small><strong>'+money(doc.total)+'</strong></div><div><small>Autorização informada no XML</small><strong>'+escapeHtml((doc.authorizationReason||'Uso autorizado').replace(/^\d+\s*[-–—:]?\s*/,''))+'</strong></div></div>';
    var parts='<div class="party-detail-grid">'+partyCard('Fornecedor emitente',issuer,'enderEmit',doc.issuerDocument)+partyCard('Sua empresa · destinatária',destination,'enderDest',doc.destinationDocument)+(Object.keys(carrier).length?partyCard('Transportadora',carrier,'',doc.carrierDocument):'<article class="party-detail-card"><div class="party-detail-heading"><span>Transporte</span><strong>Transportadora não informada no XML</strong></div><p>Modalidade: '+escapeHtml(({0:'Por conta do emitente',1:'Por conta do destinatário',2:'Por conta de terceiros',3:'Transporte próprio do emitente',4:'Transporte próprio do destinatário',9:'Sem ocorrência de transporte'})[xmlValue(transport,'modFrete')]||'Não informada')+'</p></article>')+'</div>';
    var packageData=xmlObject(transport.vol),packageRows=Array.isArray(packageData)?packageData:[packageData];
    var transportSummary=packageRows.filter(function(row){return Object.keys(xmlObject(row)).length;}).map(function(row){row=xmlObject(row);return [xmlValue(row,'qVol')&&('Volumes: '+xmlValue(row,'qVol')),xmlValue(row,'esp')&&('Espécie: '+xmlValue(row,'esp')),xmlValue(row,'marca')&&('Marca: '+xmlValue(row,'marca')),xmlValue(row,'nVol')&&('Identificação: '+xmlValue(row,'nVol')),xmlValue(row,'pesoB')&&('Peso bruto: '+xmlValue(row,'pesoB')+' kg'),xmlValue(row,'pesoL')&&('Peso líquido: '+xmlValue(row,'pesoL')+' kg')].filter(Boolean).join(' · ');}).filter(Boolean).join(' | ');
    root.innerHTML='<div class="fiscal-data-heading"><strong>Conferência completa da nota e das partes</strong><span>Dados copiados do XML autorizado. O ERP exibe os valores informados pelo fornecedor e não recalcula impostos. O XML original pode ser baixado na lista de notas.</span></div>'+summary+parts+'<section class="invoice-totals"><div class="fiscal-data-heading"><strong>Impostos e totais da NF-e</strong><span>Valores declarados no documento, sem cálculo ou ajuste pelo ERP.</span></div>'+totalRowsMarkup('ICMS, PIS, Cofins e totais dos produtos',icmsTotals)+totalRowsMarkup('IBS e CBS informados',xmlObject(totals.IBSCBSTot))+totalRowsMarkup('Imposto Seletivo, quando informado',xmlObject(totals.ISTot))+totalRowsMarkup('ISSQN, quando informado',issTotals)+(transportSummary?'<section class="invoice-tax-total"><h4>Volumes e transporte</h4><p>'+escapeHtml(transportSummary)+'</p></section>':'')+'</section><p class="tax-source-note">Impostos detalhados em '+detailedCount+' de '+items.length+' item(ns). Os valores e descrições são transcritos do XML e não representam recálculo fiscal.</p>';
  }
  function applyReviewState(doc){
    var received=doc.status==='received';
    if(doc.status==='cancelled'){$('reviewCard').hidden=true;setStatus('Este lançamento está cancelado e bloqueado. Importe o XML novamente para iniciar outro lançamento.',true);return;}
    var recoverable=received&&doc.receivedWithoutStock===true,locked=received&&!recoverable;
    $('reviewHeading').textContent=recoverable?'Corrigir entrada da NF-e '+doc.invoiceNumber:'Conferir NF-e '+doc.invoiceNumber;
    $('authorizationSummary').textContent=recoverable?'Esta nota foi marcada como recebida, mas ainda não gerou movimento de estoque. Associe o produto e conclua a entrada.':'O XML informa: '+(doc.authorizationReason||'uso autorizado').replace(/^\d+\s*[-–—:]?\s*/,'')+'. Confira a chave e a autorização no portal oficial da SEFAZ; esta tela não valida a assinatura digital.';
    $('authorizationSummary').classList.toggle('recovery',recoverable);$('officialStatus').disabled=locked;$('supplierSelect').disabled=locked;
    $('reviewItems').querySelectorAll('select,input').forEach(function(input){input.disabled=input.disabled||locked;});
    $('saveReviewButton').hidden=locked;$('receiveButton').hidden=locked;
    $('saveReviewButton').textContent=recoverable?'Reabrir e salvar conferência':'Salvar conferência';$('receiveButton').textContent=recoverable?'Reabrir e concluir entrada':'Confirmar entrada no estoque';
    $('cancelEntryButton').textContent=received?'Estornar entrada no estoque':'Cancelar lançamento no ERP';
    $('cancelEntryDescription').textContent=received?'Será criado um movimento inverso mantendo os movimentos originais e o XML. O estorno depende do saldo atual e não cancela a nota na SEFAZ.':'O lançamento será cancelado no ERP e o XML continuará no histórico. Nenhum movimento de estoque será criado.';
  }
  function partyCard(title,person,addressKey,docFallback){
    person=xmlObject(person);var address=addressKey?xmlObject(person[addressKey]):person;var name=xmlValue(person,'xNome')||title;var document=taxId(xmlValue(person,'CNPJ')||xmlValue(person,'CPF')||docFallback);
    var location=addressKey?addressText(address):[xmlValue(person,'xEnder'),xmlValue(person,'xMun'),xmlValue(person,'UF')].filter(Boolean).join(' · ')||'Endereço não informado no XML';
    var fields=[['CNPJ / CPF',document],['Inscrição estadual',xmlValue(person,'IE')||'Não informada'],['E-mail',xmlValue(person,'email')||'Não informado'],['Telefone',xmlValue(address,'fone')||xmlValue(person,'fone')||'Não informado']];
    return '<article class="party-detail-card"><div class="party-detail-heading"><span>'+escapeHtml(title)+'</span><strong>'+escapeHtml(name)+'</strong>'+(xmlValue(person,'xFant')?'<small>'+escapeHtml(xmlValue(person,'xFant'))+'</small>':'')+'</div><p>'+escapeHtml(location)+'</p><div class="party-detail-fields">'+fields.map(function(field){return '<div><small>'+escapeHtml(field[0])+'</small><strong>'+escapeHtml(field[1])+'</strong></div>';}).join('')+'</div></article>';
  }
  function taxValueMarkup(key,value,group){
    var csosn={'101':'Simples Nacional com permissão de crédito','102':'Simples Nacional sem crédito de ICMS ao destinatário','103':'Isenção do Simples Nacional dentro do limite de receita','201':'Simples Nacional com crédito e substituição tributária','202':'Simples Nacional sem crédito e com substituição tributária','203':'Isenção do Simples Nacional com substituição tributária','300':'Imune','400':'Não tributada pelo Simples Nacional','500':'ICMS retido anteriormente por substituição tributária','900':'Outras situações do Simples Nacional'};
    var icmsCst={'00':'Tributada integralmente','10':'Tributada com substituição tributária','20':'Tributada com redução de base de cálculo','30':'Isenta ou não tributada com substituição tributária','40':'Isenta','41':'Não tributada','50':'Suspensão','51':'Diferimento','60':'ICMS retido anteriormente por substituição tributária','70':'Redução de base com substituição tributária','90':'Outras situações'};
    var pisCofinsCst={'01':'Tributação pela alíquota básica','02':'Tributação por alíquota diferenciada','03':'Tributação por unidade de medida','04':'Operação monofásica com alíquota zero na revenda','05':'Tributação por substituição tributária','06':'Alíquota zero','07':'Isenta','08':'Sem incidência','09':'Suspensa','49':'Outras operações de saída'};
    var label=taxFieldNames[key]||'Outro valor tributário informado',numeric=Number(value),shown=Number.isFinite(numeric)&&/^v/.test(key)?money(numeric):Number.isFinite(numeric)&&/^p/.test(key)?numeric.toLocaleString('pt-BR')+'%':String(value);
    if(key==='orig')shown=originText(value);
    if(key==='CSOSN')shown=csosn[String(value)]||'Classificação do Simples informada no XML';
    if(key==='CST'){
      var cst=String(value).padStart(2,'0');
      shown=group==='ICMS'?(icmsCst[cst]||'Situação tributária de ICMS informada no XML'):
        (group==='PIS'||group==='PISST'||group==='COFINS'||group==='COFINSST'?(pisCofinsCst[cst]||'Situação tributária informada no XML'):'Classificação fiscal informada no XML');
    }
    if(key==='cClassTrib')shown='Classificação tributária IBS/CBS informada no XML';
    if(key==='cEnq')shown='Enquadramento fiscal informado no XML';
    if(key==='modBC'||key==='modBCST')shown='Modalidade da base de cálculo informada no XML';
    if(key==='indTot')shown=String(value)==='1'?'Incluído no total da NF-e':String(value)==='0'?'Não incluído no total da NF-e':'Informação de totalização do XML';
    if(['cBenef','motDesICMS','tpIPI'].indexOf(key)>=0)shown='Informação fiscal complementar consta no XML';
    if(['CST','CSOSN','cClassTrib','cEnq','modBC','modBCST','indTot','cBenef','motDesICMS','tpIPI'].indexOf(key)<0&&/^(c|ind|mod|tp|mot)/.test(key)&&/^\d+$/.test(String(value)))shown='Classificação detalhada disponível no XML original';
    return '<div class="tax-value"><small>'+escapeHtml(label)+'</small><strong>'+escapeHtml(shown)+'</strong></div>';
  }
  Object.assign(taxFieldNames,{vIBS:'IBS',vCBS:'CBS',vIBSUF:'IBS estadual',vIBSMun:'IBS municipal',pIBSUF:'Alíquota IBS estadual (%)',pIBSMun:'Alíquota IBS municipal (%)',pCBS:'Alíquota CBS (%)',pIBS:'Alíquota IBS (%)',vIS:'Imposto Seletivo',pIS:'Alíquota do Imposto Seletivo (%)',cClassTrib:'Classificação tributária IBS/CBS',vCredPres:'Crédito presumido informado',vDevTrib:'Devolução de tributo',vDif:'Diferimento informado',vICMSUFDest:'ICMS devido à UF de destino',vICMSUFRemet:'ICMS devido à UF do remetente',vIBSMono:'IBS monofásico',vCBSMono:'CBS monofásica',adRemIBS:'Alíquota específica IBS',adRemCBS:'Alíquota específica CBS'});
  Object.assign(taxGroupNames,{IBSCBS:'IBS e CBS',IBSCBSMono:'IBS e CBS monofásicos',IBSCBSTot:'Totais de IBS e CBS',IS:'Imposto Seletivo',ISTot:'Totais do Imposto Seletivo',ISSQNtot:'Totais do ISSQN'});
  function itemTaxMarkup(taxes){
    taxes=xmlObject(taxes);var groups=Object.keys(taxes).filter(function(key){return key.indexOf('@_')!==0;});
    if(!groups.length)return '<div class="tax-empty">O XML não trouxe grupo de imposto detalhado para este item.</div>';
    return '<details class="item-tax-details" open><summary>Impostos e enquadramentos declarados pelo fornecedor</summary><div class="tax-groups">'+groups.map(function(group){var rows=[];scalarRows(taxes[group],[group],rows);return '<section class="tax-group"><h5>'+escapeHtml(taxGroupNames[group]||'Outros tributos informados')+'</h5><div class="tax-value-grid">'+rows.map(function(row){return taxValueMarkup(row.key,row.value,group);}).join('')+'</div></section>';}).join('')+'</div></details>';
  }
  function totalRowsMarkup(title,group){
    group=xmlObject(group);var rows=[];scalarRows(group,[],rows);if(!rows.length)return '';
    return '<section class="invoice-tax-total"><h4>'+escapeHtml(title)+'</h4><div class="tax-value-grid">'+rows.map(function(row){return taxValueMarkup(row.key,row.value,'total');}).join('')+'</div></section>';
  }
  async function openReview(id){
    selectedDoc=docs.find(function(doc){return doc.id===id;});
    if(!selectedDoc||selectedDoc.status==='cancelled')return;
    $('reviewSummary').textContent=selectedDoc.issuerName+' · '+date(selectedDoc.issuedAt)+' · '+money(selectedDoc.total);
    $('supplierSelect').innerHTML=supplierOptions(selectedDoc.supplierId,selectedDoc);
    $('fiscalDataReview').innerHTML='<p>Carregando dados fiscais do XML...</p>';
    $('reviewItems').innerHTML=(selectedDoc.items||[]).map(itemMarkup).join('');
    $('reviewItems').querySelectorAll('.item-tax-details').forEach(function(details){details.open=true;});
    $('officialStatus').checked=false;
    $('cancelEntryPanel').hidden=true;
    $('cancelEntryReason').value='';
    $('supplierSelect').disabled=false;
    applyReviewState(selectedDoc);
    $('closeReview').textContent='Fechar';
    $('reviewCard').hidden=false;
    $('reviewCard').scrollIntoView({behavior:'smooth',block:'start'});
    try{
      var response=await api('/api/inbound-nfe?id='+encodeURIComponent(id));
      if(!selectedDoc||selectedDoc.id!==id)return;
      selectedDoc=response.document;
      $('supplierSelect').innerHTML=supplierOptions(selectedDoc.supplierId,selectedDoc);
      $('reviewItems').innerHTML=(selectedDoc.items||[]).map(itemMarkup).join('');
      $('reviewItems').querySelectorAll('.item-tax-details').forEach(function(details){details.open=true;});
      showFiscalData(selectedDoc);
      applyReviewState(selectedDoc);
    }catch(error){
      $('fiscalDataReview').innerHTML='<p class="error">Não foi possível abrir os dados completos do XML: '+escapeHtml(error.message)+'</p>';
    }
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
    if(!selectedDoc||selectedDoc.status==='cancelled')return;
    if(event.target.name!=='productId'&&event.target.name!=='trackStock')return;
    var row=event.target.closest('[data-line]');
    var lineNumber=Number(row&&row.dataset.line);
    var item=(selectedDoc&&selectedDoc.items||[]).find(function(entry){return Number(entry.lineNumber)===lineNumber;});
    if(!row||!item)return;
    if(event.target.name==='productId'){
      var product=products.find(function(entry){return entry.id===event.target.value;});
      item.productId=product?String(product.id):null;
      item.trackStock=!!product&&product.tracksStock;
      row.outerHTML=itemMarkup(item);
    }else item.trackStock=event.target.checked;
    persistReviewDraft().then(function(){
      setStatus('Vínculo do produto e seleção de estoque salvos na conferência. A quantidade só entra após confirmar a entrada.',false);
    }).catch(function(error){setStatus(error.message,true);});
  });
  $('supplierSelect').addEventListener('change',function(){
    if(!selectedDoc||selectedDoc.status==='cancelled')return;
    persistReviewDraft().then(function(){setStatus('Fornecedor vinculado à conferência.',false);})
      .catch(function(error){setStatus(error.message,true);});
  });
    $('reviewItems').addEventListener('click',async function(event){
    var button=event.target.closest('[data-create-product],[data-cancel-product],[data-save-product],[data-fill-classification],[data-enable-stock]');
    if(!button)return;
    var row=button.closest('[data-line]'),panel=row&&row.querySelector('.product-create-panel');
    if(!row||!panel||!selectedDoc||selectedDoc.status==='cancelled')return;
    if(button.hasAttribute('data-create-product')){panel.hidden=false;var skuInput=panel.querySelector('[name="newProductSku"]');if(skuInput)skuInput.focus();return;}
    if(button.hasAttribute('data-cancel-product')){panel.hidden=true;return;}
    if(button.hasAttribute('data-enable-stock')){
      var selectedId=row.querySelector('[name="productId"]').value;
      var selectedProduct=products.find(function(entry){return entry.id===selectedId;});
      if(!selectedProduct){setStatus('Selecione um produto do catálogo antes de habilitar o estoque.',true);return;}
      button.disabled=true;
      try{
        await api('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'product',id:selectedProduct.id,record:{sku:selectedProduct.sku,name:selectedProduct.name,category:selectedProduct.category||'',unit:selectedProduct.unit,ncm:selectedProduct.ncm||'',cest:selectedProduct.cest||'',gtin:selectedProduct.gtin==='SEM GTIN'?'':selectedProduct.gtin,origin:selectedProduct.origin||'',defaultCfop:selectedProduct.defaultCfop||'',taxProfileId:selectedProduct.taxProfileId||'',cost:selectedProduct.cost,price:selectedProduct.price,active:selectedProduct.active,tracksStock:true}})});
        selectedProduct.tracksStock=true;
        var selectedItem=(selectedDoc.items||[]).find(function(entry){return Number(entry.lineNumber)===Number(row.dataset.line);});
        if(selectedItem)selectedItem.trackStock=true;
        row.outerHTML=itemMarkup(selectedItem);
        await persistReviewDraft();
        setStatus('Controle de estoque habilitado. A quantidade será lançada ao confirmar a entrada.',false);
      }catch(error){setStatus(error.message,true);button.disabled=false;}
      return;
    }
    if(button.hasAttribute('data-fill-classification')){
      if(button.disabled||!selectedDoc)return;
      var lineNumber=Number(row.dataset.line);
      var item=(selectedDoc.items||[]).find(function(entry){return Number(entry.lineNumber)===lineNumber;});
      var productSelect=row.querySelector('[name="productId"]');
      var product=products.find(function(entry){return entry.id===(productSelect&&productSelect.value);});
      if(!item||!product){setStatus('Selecione o produto correspondente antes de importar a classificação.',true);return;}
      var ncm=product.ncm||(/^\d{8}$/.test(String(item.ncm||''))?String(item.ncm):'');
      var cest=product.cest||(/^\d{7}$/.test(String(item.cest||''))?String(item.cest):'');
      var origin=product.origin||String(item.origin||'');
      var gtin=product.gtin&&product.gtin!=='SEM GTIN'?product.gtin:(item.gtin&&item.gtin!=='SEMGTIN'?item.gtin:'');
      if(ncm===product.ncm&&cest===product.cest&&origin===product.origin&&gtin===product.gtin){setStatus('O produto já possui esses dados fiscais ou o XML não contém novos dados válidos.',true);return;}
      button.disabled=true;
      try{
        await api('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'product',id:product.id,record:{sku:product.sku,name:product.name,category:product.category||'',unit:product.unit,ncm:ncm,cest:cest,gtin:gtin,origin:origin,defaultCfop:product.defaultCfop||'',taxProfileId:product.taxProfileId||'',cost:product.cost,price:product.price,active:product.active,tracksStock:product.tracksStock}})});
        product.ncm=ncm;product.cest=cest;product.origin=origin;product.gtin=gtin||'SEM GTIN';
        row.outerHTML=itemMarkup(item);
        setStatus('Dados fiscais ausentes preenchidos com valores do XML. Revise a comparação e confirme com a contabilidade antes de usar em notas.');
      }catch(error){setStatus(error.message,true);button.disabled=false;}
      return;
    }
    if(button.disabled||!selectedDoc)return;
    var lineNumber=Number(row.dataset.line);
    var item=(selectedDoc.items||[]).find(function(entry){return Number(entry.lineNumber)===lineNumber;});
    var sku=panel.querySelector('[name="newProductSku"]');
    var nameInput=panel.querySelector('[name="newProductName"]');
    var unitInput=panel.querySelector('[name="newProductUnit"]');
    var gtinInput=panel.querySelector('[name="newProductGtin"]');
    var ncmInput=panel.querySelector('[name="newProductNcm"]');
    var cestInput=panel.querySelector('[name="newProductCest"]');
    var originInput=panel.querySelector('[name="newProductOrigin"]');
    var categoryInput=panel.querySelector('[name="newProductCategory"]');
    var costInput=panel.querySelector('[name="newProductCostPrice"]');
    var salePrice=panel.querySelector('[name="newProductSalePrice"]');
    var tracksStockInput=panel.querySelector('[name="newProductTracksStock"]');
    if(!item||!sku||!nameInput||!unitInput||!salePrice||!tracksStockInput)return;
    if(!sku.value.trim()){setStatus('Informe o SKU interno do novo produto.',true);sku.focus();return;}
    if(!nameInput.value.trim()){setStatus('Informe a descrição do produto.',true);nameInput.focus();return;}
    if(!unitInput.value.trim()){setStatus('Informe a unidade do produto.',true);unitInput.focus();return;}
    if(ncmInput&&ncmInput.value.trim()&&!/^\d{8}$/.test(ncmInput.value.trim())){setStatus('NCM inválido: use oito dígitos ou deixe vazio.',true);ncmInput.focus();return;}
    if(cestInput&&cestInput.value.trim()&&!/^\d{7}$/.test(cestInput.value.trim())){setStatus('CEST inválido: use sete dígitos ou deixe vazio.',true);cestInput.focus();return;}
    if(salePrice.value.trim()===''||!Number.isFinite(Number(salePrice.value))||Number(salePrice.value)<0){setStatus('Informe um preço de venda válido; use 0,00 se ainda não definiu o preço.',true);salePrice.focus();return;}
    button.disabled=true;
    try{
      var gtin=String(gtinInput.value||'').toUpperCase().trim();
      if(gtin==='SEMGTIN')gtin='';
      var ncm=String(ncmInput&&ncmInput.value||'').replace(/\D/g,'');
      var cest=String(cestInput&&cestInput.value||'').replace(/\D/g,'');
      var origin=String(originInput&&originInput.value||'');
      var name=String(nameInput.value||'').trim().slice(0,160);
      var unit=String(unitInput.value||'').trim().slice(0,8);
      var category=String(categoryInput&&categoryInput.value||'').trim();
      var cost=Number(costInput&&costInput.value);
      if(!Number.isFinite(cost)||cost<0)throw new Error('Informe um custo unitário válido.');
      var tracksStock=tracksStockInput.checked;
      var result=await api('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'product',record:{sku:sku.value.trim(),name:name,category:category,unit:unit,gtin:gtin,ncm:ncm,cest:cest,origin:origin,cost:cost,price:Number(salePrice.value),tracksStock:tracksStock,active:true}})});
      if(!result.id)throw new Error('O produto foi enviado, mas não retornou identificador para vínculo. Atualize o catálogo antes de tentar de novo.');
      var created={id:String(result.id),sku:sku.value.trim(),name:name,category:category,unit:unit,gtin:gtin||'SEM GTIN',ncm:ncm,cest:cest,origin:origin,cost:cost,price:Number(salePrice.value),stock:0,tracksStock:tracksStock,active:true};
      products.push(created);
      item.productId=created.id;
      item.trackStock=tracksStock;
      row.outerHTML=itemMarkup(item);
      await persistReviewDraft();
      $('uploadStatus').classList.remove('error');
      $('uploadStatus').textContent='Produto criado e vínculo salvo na conferência. A entrada no estoque só ocorre após a confirmação da NF-e.';
      setStatus('Produto criado, vínculo salvo e item marcado para estoque. Confirme a autorização no portal da SEFAZ para concluir.');
    }catch(error){setStatus(error.message,true);button.disabled=false;}
  });
  $('cancelEntryButton').addEventListener('click',function(){
    if(!selectedDoc||selectedDoc.status==='cancelled')return;
    $('cancelEntryPanel').hidden=false;
    $('cancelEntryReason').focus();
  });
  $('cancelEntryBack').addEventListener('click',function(){
    $('cancelEntryPanel').hidden=true;
    $('cancelEntryReason').value='';
  });
  $('confirmCancelEntry').addEventListener('click',async function(){
    if(!selectedDoc||selectedDoc.status==='cancelled')return;
    var reason=$('cancelEntryReason').value.trim();
    if(reason.length<5||reason.length>500){
      setStatus('Informe um motivo entre 5 e 500 caracteres.',true);
      $('cancelEntryReason').focus();
      return;
    }
    var button=$('confirmCancelEntry');
    button.disabled=true;
    try{
      var result=await api('/api/inbound-nfe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',id:selectedDoc.id,reason:reason})});
      var reversed=Number(result.result&&result.result.reversedLines||0);
      $('cancelEntryPanel').hidden=true;
      $('reviewCard').hidden=true;
      selectedDoc=null;
      await load();
      setStatus(reversed?'Lançamento encerrado no ERP; '+reversed+' movimento(s) de estorno foram registrados. Para lançar novamente, importe o XML outra vez.':'Lançamento encerrado no ERP sem movimentar o estoque. Para lançar novamente, importe o XML outra vez.',false);
    }catch(error){setStatus(error.message,true);}
    finally{button.disabled=false;}
  });
  $('closeReview').addEventListener('click',function(){ $('reviewCard').hidden=true; });
  $('reviewForm').addEventListener('submit',async function(event){
    event.preventDefault();
    if(!selectedDoc||selectedDoc.status==='cancelled')return;
    var receive=event.submitter&&event.submitter.dataset.receive==='true';
    var items=collectReviewItems();
    if(receive&&!items.some(function(item){return item.trackStock;})){
      setStatus('Para confirmar a entrada, selecione o produto e marque “Lançar no estoque” em pelo menos um item.',true);
      return;
    }
    if(receive&&items.some(function(item){return item.trackStock&&!item.productId;})){
      setStatus('Associe um produto cadastrado a cada item marcado para movimentar o estoque.',true);
      return;
    }
    var buttons=[$('saveReviewButton'),$('receiveButton')];
    buttons.forEach(function(button){button.disabled=true;});
    try{
      if(selectedDoc.receivedWithoutStock===true){
        await api('/api/inbound-nfe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reopen-empty',id:selectedDoc.id})});
        selectedDoc.status='draft';
        selectedDoc.receivedWithoutStock=false;
      }
      await persistReviewDraft(items);
      if(receive&&!$('officialStatus').checked){
        setStatus('Vínculos salvos na conferência. Marque a confirmação da consulta oficial da SEFAZ para lançar a quantidade no estoque.',true);
        return;
      }
      if(receive){
        var confirmation=await api('/api/inbound-nfe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm',id:selectedDoc.id,checkedOfficialStatus:true})});
        var stockLines=confirmation.result&&Number(confirmation.result.stockLines||0);
        $('uploadStatus').textContent='NF-e recebida. '+stockLines+' item(ns) geraram movimentos de estoque vinculados à chave.';
      }else $('uploadStatus').textContent='Conferência salva sem movimentar estoque.';
      $('reviewCard').hidden=true;
      selectedDoc=null;
      await load();
    }catch(error){setStatus(error.message,true);}
    finally{buttons.forEach(function(button){button.disabled=false;});}
  });
    load();
})();
