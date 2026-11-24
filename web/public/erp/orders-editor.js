(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const dialog = $('orderEditDialog');
  if (!dialog) return;

  let catalog = [], currentOrder = null, saving = false, catalogReady = Promise.resolve();
  const rows = () => [...$('orderEditItems').querySelectorAll('.commercial-editor-row')];
  const notice = (message) => { $('orderEditNotice').textContent = message; };

  async function api(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }

  function updateTotal() {
    const total = rows().reduce((sum, row) => sum + (Number(row.querySelector('.editor-quantity').value) || 0) * (Number(row.querySelector('.editor-price').value) || 0), 0);
    $('orderEditTotal').textContent = 'Total: ' + money(total);
    $('orderEditSave').disabled = saving || !rows().length || rows().some((row) => {
      const validItem = row.dataset.manual === 'true'
        ? !!row.querySelector('.editor-description').value.trim() && !!row.querySelector('.editor-unit').value.trim()
        : !!row.querySelector('.editor-item').value;
      return !validItem || !(Number(row.querySelector('.editor-quantity').value) > 0) || row.querySelector('.editor-price').value === '';
    });
    $('orderEditAdd').disabled = saving || rows().length >= 100;
    $('orderEditAddManual').disabled = saving || rows().length >= 100;
  }

  function addRow(item, requestedMode = 'catalog') {
    if (rows().length >= 100) return;
    const row = document.createElement('div');
    row.className = 'commercial-editor-row';
    const manual = requestedMode === 'manual' || item?.manual === true || (!item?.productId && !item?.serviceId && !!item);
    row.dataset.manual = manual ? 'true' : 'false';
    if (manual) row.classList.add('commercial-editor-row--manual');
    const options = catalog.map((entry) => '<option value="' + safe(entry.kind + ':' + entry.id) + '">' + safe(entry.name) + '</option>').join('');
    const picker = manual
      ? '<label>Descrição<input class="editor-description" maxlength="180" required></label><label>Unidade<input class="editor-unit" maxlength="12" value="UN" required></label>'
      : '<label>Produto ou serviço<select class="editor-item" required><option value="">Selecione</option>' + options + '</select></label>';
    row.innerHTML = picker + '<label>Quantidade<input class="editor-quantity" type="number" min="0.001" max="999999" step="0.001" required></label><label>Preço unitário (R$)<input class="editor-price" type="number" min="0" max="999999999" step="0.01" required></label><button class="btn editor-remove" type="button">Remover</button>';
    if (manual) {
      row.querySelector('.editor-description').value = item?.description || '';
      row.querySelector('.editor-unit').value = item?.unit || 'UN';
    } else if (item) {
      const select = row.querySelector('.editor-item');
      const kind = item.productId ? 'product' : 'service';
      const id = item.productId || item.serviceId;
      const value = kind + ':' + id;
      if (![...select.options].some((option) => option.value === value)) select.insertAdjacentHTML('beforeend', '<option value="' + safe(value) + '">' + safe(item.description || 'Item inativo do pedido') + '</option>');
      select.value = value;
      row.querySelector('.editor-quantity').value = String(item.quantity ?? 1);
      row.querySelector('.editor-price').value = Number(item.unitPrice || 0).toFixed(2);
    } else {
      row.querySelector('.editor-quantity').value = '1';
    }
    if (!manual) row.querySelector('.editor-item').addEventListener('change', (event) => {
      const entry = catalog.find((value) => value.kind + ':' + value.id === event.currentTarget.value);
      if (entry) row.querySelector('.editor-price').value = Number(entry.price || 0).toFixed(2);
      updateTotal();
    });
    row.querySelectorAll('input').forEach((input) => input.addEventListener('input', updateTotal));
    row.querySelector('.editor-remove').addEventListener('click', () => { row.remove(); updateTotal(); });
    $('orderEditItems').append(row);
    updateTotal();
    return row;
  }

  async function editOrder(id) {
    if (saving) return;
    try {
      await catalogReady;
      const data = await api('/api/orders?id=' + encodeURIComponent(id));
      const order = data.order;
      if (!order || order.status !== 'open') throw new Error('Apenas pedidos em aberto podem ser editados. Atualize a lista.');
      currentOrder = order;
      $('orderEditTitle').textContent = 'Editar pedido PED-' + String(order.id).slice(0, 8).toUpperCase();
      $('orderEditItems').replaceChildren();
      $('orderEditNotes').value = order.notes || '';
      (Array.isArray(order.items) ? order.items : []).forEach(addRow);
      if (!rows().length) addRow();
      notice('O pedido vem de uma proposta aprovada. Revise com o cliente qualquer alteração de item ou preço; a proposta original fica preservada.');
      dialog.showModal();
    } catch (error) {
      $('orderNotice').textContent = error.message;
    }
  }

  function ensureEditButtons() {
    document.querySelectorAll('#orderList tr').forEach((tr) => {
      const detail = tr.querySelector('button[data-order-action="details"]');
      if (!detail || !tr.querySelector('.status-pill.is-open') || tr.querySelector('[data-order-action="edit"]')) return;
      detail.insertAdjacentHTML('afterend', ' <button type="button" class="btn" data-order-action="edit" data-id="' + safe(detail.dataset.id) + '">Editar</button>');
    });
  }

  $('orderList').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-order-action="edit"]');
    if (button) editOrder(button.dataset.id);
  });
  $('orderEditAdd').addEventListener('click', () => addRow());
  $('orderEditAddManual').addEventListener('click', () => addRow(null, 'manual')?.querySelector('.editor-description')?.focus());
  $('orderEditClose').addEventListener('click', () => dialog.close());
  $('orderEditCancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  $('orderEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentOrder || saving || $('orderEditSave').disabled) return;
    const items = rows().map((row) => {
      const quantity = Number(row.querySelector('.editor-quantity').value), unitPrice = Number(row.querySelector('.editor-price').value);
      if (row.dataset.manual === 'true') return { manual: true, description: row.querySelector('.editor-description').value.trim(), unit: row.querySelector('.editor-unit').value.trim(), quantity, unitPrice };
      const [kind, id] = row.querySelector('.editor-item').value.split(':');
      return { productId: kind === 'product' ? id : null, serviceId: kind === 'service' ? id : null, quantity, unitPrice };
    });
    if (!confirm('Confirme que o cliente concordou com as alterações deste pedido. O orçamento aprovado original não será alterado.')) return;
    saving = true; updateTotal(); notice('Salvando alterações do pedido...');
    try {
      await api('/api/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentOrder.id, action: 'edit', fromStatus: currentOrder.status, items, notes: $('orderEditNotes').value }) });
      dialog.close(); currentOrder = null;
      $('ordersRefresh').click();
      $('orderNotice').textContent = 'Pedido atualizado. O orçamento aprovado original foi preservado.';
    } catch (error) { notice(error.message); }
    finally { saving = false; updateTotal(); }
  });

  const observer = new MutationObserver(ensureEditButtons);
  observer.observe($('orderList'), { childList: true, subtree: true });
  ensureEditButtons();

  catalogReady = api('/api/records?scope=quotes').then((data) => {
    catalog = [
      ...(data.products || []).filter((item) => item.active).map((item) => ({ ...item, kind: 'product' })),
      ...(data.services || []).filter((item) => item.active).map((item) => ({ ...item, kind: 'service' })),
    ];
  }).catch((error) => { notice(error.message); });
})();
