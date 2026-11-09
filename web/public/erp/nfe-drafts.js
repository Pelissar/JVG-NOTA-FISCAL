(function () {
  'use strict';

  var state = { products: [], clients: [], drafts: [], ready: false };
  var status = document.getElementById('status');
  var form = document.getElementById('draftForm');
  var items = document.getElementById('items');
  var saveButton = document.getElementById('saveButton');
  var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function report(message, kind) {
    status.textContent = message;
    status.className = 'notice' + (kind ? ' ' + kind : '');
  }

  async function api(endpoint, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response = await fetch(endpoint, Object.assign({
        credentials: 'same-origin', cache: 'no-store',
      }, options || {}, { signal: controller.signal }));
      var data = await response.json().catch(function () { return {}; });
      if (response.status === 401) {
        window.location.replace('/login');
        throw new Error('Faça login novamente.');
      }
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('O servidor não respondeu em 15 segundos. Tente novamente.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function option(value, text) {
    var el = document.createElement('option');
    el.value = value;
    el.textContent = text;
    return el;
  }

  function fillRecipients() {
    var select = document.getElementById('recipientId');
    select.replaceChildren(option('', 'Selecione um destinatário'));
    state.clients.filter(function (c) { return c.active && c.isCustomer === true && c.type !== 'EXT'; }).forEach(function (client) {
      select.append(option(client.id, client.name + (client.document ? ' · ' + client.document : '')));
    });
  }

  function addItem() {
    if (items.children.length >= 20) {
      report('Limite de 20 produtos por rascunho.', 'error');
      return;
    }
    var row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML =
      '<label class="field product-field"><span>Produto *</span><select class="product" required></select></label>' +
      '<label class="field"><span>Qtd. *</span><input class="quantity" type="number" min="0.001" max="100000" step="0.001" value="1" required></label>' +
      '<label class="field"><span>Preço (R$) *</span><input class="price" type="number" min="0" max="999999.99" step="0.01" required></label>' +
      '<label class="field"><span>CFOP</span><input class="cfop" maxlength="4" inputmode="numeric" list="cfopOptions" placeholder="Ex.: 5102"></label>' +
      '<label class="field"><span>CSOSN</span><input class="csosn" maxlength="3" inputmode="numeric" placeholder="Ex.: 102"></label>' +
      '<button type="button" class="remove-item" aria-label="Remover este produto" title="Remover produto">×</button>';
    var select = row.querySelector('.product');
    select.append(option('', 'Selecione'));
    state.products.filter(function (p) { return p.active; }).forEach(function (p) {
      select.append(option(p.id, p.name + ' · ' + p.sku));
    });
    select.addEventListener('change', function () {
      var product = state.products.find(function (p) { return p.id === select.value; });
      row.querySelector('.price').value = product ? Number(product.price || 0).toFixed(2) : '';
      row.querySelector('.cfop').value = product ? product.defaultCfop || '' : '';
      updateTotal();
    });
    row.querySelector('.remove-item').addEventListener('click', function () {
      if (items.children.length > 1) row.remove();
      else report('Mantenha pelo menos um produto no rascunho.', 'error');
      updateTotal();
    });
    row.querySelectorAll('input').forEach(function (input) { input.addEventListener('input', updateTotal); });
    items.append(row);
    updateTotal();
  }

  function readItems() {
    return Array.from(items.querySelectorAll('.item-row')).map(function (row) {
      return {
        productId: row.querySelector('.product').value,
        quantity: row.querySelector('.quantity').value,
        unitPrice: row.querySelector('.price').value,
        cfop: row.querySelector('.cfop').value.trim(),
        csosn: row.querySelector('.csosn').value.trim(),
      };
    });
  }

  function updateTotal() {
    var cents = readItems().reduce(function (sum, item) {
      var quantity = Number(item.quantity), price = Number(item.unitPrice);
      return sum + (Number.isFinite(quantity) && Number.isFinite(price) && quantity > 0 && price >= 0 ?
        Math.round(Math.round(quantity * 1000) * Math.round(price * 100) / 1000) : 0);
    }, 0);
    document.getElementById('total').textContent = money.format(cents / 100);
  }

  function renderHistory() {
    var target = document.getElementById('history');
    target.replaceChildren();
    if (!state.drafts.length) {
      var empty = document.createElement('p');
      empty.textContent = 'Nenhum rascunho salvo. Prepare o primeiro à esquerda.';
      target.append(empty);
      return;
    }
    state.drafts.forEach(function (draft) {
      var row = document.createElement('div');
      row.className = 'history-row';
      var name = document.createElement('strong');
      name.textContent = draft.recipientName;
      var date = document.createElement('small');
      date.textContent = draft.itemsCount + ' produto(s) · ' + new Date(draft.createdAt).toLocaleString('pt-BR');
      var foot = document.createElement('div');
      var price = document.createElement('b');
      price.textContent = money.format(draft.totalCents / 100);
      var badge = document.createElement('span');
      badge.textContent = draft.status === 'draft' ? 'Rascunho · ' + draft.pendingCount + ' pendência(s)' : draft.status;
      foot.append(price, badge);
      const preview = document.createElement('small');
      preview.textContent = draft.previewTotalCents ? 'Estimativa aritmética de tributos: ' + money.format(draft.previewTotalCents / 100) + ' · não válida para emissão' : 'Sem estimativa de tributos';
      var inspect = document.createElement('button');
      inspect.type = 'button';
      inspect.className = 'draft-inspect';
      inspect.textContent = 'Ver pendências e detalhes';
      inspect.addEventListener('click', function () { inspectDraft(draft.id); });
      row.append(name, date, foot, preview, inspect);
      target.append(row);
    });
  }

  function appendLine(parent, tag, value) {
    var node = document.createElement(tag);
    node.textContent = value;
    parent.append(node);
  }

  async function inspectDraft(id) {
    var target = document.getElementById('draftDetails');
    target.replaceChildren();
    appendLine(target, 'p', 'Buscando detalhes do rascunho...');
    try {
      var response = await api('/api/fiscal/nfe-drafts?id=' + encodeURIComponent(id));
      var draft = response.draft;
      if (!draft || draft.readyToTransmit !== false || draft.transmissionEnabled !== false)
        throw new Error('Resposta fiscal inesperada. Consulte o suporte.');
      target.replaceChildren();
      var recipient = draft.recipient || {};
      appendLine(target, 'h3', 'Rascunho · ' + (recipient.name || 'Destinatário'));
      appendLine(target, 'p', 'Natureza: ' + (draft.nature || 'não informada'));
      appendLine(target, 'p', 'Total comercial: ' + money.format(Number(draft.totalCents || 0) / 100));
      if (draft.preflight) {
        appendLine(target, 'h4', 'Pré-conferência cadastral');
        appendLine(target, 'p', draft.preflight.dataComplete ?
          'Dados básicos presentes. Revisão fiscal e homologação ainda obrigatórias.' :
          'Dados cadastrais incompletos: veja as pendências abaixo.');
        appendLine(target, 'p', 'Transmissão bloqueada. Pré-conferência não substitui validação fiscal.');
      } else {
        appendLine(target, 'p', 'Rascunho antigo: pré-conferência cadastral indisponível.');
      }
      var documentReview = draft.documentReview || {};
      if (Array.isArray(documentReview.checks)) {
        appendLine(target, 'h4', 'Checklist de preparação da NF-e');
        var checkList = document.createElement('ul');
        documentReview.checks.forEach(function (check) {
          appendLine(checkList, 'li', (check.ok ? '✓ ' : 'Pendente: ') +
            check.label + ' — ' + check.detail);
        });
        target.append(checkList);
        appendLine(target, 'p', 'Checklist interno: não é XML, DANFE, validação da SEFAZ ou permissão de emissão.');
      }
      appendLine(target, 'h4', 'Itens');
      var itemList = document.createElement('ul');
      (Array.isArray(draft.items) ? draft.items : []).forEach(function (item, i) {
        appendLine(itemList, 'li', (i + 1) + '. ' + (item.description || 'Produto') +
          ' · CFOP ' + (item.cfop || 'pendente') + ' · CSOSN ' + (item.csosn || 'pendente') +
          ' · ' + money.format(Number(item.subtotalCents || 0) / 100));
      });
      target.append(itemList);
      appendLine(target, 'h4', 'Pendências de conferência');
      var pending = Array.isArray(draft.pending) ? draft.pending : [];
      if (pending.length) {
        var list = document.createElement('ul');
        pending.forEach(function (issue) { appendLine(list, 'li', String(issue)); });
        target.append(list);
      } else {
        appendLine(target, 'p', 'Sem pendências registradas neste rascunho. Isso não representa aprovação fiscal.');
      }
      var preview = draft.taxPreview || {};
      appendLine(target, 'h4', 'Prévia matemática não fiscal');
      appendLine(target, 'p', 'Estimativa total: ' + money.format(Number(preview.sumOfEstimatesCents || 0) / 100) +
        '. Não é valor autorizado, nem apuração tributária.');
      appendLine(target, 'p', 'Emissão e transmissão indisponíveis nesta fase.');
      target.hidden = false;
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      target.replaceChildren();
      appendLine(target, 'p', 'Falha na consulta: ' + error.message);
      target.hidden = false;
    }
  }

  async function refreshHistory() {
    var response = await api('/api/fiscal/nfe-drafts');
    state.drafts = Array.isArray(response.drafts) ? response.drafts : [];
    renderHistory();
  }

  async function load() {
    try {
      var data = await api('/api/records');
      state.products = Array.isArray(data.products) ? data.products : [];
      state.clients = Array.isArray(data.clients) ? data.clients : [];
      fillRecipients();
      addItem();
      // Sugestões oficiais não podem impedir o uso de rascunhos se o catálogo falhar.
      try {
        var cfops = await api('/api/fiscal/cfop');
        var options = document.getElementById('cfopOptions');
        (cfops.records || []).forEach(function (record) {
          options.append(option(record.code, record.customLabel || record.title));
        });
      } catch { /* campo livre continua disponível */ }
      await refreshHistory();
      state.ready = state.products.some(function (p) { return p.active; }) &&
        state.clients.some(function (c) { return c.active && c.isCustomer === true && c.type !== 'EXT'; });
      saveButton.disabled = !state.ready;
      report(state.ready ?
        'Conectado ao Supabase. Os rascunhos serão salvos somente para esta empresa e não serão transmitidos.' :
        'Cadastre pelo menos um produto e um cliente ativos no ERP para preparar a NF-e.', state.ready ? '' : 'info');
    } catch (error) {
      report('Falha ao carregar a central fiscal: ' + error.message + ' Volte ao ERP ou recarregue esta página.', 'error');
      saveButton.disabled = true;
    }
  }

  document.getElementById('addItem').addEventListener('click', addItem);
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!state.ready) return;
    saveButton.disabled = true;
    saveButton.textContent = 'Salvando...';
    try {
      var result = await api('/api/fiscal/nfe-drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nature: form.elements.namedItem('nature').value.trim(),
          recipientId: form.elements.namedItem('recipientId').value,
          items: readItems(),
        }),
      });
      form.reset();
      items.replaceChildren();
      addItem();
      await refreshHistory();
      report('Rascunho salvo no Supabase. Restam ' + result.pending.length +
        ' conferência(s) fiscais antes de qualquer emissão. Nenhum documento foi transmitido.');
    } catch (error) {
      report('Não foi possível salvar: ' + error.message, 'error');
    } finally {
      saveButton.disabled = !state.ready;
      saveButton.textContent = 'Salvar rascunho NF-e';
    }
  });

  load();
})();
