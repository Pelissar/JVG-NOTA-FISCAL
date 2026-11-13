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
  var paymentsRoot;
  var totalsRoot;

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
    if (formBody) formBody.classList.add('nfe-step-content');
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
      tab.addEventListener('click', function () { goToStep(index, false); });
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
    next.addEventListener('click', function () { goToStep(currentStep + 1, true); });
    document.addEventListener('keydown', function (event) {
      var target = event.target;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === 'F4') { event.preventDefault(); goToStep(currentStep - 1, false); }
      if (event.key === 'F5') { event.preventDefault(); goToStep(currentStep + 1, true); }
      if (event.key === 'F1') { event.preventDefault(); window.location.assign('/erp/index.html#fiscal'); }
    });

    form.addEventListener('input', refreshComputed);
    form.addEventListener('change', refreshComputed);
    document.getElementById('recipientId').addEventListener('change', renderRecipient);
    renderRecipient();
    refreshComputed();
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

  function goToStep(index, scroll) {
    var destination = Math.max(0, Math.min(steps.length - 1, index));
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
      tab.classList.toggle('is-complete', tabIndex < currentStep);
    });
    var heading = document.getElementById('stepHeading');
    var description = document.getElementById('stepDescription');
    var counter = document.getElementById('stepCounter');
    if (heading) heading.textContent = steps[currentStep][1];
    if (description) description.textContent = steps[currentStep][2];
    if (counter) counter.textContent = String(currentStep + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0');
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
    var address = client && client.address && typeof client.address === 'object' ? client.address : {};
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
  window.jvgNfeWizardRefresh = refreshComputed;
  window.jvgNfeWizardCanSave = function () {
    if (currentStep !== steps.length - 1) {
      warn('Vá até a etapa Conferência para escolher como concluir a NF-e.');
      return false;
    }
    setDefaultIssueAt(false);
    return true;
  };
  window.jvgNfeWizardValidateFinalization = function (mode) {
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