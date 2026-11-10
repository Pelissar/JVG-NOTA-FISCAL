(function () {
  'use strict';

  var state = { products: [], clients: [], drafts: [], ready: false, sourceOrderId: null, sourceOrderNumber: '' };
  var idempotencyKey = null;
  var status = document.getElementById('status');
  var form = document.getElementById('draftForm');
  var items = document.getElementById('items');
  var saveButton = document.getElementById('saveButton');
  var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function report(message, kind) {
    status.textContent = message;
    status.className = 'notice' + (kind ? ' ' + kind : '');
  }

  function selectedNumber(name) {
    var value = form.elements.namedItem(name).value;
    return value === '' ? null : Number(value);
  }

  function selectedIssueAt() {
    var value = form.elements.namedItem('issueAt').value;
    if (!value) return null;
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    var offset = -date.getTimezoneOffset();
    var sign = offset >= 0 ? '+' : '-';
    var absolute = Math.abs(offset);
    var hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    var minutes = String(absolute % 60).padStart(2, '0');
    return value + ':00' + sign + hours + ':' + minutes;
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

  function fillCarriers() {
    var select = document.getElementById('carrierId');
    if (!select) return;
    select.replaceChildren(option('', 'Não informada'));
    state.clients.filter(function (party) { return party.active && party.isCarrier === true; }).forEach(function (party) {
      select.append(option(party.id, party.name + (party.document ? ' · ' + party.document : '')));
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
      var source = document.createElement('small');
      source.textContent = draft.sourceOrderNumber ? 'Pedido de origem: ' + draft.sourceOrderNumber : 'Criado sem pedido de origem';
      var foot = document.createElement('div');
      var price = document.createElement('b');
      price.textContent = money.format(draft.totalCents / 100);
      var badge = document.createElement('span');
      badge.textContent = draft.status === 'draft' ? 'Rascunho · ' + draft.pendingCount + ' pendência(s)' : draft.status;
      foot.append(price, badge);
      const preview = document.createElement('small');
      preview.textContent = 'Impostos não calculados';
      var inspect = document.createElement('button');
      inspect.type = 'button';
      inspect.className = 'draft-inspect';
      inspect.textContent = 'Ver pendências e detalhes';
      inspect.addEventListener('click', function () { inspectDraft(draft.id); });
      row.append(name, date, source, foot, preview, inspect);
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
      var purposeNames = { 1: 'Normal', 2: 'Complementar', 3: 'Ajuste', 4: 'Devolução' };
      appendLine(target, 'p', 'Finalidade: ' + (purposeNames[draft.purpose] || 'não informada') +
        ' · Data/hora: ' + (draft.issueAt || 'não informada'));
      appendLine(target, 'p', 'Consumidor final: ' + (draft.consumerFinal === true ? 'Sim' :
        draft.consumerFinal === false ? 'Não' : 'não informado') +
        ' · Presença: ' + (draft.buyerPresence == null ? 'não informada' : String(draft.buyerPresence)) +
        ' · Frete: ' + (draft.transportMode == null ? 'não informado' : String(draft.transportMode)));
      if (draft.carrier) appendLine(target, 'p', 'Transportadora: ' + (draft.carrier.name || 'Não informada') +
        (draft.carrier.documentNumber ? ' · ' + draft.carrier.documentNumber : ''));
      if (draft.sourceOrder && draft.sourceOrder.number)
        appendLine(target, 'p', 'Pedido de origem: ' + draft.sourceOrder.number + ' · situação ' + (draft.sourceOrder.status || ''));
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
      var focusReview = draft.focusPayloadReview || {};
      appendLine(target, 'h4', 'Prévia parcial do payload Focus');
      appendLine(target, 'p', 'Campos mapeados sem transmissão. ' +
        String(focusReview.missingCount || 0) + ' conferência(s) estrutural(is) pendente(s).');
      var focusChecks = Array.isArray(focusReview.checks) ? focusReview.checks : [];
      if (focusChecks.length) {
        var focusList = document.createElement('ul');
        focusChecks.forEach(function (check) {
          appendLine(focusList, 'li', (check.ok ? '✓ ' : 'Pendente: ') +
            check.label + ' — ' + check.detail);
        });
        target.append(focusList);
      }
      if (focusReview.requestPreview && typeof focusReview.requestPreview === 'object') {
        var previewDetails = document.createElement('details');
        var previewSummary = document.createElement('summary');
        previewSummary.textContent = 'Ver JSON parcial (não enviável)';
        var previewJson = document.createElement('pre');
        previewJson.className = 'focus-json-preview';
        previewJson.textContent = JSON.stringify(focusReview.requestPreview, null, 2);
        previewDetails.append(previewSummary, previewJson);
        target.append(previewDetails);
      }
      appendLine(target, 'p', 'A prévia é incompleta e não pode ser enviada. Homologação e transmissão continuam desativadas.');
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
      appendLine(target, 'h4', 'Apuração tributária');
      appendLine(target, 'p', 'Não realizada. O ERP ainda não calcula bases, alíquotas ou valores de impostos. A prévia mostra os campos da Focus já mapeados e os dados que dependem da contabilidade.');
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

  function clearOrderQuery() {
    var url = new URL(window.location.href);
    url.searchParams.delete('orderId');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  function unlinkSourceOrder() {
    state.sourceOrderId = null;
    state.sourceOrderNumber = '';
    idempotencyKey = null;
    items.querySelectorAll('.product, .quantity, .price, .remove-item').forEach(function (field) {
      field.disabled = false;
    });
    document.getElementById('addItem').disabled = !state.ready || items.children.length >= 20;
    document.getElementById('sourceOrderNotice').hidden = true;
    document.getElementById('recipientId').disabled = false;
    clearOrderQuery();
    report('Vínculo com o pedido removido. Você pode editar os itens; a origem não será registrada no rascunho.');
  }

  function importOrder(order) {
    if (!order || !order.id) throw new Error('Pedido inválido.');
    if (order.status !== 'open' && order.status !== 'fulfilled')
      throw new Error('Somente pedidos em aberto ou concluídos podem ser preparados para NF-e.');
    if (!order.customer_id) throw new Error('O pedido precisa ter um cliente cadastrado.');
    if (!Array.isArray(order.items) || order.items.length < 1 || order.items.length > 20)
      throw new Error('A NF-e aceita até 20 itens por rascunho; este pedido não pode ser importado.');
    var recipient = state.clients.find(function (client) {
      return client.id === order.customer_id && client.active && client.isCustomer === true && client.type !== 'EXT';
    });
    if (!recipient) throw new Error('O cliente do pedido está inativo ou não está disponível para NF-e.');
    var mapped = order.items.map(function (item) {
      if (!item || !item.productId || item.serviceId)
        throw new Error('Este pedido contém serviço ou item sem produto vinculado. O rascunho atual é para mercadorias.');
      var product = state.products.find(function (entry) { return entry.id === item.productId && entry.active; });
      if (!product) throw new Error('Um produto do pedido está inativo ou não pertence ao catálogo carregado.');
      var quantity = Number(item.quantity), unitPrice = Number(item.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0)
        throw new Error('Quantidade ou preço do pedido está inválido.');
      return { productId: item.productId, quantity: quantity, unitPrice: unitPrice, product: product };
    });
    if (state.drafts.some(function (draft) { return draft.sourceOrderId === order.id; }) &&
        !window.confirm('Já existe um rascunho NF-e vinculado a este pedido. Criar outro rascunho de preparação?'))
      return;
    if (items.children.length && !window.confirm('Carregar este pedido substituirá os dados atuais do formulário. Continuar?'))
      return;

    form.reset();
    items.replaceChildren();
    document.getElementById('recipientId').value = order.customer_id;
    document.getElementById('recipientId').disabled = true;
    mapped.forEach(function (entry) {
      addItem();
      var row = items.lastElementChild;
      var productSelect = row.querySelector('.product');
      productSelect.value = entry.productId;
      productSelect.dispatchEvent(new Event('change'));
      row.querySelector('.quantity').value = String(entry.quantity);
      row.querySelector('.price').value = Number(entry.unitPrice).toFixed(2);
      row.querySelector('.cfop').value = entry.product.defaultCfop || '';
      productSelect.disabled = true;
      row.querySelector('.quantity').disabled = true;
      row.querySelector('.price').disabled = true;
      row.querySelector('.remove-item').disabled = true;
    });
    state.sourceOrderId = order.id;
    state.sourceOrderNumber = 'PED-' + String(order.id).slice(0, 8).toUpperCase();
    idempotencyKey = null;
    document.getElementById('sourceOrderLabel').textContent = state.sourceOrderNumber;
    document.getElementById('sourceOrderNotice').hidden = false;
    document.getElementById('addItem').disabled = true;
    updateTotal();
    report('Pedido carregado. Revise a natureza, CFOP e CSOSN com a contabilidade. Nenhuma nota foi transmitida.');
    document.getElementById('draftForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function load() {
    try {
      var data = await api('/api/records?scope=quotes');
      state.products = Array.isArray(data.products) ? data.products : [];
      state.clients = Array.isArray(data.clients) ? data.clients : [];
      fillRecipients();
      fillCarriers();
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
      var sourceOrderId = new URLSearchParams(window.location.search).get('orderId');
      if (sourceOrderId) {
        try {
          var orderResponse = await api('/api/orders?id=' + encodeURIComponent(sourceOrderId));
          importOrder(orderResponse.order);
        } catch (error) {
          report('Não foi possível carregar o pedido no rascunho: ' + error.message, 'error');
        }
      }
    } catch (error) {
      report('Falha ao carregar a central fiscal: ' + error.message + ' Volte ao ERP ou recarregue esta página.', 'error');
      saveButton.disabled = true;
    }
  }

  document.getElementById('addItem').addEventListener('click', addItem);
  document.getElementById('unlinkSourceOrder').addEventListener('click', unlinkSourceOrder);
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!state.ready) return;
    saveButton.disabled = true;
    saveButton.textContent = 'Salvando...';
    try {
      if (!idempotencyKey) {
        if (!window.crypto || typeof window.crypto.randomUUID !== 'function')
          throw new Error('Este navegador não oferece uma chave segura para evitar duplicidade. Atualize o navegador.');
        idempotencyKey = window.crypto.randomUUID();
      }
      var result = await api('/api/fiscal/nfe-drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          nature: form.elements.namedItem('nature').value.trim(),
          purpose: selectedNumber('purpose'),
          issueAt: selectedIssueAt(),
          consumerFinal: form.elements.namedItem('consumerFinal').value === '' ? null :
            form.elements.namedItem('consumerFinal').value === '1',
          buyerPresence: selectedNumber('buyerPresence'),
          transportMode: selectedNumber('transportMode'),
          carrierId: form.elements.namedItem('carrierId').value || null,
          recipientId: form.elements.namedItem('recipientId').value,
          sourceOrderId: state.sourceOrderId,
          items: readItems(),
        }),
      });
      idempotencyKey = null;
      state.sourceOrderId = null;
      state.sourceOrderNumber = '';
      document.getElementById('sourceOrderNotice').hidden = true;
      document.getElementById('recipientId').disabled = false;
      clearOrderQuery();
      form.reset();
      items.replaceChildren();
      addItem();
      try {
        await refreshHistory();
      } catch {
        report('Rascunho salvo com sucesso, mas não foi possível atualizar o histórico. Recarregue a página para conferir.', 'error');
        return;
      }
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
