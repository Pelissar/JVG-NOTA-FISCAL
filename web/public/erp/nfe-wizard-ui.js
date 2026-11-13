(function () {
  'use strict';

  var form = document.getElementById('draftForm');
  var stepNav = document.querySelector('.fiscal-steps');
  var grid = document.querySelector('.layout > .grid');
  if (!form || !stepNav || !grid) return;

  var steps = [
    ['general', 'Natureza', 'Defina o tipo de operação e as datas reais.'],
    ['recipient', 'Destinatário', 'Confira identificação, inscrição estadual e endereço.'],
    ['items', 'Produtos e dados fiscais', 'Informe os códigos fiscais diretamente em cada item; o perfil é opcional.'],
    ['totals', 'Totais da NF-e', 'Informe frete, seguro, desconto e despesas quando existirem.'],
    ['billing', 'Faturamento', 'Registre as formas e condições de pagamento reais.'],
    ['transport', 'Transportador', 'Preencha transporte e volumes quando aplicáveis.'],
    ['intermediary', 'Intermediador', 'Informe se uma plataforma de terceiros participou da venda.'],
    ['review', 'Conferência', 'Revise os dados e escolha como concluir a nota.'],
  ];
  var currentStep = 0;
  var unlockedThrough = 0;
  var paymentsRoot;
  var totalsRoot;
  var validationSummary;

  function localDateTimeValue(date) {
    function pad(value) { return String(value).padStart(2, '0'); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function setDefaultIssueAt(force) {
    var issueAt = form.elements.namedItem('issueAt');
    if (issueAt && (force || !issueAt.value || issueAt.dataset.userEdited !== 'true'))
      issueAt.value = localDateTimeValue(new Date());
  }

  function makeField(label, name, type, attrs) {
    var wrapper = document.createElement('label');
    wrapper.className = 'field';
    var caption = document.createElement('span');
    caption.textContent = label;
    var input = document.createElement(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    input.name = name;
    if (type !== 'select' && type !== 'textarea') input.type = type || 'text';
    Object.keys(attrs || {}).forEach(function (key) { input.setAttribute(key, attrs[key]); });
    wrapper.append(caption, input);
    return { wrapper: wrapper, input: input };
  }

  function addOption(select, value, label) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function insertSection(key, title, beforeKey) {
    var section = document.createElement('section');
    section.dataset.fiscalSection = key;
    section.id = 'nfe-step-' + key;
    section.hidden = true;
    var heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    var before = form.querySelector('[data-fiscal-section="' + beforeKey + '"]');
    before.parentNode.insertBefore(section, before);
    return section;
  }

  function prepareWizard() {
    form.noValidate = true;
    var issueAtField = form.elements.namedItem('issueAt');
    if (issueAtField) {
      issueAtField.required = true;
      var issueAtWrapper = issueAtField.closest('.field');
      var issueAtLabel = issueAtWrapper && issueAtWrapper.querySelector('span');
      if (issueAtLabel) issueAtLabel.textContent = 'Data e hora de emissão *';
      var issueAtHint = issueAtWrapper && issueAtWrapper.querySelector('small');
      if (issueAtHint) issueAtHint.textContent = 'Preenchida automaticamente com a data e hora locais. Você pode alterar antes de salvar.';
      issueAtField.addEventListener('input', function () { issueAtField.dataset.userEdited = 'true'; });
      issueAtField.addEventListener('change', function () { issueAtField.dataset.userEdited = 'true'; });
    }
    setDefaultIssueAt();
    var layout = document.querySelector('main.layout');
    if (layout) layout.classList.add('nfe-layout');
    var formPanel = form.closest('.panel');
    formPanel.classList.add('nfe-form-panel');
    var formBody = form.querySelector('.panel-body');
    if (formBody) {
      formBody.classList.add('nfe-step-content');
      validationSummary = document.createElement('div');
      validationSummary.className = 'wizard-validation-summary';
      validationSummary.setAttribute('role', 'alert');
      validationSummary.setAttribute('aria-live', 'assertive');
      validationSummary.hidden = true;
      formBody.prepend(validationSummary);
    }
    var formFooter = form.querySelector('.form-footer');
    if (formFooter) formFooter.classList.add('wizard-footer');
    var panelHeading = formPanel.querySelector('.panel-head');
    if (panelHeading) {
      var headingTitle = panelHeading.querySelector('h2');
      var headingDescription = panelHeading.querySelector('p');
      var headingCounter = panelHeading.querySelector('.step-tag');
      if (headingTitle) headingTitle.id = 'stepHeading';
      if (headingDescription) headingDescription.id = 'stepDescription';
      if (headingCounter) headingCounter.id = 'stepCounter';
    }
    var wizard = document.createElement('div');
    wizard.className = 'nfe-wizard';
    grid.parentNode.insertBefore(wizard, stepNav);
    wizard.append(stepNav, grid);
    grid.classList.add('nfe-grid');
    var supportDetails = document.createElement('details');
    supportDetails.className = 'fiscal-support';
    var supportSummary = document.createElement('summary');
    supportSummary.textContent = 'Conexão Focus e prontidão para homologação';
    var supportContent = document.createElement('div');
    supportContent.className = 'fiscal-support-content';
    supportDetails.append(supportSummary, supportContent);
    var supportPanels = [document.querySelector('.focus-panel'), document.querySelector('.readiness-panel')];
    supportPanels.forEach(function (panel) { if (panel) supportContent.append(panel); });
    wizard.after(supportDetails);

    var tabs = Array.from(stepNav.querySelectorAll('[data-fiscal-tab]'));
    var byKey = {};
    tabs.forEach(function (tab) { byKey[tab.dataset.fiscalTab] = tab; });
    if (byKey.payment) {
      byKey.payment.dataset.fiscalTab = 'billing';
      byKey.billing = byKey.payment;
      delete byKey.payment;
    }
    if (byKey.review) byKey.review.remove();
    var labels = {
      general: 'Natureza', recipient: 'Destinatário', items: 'Produtos e regras fiscais',
      billing: 'Faturamento', transport: 'Transportador', review: 'Conferência',
    };
    steps.forEach(function (step, index) {
      var key = step[0], tab = byKey[key];
      if (!tab) {
        tab = document.createElement('button');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.dataset.fiscalTab = key;
      }
      tab.replaceChildren();
      var number = document.createElement('span');
      number.textContent = String(index + 1).padStart(2, '0');
      var label = document.createElement('span');
      label.textContent = labels[key] || step[1];
      tab.append(number, label);
      tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      tab.setAttribute('aria-controls', 'nfe-step-' + key);
      tab.classList.toggle('selected', index === 0);
      stepNav.append(tab);
      tab.addEventListener('click', function () {
        if (index <= unlockedThrough) goToStep(index, false);
      });
    });

    var sections = {};
    Array.from(form.querySelectorAll('[data-fiscal-section]')).forEach(function (section) {
      sections[section.dataset.fiscalSection] = section;
    });
    if (sections.payment) {
      sections.payment.dataset.fiscalSection = 'billing';
      sections.billing = sections.payment;
      delete sections.payment;
    }
    Object.keys(sections).forEach(function (key) { sections[key].id = 'nfe-step-' + key; });
    if (!sections.totals) sections.totals = insertSection('totals', 'Totais comerciais', 'transport');
    if (!sections.intermediary) sections.intermediary = insertSection('intermediary', 'Intermediador ou marketplace', 'review');
    if (sections.review) sections.review.id = 'nfe-step-review';

    var general = sections.general;
    var generalGrid = general.querySelector('.field-grid') || general;
    var natureSearch = makeField('Buscar natureza por CFOP ou descri\u00e7\u00e3o', 'natureCfopSearch', 'search', {
      list: 'natureCfopOptions', maxlength: '180', autocomplete: 'off',
      placeholder: 'Ex.: 5102, venda de mercadoria',
      'aria-describedby': 'natureCfopHint'
    });
    natureSearch.wrapper.id = 'natureCfopSearchField';
    var natureHint = document.createElement('small');
    natureHint.id = 'natureCfopHint';
    natureHint.textContent = 'Cat\u00e1logo oficial e apelido da empresa, se houver. Ao escolher, o CFOP vira sugest\u00e3o para os itens; confira produto, opera\u00e7\u00e3o, destinat\u00e1rio e local de entrega.';
    natureSearch.wrapper.append(natureHint);
    var natureOptions = document.createElement('datalist');
    natureOptions.id = 'natureCfopOptions';
    var natureField = general.querySelector('[name="nature"]');
    if (natureField && natureField.closest('.field')) {
      natureField.closest('.field').insertAdjacentElement('afterend', natureSearch.wrapper);
    } else {
      generalGrid.append(natureSearch.wrapper);
    }
    general.append(natureOptions);
    natureSearch.input.addEventListener('change', function () {
      if (typeof window.jvgNfeApplyNatureCfop === 'function') window.jvgNfeApplyNatureCfop(natureSearch.input.value);
    });
    var cfop = makeField('CFOP da nota (resumo dos itens)', 'headerCfop', 'text', { readonly: 'readonly', placeholder: 'Definido por item' });
    cfop.wrapper.id = 'headerCfopField';
    cfop.input.id = 'headerCfopSummary';
    var exitAt = makeField('Data e hora de saída', 'exitAt', 'datetime-local');
    exitAt.wrapper.id = 'exitAtField';
    var purpose = general.querySelector('[name="purpose"]');
    if (purpose && purpose.parentNode) {
      purpose.parentNode.insertAdjacentElement('afterend', cfop.wrapper);
      cfop.wrapper.insertAdjacentElement('afterend', exitAt.wrapper);
      var note = document.createElement('small');
      note.textContent = 'O CFOP pode variar por produto. O resumo só aparece quando os itens coincidem.';
      cfop.wrapper.append(note);
    }
    var sourceOrderNotice = document.getElementById('sourceOrderNotice');
    if (sourceOrderNotice) general.append(sourceOrderNotice);

    var recipient = sections.recipient;
    var recipientGrid = recipient.querySelector('.field-grid') || recipient;
    var ie = makeField('Indicador de inscrição estadual', 'recipientIeIndicator', 'select');
    addOption(ie.input, '', 'Selecione conforme a operação');
    addOption(ie.input, '1', '1 · Contribuinte de ICMS');
    addOption(ie.input, '2', '2 · Contribuinte isento');
    addOption(ie.input, '9', '9 · Não contribuinte');
    recipientGrid.append(ie.wrapper);
    var recipientCard = document.createElement('div');
    recipientCard.id = 'recipientPreview';
    recipientCard.className = 'recipient-card';
    recipientCard.setAttribute('aria-live', 'polite');
    recipientCard.textContent = 'Selecione um destinatário para conferir os dados cadastrados.';
    recipient.append(recipientCard);

    totalsRoot = sections.totals;
    totalsRoot.replaceChildren();
    var totalsHeading = document.createElement('h3');
    totalsHeading.textContent = 'Totais comerciais';
    var totalCards = document.createElement('div');
    totalCards.className = 'totals-cards';
    totalCards.innerHTML = '<article><span>Total dos produtos</span><strong id="productTotal">R$ 0,00</strong></article><article class="grand-total"><span>Total comercial informado</span><strong id="commercialTotal">R$ 0,00</strong></article>';
    var totalsFields = document.createElement('div');
    totalsFields.className = 'field-grid totals-fields';
    [['Frete (R$)', 'freight'], ['Seguro (R$)', 'insurance'], ['Desconto total (R$)', 'discount'], ['Outras despesas (R$)', 'expenses']].forEach(function (entry) {
      totalsFields.append(makeField(entry[0], entry[1], 'number', { min: '0', max: '999999999.99', step: '0.01', inputmode: 'decimal', placeholder: '0,00' }).wrapper);
    });
    var taxNote = document.createElement('p');
    taxNote.className = 'fiscal-callout';
    taxNote.innerHTML = '<strong>Tributos não calculados.</strong> O total é soma comercial dos produtos, frete, seguro e despesas, menos desconto. Informe nos itens os campos exigidos por cada CST/CSOSN; perfil tributário é opcional.';
    totalsRoot.append(totalsHeading, totalCards, totalsFields, taxNote);

    paymentsRoot = sections.billing;
    paymentsRoot.classList.remove('fiscal-pending');
    paymentsRoot.replaceChildren();
    var billingHeading = document.createElement('div');
    billingHeading.className = 'items-heading';
    billingHeading.innerHTML = '<div><h3>Faturamento e pagamentos</h3><p>Registre a condição e os valores reais combinados com o cliente.</p></div>';
    var addPayment = document.createElement('button');
    addPayment.type = 'button';
    addPayment.id = 'addPayment';
    addPayment.className = 'add-button';
    addPayment.textContent = '+ Adicionar pagamento';
    billingHeading.append(addPayment);
    var paymentList = document.createElement('div');
    paymentList.id = 'payments';
    paymentList.className = 'payment-list';
    var paymentSummary = document.createElement('div');
    paymentSummary.className = 'payment-summary';
    paymentSummary.innerHTML = '<span>Soma dos pagamentos informados</span><strong id="paymentsTotal">R$ 0,00</strong>';
    var info = makeField('Informações adicionais ao contribuinte', 'additionalInfo', 'textarea', { maxlength: '5000', rows: '4', placeholder: 'Observações verdadeiras para constar no documento' });
    info.wrapper.classList.add('additional-info-field');
    var infoHint = document.createElement('small');
    infoHint.textContent = 'Até 5000 caracteres. Não inclua informações fiscais presumidas.';
    info.wrapper.append(infoHint);
    paymentsRoot.append(billingHeading, paymentList, paymentSummary, info.wrapper);
    addPayment.addEventListener('click', function () { createPaymentRow(); });

    var intermediary = sections.intermediary;
    intermediary.replaceChildren();
    var intermediaryHeading = document.createElement('h3');
    intermediaryHeading.textContent = 'Intermediador ou marketplace';
    var intermediaryText = document.createElement('p');
    intermediaryText.textContent = 'Indique se uma plataforma de terceiros participou desta venda.';
    var intermediaryGrid = document.createElement('div');
    intermediaryGrid.className = 'field-grid';
    var indicator = makeField('Houve intermediador?', 'intermediaryIndicator', 'select');
    addOption(indicator.input, '', 'Selecione conforme a operação');
    addOption(indicator.input, '0', '0 · Sem intermediador / plataforma própria');
    addOption(indicator.input, '1', '1 · Plataforma de terceiros / marketplace');
    var cnpj = makeField('CNPJ do intermediador', 'intermediaryCnpj', 'text', { inputmode: 'numeric', maxlength: '18', placeholder: '00.000.000/0000-00' });
    var intermediaryId = makeField('Identificador na plataforma', 'intermediaryId', 'text', { maxlength: '60', placeholder: 'Identificador fornecido pela plataforma' });
    cnpj.wrapper.classList.add('intermediary-extra');
    intermediaryId.wrapper.classList.add('intermediary-extra');
    cnpj.wrapper.hidden = intermediaryId.wrapper.hidden = true;
    intermediaryGrid.append(indicator.wrapper, cnpj.wrapper, intermediaryId.wrapper);
    var intermediaryHint = document.createElement('p');
    intermediaryHint.className = 'hint';
    intermediaryHint.textContent = 'CNPJ e identificador são exigidos somente quando houver intermediador.';
    intermediary.append(intermediaryHeading, intermediaryText, intermediaryGrid, intermediaryHint);
    indicator.input.addEventListener('change', function () {
      var show = indicator.input.value === '1';
      cnpj.wrapper.hidden = intermediaryId.wrapper.hidden = !show;
      renderReview();
    });

    var review = sections.review;
    review.replaceChildren();
    var reviewHeading = document.createElement('h3');
    reviewHeading.textContent = 'Escolha como concluir';
    var reviewSummary = document.createElement('div');
    reviewSummary.id = 'reviewSummary';
    reviewSummary.className = 'review-summary';
    var summary = document.createElement('div');
    summary.className = 'summary';
    summary.innerHTML = '<span>Total comercial do documento</span><strong id="reviewTotal">R$ 0,00</strong>';
    var finalNote = document.createElement('p');
    finalNote.className = 'fiscal-callout';
    finalNote.innerHTML = '<strong>Revise os dados e escolha a ação.</strong> Você poderá enviar para homologação ou cancelar sem criar documento. A emissão em produção continua bloqueada.';
    review.append(reviewHeading, reviewSummary, summary, finalNote);
    var legacyTotal = document.createElement('strong');
    legacyTotal.id = 'total';
    legacyTotal.hidden = true;
    review.append(legacyTotal);

    var footer = form.querySelector('.form-footer');
    var footerNote = footer && footer.querySelector('p');
    if (footerNote) footerNote.textContent = 'Na etapa final, escolha entre enviar para homologação ou cancelar sem criar documento.';
    var controls = document.createElement('div');
    controls.className = 'wizard-controls';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.id = 'cancelDraft'; cancel.className = 'secondary-button'; cancel.textContent = 'Sair sem salvar';
    var previous = document.createElement('button');
    previous.type = 'button'; previous.id = 'wizardPrev'; previous.className = 'secondary-button'; previous.textContent = 'Anterior';
    var next = document.createElement('button');
    next.type = 'button'; next.id = 'wizardNext'; next.className = 'next-button'; next.textContent = 'Próximo';
    var save = document.getElementById('saveButton');
    if (save) save.textContent = 'Concluir nota';
    controls.append(previous, next, save);
    if (footer) footer.replaceChildren(cancel, controls);
    cancel.addEventListener('click', function () { window.location.assign('/erp/index.html#fiscal'); });
    previous.addEventListener('click', function () { goToStep(currentStep - 1, false); });
    next.addEventListener('click', function () { advanceToStep(currentStep + 1, true); });
    document.addEventListener('keydown', function (event) {
      var target = event.target;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === 'F4') { event.preventDefault(); goToStep(currentStep - 1, false); }
      if (event.key === 'F5') { event.preventDefault(); advanceToStep(currentStep + 1, true); }
      if (event.key === 'F1') { event.preventDefault(); window.location.assign('/erp/index.html#fiscal'); }
    });

    form.addEventListener('input', onFormEdited);
    form.addEventListener('change', onFormEdited);
    document.getElementById('recipientId').addEventListener('change', renderRecipient);
    renderRecipient();
    refreshComputed();
    updateRequiredMarkers();
    syncStepAccess();
    goToStep(0, false);
  }

  function createPaymentRow() {
    var row = document.createElement('article');
    row.className = 'payment-row';
    var indicator = makeField('Condição', 'paymentIndicator', 'select');
    addOption(indicator.input, '', 'Selecione'); addOption(indicator.input, '0', 'À vista'); addOption(indicator.input, '1', 'A prazo');
    var method = makeField('Forma de pagamento', 'paymentMethod', 'select');
    addOption(method.input, '', 'Selecione');
    [['01','Dinheiro'],['02','Cheque'],['03','Cartão de crédito'],['04','Cartão de débito'],['05','Cartão da loja'],['10','Vale alimentação'],['11','Vale refeição'],['12','Vale presente'],['13','Vale combustível'],['14','Duplicata mercantil'],['15','Boleto bancário'],['16','Depósito bancário'],['17','PIX dinâmico'],['18','Transferência / carteira digital'],['19','Fidelidade / cashback'],['20','PIX estático'],['21','Crédito em loja'],['22','Pagamento eletrônico não informado'],['23','PIX automático'],['24','TEF Book Transfer'],['90','Sem pagamento'],['91','Pagamento posterior'],['99','Outros']].forEach(function (item) { addOption(method.input, item[0], item[0] + ' · ' + item[1]); });
    var amount = makeField('Valor (R$)', 'paymentAmount', 'number', { min: '0', max: '999999999.99', step: '0.01', inputmode: 'decimal', placeholder: '0,00' });
    var date = makeField('Data do pagamento', 'paymentDate', 'date');
    var description = makeField('Descrição (forma 99)', 'paymentDescription', 'text', { maxlength: '60' });
    description.wrapper.hidden = true;
    var card = document.createElement('div');
    card.className = 'payment-card-fields';
    card.hidden = true;
    var integration = makeField('Integração de cartão', 'paymentIntegration', 'select');
    addOption(integration.input, '', 'Selecione'); addOption(integration.input, '1', '1 · Integrado'); addOption(integration.input, '2', '2 · Não integrado');
    var acquirer = makeField('CNPJ credenciadora', 'paymentAcquirerCnpj', 'text', { inputmode: 'numeric', maxlength: '18' });
    var authorization = makeField('Nº de autorização', 'paymentAuthorization', 'text', { maxlength: '128' });
    card.append(integration.wrapper, acquirer.wrapper, authorization.wrapper);
    var remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'remove-payment'; remove.textContent = 'Remover';
    remove.setAttribute('aria-label', 'Remover forma de pagamento');
    row.append(indicator.wrapper, method.wrapper, amount.wrapper, date.wrapper, description.wrapper, card, remove);
    method.input.addEventListener('change', sync);
    integration.input.addEventListener('change', sync);
    function sync() {
      var usesDescription = method.input.value === '99';
      var usesCard = ['03','04','05'].includes(method.input.value);
      description.wrapper.hidden = !usesDescription;
      card.hidden = !usesCard;
      acquirer.wrapper.hidden = !usesCard || integration.input.value !== '1';
      authorization.wrapper.hidden = !usesCard || integration.input.value !== '1';
      if (!usesDescription) description.input.value = '';
      if (!usesCard) { integration.input.value = ''; acquirer.input.value = ''; authorization.input.value = ''; }
      if (!usesCard || integration.input.value !== '1') { acquirer.input.value = ''; authorization.input.value = ''; }
      refreshComputed();
    }
    remove.addEventListener('click', function () { row.remove(); refreshComputed(); });
    row.addEventListener('input', refreshComputed);
    row.addEventListener('change', refreshComputed);
    paymentsRoot.querySelector('#payments').append(row);
    refreshComputed();
  }

  function warn(message) {
    var status = document.getElementById('status');
    status.textContent = message;
    status.className = 'notice error';
    return false;
  }

  function requiredControl(control, required) {
    if (!control) return;
    control.required = Boolean(required);
    if (required) control.setAttribute('aria-required', 'true');
    else control.removeAttribute('aria-required');
    var wrapper = control.closest('.field');
    var caption = wrapper && wrapper.querySelector('span');
    if (!caption) return;
    if (!caption.dataset.baseLabel) caption.dataset.baseLabel = caption.textContent.replace(/\s*\*$/, '');
    caption.textContent = caption.dataset.baseLabel + (required ? ' *' : '');
  }

  function updateRequiredMarkers() {
    ['nature', 'issueAt', 'consumerFinal', 'buyerPresence', 'recipientId', 'recipientIeIndicator',
      'transportMode', 'intermediaryIndicator'].forEach(function (name) {
      requiredControl(form.elements.namedItem(name), true);
    });
    Array.from(document.querySelectorAll('#items .item-row')).forEach(function (row) {
      ['.product', '.quantity', '.price', '.cfop', '.csosn', '.pis-cst', '.cofins-cst', '.item-ncm', '.item-origin']
        .forEach(function (selector) { requiredControl(row.querySelector(selector), true); });
      var csosn = row.querySelector('.csosn').value.trim();
      requiredControl(row.querySelector('.item-cest'), ['201', '202', '203', '500'].includes(csosn));
      var fields = Array.from(row.querySelectorAll('.focus-tax-field'));
      fields.forEach(function (field) { requiredControl(field, false); });
      var byName = Object.fromEntries(fields.map(function (field) { return [field.dataset.field, field]; }));
      var csosnGroups = {
        basic: ['icms_modalidade_base_calculo', 'icms_base_calculo', 'icms_reducao_base_calculo', 'icms_aliquota', 'icms_valor'],
        st: ['icms_modalidade_base_calculo_st', 'icms_margem_valor_adicionado_st', 'icms_reducao_base_calculo_st', 'icms_base_calculo_st', 'icms_aliquota_st', 'icms_valor_st'],
        credit: ['icms_aliquota_credito_simples', 'icms_valor_credito_simples'],
        retained: ['icms_base_calculo_retido_st', 'icms_valor_retido_st', 'icms_aliquota_final', 'icms_valor_substituto'],
      };
      var markGroup = function (names) { names.forEach(function (name) { requiredControl(byName[name], true); }); };
      var hasAny = function (names) { return names.some(function (name) { return byName[name] && byName[name].value.trim() !== ''; }); };
      if (csosn === '101') markGroup(csosnGroups.credit);
      if (csosn === '201') { markGroup(csosnGroups.st); markGroup(csosnGroups.credit); }
      if (csosn === '202' || csosn === '203') markGroup(csosnGroups.st);
      if (csosn === '900') {
        if (hasAny(csosnGroups.basic)) markGroup(csosnGroups.basic);
        if (hasAny(csosnGroups.st)) markGroup(csosnGroups.st);
        if (hasAny(csosnGroups.credit)) markGroup(csosnGroups.credit);
      }
      if (csosn === '500' && hasAny(csosnGroups.retained)) markGroup(csosnGroups.retained);
      [['pis', row.querySelector('.pis-cst').value.trim()], ['cofins', row.querySelector('.cofins-cst').value.trim()]]
        .forEach(function (entry) {
          var prefix = entry[0], cst = entry[1];
          if (cst === '01' || cst === '02') markGroup([prefix + '_base_calculo', prefix + '_aliquota_porcentual', prefix + '_valor']);
          if (cst === '03') markGroup([prefix + '_quantidade_vendida', prefix + '_aliquota_valor', prefix + '_valor']);
          if (cst === '05') markGroup([prefix + '_base_calculo_st', prefix + '_aliquota_porcentual_st', prefix + '_valor_st']);
          if (cst === '49' || cst === '99') {
            var percentage = [prefix + '_base_calculo', prefix + '_aliquota_porcentual', prefix + '_valor'];
            var quantity = [prefix + '_quantidade_vendida', prefix + '_aliquota_valor', prefix + '_valor'];
            if (hasAny(percentage)) markGroup(percentage);
            if (hasAny(quantity)) markGroup(quantity);
          }
        });
    });
    var intermediary = form.elements.namedItem('intermediaryIndicator').value === '1';
    requiredControl(form.elements.namedItem('intermediaryCnpj'), intermediary);
    requiredControl(form.elements.namedItem('intermediaryId'), intermediary);
    Array.from(document.querySelectorAll('#payments .payment-row')).forEach(function (row) {
      ['paymentIndicator', 'paymentMethod', 'paymentAmount'].forEach(function (name) {
        requiredControl(row.querySelector('[name="' + name + '"]'), true);
      });
      var method = row.querySelector('[name="paymentMethod"]').value;
      requiredControl(row.querySelector('[name="paymentDescription"]'), method === '99');
      var integratedCard = ['03', '04', '05'].includes(method) && row.querySelector('[name="paymentIntegration"]').value === '1';
      requiredControl(row.querySelector('[name="paymentIntegration"]'), ['03', '04', '05'].includes(method));
      requiredControl(row.querySelector('[name="paymentAcquirerCnpj"]'), integratedCard);
      requiredControl(row.querySelector('[name="paymentAuthorization"]'), integratedCard);
    });
  }

  function value(name) {
    var control = form.elements.namedItem(name);
    return control ? String(control.value || '').trim() : '';
  }

  function partyAddress(party) {
    var nested = party && party.address && typeof party.address === 'object' ? party.address : {};
    return {
      street: nested.street || party && party.street || '', number: nested.number || party && party.number || '',
      complement: nested.complement || party && party.complement || '', district: nested.district || party && party.district || '',
      postalCode: nested.postalCode || party && party.postalCode || '', cityCode: nested.cityCode || party && party.cityCode || '',
      city: nested.city || party && party.city || '', state: nested.state || party && party.state || '',
    };
  }

  function partyDocumentType(party) {
    var type = String(party && (party.documentType || party.type) || '').toLowerCase();
    return type === 'pf' ? 'cpf' : type === 'pj' ? 'cnpj' : type;
  }

  function cpfIsValid(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
    for (var length = 9; length <= 10; length += 1) {
      var sum = 0;
      for (var index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
      var remainder = (sum * 10) % 11;
      if (Number(digits[length]) !== (remainder === 10 ? 0 : remainder)) return false;
    }
    return true;
  }

  function cnpjIsValid(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
    function digit(base, weights) {
      var sum = base.split('').reduce(function (total, char, index) { return total + Number(char) * weights[index]; }, 0);
      var remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    }
    return Number(digits[12]) === digit(digits.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]) &&
      Number(digits[13]) === digit(digits.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  }

  function addStepError(errors, control, message) {
    errors.push({ control: control || null, message: message });
  }

  function validateRecipientStep(errors) {
    var select = form.elements.namedItem('recipientId');
    var indicator = value('recipientIeIndicator');
    if (!select.value) addStepError(errors, select, 'Selecione o destinatário.');
    if (!['1', '2', '9'].includes(indicator))
      addStepError(errors, form.elements.namedItem('recipientIeIndicator'), 'Informe o indicador de inscrição estadual conforme esta operação.');
    if (!select.value) return;
    var client = typeof window.jvgNfeGetRecipient === 'function' ? window.jvgNfeGetRecipient(select.value) : null;
    if (!client) {
      addStepError(errors, select, 'Não foi possível carregar o cadastro deste destinatário. Atualize a página e selecione novamente.');
      return;
    }
    var documentType = partyDocumentType(client);
    var document = String(client.document || client.documentNumber || '').replace(/\D/g, '');
    if (!((documentType === 'cpf' && cpfIsValid(document)) || (documentType === 'cnpj' && cnpjIsValid(document))))
      addStepError(errors, select, 'Complete o CPF/CNPJ do destinatário em Cadastros > Pessoas antes de continuar.');
    var name = String(client.legalName || client.name || client.displayName || '').trim();
    if (name.length < 2 || name.length > 60)
      addStepError(errors, select, 'Complete o nome ou razão social do destinatário (2 a 60 caracteres) em Cadastros > Pessoas.');
    if (indicator === '1' && !String(client.stateRegistration || '').trim())
      addStepError(errors, select, 'O destinatário foi marcado como contribuinte de ICMS, mas o cadastro não tem inscrição estadual.');
    var address = partyAddress(client);
    var missingAddress = [];
    if (!String(address.street || '').trim()) missingAddress.push('logradouro');
    if (!String(address.number || '').trim()) missingAddress.push('número');
    if (!String(address.district || '').trim()) missingAddress.push('bairro');
    if (!/^\d{7}$/.test(String(address.cityCode || '').replace(/\D/g, ''))) missingAddress.push('código IBGE do município');
    if (!String(address.city || '').trim()) missingAddress.push('município');
    if (!/^[A-Za-z]{2}$/.test(String(address.state || '').trim())) missingAddress.push('UF');
    if (missingAddress.length)
      addStepError(errors, select, 'Complete o endereço do destinatário em Cadastros > Pessoas: ' + missingAddress.join(', ') + '.');
  }

  function validateTaxGroups(row, errors, label) {
    var inputs = Array.from(row.querySelectorAll('.focus-tax-field'));
    var byName = Object.fromEntries(inputs.map(function (input) { return [input.dataset.field, input]; }));
    var hasAny = function (names) { return names.some(function (name) { return byName[name] && byName[name].value.trim() !== ''; }); };
    var hasAll = function (names) { return names.every(function (name) { return byName[name] && byName[name].value.trim() !== '' && Number.isFinite(Number(byName[name].value)) && Number(byName[name].value) >= 0; }); };
    var need = function (names, text) {
      if (hasAll(names)) return;
      var control = names.map(function (name) { return byName[name]; }).find(function (input) { return input && !input.value.trim(); }) || byName[names[0]];
      addStepError(errors, control, label + ': ' + text);
    };
    var basic = ['icms_modalidade_base_calculo', 'icms_base_calculo', 'icms_reducao_base_calculo', 'icms_aliquota', 'icms_valor'];
    var st = ['icms_modalidade_base_calculo_st', 'icms_margem_valor_adicionado_st', 'icms_reducao_base_calculo_st', 'icms_base_calculo_st', 'icms_aliquota_st', 'icms_valor_st'];
    var credit = ['icms_aliquota_credito_simples', 'icms_valor_credito_simples'];
    var retained = ['icms_base_calculo_retido_st', 'icms_valor_retido_st', 'icms_aliquota_final', 'icms_valor_substituto'];
    var csosn = row.querySelector('.csosn').value.trim();
    if (csosn === '101') need(credit, 'preencha alíquota e valor do crédito do Simples orientados para este item.');
    if (csosn === '201') { need(st, 'preencha os campos de ICMS-ST indicados para este CSOSN.'); need(credit, 'preencha alíquota e valor do crédito do Simples orientados para este item.'); }
    if (csosn === '202' || csosn === '203') need(st, 'preencha os campos de ICMS-ST indicados para este CSOSN.');
    if (csosn === '900') {
      var basicUsed = hasAny(basic), stUsed = hasAny(st);
      if (basicUsed === stUsed) addStepError(errors, row.querySelector('.csosn'), label + ': CSOSN 900 requer exatamente um grupo preenchido, ICMS ou ICMS-ST.');
      if (basicUsed) need(basic, 'complete todos os campos do grupo ICMS iniciado.');
      if (stUsed) need(st, 'complete todos os campos do grupo ICMS-ST iniciado.');
      if (hasAny(credit)) need(credit, 'complete o grupo de crédito do Simples iniciado.');
    }
    if (csosn === '500' && hasAny(retained)) need(retained, 'complete os campos de ICMS-ST retido que foram iniciados.');
    [['pis', row.querySelector('.pis-cst').value.trim()], ['cofins', row.querySelector('.cofins-cst').value.trim()]]
      .forEach(function (entry) {
        var prefix = entry[0], cst = entry[1];
        if (cst === '01' || cst === '02') need([prefix + '_base_calculo', prefix + '_aliquota_porcentual', prefix + '_valor'], 'preencha base, alíquota e valor conforme orientação fiscal para o CST ' + cst + '.');
        if (cst === '03') need([prefix + '_quantidade_vendida', prefix + '_aliquota_valor', prefix + '_valor'], 'preencha quantidade tributável, alíquota por unidade e valor conforme orientação fiscal para o CST 03.');
        if (cst === '05') need([prefix + '_base_calculo_st', prefix + '_aliquota_porcentual_st', prefix + '_valor_st'], 'preencha base, alíquota e valor de substituição conforme orientação fiscal para o CST 05.');
        if (cst === '49' || cst === '99') {
          var percentage = [prefix + '_base_calculo', prefix + '_aliquota_porcentual', prefix + '_valor'];
          var quantity = [prefix + '_quantidade_vendida', prefix + '_aliquota_valor', prefix + '_valor'];
          var percentageStarted = hasAny(percentage), quantityStarted = hasAny(quantity);
          if (percentageStarted && quantityStarted)
            addStepError(errors, byName[percentage[0]], label + ': informe somente o grupo percentual ou o grupo por quantidade para CST ' + cst + '.');
          else if (percentageStarted) need(percentage, 'complete o grupo percentual iniciado para CST ' + cst + '.');
          else if (quantityStarted) need(quantity, 'complete o grupo por quantidade iniciado para CST ' + cst + '.');
          else addStepError(errors, byName[percentage[0]] || row.querySelector('.' + prefix + '-cst'), label + ': informe um grupo percentual ou por quantidade com os valores orientados para CST ' + cst + '.');
        }
      });
    inputs.forEach(function (input) {
      if (input.value.trim() && (!Number.isFinite(Number(input.value)) || Number(input.value) < 0))
        addStepError(errors, input, label + ': corrija o valor numérico inválido em ' + input.closest('.field').querySelector('span').textContent.replace(/\s*\*$/, '') + '.');
    });
  }

  function validateItemsStep(errors) {
    var rows = Array.from(document.querySelectorAll('#items .item-row'));
    if (!rows.length) {
      addStepError(errors, document.getElementById('addItem'), 'Adicione pelo menos um produto à NF-e.');
      return;
    }
    var supportedCsosn = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'];
    var supportedCst = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '49', '99'];
    rows.forEach(function (row, index) {
      var label = 'Item ' + (index + 1);
      var product = row.querySelector('.product');
      var quantity = row.querySelector('.quantity');
      var price = row.querySelector('.price');
      var cfop = row.querySelector('.cfop');
      var csosn = row.querySelector('.csosn');
      var pis = row.querySelector('.pis-cst');
      var cofins = row.querySelector('.cofins-cst');
      var ncm = row.querySelector('.item-ncm');
      var cest = row.querySelector('.item-cest');
      var origin = row.querySelector('.item-origin');
      if (!product.value) addStepError(errors, product, label + ': selecione um produto cadastrado.');
      if (!Number.isFinite(Number(quantity.value)) || Number(quantity.value) <= 0) addStepError(errors, quantity, label + ': informe quantidade maior que zero.');
      if (!price.value || !Number.isFinite(Number(price.value)) || Number(price.value) < 0) addStepError(errors, price, label + ': informe um preço unitário válido.');
      if (!/^\d{4}$/.test(cfop.value.trim())) addStepError(errors, cfop, label + ': informe o CFOP de 4 dígitos aplicável a este item.');
      if (!supportedCsosn.includes(csosn.value.trim())) addStepError(errors, csosn, label + ': informe um CSOSN válido para o regime confirmado.');
      if (!supportedCst.includes(pis.value.trim())) addStepError(errors, pis, label + ': informe o CST do PIS de 2 dígitos aplicável.');
      if (!supportedCst.includes(cofins.value.trim())) addStepError(errors, cofins, label + ': informe o CST da Cofins de 2 dígitos aplicável.');
      if (!/^\d{8}$/.test(ncm.value.trim())) addStepError(errors, ncm, label + ': informe o NCM de 8 dígitos.');
      if (!/^[0-8]$/.test(origin.value)) addStepError(errors, origin, label + ': selecione a origem real da mercadoria.');
      var cestDigits = cest.value.trim().replace(/\D/g, '');
      if (cest.value.trim() && !/^\d{7}$/.test(cestDigits)) addStepError(errors, cest, label + ': CEST deve ter 7 dígitos.');
      if (['201', '202', '203', '500'].includes(csosn.value.trim()) && !/^\d{7}$/.test(cestDigits))
        addStepError(errors, cest, label + ': informe o CEST de 7 dígitos exigido para este CSOSN.');
      validateTaxGroups(row, errors, label);
    });
  }

  function validateStep(index) {
    var errors = [];
    var key = steps[index] && steps[index][0];
    if (key === 'general') {
      var nature = value('nature');
      if (nature.length < 3 || nature.length > 60) addStepError(errors, form.elements.namedItem('nature'), 'Informe uma natureza da operação entre 3 e 60 caracteres.');
      var issueAt = value('issueAt');
      if (!issueAt || !Number.isFinite(new Date(issueAt).getTime())) addStepError(errors, form.elements.namedItem('issueAt'), 'Informe data e hora válidas; o campo é preenchido automaticamente e pode ser alterado.');
      if (!['0', '1'].includes(value('consumerFinal'))) addStepError(errors, form.elements.namedItem('consumerFinal'), 'Indique se esta operação é destinada a consumidor final.');
      if (!['0', '1', '2', '3', '4', '5', '9'].includes(value('buyerPresence'))) addStepError(errors, form.elements.namedItem('buyerPresence'), 'Indique a presença ou o canal real da operação.');
    }
    if (key === 'recipient') validateRecipientStep(errors);
    if (key === 'items') validateItemsStep(errors);
    if (key === 'totals') {
      ['freight', 'insurance', 'discount', 'expenses'].forEach(function (name) {
        var control = form.elements.namedItem(name);
        if (control.value && (!Number.isFinite(Number(control.value)) || Number(control.value) < 0))
          addStepError(errors, control, 'Informe valor não negativo para ' + name + '.');
      });
      if (commercialCents() < 0) addStepError(errors, form.elements.namedItem('discount'), 'O desconto não pode deixar o total comercial negativo.');
    }
    if (key === 'billing') {
      Array.from(document.querySelectorAll('#payments .payment-row')).forEach(function (row, index) {
        var indicator = row.querySelector('[name="paymentIndicator"]');
        var method = row.querySelector('[name="paymentMethod"]');
        var amount = row.querySelector('[name="paymentAmount"]');
        if (!['0', '1'].includes(indicator.value)) addStepError(errors, indicator, 'Pagamento ' + (index + 1) + ': selecione à vista ou a prazo.');
        if (!method.value) addStepError(errors, method, 'Pagamento ' + (index + 1) + ': selecione a forma de pagamento.');
        if (!amount.value || !Number.isFinite(Number(amount.value)) || Number(amount.value) < 0) addStepError(errors, amount, 'Pagamento ' + (index + 1) + ': informe um valor válido.');
        if (method.value === '99' && row.querySelector('[name="paymentDescription"]').value.trim().length < 2)
          addStepError(errors, row.querySelector('[name="paymentDescription"]'), 'Informe a descrição da forma de pagamento Outros (99).');
        if (['03', '04', '05'].includes(method.value)) {
          var integration = row.querySelector('[name="paymentIntegration"]');
          if (!['1', '2'].includes(integration.value)) addStepError(errors, integration, 'Informe se a operação de cartão foi integrada.');
          if (integration.value === '1') {
            if (!cnpjIsValid(row.querySelector('[name="paymentAcquirerCnpj"]').value))
              addStepError(errors, row.querySelector('[name="paymentAcquirerCnpj"]'), 'Informe o CNPJ de 14 dígitos da credenciadora.');
            if (!row.querySelector('[name="paymentAuthorization"]').value.trim())
              addStepError(errors, row.querySelector('[name="paymentAuthorization"]'), 'Informe o número de autorização do cartão.');
          }
        }
      });
    }
    if (key === 'transport') {
      if (!['0', '1', '2', '3', '4', '9'].includes(value('transportMode')))
        addStepError(errors, form.elements.namedItem('transportMode'), 'Selecione a modalidade de frete real da operação.');
      var carrierId = value('carrierId');
      if (carrierId) {
        var carrier = typeof window.jvgNfeGetRecipient === 'function' ? window.jvgNfeGetRecipient(carrierId) : null;
        if (!carrier) addStepError(errors, form.elements.namedItem('carrierId'), 'Não foi possível carregar os dados da transportadora.');
        else {
          var carrierName = String(carrier.legalName || carrier.name || '').trim();
          var carrierDocument = String(carrier.document || carrier.documentNumber || '').replace(/\D/g, '');
          var carrierType = partyDocumentType(carrier);
          var carrierDocumentValid = (carrierType === 'cpf' && cpfIsValid(carrierDocument)) ||
            (carrierType === 'cnpj' && cnpjIsValid(carrierDocument));
          if (carrierName.length < 2 || carrierName.length > 60 || !carrierDocumentValid)
            addStepError(errors, form.elements.namedItem('carrierId'), 'Complete nome e CPF/CNPJ da transportadora em Cadastros > Pessoas.');
        }
      }
      var plate = value('vehiclePlate'), vehicleUf = value('vehicleState');
      if ((plate || vehicleUf || value('vehicleRntc')) && !/^[A-Za-z0-9]{7}$/.test(plate))
        addStepError(errors, form.elements.namedItem('vehiclePlate'), 'Se informar dados do veículo, preencha uma placa com 7 caracteres.');
      if (vehicleUf && !/^[A-Za-z]{2}$/.test(vehicleUf)) addStepError(errors, form.elements.namedItem('vehicleState'), 'Informe a UF do veículo com 2 letras.');
      var volumeNames = ['volumeQuantity', 'volumeSpecies', 'volumeBrand', 'volumeNumber', 'volumeNetWeight', 'volumeGrossWeight'];
      var hasVolume = volumeNames.some(function (name) { return value(name) !== ''; });
      if (hasVolume && (!/^\d+$/.test(value('volumeQuantity')) || Number(value('volumeQuantity')) < 1))
        addStepError(errors, form.elements.namedItem('volumeQuantity'), 'Ao informar volumes, indique uma quantidade inteira positiva.');
      ['volumeNetWeight', 'volumeGrossWeight'].forEach(function (name) {
        var control = form.elements.namedItem(name);
        if (control.value && (!Number.isFinite(Number(control.value)) || Number(control.value) <= 0 || Math.round(Number(control.value) * 1000) / 1000 !== Number(control.value)))
          addStepError(errors, control, 'Informe peso positivo com até 3 casas decimais.');
      });
      if (Number(value('volumeNetWeight')) > Number(value('volumeGrossWeight')) && value('volumeGrossWeight'))
        addStepError(errors, form.elements.namedItem('volumeNetWeight'), 'O peso líquido não pode superar o peso bruto.');
    }
    if (key === 'intermediary' && !['0', '1'].includes(value('intermediaryIndicator')))
      addStepError(errors, form.elements.namedItem('intermediaryIndicator'), 'Indique se a venda ocorreu sem intermediador ou por plataforma de terceiros.');
    if (key === 'intermediary' && value('intermediaryIndicator') === '1') {
      if (!cnpjIsValid(value('intermediaryCnpj')))
        addStepError(errors, form.elements.namedItem('intermediaryCnpj'), 'Informe o CNPJ de 14 dígitos da plataforma intermediadora.');
      if (value('intermediaryId').length < 2 || value('intermediaryId').length > 60)
        addStepError(errors, form.elements.namedItem('intermediaryId'), 'Informe o identificador da plataforma, entre 2 e 60 caracteres.');
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function clearStepErrors() {
    Array.from(form.querySelectorAll('[aria-invalid="true"]')).forEach(function (control) { control.removeAttribute('aria-invalid'); });
    if (validationSummary) { validationSummary.hidden = true; validationSummary.replaceChildren(); }
  }

  function showStepErrors(result, focus) {
    if (!validationSummary) return;
    Array.from(form.querySelectorAll('[aria-invalid="true"]')).forEach(function (control) { control.removeAttribute('aria-invalid'); });
    validationSummary.replaceChildren();
    var title = document.createElement('strong');
    title.textContent = 'Para avançar, corrija os campos obrigatórios desta etapa:';
    var list = document.createElement('ul');
    result.errors.forEach(function (error) {
      var item = document.createElement('li');
      item.textContent = error.message;
      if (error.control) error.control.setAttribute('aria-invalid', 'true');
      list.append(item);
    });
    validationSummary.append(title, list);
    validationSummary.hidden = false;
    var first = result.errors.find(function (error) { return error.control; });
    if (focus && first) {
      var details = first.control.closest('details');
      if (details) details.open = true;
      first.control.focus({ preventScroll: true });
      first.control.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function updateStepButtons() {
    Array.from(stepNav.querySelectorAll('[data-fiscal-tab]')).forEach(function (tab, index) {
      var locked = index > unlockedThrough;
      tab.disabled = locked;
      tab.dataset.locked = locked ? 'true' : 'false';
      tab.title = locked ? 'Conclua a etapa anterior para liberar esta.' : 'Abrir etapa ' + (index + 1) + ': ' + steps[index][1];
      var badge = tab.querySelector('span:first-child');
      if (badge) badge.textContent = index < unlockedThrough ? '✓' : String(index + 1).padStart(2, '0');
      tab.classList.toggle('is-complete', index < unlockedThrough);
      tab.setAttribute('aria-label', (index + 1) + '. ' + steps[index][1] + (locked ? ', bloqueada até concluir a etapa anterior' : index < unlockedThrough ? ', concluída' : ', liberada'));
    });
  }

  function syncStepAccess() {
    for (var index = 0; index < unlockedThrough; index += 1) {
      if (!validateStep(index).ok) { unlockedThrough = index; break; }
    }
    updateStepButtons();
    if (currentStep > unlockedThrough) goToStep(unlockedThrough, false);
  }

  function onFormEdited() {
    updateRequiredMarkers();
    refreshComputed();
    syncStepAccess();
    if (validationSummary && !validationSummary.hidden) {
      var result = validateStep(currentStep);
      if (result.ok) clearStepErrors();
      else showStepErrors(result, false);
    }
  }

  function advanceToStep(destination, scroll) {
    var target = Math.max(0, Math.min(steps.length - 1, destination));
    if (target <= currentStep) { goToStep(target, scroll); return true; }
    for (var index = currentStep; index < target; index += 1) {
      clearStepErrors();
      var result = validateStep(index);
      if (!result.ok) {
        unlockedThrough = Math.min(unlockedThrough, index);
        updateStepButtons();
        showStepErrors(result, true);
        return false;
      }
      unlockedThrough = Math.max(unlockedThrough, index + 1);
      updateStepButtons();
    }
    goToStep(target, scroll);
    return true;
  }

  function validateAllStages() {
    for (var index = 0; index < steps.length - 1; index += 1) {
      var result = validateStep(index);
      if (!result.ok) {
        unlockedThrough = Math.min(unlockedThrough, index);
        updateStepButtons();
        goToStep(index, true);
        showStepErrors(result, true);
        return false;
      }
    }
    return true;
  }

  function goToStep(index, scroll) {
    var destination = Math.max(0, Math.min(steps.length - 1, index));
    if (destination !== currentStep) clearStepErrors();
    if (destination === steps.length - 1) setDefaultIssueAt(false);
    currentStep = destination;
    var key = steps[currentStep][0];
    Array.from(form.querySelectorAll('[data-fiscal-section]')).forEach(function (section) {
      section.hidden = section.dataset.fiscalSection !== key;
    });
    Array.from(stepNav.querySelectorAll('[data-fiscal-tab]')).forEach(function (tab, tabIndex) {
      var active = tab.dataset.fiscalTab === key;
      tab.classList.toggle('selected', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) tab.setAttribute('aria-current', 'step');
      else tab.removeAttribute('aria-current');
      tab.classList.toggle('is-complete', tabIndex < currentStep);
    });
    var heading = document.getElementById('stepHeading');
    var description = document.getElementById('stepDescription');
    var counter = document.getElementById('stepCounter');
    if (heading) heading.textContent = steps[currentStep][1];
    if (description) description.textContent = steps[currentStep][2];
    if (counter) counter.textContent = String(currentStep + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0');
    updateStepButtons();
    var prev = document.getElementById('wizardPrev');
    var next = document.getElementById('wizardNext');
    var save = document.getElementById('saveButton');
    if (prev) prev.hidden = currentStep === 0;
    if (next) next.hidden = currentStep === steps.length - 1;
    if (save) save.hidden = currentStep !== steps.length - 1;
    if (key === 'review') renderReview();
    if (scroll) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectedDateTime(name) {
    var field = form.elements.namedItem(name);
    if (!field || !field.value) return null;
    var date = new Date(field.value);
    if (!Number.isFinite(date.getTime())) return null;
    var offset = -date.getTimezoneOffset();
    var sign = offset >= 0 ? '+' : '-';
    var absolute = Math.abs(offset);
    return field.value + ':00' + sign + String(Math.floor(absolute / 60)).padStart(2, '0') + ':' + String(absolute % 60).padStart(2, '0');
  }

  function readPayments() {
    return Array.from(document.querySelectorAll('#payments .payment-row')).map(function (row) {
      function val(name) { return row.querySelector('[name="' + name + '"]').value.trim(); }
      return {
        indicator: val('paymentIndicator') || null, method: val('paymentMethod'), amount: val('paymentAmount'),
        paymentDate: val('paymentDate') || null, description: val('paymentDescription'),
        integration: val('paymentIntegration') || null, acquirerCnpj: val('paymentAcquirerCnpj'),
        authorizationNumber: val('paymentAuthorization'),
      };
    }).filter(function (payment) {
      return Boolean(payment.indicator || payment.method || payment.amount || payment.paymentDate || payment.description ||
        payment.integration || payment.acquirerCnpj || payment.authorizationNumber);
    });
  }

  function cents(input) {
    var value = Number(input && input.value);
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : 0;
  }

  function productCents() {
    return Array.from(document.querySelectorAll('#items .item-row')).reduce(function (sum, row) {
      var quantity = Number(row.querySelector('.quantity').value), price = Number(row.querySelector('.price').value);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) return sum;
      return sum + Math.round(Math.round(quantity * 1000) * Math.round(price * 100) / 1000);
    }, 0);
  }

  function commercialCents() {
    return productCents() + cents(form.elements.namedItem('freight')) + cents(form.elements.namedItem('insurance')) +
      cents(form.elements.namedItem('expenses')) - cents(form.elements.namedItem('discount'));
  }

  function refreshComputed() {
    var products = productCents(), total = commercialCents();
    var productDisplay = document.getElementById('productTotal');
    var totalDisplay = document.getElementById('commercialTotal');
    var reviewTotal = document.getElementById('reviewTotal');
    var paymentsTotal = document.getElementById('paymentsTotal');
    var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    if (productDisplay) productDisplay.textContent = money.format(products / 100);
    if (totalDisplay) totalDisplay.textContent = money.format(total / 100);
    if (reviewTotal) reviewTotal.textContent = money.format(total / 100);
    var paymentSum = readPayments().reduce(function (sum, payment) { return sum + Math.round(Number(payment.amount || 0) * 100); }, 0);
    if (paymentsTotal) paymentsTotal.textContent = money.format(paymentSum / 100);
    var cfopInputs = Array.from(document.querySelectorAll('#items .cfop')).map(function (input) { return input.value.trim(); }).filter(Boolean);
    var cfopSummary = document.getElementById('headerCfopSummary');
    if (cfopSummary) cfopSummary.value = cfopInputs.length && cfopInputs.every(function (code) { return code === cfopInputs[0]; }) ? cfopInputs[0] : '';
    if (steps[currentStep] && steps[currentStep][0] === 'review') renderReview();
  }

  function addReviewLine(target, label, value) {
    var row = document.createElement('div'); row.className = 'review-line';
    var name = document.createElement('span'); name.textContent = label;
    var detail = document.createElement('strong'); detail.textContent = value || 'Não informado';
    row.append(name, detail); target.append(row);
  }

  function renderReview() {
    var target = document.getElementById('reviewSummary');
    if (!target) return;
    target.replaceChildren();
    var selected = form.elements.namedItem('recipientId');
    var selectedText = selected && selected.selectedOptions[0] ? selected.selectedOptions[0].textContent : '';
    var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    function fieldValue(name) {
      var field = form.elements.namedItem(name);
      return field ? field.value.trim() : '';
    }
    addReviewLine(target, 'Natureza', form.elements.namedItem('nature').value.trim());
    addReviewLine(target, 'Destinatário', selectedText);
    var ie = form.elements.namedItem('recipientIeIndicator');
    addReviewLine(target, 'Indicador de IE', ie && ie.selectedOptions[0] ? ie.selectedOptions[0].textContent : 'Pendente de confirmação');
    addReviewLine(target, 'Produtos', String(document.querySelectorAll('#items .item-row').length));
    addReviewLine(target, 'CFOP', document.getElementById('headerCfopSummary').value || 'Por item / revisar');
    var exitAt = fieldValue('exitAt');
    addReviewLine(target, 'Saída', exitAt ? exitAt.replace('T', ' ') : 'Não informada');
    var transportMode = form.elements.namedItem('transportMode');
    addReviewLine(target, 'Frete', transportMode && transportMode.selectedOptions[0] ? transportMode.selectedOptions[0].textContent : 'Pendente de confirmação');
    var intermediary = fieldValue('intermediaryIndicator');
    addReviewLine(target, 'Intermediador', intermediary === '1' ? 'Plataforma de terceiros' : 'Sem intermediador (padrão Focus: 0)');
    var payments = Array.from(document.querySelectorAll('#payments .payment-row')).map(function (row) {
      var method = row.querySelector('[name="paymentMethod"]');
      var amount = row.querySelector('[name="paymentAmount"]');
      var condition = row.querySelector('[name="paymentIndicator"]');
      var methodLabel = method && method.selectedOptions[0] ? method.selectedOptions[0].textContent : 'Forma pendente';
      var conditionLabel = condition && condition.selectedOptions[0] ? condition.selectedOptions[0].textContent : 'condição pendente';
      return methodLabel + ' · ' + conditionLabel + ' · ' + money.format(Number(amount && amount.value || 0));
    });
    addReviewLine(target, 'Pagamentos', payments.length ? payments.join(' | ') : 'Não informado');
    addReviewLine(target, 'Frete / seguro / desconto / despesas', ['freight', 'insurance', 'discount', 'expenses']
      .map(function (name) { return money.format(Number(fieldValue(name) || 0)); }).join(' · '));
    addReviewLine(target, 'Total de produtos', money.format(productCents() / 100));
    addReviewLine(target, 'Total comercial', money.format(commercialCents() / 100));
    addReviewLine(target, 'Situação fiscal', 'Perfil opcional; confira os campos fiscais antes de transmitir');
    var summary = document.getElementById('reviewTotal');
    if (summary) summary.textContent = money.format(commercialCents() / 100);
    var rows = Array.from(document.querySelectorAll('#items .item-row'));
    rows.forEach(function (row, index) {
      var select = row.querySelector('.product');
      var productId = select.value;
      var product = select.selectedOptions[0] ? select.selectedOptions[0].textContent : 'Produto pendente';
      var record = typeof window.jvgNfeGetProduct === 'function' ? window.jvgNfeGetProduct(productId) : null;
      var qty = row.querySelector('.quantity').value || '—';
      var price = row.querySelector('.price').value || '—';
      var fiscal = [
        'CFOP ' + (row.querySelector('.cfop').value || 'pendente'),
        'CSOSN ' + (row.querySelector('.csosn').value || 'pendente'),
        'NCM ' + (record && record.ncm || 'não cadastrado'),
        'CEST ' + (record && record.cest || 'não cadastrado'),
        'origem ' + (record && record.origin != null && record.origin !== '' ? record.origin : 'não cadastrada'),
      ].join(' · ');
      addReviewLine(target, 'Item ' + (index + 1) + ' · ' + product, 'Qtd. ' + qty + ' · R$ ' + price);
      addReviewLine(target, 'Dados fiscais do item ' + (index + 1), fiscal);
    });
  }

  function renderRecipient() {
    var card = document.getElementById('recipientPreview');
    var select = document.getElementById('recipientId');
    if (!card || !select) return;
    if (!select.value) {
      card.textContent = 'Selecione um destinatário para conferir os dados cadastrados.';
      return;
    }
    var client = typeof window.jvgNfeGetRecipient === 'function' ? window.jvgNfeGetRecipient(select.value) : null;
    card.replaceChildren();
    var heading = document.createElement('strong');
    heading.textContent = client ? client.name || client.legalName || select.selectedOptions[0].textContent : select.selectedOptions[0].textContent;
    card.append(heading);
    var address = partyAddress(client);
    var values = [
      ['CPF/CNPJ', client && (client.document || client.documentNumber)],
      ['Inscrição estadual', client && client.stateRegistration],
      ['Endereço', client ? [address.street, address.number, address.complement, address.district, address.city, address.state, address.postalCode].filter(Boolean).join(', ') : ''],
      ['E-mail', client && client.email], ['Telefone', client && client.phone],
    ];
    var list = document.createElement('div'); list.className = 'recipient-facts';
    values.forEach(function (entry) {
      var block = document.createElement('div');
      var caption = document.createElement('span'); caption.textContent = entry[0];
      var value = document.createElement('strong'); value.textContent = String(entry[1] || 'Não cadastrado');
      block.append(caption, value); list.append(block);
    });
    card.append(list);
  }

  window.jvgNfeWizardData = function () {
    function value(name) { var input = form.elements.namedItem(name); return input ? input.value.trim() : ''; }
    return {
      exitAt: selectedDateTime('exitAt'),
      recipientIeIndicator: value('recipientIeIndicator') ? Number(value('recipientIeIndicator')) : null,
      additionalTotals: { freight: value('freight'), insurance: value('insurance'), discount: value('discount'), expenses: value('expenses') },
      payments: readPayments(),
      intermediary: { indicator: value('intermediaryIndicator') ? Number(value('intermediaryIndicator')) : null, cnpj: value('intermediaryCnpj'), id: value('intermediaryId') },
      additionalInfo: value('additionalInfo'),
    };
  };
  window.jvgNfeWizardRefresh = function () {
    updateRequiredMarkers();
    refreshComputed();
    syncStepAccess();
  };
  window.jvgNfeWizardCanSave = function () {
    if (currentStep !== steps.length - 1) {
      warn('Vá até a etapa Conferência para escolher como concluir a NF-e.');
      return false;
    }
    setDefaultIssueAt(false);
    return validateAllStages();
  };
  window.jvgNfeWizardValidateFinalization = function (mode) {
    if (mode === 'discard') return true;
    if (!validateAllStages()) return false;
    var nature = form.elements.namedItem('nature').value.trim();
    if (nature.length < 3 || nature.length > 60) {
      goToStep(0, true);
      return warn('Para concluir, informe a natureza da operação com 3 a 60 caracteres.');
    }
    if (!form.elements.namedItem('recipientId').value) {
      goToStep(1, true);
      return warn('Para concluir, selecione o destinatário cadastrado.');
    }
    var rows = Array.from(document.querySelectorAll('#items .item-row'));
    if (!rows.length || rows.some(function (row) {
      var quantity = Number(row.querySelector('.quantity').value);
      var price = Number(row.querySelector('.price').value);
      return !row.querySelector('.product').value || !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(price) || price < 0;
    })) {
      goToStep(2, true);
      return warn('Cada item precisa de produto, quantidade positiva e preço válido.');
    }
    if (mode === 'emit') {
      var issueAt = form.elements.namedItem('issueAt').value;
      if (!issueAt || !Number.isFinite(new Date(issueAt).getTime())) {
        goToStep(0, true);
        return warn('A data e hora de emissão precisa ser válida. O sistema preenche automaticamente e permite ajuste.');
      }
    }
    return true;
  };
  window.jvgNfeWizardLoad = function (data) {
    unlockedThrough = 0;
    clearStepErrors();
    data = data && typeof data === 'object' ? data : {};
    function set(name, value) {
      var field = form.elements.namedItem(name);
      if (field) field.value = value == null ? '' : String(value);
    }
    function localDateTime(value) {
      if (!value) return '';
      var date = new Date(value);
      return Number.isFinite(date.getTime()) ? localDateTimeValue(date) : '';
    }
    set('purpose', data.purpose);
    set('issueAt', localDateTime(data.issueAt));
    set('exitAt', localDateTime(data.exitAt));
    var issueAt = form.elements.namedItem('issueAt');
    if (issueAt) issueAt.dataset.userEdited = issueAt.value ? 'true' : 'false';
    set('consumerFinal', data.consumerFinal == null ? '' : data.consumerFinal ? '1' : '0');
    set('buyerPresence', data.buyerPresence);
    set('recipientIeIndicator', data.recipientIeIndicator);
    set('transportMode', data.transportMode);
    set('carrierId', data.carrier && data.carrier.id);
    set('vehiclePlate', data.vehicle && data.vehicle.plate);
    set('vehicleState', data.vehicle && data.vehicle.state);
    set('vehicleRntc', data.vehicle && data.vehicle.rntc);
    var volumes = Array.isArray(data.volumes) ? data.volumes : [];
    var volume = volumes[0] || {};
    set('volumeQuantity', volume.quantity);
    set('volumeSpecies', volume.species);
    set('volumeBrand', volume.brand);
    set('volumeNumber', volume.number);
    set('volumeNetWeight', volume.netWeightMilli == null ? '' : Number(volume.netWeightMilli) / 1000);
    set('volumeGrossWeight', volume.grossWeightMilli == null ? '' : Number(volume.grossWeightMilli) / 1000);
    var totals = data.additionalTotals || {};
    [['freight', totals.freightCents], ['insurance', totals.insuranceCents],
      ['discount', totals.discountCents], ['expenses', totals.expensesCents]].forEach(function (entry) {
      set(entry[0], entry[1] == null ? '' : (Number(entry[1]) / 100).toFixed(2));
    });
    set('additionalInfo', data.additionalInfo);
    var intermediary = data.intermediary || {};
    set('intermediaryIndicator', intermediary.indicator);
    set('intermediaryCnpj', intermediary.cnpj);
    set('intermediaryId', intermediary.id);
    var showIntermediary = String(intermediary.indicator) === '1';
    form.querySelectorAll('.intermediary-extra').forEach(function (field) { field.hidden = !showIntermediary; });

    var paymentList = paymentsRoot && paymentsRoot.querySelector('#payments');
    if (paymentList) paymentList.replaceChildren();
    (Array.isArray(data.payments) ? data.payments : []).forEach(function (payment) {
      createPaymentRow();
      var row = paymentList.lastElementChild;
      function paymentSet(name, value) {
        var field = row.querySelector('[name="' + name + '"]');
        if (field) field.value = value == null ? '' : String(value);
      }
      paymentSet('paymentIndicator', payment.indicator);
      paymentSet('paymentMethod', payment.method);
      paymentSet('paymentAmount', payment.amountCents == null ? '' : (Number(payment.amountCents) / 100).toFixed(2));
      paymentSet('paymentDate', payment.paymentDate);
      paymentSet('paymentDescription', payment.description);
      paymentSet('paymentIntegration', payment.integration);
      paymentSet('paymentAcquirerCnpj', payment.acquirerCnpj);
      paymentSet('paymentAuthorization', payment.authorizationNumber);
      var method = row.querySelector('[name="paymentMethod"]');
      if (method) method.dispatchEvent(new Event('change', { bubbles: true }));
      var integration = row.querySelector('[name="paymentIntegration"]');
      if (integration) integration.dispatchEvent(new Event('change', { bubbles: true }));
    });
    renderRecipient();
    updateRequiredMarkers();
    refreshComputed();
    goToStep(0, false);
  };
  window.jvgNfeWizardReset = function () {
    unlockedThrough = 0;
    clearStepErrors();
    var payments = document.getElementById('payments');
    if (payments) payments.replaceChildren();
    var issueAt = form.elements.namedItem('issueAt');
    if (issueAt) issueAt.dataset.userEdited = 'false';
    setDefaultIssueAt(true);
    if (steps[currentStep] && steps[currentStep][0] !== 'general') goToStep(0, false);
    renderRecipient(); updateRequiredMarkers(); refreshComputed(); syncStepAccess();
  };

  prepareWizard();
})();
