(function () {
  'use strict';
  var form = document.getElementById('issuedFilterForm');
  var rows = [];
  var selected = new Set();
  var page = 1;
  var hasMore = false;
  var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var statusLabels = {
    draft: 'Em preparação', waiting_certificate: 'Aguardando certificado', queued: 'Na fila',
    processing: 'Processando', authorized: 'Autorizada', rejected: 'Rejeitada',
    cancelled: 'Cancelada', denied: 'Denegada', contingency: 'Contingência'
  };
  var $ = function (id) { return document.getElementById(id); };
  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (letter) {
      var random = Math.random() * 16 | 0;
      return (letter === 'x' ? random : (random & 3 | 8)).toString(16);
    });
  }
  async function readResponse(response) {
    var data = await response.json().catch(function () { return {}; });
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('Faça login novamente.');
    }
    return data;
  }
  async function api(url) {
    var response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    var data = await readResponse(response);
    if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as NF-e.');
    return data;
  }
  function date(value) {
    if (!value) return 'Data não informada';
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Data não informada' : parsed.toLocaleDateString('pt-BR');
  }
  function params() {
    var query = new URLSearchParams();
    query.set('kind', 'outgoing');
    query.set('documentType', 'nfe');
    query.set('page', String(page));
    ['number', 'customer', 'cfop', 'from', 'to', 'status', 'environment'].forEach(function (name) {
      var field = form.elements.namedItem(name);
      var value = field ? field.value.trim() : '';
      if (value) query.set(name, value);
    });
    return query;
  }
  function selectedRows() {
    return rows.filter(function (doc) { return selected.has(doc.id); });
  }
  function setStatus(message, error) {
    $('issuedStatus').textContent = message;
    $('issuedStatus').classList.toggle('history-error', !!error);
  }
  function updateSelection() {
    var count = selected.size;
    $('selectionBar').hidden = count === 0;
    $('selectionCount').textContent = count + (count === 1 ? ' NF-e selecionada' : ' NF-e selecionadas');
    var selectedOnPage = rows.filter(function (doc) { return selected.has(doc.id); }).length;
    $('selectIssuedPage').checked = rows.length > 0 && selectedOnPage === rows.length;
    $('selectIssuedPage').indeterminate = selectedOnPage > 0 && selectedOnPage < rows.length;
    var picked = selectedRows();
    $('viewSelected').disabled = picked.length !== 1;
    $('downloadSelectedXml').disabled = picked.length !== 1 || !picked[0].hasImportedXml;
    $('downloadSelectedXml').textContent = picked.length === 1 && picked[0].hasImportedXml
      ? 'Baixar XML da selecionada' : 'XML disponível apenas para uma nota importada';
  }
  function render() {
    var body = $('issuedRows');
    body.replaceChildren();
    $('issuedPageNumber').textContent = 'Página ' + page;
    $('previousIssuedPage').disabled = page <= 1;
    $('nextIssuedPage').disabled = !hasMore;
    if (!rows.length) {
      var empty = node('tr', '');
      empty.append(node('td', 'issued-empty', 'Nenhuma NF-e encontrada com estes filtros.'));
      empty.firstChild.colSpan = 8;
      body.append(empty);
      updateSelection();
      return;
    }
    rows.forEach(function (doc) {
      var row = node('tr', selected.has(doc.id) ? 'is-selected' : '');
      var check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'issued-row-check';
      check.checked = selected.has(doc.id);
      check.setAttribute('aria-label', 'Selecionar NF-e ' + (doc.number || 'sem número'));
      check.addEventListener('change', function () {
        if (check.checked) selected.add(doc.id);
        else selected.delete(doc.id);
        row.classList.toggle('is-selected', check.checked);
        updateSelection();
      });
      var checkCell = node('td', 'issued-check-cell');
      checkCell.append(check);

      var numberCell = node('td', '');
      var number = node('div', 'issued-number');
      number.append(node('strong', '', (doc.number || 'Sem número') + (doc.series ? ' · Série ' + doc.series : '')));
      if (doc.accessKey) number.append(node('small', '', doc.accessKey));
      numberCell.append(number);

      var customerCell = node('td', '');
      var customer = node('div', 'issued-customer');
      customer.append(node('strong', '', doc.contactName || 'Destinatário não identificado'));
      if (doc.contactDocument) customer.append(node('small', '', doc.contactDocument));
      if (doc.hasImportedXml) customer.append(node('small', 'issued-source', 'XML autorizado arquivado no ERP'));
      else customer.append(node('small', 'issued-source', doc.environment || 'Homologação'));
      customerCell.append(customer);

      var cfop = node('td', 'issued-cfop', doc.cfop || '—');
      var issueDate = node('td', 'issued-date', date(doc.date));
      var statusCell = node('td', '');
      var statusClass = String(doc.status || '').toLowerCase().replace(/[^a-z_]/g, '');
      statusCell.append(node('span', 'issued-status ' + statusClass, statusLabels[doc.status] || doc.status || 'Sem status'));
      var total = node('td', 'issued-total', money(Number(doc.total || 0)));
      var actions = node('td', '');
      var actionRoot = node('div', 'issued-row-actions');
      var view = node('button', '', 'Ver');
      view.type = 'button';
      view.addEventListener('click', function () { openDetails(doc); });
      actionRoot.append(view);
      if (doc.hasImportedXml) {
        var xml = node('a', '', 'XML');
        xml.href = '/api/fiscal/nfe-imports?xml=' + encodeURIComponent(doc.id);
        xml.setAttribute('download', '');
        actionRoot.append(xml);
      }
      actions.append(actionRoot);
      row.append(checkCell, numberCell, customerCell, cfop, issueDate, statusCell, total, actions);
      body.append(row);
    });
    updateSelection();
  }
  async function load() {
    $('refreshIssued').disabled = true;
    setStatus('Buscando NF-e desta empresa…', false);
    try {
      var data = await api('/api/fiscal/history?' + params().toString());
      rows = Array.isArray(data.documents) ? data.documents : [];
      hasMore = data.hasMore === true;
      selected.clear();
      $('bulkActions').hidden = true;
      $('bulkActionsToggle').setAttribute('aria-expanded', 'false');
      render();
      setStatus(rows.length + ' NF-e nesta página. A seleção em lote vale para a página atual.', false);
    } catch (error) {
      rows = [];
      hasMore = false;
      render();
      setStatus(error.message + ' Se a migration de gestão de NF-e ainda não foi aplicada, aplique o SQL indicado ao final da implantação.', true);
    } finally {
      $('refreshIssued').disabled = false;
    }
  }
  async function openDetails(doc) {
    $('issuedDetail').hidden = false;
    $('issuedDetailHeading').textContent = 'NF-e ' + (doc.number || 'sem número');
    $('issuedDetailSummary').textContent = (doc.contactName || 'Destinatário não identificado') + ' · ' +
      date(doc.date) + ' · ' + money(Number(doc.total || 0));
    $('issuedDetailContent').replaceChildren(node('p', '', 'Carregando os dados fiscais registrados…'));
    $('issuedDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      var result = await api('/api/fiscal/history?id=' + encodeURIComponent(doc.id) + '&direction=outgoing');
      var detail = result.document || {};
      var content = $('issuedDetailContent');
      content.replaceChildren();
      var meta = node('div', 'detail-meta');
      meta.append(node('p', '', 'Situação: ' + (statusLabels[detail.status] || detail.status || '—')));
      meta.append(node('p', '', 'Ambiente: ' + (detail.environment || '—') + ' · Tipo: ' + (detail.documentType || 'NF-e 55')));
      if (detail.accessKey) meta.append(node('p', '', 'Chave: ' + detail.accessKey));
      if (detail.recipientDocument) meta.append(node('p', '', 'Destinatário: ' + detail.recipientDocument));
      if (detail.carrierName) meta.append(node('p', '', 'Transportadora: ' + detail.carrierName +
        (detail.carrierDocument ? ' · ' + detail.carrierDocument : '')));
      var provider = detail.providerResponse || {};
      if (provider.status_sefaz) meta.append(node('p', '', 'Retorno SEFAZ: ' + provider.status_sefaz));
      if (provider.mensagem_sefaz) meta.append(node('p', '', 'Mensagem: ' + provider.mensagem_sefaz));
      if (provider.protocolo || provider.numero_protocolo) meta.append(node('p', '', 'Protocolo: ' + (provider.protocolo || provider.numero_protocolo)));
      content.append(meta);
      var payload = detail.fiscalData || {};
      var raw = node('pre', 'detail-data', JSON.stringify({
        itens: payload.items || [],
        totais: payload.fiscalData || {},
        autorizacao: payload.authorization || provider,
        pedidoOrigem: detail.sourceOrder || null
      }, null, 2));
      content.append(raw);
      if (detail.hasImportedXml) {
        var links = node('div', 'detail-links');
        var link = node('a', 'secondary-button', 'Baixar XML original');
        link.href = '/api/fiscal/nfe-imports?xml=' + encodeURIComponent(detail.id);
        link.setAttribute('download', '');
        links.append(link);
        content.append(links);
      }
    } catch (error) {
      $('issuedDetailContent').replaceChildren(node('p', 'history-error', error.message));
    }
  }
  function showDialog(dialogId) {
    var dialog = $(dialogId);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  function closeDialog(dialogId) {
    var dialog = $(dialogId);
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }
  function downloadXml(doc) {
    var link = document.createElement('a');
    link.href = '/api/fiscal/nfe-imports?xml=' + encodeURIComponent(doc.id);
    link.download = '';
    document.body.append(link);
    link.click();
    link.remove();
  }
  function csvCell(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }
  function exportSelected() {
    var picked = selectedRows();
    var lines = [['Número', 'Série', 'Cliente', 'Documento', 'CFOP', 'Emissão', 'Status', 'Ambiente', 'Total', 'Chave']];
    picked.forEach(function (doc) {
      lines.push([doc.number, doc.series, doc.contactName, doc.contactDocument, doc.cfop, date(doc.date),
        statusLabels[doc.status] || doc.status, doc.environment, Number(doc.total || 0).toFixed(2), doc.accessKey]);
    });
    var csv = '\ufeff' + lines.map(function (line) { return line.map(csvCell).join(';'); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = 'nfe-selecionadas.csv';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function resultText(target, message, type) {
    target.textContent = message;
    target.classList.remove('success', 'error');
    if (type) target.classList.add(type);
  }

  $('toggleFilters').addEventListener('click', function () {
    var expanded = $('issuedFilters').hidden;
    $('issuedFilters').hidden = !expanded;
    $('toggleFilters').setAttribute('aria-expanded', String(expanded));
  });
  $('openImport').addEventListener('click', function () { resultText($('importResult'), '', ''); showDialog('importDialog'); });
  $('openInutilization').addEventListener('click', function () { resultText($('inutilizationResult'), '', ''); showDialog('inutilizationDialog'); });
  document.querySelectorAll('[data-close-dialog]').forEach(function (button) {
    button.addEventListener('click', function () { closeDialog(button.getAttribute('data-close-dialog')); });
  });
  form.addEventListener('submit', function (event) { event.preventDefault(); page = 1; load(); });
  $('clearIssuedFilters').addEventListener('click', function () { form.reset(); page = 1; load(); });
  $('refreshIssued').addEventListener('click', load);
  $('previousIssuedPage').addEventListener('click', function () { if (page > 1) { page--; load(); } });
  $('nextIssuedPage').addEventListener('click', function () { if (hasMore) { page++; load(); } });
  $('selectIssuedPage').addEventListener('change', function () {
    rows.forEach(function (doc) {
      if ($('selectIssuedPage').checked) selected.add(doc.id);
      else selected.delete(doc.id);
    });
    render();
  });
  $('bulkActionsToggle').addEventListener('click', function () {
    var menu = $('bulkActions');
    menu.hidden = !menu.hidden;
    $('bulkActionsToggle').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', function (event) {
    if (!$('bulkActions').hidden && !event.target.closest('.issued-bulk-menu')) {
      $('bulkActions').hidden = true;
      $('bulkActionsToggle').setAttribute('aria-expanded', 'false');
    }
  });
  $('viewSelected').addEventListener('click', function () {
    var picked = selectedRows();
    if (picked.length === 1) openDetails(picked[0]);
    $('bulkActions').hidden = true;
  });
  $('downloadSelectedXml').addEventListener('click', function () {
    var picked = selectedRows();
    if (picked.length === 1 && picked[0].hasImportedXml) downloadXml(picked[0]);
    $('bulkActions').hidden = true;
  });
  $('exportSelected').addEventListener('click', exportSelected);
  $('clearSelection').addEventListener('click', function () { selected.clear(); render(); });
  $('closeIssuedDetail').addEventListener('click', function () { $('issuedDetail').hidden = true; });

  $('importForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var file = $('authorizedXmlFile').files[0];
    if (!file || !$('confirmSeFazImport').checked) return;
    var button = $('submitImport');
    button.disabled = true;
    resultText($('importResult'), 'Validando autorização, chave e emitente do XML…', '');
    try {
      var body = new FormData();
      body.set('xml', file);
      body.set('confirmedOfficialStatus', 'true');
      var response = await fetch('/api/fiscal/nfe-imports', {
        method: 'POST', body: body, credentials: 'same-origin', cache: 'no-store'
      });
      var data = await readResponse(response);
      if (!response.ok) throw new Error(data.error || 'Não foi possível importar o XML.');
      resultText($('importResult'),
        'NF-e ' + data.number + ' arquivada no histórico. ' +
        (data.recipientCreated ? 'Cliente cadastrado pelo documento do XML. ' :
          data.recipientMatched ? 'Cliente associado pelo CPF/CNPJ. ' : '') +
        (data.eventLogged ? 'Autorização registrada no histórico fiscal. ' : '') +
        'Nenhuma chamada foi feita à Focus.',
        'success');
      await load();
    } catch (error) {
      resultText($('importResult'), error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('inutilizationForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var formData = new FormData(event.currentTarget);
    if (!$('confirmHomologation').checked) return;
    var button = $('submitInutilization');
    button.disabled = true;
    resultText($('inutilizationResult'), 'Registrando a tentativa e consultando a Focus em homologação…', '');
    try {
      var response = await fetch('/api/fiscal/nfe-number-inutilizations', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: uuid(),
          series: String(formData.get('series') || '').trim(),
          numberStart: Number(formData.get('numberStart')),
          numberEnd: Number(formData.get('numberEnd')),
          justification: String(formData.get('justification') || '').trim(),
          confirmHomologation: $('confirmHomologation').checked
        })
      });
      var data = await readResponse(response);
      if (data.status === 'authorized') {
        var authorizedMessage = 'A Focus informou autorização da inutilização em homologação.';
        if (data.providerResponse && data.providerResponse.status_sefaz)
          authorizedMessage += ' SEFAZ: ' + data.providerResponse.status_sefaz + '.';
        if (data.protocol) authorizedMessage += ' Protocolo: ' + data.protocol + '.';
        resultText($('inutilizationResult'), authorizedMessage, 'success');
      } else if (data.status === 'outcome_unknown') {
        resultText($('inutilizationResult'), data.error || 'A Focus não confirmou o resultado. Consulte o painel antes de tentar novamente.', 'error');
      } else if (data.status === 'rejected') {
        resultText($('inutilizationResult'), data.error || 'A Focus recusou a solicitação.', 'error');
      } else if (!response.ok) {
        throw new Error(data.error || 'Não foi possível inutilizar a numeração.');
      } else {
        resultText($('inutilizationResult'), 'A Focus recebeu a solicitação, mas não retornou confirmação suficiente para concluir o resultado. Consulte o painel antes de tentar novamente.', 'error');
      }
    } catch (error) {
      resultText($('inutilizationResult'), error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll('.issued-dialog').forEach(function (dialog) {
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) closeDialog(dialog.id);
    });
  });
  load();
})();
