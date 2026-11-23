(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  const labels = {
    draft: 'Preparada · não enviada', processing: 'Aguardando retorno', authorized: 'Autorizada',
    rejected: 'Rejeitada', cancelled: 'Cancelada', denied: 'Denegada',
  };
  const paymentOptions = [
    ['01', 'Dinheiro'], ['02', 'Cheque'], ['03', 'Cartão de crédito'], ['04', 'Cartão de débito'],
    ['05', 'Cartão da loja'], ['10', 'Vale-alimentação'], ['11', 'Vale-refeição'], ['12', 'Vale-presente'],
    ['13', 'Vale-combustível'], ['14', 'Duplicata mercantil'], ['15', 'Boleto bancário'], ['16', 'Depósito bancário'],
    ['17', 'Pix dinâmico'], ['18', 'Transferência / carteira digital'], ['19', 'Fidelidade / cashback / crédito virtual'],
    ['20', 'Pix estático'], ['21', 'Crédito em loja'], ['22', 'Pagamento eletrônico não informado'],
    ['23', 'Pix automático'], ['24', 'TEF · Book Transfer'], ['91', 'Pagamento posterior'], ['99', 'Outros'],
  ];
  const cardBrands = [
    ['01', 'Visa'], ['02', 'Mastercard'], ['03', 'American Express'], ['04', 'Sorocred'], ['05', 'Diners Club'],
    ['06', 'Elo'], ['07', 'Hipercard'], ['08', 'Aura'], ['09', 'Cabal'], ['10', 'Alelo'], ['11', 'Banescard'],
    ['12', 'CalCard'], ['13', 'Credz'], ['14', 'Discover'], ['15', 'GoodCard'], ['16', 'GreenCard'],
    ['17', 'Hiper'], ['18', 'JCB'], ['19', 'Mais'], ['20', 'MaxVan'], ['21', 'Policard'], ['22', 'RedeCompras'],
    ['23', 'Sodexo'], ['24', 'ValeCard'], ['25', 'Verocheque'], ['26', 'VR'], ['27', 'Ticket'], ['99', 'Outros'],
  ];
  const csosnOptions = [
    ['101', '101 · Com crédito do Simples'], ['102', '102 · Sem crédito do Simples'], ['103', '103 · Isenção por faixa'],
    ['201', '201 · Com ST e crédito'], ['202', '202 · Com ST sem crédito'], ['203', '203 · Com ST e isenção'],
    ['300', '300 · Imune'], ['400', '400 · Não tributada'], ['500', '500 · ICMS cobrado anteriormente por ST'], ['900', '900 · Outros'],
  ];
  const cstOptions = [
    ['01', '01 · Tributável com alíquota básica'], ['02', '02 · Tributável com alíquota diferenciada'],
    ['03', '03 · Tributável por quantidade'], ['04', '04 · Monofásica · revenda alíquota zero'],
    ['05', '05 · Substituição tributária'], ['06', '06 · Alíquota zero'], ['07', '07 · Isenta'],
    ['08', '08 · Sem incidência'], ['09', '09 · Suspensa'], ['49', '49 · Outras operações de saída'], ['99', '99 · Outras operações'],
  ];
  const taxLabels = {
    icms_modalidade_base_calculo: 'Modalidade da base ICMS', icms_reducao_base_calculo: 'Redução da base ICMS (%)',
    icms_base_calculo: 'Base ICMS (R$)', icms_aliquota: 'Alíquota ICMS (%)', icms_valor: 'Valor ICMS (R$)',
    icms_modalidade_base_calculo_st: 'Modalidade da base ICMS-ST', icms_margem_valor_adicionado_st: 'MVA do ICMS-ST (%)',
    icms_reducao_base_calculo_st: 'Redução da base ICMS-ST (%)', icms_base_calculo_st: 'Base ICMS-ST (R$)',
    icms_aliquota_st: 'Alíquota ICMS-ST (%)', icms_valor_st: 'Valor ICMS-ST (R$)',
    icms_aliquota_credito_simples: 'Alíquota de crédito do Simples (%)', icms_valor_credito_simples: 'Valor de crédito do Simples (R$)',
    icms_base_calculo_retido_st: 'Base ICMS-ST retido (R$)', icms_valor_retido_st: 'ICMS-ST retido anteriormente (R$)',
    icms_valor_substituto: 'ICMS do substituto (R$)', icms_aliquota_final: 'Alíquota final ICMS (%)',
    pis_base_calculo: 'Base de cálculo PIS (R$)', pis_aliquota_porcentual: 'Alíquota PIS (%)',
    pis_quantidade_vendida: 'Quantidade tributável PIS', pis_aliquota_valor: 'Alíquota PIS por unidade (R$)',
    pis_valor: 'Valor PIS (R$)', pis_base_calculo_st: 'Base de cálculo PIS-ST (R$)',
    pis_aliquota_porcentual_st: 'Alíquota PIS-ST (%)', pis_quantidade_vendida_st: 'Quantidade PIS-ST',
    pis_aliquota_valor_st: 'Alíquota PIS-ST por unidade (R$)', pis_valor_st: 'Valor PIS-ST (R$)',
    cofins_base_calculo: 'Base de cálculo Cofins (R$)', cofins_aliquota_porcentual: 'Alíquota Cofins (%)',
    cofins_quantidade_vendida: 'Quantidade tributável Cofins', cofins_aliquota_valor: 'Alíquota Cofins por unidade (R$)',
    cofins_valor: 'Valor Cofins (R$)', cofins_base_calculo_st: 'Base de cálculo Cofins-ST (R$)',
    cofins_aliquota_porcentual_st: 'Alíquota Cofins-ST (%)', cofins_quantidade_vendida_st: 'Quantidade Cofins-ST',
    cofins_aliquota_valor_st: 'Alíquota Cofins-ST por unidade (R$)', cofins_valor_st: 'Valor Cofins-ST (R$)',
  };

  let state = { products: [], profiles: [], productProfileIds: {}, defaults: {}, canIssue: false, canCancel: false };
  let draftId = '';
  let cancelId = '';
  let busy = false;
  let sequence = 0;

  class ApiError extends Error {
    constructor(message, issues = []) { super(message); this.issues = issues; }
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error || 'Não foi possível concluir a operação.', Array.isArray(data.issues) ? data.issues : []);
    return data;
  }

  function notice(message, error = false) {
    $('nfceNotice').textContent = message;
    $('nfceNotice').classList.toggle('is-error', error);
  }

  function issueList(items) {
    const target = $('nfceIssues');
    if (!items?.length) { target.hidden = true; target.replaceChildren(); return; }
    target.hidden = false;
    target.innerHTML = '<strong>Corrija antes de preparar</strong><ul>' + items.map(item => '<li>' + safe(item) + '</li>').join('') + '</ul>';
  }

  function selectOptions(rows, placeholder) {
    return '<option value="">' + safe(placeholder) + '</option>' + rows.map(([value, label]) => '<option value="' + safe(value) + '">' + safe(label) + '</option>').join('');
  }

  function profileRule(product) {
    const profile = state.profiles.find(item => item.id === product?.taxProfileId || item.id === state.productProfileIds?.[product?.id]);
    const rules = profile?.rules && typeof profile.rules === 'object' ? profile.rules : {};
    const operations = rules.operations && typeof rules.operations === 'object' ? rules.operations : {};
    const direction = operations.interna;
    return direction && typeof direction === 'object' ? direction : {};
  }

  function jvgSuggestion(cfop) {
    return Boolean(state.defaults.isJvgPilot && state.defaults.simplesNacionalConfirmado && ['5101', '5102'].includes(String(cfop || '')));
  }

  function totalCents() {
    let total = 0;
    document.querySelectorAll('.nfce-line-item').forEach((row) => {
      const quantity = Number(row.querySelector('[data-field="quantity"]').value) || 0;
      const price = Number(row.querySelector('[data-field="price"]').value) || 0;
      const unitCents = Math.round(price * 100);
      total += Math.round(quantity * unitCents);
    });
    return total;
  }

  function paymentAmountCents() {
    return [...document.querySelectorAll('.nfce-payment-row')].reduce((total, row) => {
      const amount = Number(row.querySelector('[data-payment="amount"]').value) || 0;
      return total + Math.round(amount * 100);
    }, 0);
  }

  function updatePaymentTotal() {
    $('nfcePaymentSummary').textContent = 'Pagamentos: ' + money(paymentAmountCents() / 100);
  }

  function updateTotal() {
    const cents = totalCents();
    $('nfceTotal').textContent = money(cents / 100);
    const rows = [...document.querySelectorAll('.nfce-payment-row')];
    if (rows.length === 1) {
      const amount = rows[0].querySelector('[data-payment="amount"]');
      if (rows[0].querySelector('[data-payment="method"]').value !== '91' && amount.dataset.manual !== 'true') amount.value = (cents / 100).toFixed(2);
    }
    updatePaymentTotal();
  }

  function taxGroups(item) {
    const csosn = item.querySelector('[data-field="csosn"]').value;
    const pis = item.querySelector('[data-field="pisCst"]').value;
    const cofins = item.querySelector('[data-field="cofinsCst"]').value;
    const groups = [];
    const basic = ['icms_modalidade_base_calculo', 'icms_reducao_base_calculo', 'icms_base_calculo', 'icms_aliquota', 'icms_valor'];
    const st = ['icms_modalidade_base_calculo_st', 'icms_margem_valor_adicionado_st', 'icms_reducao_base_calculo_st', 'icms_base_calculo_st', 'icms_aliquota_st', 'icms_valor_st'];
    const credit = ['icms_aliquota_credito_simples', 'icms_valor_credito_simples'];
    const retained = ['icms_base_calculo_retido_st', 'icms_valor_retido_st', 'icms_valor_substituto', 'icms_aliquota_final'];
    if (csosn === '101') groups.push(['Crédito do Simples', credit]);
    if (csosn === '201') groups.push(['ICMS-ST', st], ['Crédito do Simples', credit]);
    if (['202', '203'].includes(csosn)) groups.push(['ICMS-ST', st]);
    if (csosn === '500') groups.push(['ICMS-ST retido anteriormente', retained]);
    if (csosn === '900') {
      const mode = item.querySelector('[data-field="csosn900Group"]')?.value || '';
      groups.push(['Escolha do grupo fiscal', ['__group_' + mode]]);
      if (mode === 'basic') groups.push(['ICMS', basic]);
      if (mode === 'st') groups.push(['ICMS-ST', st]);
    }
    const addCst = (prefix, cst) => {
      if (['01', '02'].includes(cst)) groups.push([prefix.toUpperCase(), [prefix + '_base_calculo', prefix + '_aliquota_porcentual', prefix + '_valor']]);
      else if (cst === '03') groups.push([prefix.toUpperCase(), [prefix + '_quantidade_vendida', prefix + '_aliquota_valor', prefix + '_valor']]);
      else if (cst === '05') groups.push([prefix.toUpperCase() + ' ST', [prefix + '_base_calculo_st', prefix + '_aliquota_porcentual_st', prefix + '_valor_st']]);
      else if (cst === '99') groups.push([prefix.toUpperCase() + ' · outras operações', [prefix + '_base_calculo', prefix + '_aliquota_porcentual', prefix + '_quantidade_vendida', prefix + '_aliquota_valor', prefix + '_valor']]);
    };
    addCst('pis', pis);
    addCst('cofins', cofins);
    return groups;
  }

  function renderAdvanced(item, applyProfile = false) {
    const root = item.querySelector('.nfce-tax-fields');
    const groups = taxGroups(item);
    const product = state.products.find(row => row.id === item.querySelector('[data-field="product"]').value);
    const rule = profileRule(product);
    const stored = rule.focusFields && typeof rule.focusFields === 'object' ? rule.focusFields : {};
    const previous = Object.fromEntries([...root.querySelectorAll('[data-tax]')].map(input => [input.dataset.tax, { value: input.value, manual: input.dataset.manual === 'true' }]));
    root.innerHTML = '';
    let count = 0;
    for (const [title, fields] of groups) {
      if (fields[0]?.startsWith('__group_')) {
        const wrapper = document.createElement('label');
        wrapper.className = 'nfce-group-choice';
        wrapper.innerHTML = 'Grupo de ICMS para CSOSN 900 <select data-field="csosn900Group"><option value="">Selecione um grupo</option><option value="basic">ICMS próprio</option><option value="st">ICMS-ST</option></select>';
        root.append(wrapper);
        wrapper.querySelector('select').value = item.dataset.csosn900Group || '';
        wrapper.querySelector('select').addEventListener('change', event => {
          item.dataset.csosn900Group = event.currentTarget.value;
          renderAdvanced(item);
        });
        count++;
        continue;
      }
      const section = document.createElement('section');
      section.className = 'nfce-tax-group';
      section.innerHTML = '<strong>' + safe(title) + '</strong><div class="nfce-tax-grid"></div>';
      const grid = section.querySelector('.nfce-tax-grid');
      for (const name of fields) {
        if (!taxLabels[name]) continue;
        const label = document.createElement('label');
        label.innerHTML = safe(taxLabels[name]) + '<input data-tax="' + safe(name) + '" inputmode="decimal" type="number" min="0" step="0.0001" placeholder="Conforme orientação fiscal">';
        const input = label.querySelector('input');
        input.value = previous[name]?.value ?? (applyProfile && stored[name] !== undefined ? String(stored[name]) : '');
        if (previous[name]?.manual) input.dataset.manual = 'true';
        input.addEventListener('input', () => { input.dataset.manual = 'true'; item.dataset.manualFocus = 'true'; });
        grid.append(label);
        count++;
      }
      root.append(section);
    }
    item.querySelector('.nfce-advanced').hidden = count === 0;
  }

  function setField(item, name, value) {
    const input = item.querySelector('[data-field="' + name + '"]');
    if (input) input.value = value == null ? '' : String(value);
  }

  function updateTaxSummary(item) {
    const summary = item.querySelector('.nfce-item-tax-summary');
    const product = state.products.find(row => row.id === item.querySelector('[data-field="product"]').value);
    if (!summary || !product) {
      if (summary) { summary.hidden = true; summary.replaceChildren(); }
      return;
    }
    const get = name => item.querySelector('[data-field="' + name + '"]')?.value?.trim() || '';
    const cfop = get('cfop'), ncm = get('ncm'), origin = get('origin');
    const csosn = get('csosn'), pis = get('pisCst'), cofins = get('cofinsCst'), cest = get('cest');
    const requiresCest = ['201', '202', '203', '500'].includes(csosn);
    const originNames = ['Nacional', 'Estrangeira · importação direta', 'Estrangeira · mercado interno', 'Nacional · conteúdo importado acima de 40%', 'Nacional · processo produtivo básico', 'Nacional · conteúdo importado até 40%', 'Estrangeira · sem similar nacional', 'Estrangeira · mercado interno sem similar nacional', 'Nacional · conteúdo importado acima de 70%'];
    const missing = [];
    if (!/^\d{4}$/.test(cfop)) missing.push('CFOP');
    if (!/^\d{8}$/.test(ncm)) missing.push('NCM');
    if (!/^[0-8]$/.test(origin)) missing.push('origem da mercadoria');
    if (!csosnOptions.some(([code]) => code === csosn)) missing.push('CSOSN');
    if (requiresCest && !/^\d{7}$/.test(cest)) missing.push('CEST exigido pelo CSOSN ' + csosn);
    if (!cstOptions.some(([code]) => code === pis)) missing.push('CST do PIS');
    if (!cstOptions.some(([code]) => code === cofins)) missing.push('CST da Cofins');
    const chips = [
      ['CFOP', cfop, !/^\d{4}$/.test(cfop)],
      ['NCM', ncm, !/^\d{8}$/.test(ncm)],
      ['Origem', origin ? origin + ' · ' + (originNames[Number(origin)] || 'código informado') : '', !/^[0-8]$/.test(origin)],
      ['CSOSN', csosn, !csosnOptions.some(([code]) => code === csosn)],
      ['PIS CST', pis, !cstOptions.some(([code]) => code === pis)],
      ['Cofins CST', cofins, !cstOptions.some(([code]) => code === cofins)],
      ['CEST', cest || 'não informado', requiresCest && !/^\d{7}$/.test(cest)],
    ];
    let message = '<p class="nfce-tax-summary-ready">Padrões carregados. Confira se correspondem à operação e ao produto.</p>';
    if (missing.length) {
      const productMissing = missing.filter(name => name !== 'CFOP');
      message = '<div class="nfce-tax-summary-alert" role="status"><strong>Faltam dados para conferir:</strong><span>' +
        safe(missing.join(', ')) + (productMissing.length ? '. Configure os dados do produto em Cadastros &gt; Produtos ou ajuste uma exceção neste item, conforme orientação contábil.' : '. Informe o CFOP de saída para esta operação.') +
        '</span>' + (productMissing.length ? '<a href="/erp/index.html#products" target="_blank" rel="noopener">Abrir cadastro de produtos</a>' : '') + '</div>';
    }
    summary.innerHTML = '<div class="nfce-tax-summary-heading"><strong>Dados fiscais usados neste item</strong><span>produto primeiro; sugestão compatível quando cadastrada</span></div>' +
      '<div class="nfce-tax-badges">' + chips.map(([label, value, isMissing]) =>
        '<span class="nfce-tax-badge' + (isMissing ? ' is-missing' : '') + '"><strong>' + safe(label) + '</strong> ' + safe(value || 'pendente') + '</span>'
      ).join('') + '</div>' + message;
    summary.hidden = false;
  }

  function refreshOperationSuggestion(item) {
    const product = state.products.find(row => row.id === item.querySelector('[data-field="product"]').value);
    const field = item.querySelector('[data-field="csosn"]');
    if (!product || !field || field.dataset.manual === 'true') return;
    const rule = profileRule(product);
    const configured = product.defaultCsosn || rule.csosn || '';
    if (configured) {
      field.value = configured;
      field.dataset.source = product.defaultCsosn ? 'product' : 'profile';
    } else if (jvgSuggestion(item.querySelector('[data-field="cfop"]').value)) {
      field.value = '102';
      field.dataset.source = 'jvg';
    } else if (field.dataset.source === 'jvg') {
      field.value = '';
      delete field.dataset.source;
    }
  }

  function applyProduct(item, keepManual = false) {
    const product = state.products.find(row => row.id === item.querySelector('[data-field="product"]').value);
    if (!product) return;
    const rule = profileRule(product);
    const cfopInput = item.querySelector('[data-field="cfop"]');
    if (!keepManual || !cfopInput.dataset.manual) {
      const fromProfile = rule.cfop || rule.cfop_sugerido || rule.cfopSugerido;
      const suggested = String(fromProfile || product.defaultCfop || '').replace(/\D/g, '').slice(0, 4);
      cfopInput.value = suggested;
      cfopInput.dataset.source = suggested ? (fromProfile ? 'profile' : 'product') : '';
      if (!keepManual) delete cfopInput.dataset.manual;
    }
    if (!keepManual) {
      setField(item, 'ncm', product.ncm || '');
      setField(item, 'origin', product.origin || '');
      setField(item, 'cest', product.cest || '');
      setField(item, 'price', product.price ?? '');
      ['ncm', 'origin', 'cest'].forEach(name => {
        const field = item.querySelector('[data-field="' + name + '"]');
        if (field) delete field.dataset.manual;
      });
    }
    const defaults = {
      csosn: product.defaultCsosn || rule.csosn || (jvgSuggestion(cfopInput.value) ? '102' : ''),
      pisCst: product.defaultPisCst || rule.pisCst || '',
      cofinsCst: product.defaultCofinsCst || rule.cofinsCst || '',
    };
    const sources = {
      csosn: product.defaultCsosn ? 'product' : rule.csosn ? 'profile' : defaults.csosn ? 'jvg' : '',
      pisCst: product.defaultPisCst ? 'product' : rule.pisCst ? 'profile' : '',
      cofinsCst: product.defaultCofinsCst ? 'product' : rule.cofinsCst ? 'profile' : '',
    };
    for (const [name, value] of Object.entries(defaults)) {
      const field = item.querySelector('[data-field="' + name + '"]');
      if (field && (!keepManual || field.dataset.manual !== 'true')) {
        field.value = value;
        field.dataset.source = sources[name];
        if (!keepManual) delete field.dataset.manual;
      }
    }
    const facts = [product.ncm ? 'NCM ' + product.ncm : 'NCM pendente', product.origin !== '' ? 'Origem ' + product.origin : 'Origem pendente', product.cest ? 'CEST ' + product.cest : 'CEST não cadastrado'];
    item.querySelector('.nfce-product-facts').textContent = facts.join(' · ');
    renderAdvanced(item, true);
    updateTaxSummary(item);
    updateTotal();
  }

  function addItem() {
    if (document.querySelectorAll('.nfce-line-item').length >= 20) { notice('O cupom permite até 20 itens nesta tela.', true); return; }
    sequence++;
    const item = document.createElement('article');
    item.className = 'nfce-line-item';
    item.dataset.line = String(sequence);
    item.innerHTML = '<header><div><span class="nfce-line-number">ITEM ' + String(sequence).padStart(2, '0') + '</span><strong class="nfce-line-title">Selecione um produto</strong><small class="nfce-product-facts">NCM · origem · CEST</small></div><button class="nfce-remove-item" type="button" aria-label="Remover item">Remover</button></header>' +
      '<div class="nfce-form-grid nfce-item-grid"><label class="nfce-product-field">Produto <span class="required">*</span><select data-field="product" required><option value="">Selecione um produto ativo</option>' + state.products.map(p => '<option value="' + safe(p.id) + '">' + safe(p.sku ? p.sku + ' · ' : '') + safe(p.name) + '</option>').join('') + '</select></label>' +
      '<label>Quantidade <span class="required">*</span><input data-field="quantity" type="number" min="0.001" max="9999" step="0.001" value="1" required></label>' +
      '<label>Preço unitário (R$) <span class="required">*</span><input data-field="price" type="number" min="0.01" step="0.01" required></label>' +
      '<label>CFOP do item <span class="required">*</span><input data-field="cfop" inputmode="numeric" maxlength="4" placeholder="4 dígitos" aria-required="true"><small>Sugestão editável; a conferência informa se falta ou não é compatível com a NFC-e.</small></label>' +
      '</div><div class="nfce-item-tax-summary" hidden></div>' +
      '<details class="nfce-item-tax-config"><summary>Ajustes fiscais deste item <span>exceções ao cadastro do produto</span></summary><p class="nfce-help">Os campos começam com os dados cadastrados no produto ou com sugestões fiscais disponíveis. Altere somente quando a operação exigir; esta mudança vale apenas para este item.</p>' +
      '<div class="nfce-form-grid nfce-item-tax-grid"><label>NCM <span class="optional">padrão do produto</span><input data-field="ncm" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" placeholder="8 dígitos"></label>' +
      '<label>CEST <span class="optional">quando aplicável</span><input data-field="cest" inputmode="numeric" maxlength="7" placeholder="7 dígitos"></label>' +
      '<label>Origem da mercadoria <span class="optional">padrão do produto</span><select data-field="origin"><option value="">Selecione</option>' + Array.from({ length: 9 }, (_, i) => '<option value="' + i + '">' + i + ' · ' + safe(['Nacional', 'Estrangeira · importação direta', 'Estrangeira · adquirida no mercado interno', 'Nacional · conteúdo de importação superior a 40%', 'Nacional · processos produtivos básicos', 'Nacional · conteúdo de importação inferior ou igual a 40%', 'Estrangeira · importação direta sem similar nacional', 'Estrangeira · mercado interno sem similar nacional', 'Nacional · conteúdo de importação superior a 70%'][i]) + '</option>').join('') + '</select></label>' +
      '<label>CSOSN <span class="optional">padrão do produto</span><select data-field="csosn">' + selectOptions(csosnOptions, 'Selecione conforme a orientação fiscal') + '</select></label>' +
      '<label>CST do PIS <span class="optional">padrão do produto</span><select data-field="pisCst">' + selectOptions(cstOptions, 'Selecione conforme a orientação fiscal') + '</select></label>' +
      '<label>CST da Cofins <span class="optional">padrão do produto</span><select data-field="cofinsCst">' + selectOptions(cstOptions, 'Selecione conforme a orientação fiscal') + '</select></label></div></details>' +
      '<details class="nfce-advanced"><summary>Valores fiscais condicionais <span>Preencha somente se exigidos para este CST/CSOSN</span></summary><div class="nfce-tax-fields"></div></details>';
    const product = item.querySelector('[data-field="product"]');
    product.addEventListener('change', () => {
      const found = state.products.find(p => p.id === product.value);
      item.querySelector('.nfce-line-title').textContent = found?.name || 'Selecione um produto';
      applyProduct(item);
    });
    item.querySelector('[data-field="cfop"]').addEventListener('input', event => {
      event.currentTarget.dataset.manual = 'true';
      refreshOperationSuggestion(item);
      renderAdvanced(item);
      updateTaxSummary(item);
    });
    ['csosn', 'pisCst', 'cofinsCst'].forEach(name => item.querySelector('[data-field="' + name + '"]').addEventListener('change', event => {
      event.currentTarget.dataset.manual = 'true';
      event.currentTarget.dataset.source = 'manual';
      renderAdvanced(item);
      updateTaxSummary(item);
    }));
    ['ncm', 'cest'].forEach(name => item.querySelector('[data-field="' + name + '"]').addEventListener('input', event => {
      event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, name === 'ncm' ? 8 : 7);
      event.currentTarget.dataset.manual = 'true';
      updateTaxSummary(item);
    }));
    item.querySelector('[data-field="origin"]').addEventListener('change', event => {
      event.currentTarget.dataset.manual = 'true';
      updateTaxSummary(item);
    });
    ['quantity', 'price'].forEach(name => item.querySelector('[data-field="' + name + '"]').addEventListener('input', updateTotal));
    item.querySelector('.nfce-remove-item').addEventListener('click', () => { item.remove(); updateTotal(); });
    $('nfceItems').append(item);
    if (state.products.length === 1) { product.value = state.products[0].id; product.dispatchEvent(new Event('change')); }
    return item;
  }

  function addPayment() {
    if (document.querySelectorAll('.nfce-payment-row').length >= 20) { notice('Adicione até 20 formas de pagamento.', true); return; }
    const row = document.createElement('article');
    row.className = 'nfce-payment-row';
    row.innerHTML = '<div class="nfce-payment-core"><label>Forma de pagamento <span class="required">*</span><select data-payment="method" required>' + selectOptions(paymentOptions, 'Selecione') + '</select></label>' +
      '<label>Pagamento <span class="required">*</span><select data-payment="indicator" required><option value="0">À vista</option><option value="1">A prazo</option></select></label>' +
      '<label>Valor (R$) <span class="required">*</span><input data-payment="amount" type="number" min="0" step="0.01" required></label>' +
      '<button class="nfce-remove-payment" type="button" aria-label="Remover forma de pagamento">Remover</button></div><div class="nfce-payment-extra" hidden></div>';
    const method = row.querySelector('[data-payment="method"]');
    method.dataset.previous = '';
    method.addEventListener('change', () => {
      const amount = row.querySelector('[data-payment="amount"]');
      const indicator = row.querySelector('[data-payment="indicator"]');
      if (method.value === '91') {
        indicator.value = '1';
        amount.value = '0.00';
        amount.dataset.manual = 'true';
      } else if (method.dataset.previous === '91') {
        indicator.value = '0';
        amount.value = document.querySelectorAll('.nfce-payment-row').length === 1 ? (totalCents() / 100).toFixed(2) : '';
        delete amount.dataset.manual;
      } else if (amount.value === '0.00' || amount.value === '0') {
        amount.value = '';
        delete amount.dataset.manual;
      }
      method.dataset.previous = method.value;
      renderPaymentExtra(row);
      updatePaymentTotal();
    });
    row.querySelector('[data-payment="amount"]').addEventListener('input', event => { event.currentTarget.dataset.manual = 'true'; updatePaymentTotal(); });
    row.querySelector('.nfce-remove-payment').addEventListener('click', () => { row.remove(); updatePaymentTotal(); });
    $('nfcePayments').append(row);
    if (document.querySelectorAll('.nfce-payment-row').length === 1) row.querySelector('[data-payment="amount"]').value = (totalCents() / 100).toFixed(2);
    updatePaymentTotal();
    return row;
  }

  function renderPaymentExtra(row) {
    const method = row.querySelector('[data-payment="method"]').value;
    const extra = row.querySelector('.nfce-payment-extra');
    extra.replaceChildren();
    extra.hidden = !['03', '04', '05', '99'].includes(method);
    if (['03', '04', '17'].includes(method)) {
      const isPix = method === '17';
      const brand = isPix ? '' : '<label>Bandeira <span class="optional">quando aplicável</span><select data-payment="brand">' + selectOptions(cardBrands, 'Selecione se aplicável') + '</select></label>';
      extra.innerHTML = '<label>' + (isPix ? 'Integração do Pix' : 'Integração do cartão') + ' <span class="required">*</span><select data-payment="integration" required><option value="">Selecione</option><option value="1">Integrado ao sistema</option><option value="2">Não integrado (POS)</option></select></label>' +
        '<label>' + (isPix ? 'Instituição de pagamento' : 'Credenciadora') + ' <span class="optional">CNPJ quando integrado</span><input data-payment="acquirer" inputmode="text" maxlength="18" placeholder="CNPJ"></label>' + brand +
        '<label>Código de autorização <span class="optional">quando integrado</span><input data-payment="authorization" maxlength="128" placeholder="Código da transação"></label>';
      const integration = extra.querySelector('[data-payment="integration"]');
      const acquirer = extra.querySelector('[data-payment="acquirer"]');
      const authorization = extra.querySelector('[data-payment="authorization"]');
      integration.addEventListener('change', () => {
        const isIntegrated = integration.value === '1';
        acquirer.required = isIntegrated;
        authorization.required = isIntegrated;
        acquirer.closest('label').querySelector('.optional').textContent = isIntegrated ? 'obrigatório quando integrado' : 'CNPJ quando aplicável';
        authorization.closest('label').querySelector('.optional').textContent = isIntegrated ? 'obrigatório quando integrado' : 'quando disponível';
      });
    } else if (method === '99') {
      extra.innerHTML = '<label>Descrição da forma de pagamento <span class="required">*</span><input data-payment="description" maxlength="60" minlength="2" required placeholder="Descreva como o cliente pagou"></label>';
    }
  }

  function itemInput(row) {
    const values = {};
    row.querySelectorAll('[data-tax]').forEach(input => { if (input.value.trim() !== '') values[input.dataset.tax] = Number(input.value); });
    const manualFocus = [...row.querySelectorAll('[data-tax]')].filter(input => input.dataset.manual === 'true').map(input => input.dataset.tax);
    const manualTaxFields = ['cfop', 'ncm', 'cest', 'origin', 'csosn', 'pisCst', 'cofinsCst'].filter(name => row.querySelector('[data-field="' + name + '"]')?.dataset.manual === 'true');
    return {
      productId: row.querySelector('[data-field="product"]').value,
      quantity: Number(row.querySelector('[data-field="quantity"]').value),
      unitPrice: Number(row.querySelector('[data-field="price"]').value),
      cfop: row.querySelector('[data-field="cfop"]').value.trim(),
      ncm: row.querySelector('[data-field="ncm"]').value.trim(),
      cest: row.querySelector('[data-field="cest"]').value.trim(),
      origin: row.querySelector('[data-field="origin"]').value,
      csosn: row.querySelector('[data-field="csosn"]').value,
      pisCst: row.querySelector('[data-field="pisCst"]').value,
      cofinsCst: row.querySelector('[data-field="cofinsCst"]').value,
      manualTaxFields, focusFields: values, manualFocusFields: manualFocus,
    };
  }

  function paymentInput(row) {
    return {
      method: row.querySelector('[data-payment="method"]').value,
      indicatorPayment: row.querySelector('[data-payment="indicator"]').value,
      amount: Number(row.querySelector('[data-payment="amount"]').value),
      description: row.querySelector('[data-payment="description"]')?.value.trim() || '',
      integrationType: row.querySelector('[data-payment="integration"]')?.value || '',
      acquirerCnpj: row.querySelector('[data-payment="acquirer"]')?.value.trim() || '',
      cardBrand: row.querySelector('[data-payment="brand"]')?.value || '',
      authorization: row.querySelector('[data-payment="authorization"]')?.value.trim() || '',
    };
  }

  function providerReason(response) { return response?.mensagem_sefaz || response?.mensagem || response?.erro || response?.status_sefaz || ''; }

  function fileButton(row, kind, label, available) {
    return available ? '<button type="button" data-file-kind="' + safe(kind) + '" data-file-id="' + safe(row.id) + '">' + safe(label) + '</button>' : '';
  }

  function renderDraftReview(review) {
    if (!review || !Array.isArray(review.items)) return '';
    const originNames = ['Nacional', 'Estrangeira · importação direta', 'Estrangeira · mercado interno', 'Nacional · conteúdo importado acima de 40%', 'Nacional · processo produtivo básico', 'Nacional · conteúdo importado até 40%', 'Estrangeira · sem similar nacional', 'Estrangeira · mercado interno sem similar nacional', 'Nacional · conteúdo importado acima de 70%'];
    const rtcTaxLabels = {
      ibs_cbs_base_calculo: 'Base IBS/CBS (R$)', ibs_uf_aliquota: 'Alíquota IBS estadual (%)',
      ibs_uf_valor: 'IBS estadual (R$)', ibs_mun_aliquota: 'Alíquota IBS municipal (%)',
      ibs_mun_valor: 'IBS municipal (R$)', cbs_aliquota: 'Alíquota CBS (%)', cbs_valor: 'CBS (R$)',
    };
    const items = review.items.map(item => {
      const origin = String(item.origin || '');
      const focusTaxes = item.focusTaxes && typeof item.focusTaxes === 'object' ? item.focusTaxes : {};
      const taxValues = Object.entries(focusTaxes).map(([field, value]) => '<li><span>' + safe(taxLabels[field] || rtcTaxLabels[field] || field) + '</span><strong>' + safe(value) + '</strong></li>').join('');
      const fiscal = [
        'CFOP ' + (item.cfop || '—'), 'NCM ' + (item.ncm || '—'),
        'Origem ' + (origin ? origin + ' · ' + (originNames[Number(origin)] || 'código informado') : 'pendente'),
        'CSOSN ' + (item.csosn || '—'), 'PIS CST ' + (item.pisCst || '—'),
        'Cofins CST ' + (item.cofinsCst || '—'),
      ];
      if (item.cest) fiscal.push('CEST ' + item.cest);
      return '<li><div><strong>' + safe(item.quantity) + ' × ' + safe(item.name || 'Produto') + '</strong><span>' + money(Number(item.unitPrice)) + ' cada · ' + money(Number(item.total)) + '</span></div><small>' + safe(fiscal.join(' · ')) + '</small>' +
        '<details class="nfce-draft-tax-review"><summary>Valores tributários numéricos</summary>' + (taxValues ? '<ul>' + taxValues + '</ul>' : '<span>Nenhum valor numérico adicional consta no payload.</span>') + '</details></li>';
    }).join('');
    const payments = Array.isArray(review.payments) ? review.payments.map(payment => {
      const method = paymentOptions.find(([code]) => code === payment.method)?.[1] || ('Forma ' + (payment.method || 'não informada'));
      const timing = payment.indicator === '1' ? 'a prazo' : 'à vista';
      const description = payment.description ? ' · ' + safe(payment.description) : '';
      return '<li>' + safe(method) + ' · ' + timing + ' · ' + money(Number(payment.amount)) + description + '</li>';
    }).join('') : '';
    return '<details class="nfce-draft-review"><summary>Conferir itens, impostos e pagamento</summary><div class="nfce-draft-review-body">' +
      '<p><strong>' + safe(review.nature || 'Natureza não informada') + '</strong></p>' +
      '<ul class="nfce-draft-review-items">' + items + '</ul>' +
      '<strong>Pagamentos</strong><ul class="nfce-draft-review-payments">' + (payments || '<li>Nenhum pagamento informado</li>') + '</ul></div></details>';
  }

  function setCapabilities(capabilities = {}) {
    state.canIssue = capabilities.canIssue === true;
    state.canCancel = capabilities.canCancel === true;
    $('nfcePrepare').disabled = !state.canIssue;
    $('nfceAddItem').disabled = !state.canIssue;
    $('nfceAddPayment').disabled = !state.canIssue;
    $('nfceSend').disabled = !state.canIssue || !draftId || !$('nfceConfirm').checked;
  }

  function renderList(rows) {
    const body = rows.map(row => {
      const response = row.provider_response?.response || {};
      const key = row.access_key || response.chave_nfe || '—';
      const reference = row.focus_reference || response.ref || '';
      const reason = providerReason(response);
      const authorized = ['authorized', 'cancelled'].includes(row.status);
      const files = [
        fileButton(row, 'danfce', 'Baixar DANFCe', authorized && Boolean(row.pdf_storage_path || response.caminho_danfe)),
        fileButton(row, 'xml', 'Baixar XML', authorized && Boolean(row.xml_storage_path || response.caminho_xml_nota_fiscal)),
        fileButton(row, 'cancelamento', 'XML do cancelamento', row.status === 'cancelled' && Boolean(response.caminho_xml_cancelamento)),
      ].filter(Boolean).join(' ');
      const action = row.status === 'processing'
        ? '<button type="button" data-reconcile="' + safe(row.id) + '">Consultar status</button>'
        : row.status === 'draft'
          ? '<button type="button" data-resume="' + safe(row.id) + '" data-total="' + safe(row.totalCents || 0) + '" data-reference="' + safe(reference) + '">Selecionar rascunho</button>' + renderDraftReview(row.draftReview)
          : row.status === 'authorized' && state.canCancel
            ? '<button type="button" data-cancel="' + safe(row.id) + '">Cancelar cupom</button>' : '';
      return '<tr><td>' + safe(row.document_number || '—') + (row.series ? ' · série ' + safe(row.series) : '') + '<small>' + safe(new Date(row.created_at).toLocaleString('pt-BR')) + '</small></td>' +
        '<td><span class="nfce-status nfce-status-' + safe(row.status) + '">' + safe(labels[row.status] || row.status) + '</span>' + (reason ? '<small>' + safe(reason) + '</small>' : '') + '</td>' +
        '<td>' + safe(key) + (reference ? '<small>Ref. ' + safe(reference) + '</small>' : '') + '</td><td>' + money(Number(row.totalCents || 0) / 100) + '</td><td>' + [files, action].filter(Boolean).join('<br>') + '</td></tr>';
    }).join('');
    $('nfceList').innerHTML = rows.length
      ? '<div class="nfce-table-scroll"><table><thead><tr><th>Número</th><th>Situação e retorno</th><th>Chave / referência</th><th>Valor</th><th>Ações</th></tr></thead><tbody>' + body + '</tbody></table></div>'
      : '<div class="nfce-empty"><strong>Nenhum cupom registrado nesta empresa</strong><span>As notas autorizadas, rejeitadas, canceladas e as preparadas aparecerão aqui.</span></div>';
  }

  async function load() {
    const [records, docs] = await Promise.all([api('/api/records?scope=products'), api('/api/fiscal/nfce-drafts')]);
    state.products = (records.products || []).filter(item => item.active);
    state.profiles = Array.isArray(docs.profiles) ? docs.profiles : [];
    state.productProfileIds = docs.productProfileIds || {};
    state.defaults = docs.defaults || {};
    setCapabilities(docs.capabilities || {});
    if (!document.querySelector('.nfce-line-item')) addItem();
    if (!document.querySelector('.nfce-payment-row')) addPayment();
    renderList(docs.documents || []);
    notice(!state.canIssue
      ? 'Seu perfil pode consultar os documentos desta empresa, mas a emissão e o cancelamento ficam disponíveis para administradores e operadores autorizados.'
      : docs.defaults?.isJvgPilot
      ? 'Cupom em ambiente de teste. As sugestões fiscais da empresa piloto podem ser alteradas por item.'
      : 'Cupom em ambiente de teste. Confira os dados fiscais de cada produto; não há padrões de outra empresa aplicados.');
    updateDeliveryFields();
  }

  function updateDeliveryFields() {
    const presence = $('nfcePresence').value;
    const delivery = presence === '4';
    const hasIntermediaryRule = ['1', '4'].includes(presence);
    if (hasIntermediaryRule && !$('nfceIntermediary').value) $('nfceIntermediary').value = '0';
    const marketplace = hasIntermediaryRule && $('nfceIntermediary').value === '1';
    const thirdParty = delivery && $('nfceTransportMode').value === 'third_party';
    $('nfceIntermediaryFields').hidden = !hasIntermediaryRule;
    $('nfceDeliveryFields').hidden = !delivery;
    $('nfceMarketplaceFields').hidden = !marketplace;
    $('nfceThirdPartyFields').hidden = !thirdParty;
    [
      'nfceDeliveryStreet', 'nfceDeliveryNumber', 'nfceDeliveryDistrict', 'nfceDeliveryCity', 'nfceDeliveryState',
    ].forEach(id => { $(id).required = delivery; });
    $('nfceIntermediary').required = hasIntermediaryRule;
    $('nfceTransportMode').required = delivery;
    $('nfceIntermediaryCnpj').required = marketplace;
    $('nfceIntermediaryId').required = marketplace;
    $('nfceCarrierName').required = thirdParty;
    $('nfceRecipientName').required = delivery;
    const nameMarker = $('nfceRecipientName').closest('label').querySelector('[data-consumer-required]');
    nameMarker.textContent = delivery ? 'obrigatório para entrega' : 'opcional';
    nameMarker.className = delivery ? 'required' : 'optional';
    $('nfceConsumerHelp').textContent = delivery
      ? 'Para entrega a domicílio, informe o nome e um documento do consumidor: CPF ou CNPJ.'
      : 'Para identificar outra pessoa ou empresa, informe o nome e apenas um documento. Para venda sem identificação, deixe esses campos vazios.';
    const identificationMissing = delivery && !$('nfceCpf').value.trim() && !$('nfceCnpj').value.trim();
    $('nfceCpf').setCustomValidity(identificationMissing ? 'Informe o CPF ou o CNPJ para entrega a domicílio.' : '');
    $('nfceCnpj').setCustomValidity(identificationMissing ? 'Informe o CPF ou o CNPJ para entrega a domicílio.' : '');
  }

  async function prepare(event) {
    event.preventDefault();
    if (busy) return;
    if (!state.canIssue) { notice('Seu perfil não pode preparar cupons fiscais.', true); return; }
    issueList([]);
    const rows = [...document.querySelectorAll('.nfce-line-item')];
    const payments = [...document.querySelectorAll('.nfce-payment-row')];
    if (!rows.length) { issueList(['Adicione ao menos um item.']); return; }
    if (!payments.length) { issueList(['Adicione ao menos uma forma de pagamento.']); return; }
    if (!$('nfceForm').reportValidity()) return;
    busy = true;
    $('nfcePrepare').disabled = true;
    try {
      const result = await api('/api/fiscal/nfce-drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          naturezaOperacao: $('nfceNature').value.trim(),
          presencaComprador: $('nfcePresence').value, recipientName: $('nfceRecipientName').value,
          cpf: $('nfceCpf').value, cnpj: $('nfceCnpj').value,
          deliveryAddress: {
            street: $('nfceDeliveryStreet').value, number: $('nfceDeliveryNumber').value,
            complement: $('nfceDeliveryComplement').value, district: $('nfceDeliveryDistrict').value,
            city: $('nfceDeliveryCity').value, state: $('nfceDeliveryState').value,
            postalCode: $('nfceDeliveryPostalCode').value,
          },
          intermediaryIndicator: $('nfceIntermediary').value,
          intermediaryCnpj: $('nfceIntermediaryCnpj').value,
          intermediaryId: $('nfceIntermediaryId').value,
          transporter: {
            mode: $('nfceTransportMode').value, name: $('nfceCarrierName').value,
            cnpj: $('nfceCarrierCnpj').value, cpf: $('nfceCarrierCpf').value,
            address: $('nfceCarrierAddress').value, city: $('nfceCarrierCity').value,
            state: $('nfceCarrierState').value,
          },
          changeAmount: Number($('nfceChange').value || 0),
          payments: payments.map(paymentInput), items: rows.map(itemInput),
        }),
      });
      draftId = result.id;
      $('nfceReference').textContent = result.reference || 'Preparada';
      $('nfceTotal').textContent = money(result.totalCents / 100);
      $('nfceSend').disabled = !state.canIssue || !$('nfceConfirm').checked;
      issueList([]);
      notice('Cupom preparado e salvo. Revise os dados antes de enviar em ambiente de teste.');
      await refresh();
    } catch (error) {
      issueList(error.issues);
      notice(error.message, true);
    } finally {
      busy = false;
      $('nfcePrepare').disabled = !state.canIssue;
      $('nfceSend').disabled = !state.canIssue || !draftId || !$('nfceConfirm').checked;
    }
  }

  async function transmit() {
    if (busy || !state.canIssue || !draftId || !$('nfceConfirm').checked) return;
    busy = true;
    $('nfceSend').disabled = true;
    try {
      const data = await api('/api/fiscal/nfce-drafts/transmit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId, confirmHomologation: true }),
      });
      notice(data.message || 'Solicitação enviada ao ambiente de teste.');
      draftId = '';
      $('nfceReference').textContent = 'Consulte o histórico para acompanhar o retorno';
      await refresh();
    } catch (error) {
      issueList(error.issues);
      notice(error.message, true);
    } finally {
      busy = false;
      $('nfceSend').disabled = !state.canIssue || !draftId || !$('nfceConfirm').checked;
    }
  }

  async function refresh() {
    try { const data = await api('/api/fiscal/nfce-drafts'); setCapabilities(data.capabilities || {}); renderList(data.documents || []); }
    catch (error) { notice(error.message, true); }
  }

  async function reconcile(id) {
    if (busy) return;
    busy = true;
    try {
      const data = await api('/api/fiscal/nfce-drafts/reconcile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      notice(data.message || 'Consulta concluída.');
      await refresh();
    } catch (error) { notice(error.message, true); }
    finally { busy = false; }
  }

  function openCancel(id) {
    cancelId = id;
    $('nfceCancelReason').value = '';
    $('nfceCancelFeedback').textContent = '';
    $('nfceCancelSubmit').disabled = false;
    $('nfceCancelDialog').showModal();
    $('nfceCancelReason').focus();
  }

  async function cancelDocument(event) {
    event.preventDefault();
    if (busy || !state.canCancel || !cancelId || !$('nfceCancelForm').reportValidity()) return;
    busy = true;
    $('nfceCancelSubmit').disabled = true;
    $('nfceCancelFeedback').textContent = 'Aguardando confirmação do cancelamento…';
    try {
      const data = await api('/api/fiscal/nfce-drafts/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cancelId, justificativa: $('nfceCancelReason').value.trim() }),
      });
      $('nfceCancelDialog').close();
      notice(data.message || 'Solicitação de cancelamento concluída.');
      cancelId = '';
      await refresh();
    } catch (error) {
      $('nfceCancelFeedback').textContent = error.message;
      notice(error.message, true);
      await refresh();
    } finally {
      busy = false;
      $('nfceCancelSubmit').disabled = false;
    }
  }

  async function downloadDocument(id, kind, button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      const response = await fetch('/api/fiscal/nfce-drafts/document?id=' + encodeURIComponent(id) + '&kind=' + encodeURIComponent(kind), {
        credentials: 'same-origin', cache: 'no-store',
      });
      const type = response.headers.get('content-type') || '';
      if (!response.ok) {
        const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
        throw new ApiError(data.error || 'Não foi possível baixar o arquivo.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'nfce-' + id.slice(0, 8) + (kind === 'cancelamento' ? '-cancelamento' : '') + (kind === 'danfce' ? '.html' : '.xml');
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notice('Download iniciado.');
    } catch (error) { notice(error.message, true); }
    finally { busy = false; button.disabled = false; }
  }

  function selectDraft(button) {
    draftId = button.dataset.resume;
    $('nfceConfirm').checked = false;
    $('nfceSend').disabled = true;
    $('nfceReference').textContent = button.dataset.reference || draftId;
    $('nfceTotal').textContent = money(Number(button.dataset.total || 0) / 100);
    $('nfceSend').scrollIntoView({ behavior: 'smooth', block: 'center' });
    notice('Rascunho selecionado. Confirme o envio de teste para transmiti-lo.');
  }

  $('nfceAddItem').addEventListener('click', () => addItem());
  $('nfceAddPayment').addEventListener('click', () => addPayment());
  $('nfceForm').addEventListener('submit', prepare);
  $('nfceConfirm').addEventListener('change', () => { $('nfceSend').disabled = !state.canIssue || !draftId || !$('nfceConfirm').checked; });
  $('nfceSend').addEventListener('click', transmit);
  $('nfceRefresh').addEventListener('click', refresh);
  $('nfcePresence').addEventListener('change', updateDeliveryFields);
  $('nfceIntermediary').addEventListener('change', updateDeliveryFields);
  $('nfceTransportMode').addEventListener('change', updateDeliveryFields);
  ['nfceCpf', 'nfceCnpj'].forEach(id => $(id).addEventListener('input', updateDeliveryFields));
  $('nfceChange').addEventListener('input', updatePaymentTotal);
  $('nfceCancelClose').addEventListener('click', () => $('nfceCancelDialog').close());
  $('nfceCancelForm').addEventListener('submit', cancelDocument);
  $('nfceList').addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.reconcile) void reconcile(target.dataset.reconcile);
    if (target.dataset.resume) selectDraft(target);
    if (target.dataset.cancel) openCancel(target.dataset.cancel);
    if (target.dataset.fileKind && target.dataset.fileId) void downloadDocument(target.dataset.fileId, target.dataset.fileKind, target);
  });
  load().catch(error => notice(error.message, true));
})();
