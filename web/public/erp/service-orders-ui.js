(() => {
  'use strict';
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = (value) => value == null || value === '' ? 'Não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
  const date = (value) => value ? new Date(value + 'T12:00:00').toLocaleDateString('pt-BR') : 'Não informada';
  const dialog = document.getElementById('serviceOrderDetails');
  if (!dialog) return;

  function render() {
    const order = window.jvgSelectedServiceOrder;
    if (!order) return;
    const customers = window.jvgServiceOrderCustomers;
    const customer = customers && customers.get(order.customer_id) || 'Consumidor não identificado';
    const approval = order.customer_approved === true ? 'Aprovado pelo cliente' : order.customer_approved === false ? 'Não aprovado' : 'Pendente';
    const equipment = [order.device_type, order.brand, order.model].filter(Boolean).join(' · ');
    const cards = [
      ['Cliente', customer],
      ['Equipamento', equipment || 'Não informado'],
      ['Entrada da OS', order.created_at ? new Date(order.created_at).toLocaleString('pt-BR') : 'Não informada'],
      ['Previsão de entrega', date(order.promised_at)],
      ['Valor estimado', money(order.estimated_value)],
      ['Aprovação do cliente', approval],
    ];
    document.getElementById('osQuickInfo').innerHTML = cards.map(([label, value]) => '<article><span>' + safe(label) + '</span><strong>' + safe(value) + '</strong></article>').join('');
    const hint = document.getElementById('osApprovalHint');
    hint.className = 'os-approval-hint' + (order.customer_approved === true ? ' is-approved' : order.customer_approved === false ? ' is-denied' : ' is-pending');
    if (order.customer_approved === true) hint.textContent = 'Aprovação registrada. A OS pode avançar para manutenção conforme o fluxo.';
    else if (order.customer_approved === false) hint.textContent = 'O cliente não aprovou o serviço. Registre uma nova decisão antes de iniciar a manutenção.';
    else hint.textContent = 'Antes de iniciar a manutenção, o comercial precisa registrar a aprovação do cliente.';
    const approvalSelect = document.getElementById('osCustomerApproval');
    const access = window.jvgServiceOrderAccess;
    if (approvalSelect) approvalSelect.disabled = !access || access.canManage !== true;
  }

  new MutationObserver((entries) => {
    if (entries.some((entry) => entry.attributeName === 'open') && dialog.open) render();
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  dialog.addEventListener('click', render);
})();
