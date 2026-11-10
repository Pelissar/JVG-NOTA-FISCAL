(function () {
  'use strict';
  var form=document.getElementById('historyFilters'), rows=[], page=1, hasMore=false, parties=[];
  var statusLabels={draft:'Rascunho / pendente',waiting_certificate:'Aguardando certificado',queued:'Na fila',processing:'Em processamento',authorized:'Autorizada',rejected:'Rejeitada',cancelled:'Cancelada',denied:'Denegada',contingency:'Contingência',received:'Recebida no estoque'};
  var money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  var $=function(id){return document.getElementById(id);};
  function node(tag,className,text){var el=document.createElement(tag);if(className)el.className=className;if(text!=null)el.textContent=String(text);return el;}
  async function api(url){var response=await fetch(url,{credentials:'same-origin',cache:'no-store'});var data=await response.json().catch(function(){return {};});if(response.status===401){window.location.replace('/login');throw new Error('Faça login novamente.');}if(!response.ok)throw new Error(data.error||'Não foi possível carregar os documentos.');return data;}
  function date(value){if(!value)return 'Data não informada';var parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Data não informada':parsed.toLocaleString('pt-BR');}
  function roleNames(party){var roles=[];if(party.isCustomer)roles.push('cliente');if(party.isSupplier)roles.push('fornecedor');if(party.isCarrier)roles.push('transportadora');return roles.join(' / ')||'cadastro';}
  async function loadParties(){
    var data=await api('/api/records?scope=clients');parties=Array.isArray(data.clients)?data.clients:[];
    var select=form.elements.namedItem('partyId');
    parties.forEach(function(party){var option=document.createElement('option');option.value=party.id;option.textContent=party.name+' · '+roleNames(party)+(party.document?' · '+party.document:'');select.append(option);});
  }
  function params(){var p=new URLSearchParams();p.set('page',String(page));['kind','partyId','status','from','to'].forEach(function(name){var value=form.elements.namedItem(name).value;if(value)p.set(name,value);});return p;}
  function render(){
    var root=$('historyRows');root.replaceChildren();
    $('pageNumber').textContent='Página '+page;$('previousPage').disabled=page<=1;$('nextPage').disabled=!hasMore;
    if(!rows.length){root.append(node('p','empty-state','Nenhum documento encontrado com estes filtros.'));return;}
    rows.forEach(function(doc){
      var row=node('article','history-row');
      var main=node('div','history-cell');main.append(node('strong',(doc.direction==='incoming'?'Entrada':'Saída')+' · '+(doc.documentType||'Documento')+' '+(doc.number||'sem número')));main.append(node('small',(doc.contactName||'Pessoa não identificada')+(doc.contactDocument?' · '+doc.contactDocument:'')));
      var details=node('div','history-cell history-secondary-cell');details.append(node('strong',doc.direction==='incoming'?'Fornecedor emitente':'Cliente destinatário'));details.append(node('small',date(doc.date)+' · Série '+(doc.series||'—')));
      var statusCell=node('div','history-cell history-status-cell');statusCell.append(node('span','history-status '+String(doc.status||'').toLowerCase(),statusLabels[doc.status]||doc.status||'Sem situação'));statusCell.append(node('small',(doc.environment||'')+(doc.authorizationStatus?' · cStat '+doc.authorizationStatus:'')));
      var value=node('div','history-value',money(doc.total||0));
      var actions=node('div','history-actions');var open=node('button','secondary-button','Ver dados');open.type='button';open.addEventListener('click',function(){openDetails(doc);});actions.append(open);
      if(doc.direction==='incoming'){var xml=node('a','secondary-button','XML');xml.href='/api/inbound-nfe?xml='+encodeURIComponent(doc.id);actions.append(xml);}
      row.append(main,details,statusCell,value,actions);root.append(row);
    });
  }
  async function load(){
    $('historyStatus').textContent='Buscando notas emitidas e recebidas desta empresa...';$('historyStatus').classList.remove('history-error');
    $('refreshHistory').disabled=true;
    try{var data=await api('/api/fiscal/history?'+params().toString());rows=Array.isArray(data.documents)?data.documents:[];hasMore=data.hasMore===true;$('historyStatus').textContent=rows.length+' documento(s) nesta página. Os rascunhos são identificados e não contam como autorizados.';render();}
    catch(error){rows=[];hasMore=false;render();$('historyStatus').textContent=error.message+' Se a migration de histórico ainda não foi aplicada, aplique supabase/migrations/20261110_jvg_fiscal_document_history.sql no Supabase.';$('historyStatus').classList.add('history-error');}
    finally{$('refreshHistory').disabled=false;}
  }
  async function openDetails(doc){
    $('historyDetail').hidden=false;$('detailHeading').textContent=(doc.direction==='incoming'?'NF-e recebida ':'Documento de saída ')+(doc.number||'sem número');$('detailSummary').textContent=(doc.contactName||'Pessoa não identificada')+' · '+date(doc.date)+' · '+money(doc.total||0);$('detailContent').replaceChildren(node('p','','Carregando campos fiscais e tributos registrados...'));$('historyDetail').scrollIntoView({behavior:'smooth',block:'start'});
    try{
      var result=await api('/api/fiscal/history?id='+encodeURIComponent(doc.id)+'&direction='+encodeURIComponent(doc.direction));
      var detail=result.document||{};var content=$('detailContent');content.replaceChildren();
      var meta=node('div','detail-meta');meta.append(node('p','','Situação interna: '+(statusLabels[detail.status]||detail.status||'—')));meta.append(node('p','','Ambiente: '+(detail.environment||'—')+' · Tipo: '+(detail.documentType||'—')));
      if(detail.accessKey)meta.append(node('p','','Chave: '+detail.accessKey));
      if(detail.carrierName)meta.append(node('p','','Transportadora: '+detail.carrierName+(detail.carrierDocument?' · '+detail.carrierDocument:'')));
      content.append(meta);
      var raw=node('pre','detail-data',JSON.stringify({dadosFiscais:detail.fiscalData||{},itens:detail.items||[],referenciaPedido:detail.sourceOrder||null},null,2));content.append(raw);
      if(detail.direction==='incoming'){var links=node('div','detail-links'),link=node('a','secondary-button','Baixar XML original');link.href='/api/inbound-nfe?xml='+encodeURIComponent(detail.id);links.append(link);content.append(links);}
    }catch(error){$('detailContent').replaceChildren(node('p','history-error',error.message));}
  }
  form.addEventListener('submit',function(event){event.preventDefault();page=1;load();});
  $('refreshHistory').addEventListener('click',load);
  $('clearFilters').addEventListener('click',function(){form.reset();page=1;load();});
  $('previousPage').addEventListener('click',function(){if(page>1){page--;load();}});
  $('nextPage').addEventListener('click',function(){if(hasMore){page++;load();}});
  $('closeDetail').addEventListener('click',function(){$('historyDetail').hidden=true;});
  Promise.all([loadParties(),load()]).catch(function(error){$('historyStatus').textContent=error.message;$('historyStatus').classList.add('history-error');});
})();
