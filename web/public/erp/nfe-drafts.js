(function () {
  'use strict';

  var state = { products: [], clients: [], taxProfiles: [], issuerState: '', drafts: [], homologationSetup: null, isJvgPilot: false, ready: false, sourceOrderId: null, sourceOrderNumber: '', editingDraftId: null, natureCfopSuggestion: '' };
  var idempotencyKey = null;
  var status = document.getElementById('status');
  var form = document.getElementById('draftForm');
  var items = document.getElementById('items');
  var saveButton = document.getElementById('saveButton');
  var finalizeDialog = document.getElementById('finalizeDialog');
  var confirmFinalizeButton = document.getElementById('confirmFinalize');
  var finalizeFeedback = document.getElementById('finalizeFeedback');
  var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var focusTaxFieldGroups = [
    { title: 'ICMS / ICMS-ST', fields: [
      ['icms_modalidade_base_calculo', 'Modalidade da base do ICMS', '1'],
      ['icms_reducao_base_calculo', 'Redução da base do ICMS (%)', '0.0000'],
      ['icms_base_calculo', 'Base do ICMS (R$)', '0.00'],
      ['icms_aliquota', 'Alíquota do ICMS (%)', '0.0000'],
      ['icms_valor', 'Valor do ICMS (R$)', '0.00'],
      ['icms_modalidade_base_calculo_st', 'Modalidade da base do ICMS-ST', '1'],
      ['icms_margem_valor_adicionado_st', 'Margem de valor agregado ST (%)', '0.0000'],
      ['icms_reducao_base_calculo_st', 'Redução da base do ICMS-ST (%)', '0.0000'],
      ['icms_base_calculo_st', 'Base do ICMS-ST (R$)', '0.00'],
      ['icms_aliquota_st', 'Alíquota do ICMS-ST (%)', '0.0000'],
      ['icms_valor_st', 'Valor do ICMS-ST (R$)', '0.00'],
      ['icms_aliquota_credito_simples', 'Alíquota de crédito do Simples (%)', '0.0000'],
      ['icms_valor_credito_simples', 'Valor de crédito do Simples (R$)', '0.00'],
      ['icms_base_calculo_retido_st', 'Base de ICMS-ST retido (R$)', '0.00'],
      ['icms_valor_retido_st', 'ICMS-ST retido anteriormente (R$)', '0.00'],
      ['icms_valor_substituto', 'ICMS do substituto (R$)', '0.00'],
      ['icms_aliquota_final', 'Alíquota final do ICMS (%)', '0.0000']
    ]},
    { title: 'PIS', fields: [
      ['pis_base_calculo', 'Base de cálculo do PIS (R$)', '0.00'],
      ['pis_aliquota_porcentual', 'Alíquota percentual do PIS (%)', '0.0000'],
      ['pis_quantidade_vendida', 'Quantidade tributável do PIS', '0.0000'],
      ['pis_aliquota_valor', 'Alíquota do PIS por unidade (R$)', '0.0000'],
      ['pis_valor', 'Valor do PIS (R$)', '0.00'],
      ['pis_base_calculo_st', 'Base de cálculo do PIS-ST (R$)', '0.00'],
      ['pis_aliquota_porcentual_st', 'Alíquota percentual do PIS-ST (%)', '0.0000'],
      ['pis_quantidade_vendida_st', 'Quantidade tributável do PIS-ST', '0.0000'],
      ['pis_aliquota_valor_st', 'Alíquota do PIS-ST por unidade (R$)', '0.0000'],
      ['pis_valor_st', 'Valor do PIS-ST (R$)', '0.00']
    ]},
    { title: 'Cofins', fields: [
      ['cofins_base_calculo', 'Base de cálculo da Cofins (R$)', '0.00'],
      ['cofins_aliquota_porcentual', 'Alíquota percentual da Cofins (%)', '0.0000'],
      ['cofins_quantidade_vendida', 'Quantidade tributável da Cofins', '0.0000'],
      ['cofins_aliquota_valor', 'Alíquota da Cofins por unidade (R$)', '0.0000'],
      ['cofins_valor', 'Valor da Cofins (R$)', '0.00'],
      ['cofins_base_calculo_st', 'Base de cálculo da Cofins-ST (R$)', '0.00'],
      ['cofins_aliquota_porcentual_st', 'Alíquota percentual da Cofins-ST (%)', '0.0000'],
      ['cofins_quantidade_vendida_st', 'Quantidade tributável da Cofins-ST', '0.0000'],
      ['cofins_aliquota_valor_st', 'Alíquota da Cofins-ST por unidade (R$)', '0.0000'],
      ['cofins_valor_st', 'Valor da Cofins-ST (R$)', '0.00']
    ]}
  ];

  function report(message, kind) {
    status.textContent = message;
    status.className = 'notice' + (kind ? ' ' + kind : '');
  }

  function readinessItem(target, title, ready, detail) {
    var item = document.createElement('article');
    item.className = 'readiness-item ' + (ready ? 'is-ready' : 'is-pending');
    var heading = document.createElement('div');
    heading.className = 'readiness-item-heading';
    var name = document.createElement('strong');
    name.textContent = title;
    var badge = document.createElement('span');
    badge.className = 'readiness-state';
    badge.textContent = ready ? 'Concluído' : 'Pendente';
    heading.append(name, badge);
    var copy = document.createElement('p');
    copy.textContent = detail;
    item.append(heading, copy);
    target.append(item);
  }

  function renderHomologationReadiness() {
    var target = document.getElementById('homologationReadiness');
    var summary = document.getElementById('readinessSummary');
    if (!target || !summary) return;
    target.replaceChildren();
    var setup = state.homologationSetup;
    if (!setup) {
      summary.textContent = 'Aguardando dados';
      var waiting = document.createElement('p');
      waiting.textContent = 'Não foi possível carregar o checklist agora. Recarregue a página para tentar novamente.';
      target.append(waiting);
      return;
    }

    var activeProducts = state.products.filter(function (product) { return product.active === true; });
    var readyProducts = activeProducts.filter(function (product) {
      return /^\d{8}$/.test(String(product.ncm || '')) && /^[0-8]$/.test(String(product.origin || ''));
    }).length;
    var incompleteProducts = activeProducts.length - readyProducts;
    var missingNcm = activeProducts.filter(function (product) { return !/^\d{8}$/.test(String(product.ncm || '')); }).length;
    var missingOrigin = activeProducts.filter(function (product) { return !/^[0-8]$/.test(String(product.origin || '')); }).length;
    var productReady = readyProducts > 0;
    var environmentAccessReady = setup.platformAdmin && setup.accountCanSubmit && setup.pilotCompanyConfigured && setup.pilotCompanyMatches;
    var regimeReady = setup.taxRegimeConfirmationAvailable && setup.taxRegimeConfirmed && setup.supportedTaxRegime;
    var issuerReady = setup.issuerFound && Array.isArray(setup.issuerMissing) && setup.issuerMissing.length === 0;
    var checks = [
      [environmentAccessReady, 'Acesso ao piloto JVG', setup.pilotCompanyMatches
        ? (setup.platformAdmin ? 'A empresa piloto está vinculada. O envio de teste é feito por administrador da plataforma.' : 'A empresa piloto está vinculada, mas o envio é restrito a um administrador da plataforma.')
        : 'O envio de teste está restrito à empresa piloto JVG e depende da configuração do ambiente.'],
      [setup.focusTokenConfigured, 'Token da API Focus no servidor', setup.focusTokenConfigured
        ? 'O token está configurado. Ele é diferente do certificado digital anexado no painel Focus; use “Verificar conexão Focus NFe” para validar o acesso à API.'
        : 'O token de API de homologação não está configurado no servidor do ERP. Ele é separado do certificado digital anexado na Focus.'],
      [issuerReady, 'Dados fiscais do emitente', issuerReady
        ? 'Os campos obrigatórios do emitente estão completos.'
        : (setup.issuerMissing || []).length
          ? 'Faltam: ' + setup.issuerMissing.join('; ') + '.'
          : 'O cadastro fiscal da empresa não foi encontrado.'],
      [regimeReady, 'Regime tributário', regimeReady
        ? 'Simples Nacional confirmado nos dados da empresa.'
        : !setup.taxRegimeConfirmationAvailable
          ? 'A confirmação ainda não está disponível no banco. A migração fiscal correspondente precisa ser aplicada no Supabase.'
          : !setup.taxRegimeConfirmed
            ? 'O regime precisa ser confirmado com a contabilidade e salvo nos dados da empresa.'
            : 'O fluxo de homologação atual atende somente ao Simples Nacional confirmado.'],
      [productReady, 'Catálogo de produtos', activeProducts.length
        ? activeProducts.length + ' produto(s) ativo(s); ' + readyProducts + ' com NCM e origem preenchidos, ' + incompleteProducts + ' incompleto(s). NCM pendente: ' + missingNcm + ', origem: ' + missingOrigin + '. Perfil tributário é opcional; só os itens configurados na nota passam pela conferência fiscal.'
        : 'Cadastre ao menos um produto ativo para preparar uma NF-e.'],
      [true, 'Perfis tributários', state.taxProfiles.length
        ? state.taxProfiles.length + ' perfil(is) disponível(is) como referência opcional. A revisão do perfil não é requisito para salvar ou transmitir uma NF-e.'
        : 'Nenhum perfil cadastrado. Informe os códigos fiscais diretamente nos itens da nota; não é necessário criar perfil.'],
    ];
    var pending = 0;
    checks.forEach(function (check) {
      if (!check[0]) pending += 1;
      readinessItem(target, check[1], check[0], check[2]);
    });
    summary.textContent = pending ? pending + ' etapa(s) de cadastro pendente(s)' : 'Cadastros base conferidos';
    summary.className = 'readiness-badge ' + (pending ? 'is-pending' : 'is-ready');
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

  function setDefaultIssueAt() {
    var input = form.elements.namedItem('issueAt');
    if (!input || input.value) return;
    var now = new Date();
    var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    input.value = local.toISOString().slice(0, 16);
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
      if (!response.ok) {
        var apiError = new Error(data.error || data.message ||
          (Array.isArray(data.issues) ? data.issues.join(' · ') : '') || 'Não foi possível concluir a operação.');
        apiError.responseData = data;
        apiError.status = response.status;
        throw apiError;
      }
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

  window.jvgNfeGetRecipient = function (id) {
    return state.clients.find(function (client) { return client.id === id; }) || null;
  };
  window.jvgNfeGetProduct = function (id) {
    return state.products.find(function (product) { return product.id === id; }) || null;
  };

  function fillCarriers() {
    var select = document.getElementById('carrierId');
    if (!select) return;
    select.replaceChildren(option('', 'Não informada'));
    state.clients.filter(function (party) { return party.active && party.isCarrier === true; }).forEach(function (party) {
      select.append(option(party.id, party.name + (party.document ? ' · ' + party.document : '')));
    });
  }

  function taxRuleFor(product, cfop) {
    return window.JvgNfeTaxSuggestion.resolve(product, cfop, state.taxProfiles);
  }

  function updateTaxSuggestion(row, product, resetTouched) {
    var cfop = row.querySelector('.cfop');
    var csosn = row.querySelector('.csosn');
    var ncm = row.querySelector('.item-ncm');
    var cest = row.querySelector('.item-cest');
    var origin = row.querySelector('.item-origin');
    var note = row.querySelector('.tax-suggestion');
    if (resetTouched) {
      row.dataset.cfopTouched = 'false';
      row.dataset.csosnTouched = 'false';
      row.dataset.ncmTouched = 'false';
      row.dataset.cestTouched = 'false';
      row.dataset.originTouched = 'false';
      row.dataset.pisCstTouched = 'false';
      row.dataset.cofinsCstTouched = 'false';
      row.querySelector('.pis-cst').value = '';
      row.querySelector('.cofins-cst').value = '';
      row.querySelectorAll('.focus-tax-field').forEach(function (input) { input.dataset.touched = 'false'; });
      row.querySelectorAll('.focus-tax-field').forEach(function (input) { input.value = ''; });
    }
    if (!product) {
      if (row.dataset.cfopTouched !== 'true') cfop.value = '';
      if (row.dataset.csosnTouched !== 'true') csosn.value = '';
      if (row.dataset.ncmTouched !== 'true') ncm.value = '';
      if (row.dataset.cestTouched !== 'true') cest.value = '';
      if (row.dataset.originTouched !== 'true') origin.value = '';
      if (row.dataset.pisCstTouched !== 'true') row.querySelector('.pis-cst').value = '';
      if (row.dataset.cofinsCstTouched !== 'true') row.querySelector('.cofins-cst').value = '';
      row.querySelectorAll('.focus-tax-field').forEach(function (input) {
        if (input.dataset.touched !== 'true') input.value = '';
      });
      renderProductFiscalFacts(row, null, null);
      note.textContent = 'Selecione o produto. Os perfis e o CFOP do cadastro podem sugerir valores; a escolha final é sua em cada item.';
      return;
    }

    var selected = taxRuleFor(product, cfop.value);
    var rule = selected.rule;
    var natureCfop = String(state.natureCfopSuggestion || '');
    // A nature explicitly chosen by the user may prefill its CFOP. Product and
    // profile CFOPs remain suggestions and are never silently applied.
    var profileCfop = rule && rule.cfop ? String(rule.cfop) : '';
    var productCfop = String(product.defaultCfop || '');
    var suggestedCfop = natureCfop;
    var suggestedCsosn = state.isJvgPilot ? '102' : '';
    if (row.dataset.cfopTouched !== 'true') cfop.value = suggestedCfop;
    if (row.dataset.csosnTouched !== 'true') csosn.value = suggestedCsosn;
    if (row.dataset.ncmTouched !== 'true') ncm.value = String(product.ncm || '').replace(/\D/g, '');
    if (row.dataset.cestTouched !== 'true') cest.value = String(product.cest || '').replace(/\D/g, '');
    if (row.dataset.originTouched !== 'true') origin.value = /^[0-8]$/.test(String(product.origin || '')) ? String(product.origin) : '';
    renderProductFiscalFacts(row, product, selected);

    if (natureCfop) {
      note.textContent = 'CFOP ' + natureCfop + ' foi preenchido como sugestão da natureza. Confira também a operação, o produto, a situação tributária do destinatário e o local de entrega; o campo pode ser alterado.';
    } else if (profileCfop && selected.profile) {
      setCfopSuggestion(note, (selected.profile.name || 'Perfil opcional') + ' · CFOP de referência para ' +
        (selected.operation === 'interna' ? 'venda interna' : 'venda interestadual') +
        '. Não foi aplicado automaticamente. Confira a operação, o produto, a situação tributária do destinatário e o local de entrega.', cfop, profileCfop);
    } else if (rule && selected.profile && !productCfop) {
      note.textContent = (selected.profile.name || 'Perfil opcional') + ' · ' +
        (selected.operation === 'interna' ? 'venda interna' : 'venda interestadual') +
        ' · referência opcional. Confira a operação, o produto, a situação tributária do destinatário e o local de entrega; os dados fiscais deste item são editáveis.';
    } else if (selected.operation && !productCfop) {
      note.textContent = 'Nenhuma sugestão de perfil para esta operação. Não é necessário criar perfil: informe ou ajuste os códigos diretamente neste item.';
    } else if (productCfop) {
      setCfopSuggestion(note, 'O produto tem um CFOP cadastrado como referência opcional. Confira a operação, a condição tributária do destinatário e o local de entrega antes de usar.', cfop, productCfop);
    } else {
      note.textContent = 'Informe o CFOP deste item conforme a operação, o produto, a condição tributária do destinatário e o local de entrega. O catálogo oficial está disponível para pesquisa.';
    }
    if (rule && selected.profile) {
      var profileNote = document.createElement('span');
      profileNote.className = 'profile-suggestion-note';
      profileNote.textContent = 'Perfil opcional: confira a condição tributária do destinatário e o local real de entrega.';
      var applyProfile = document.createElement('button');
      applyProfile.type = 'button';
      applyProfile.className = 'inline-suggestion';
      applyProfile.textContent = 'Preencher campos vazios pelo perfil';
      applyProfile.addEventListener('click', function () {
        [[row.querySelector('.csosn'), rule.csosn, 'csosnTouched'],
          [row.querySelector('.pis-cst'), rule.pisCst, 'pisCstTouched'],
          [row.querySelector('.cofins-cst'), rule.cofinsCst, 'cofinsCstTouched']].forEach(function (entry) {
          if (entry[0] && !entry[0].value.trim() && entry[1] != null && entry[1] !== '') {
            entry[0].value = String(entry[1]);
            row.dataset[entry[2]] = 'true';
          }
        });
        var values = rule.focusFields && typeof rule.focusFields === 'object' ? rule.focusFields : {};
        row.querySelectorAll('.focus-tax-field').forEach(function (input) {
          var suggestion = values[input.dataset.field];
          if (!input.value.trim() && suggestion != null && suggestion !== '') {
            input.value = String(suggestion);
            input.dataset.touched = 'true';
          }
        });
        applyProfile.disabled = true;
        applyProfile.textContent = 'Referências preenchidas nos campos vazios';
        updateTotal();
      });
      note.append(document.createTextNode(' '), profileNote, document.createTextNode(' '), applyProfile);
    }
    if (selected.profile && !rule) {
      var operations = selected.profile.rules && selected.profile.rules.operations || {};
      Object.keys(operations).forEach(function (operation) {
        var suggestedRule = operations[operation] || {};
        var code = String(suggestedRule.cfop || '');
        if (!/^\d{4}$/.test(code)) return;
        var chooseCfop = document.createElement('button');
        chooseCfop.type = 'button';
        chooseCfop.className = 'inline-suggestion';
        chooseCfop.textContent = 'Referência ' + (operation === 'interna' ? 'interna ' : operation === 'interestadual' ? 'interestadual ' : '') + code;
        chooseCfop.addEventListener('click', function () {
          cfop.value = code;
          cfop.dispatchEvent(new Event('input', { bubbles: true }));
          updateTotal();
        });
        note.append(document.createTextNode(' '), chooseCfop);
      });
    }
  }

  function setCfopSuggestion(target, message, input, code) {
    target.replaceChildren(document.createTextNode(message + ' '));
    if (!/^[1-7]\d{3}$/.test(code)) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'inline-suggestion';
    button.textContent = 'Usar sugestão ' + code;
    button.addEventListener('click', function () {
      input.value = code;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      var row = input.closest('.item-row');
      if (row) {
        var product = state.products.find(function (entry) { return entry.id === row.querySelector('.product').value; });
        if (product) updateTaxSuggestion(row, product, false);
      }
      updateTotal();
    });
    target.append(button);
  }

  window.jvgNfeApplyNatureCfop = function (selection) {
    var query = String(selection || '').trim();
    var match = query.match(/^(\d{4})\s*[-\u00b7\u2014]/);
    state.natureCfopSuggestion = match ? match[1] : '';
    if (match) {
      var label = query.slice(match[0].length).trim();
      var nature = document.querySelector('[name="nature"]');
      if (nature && label) nature.value = label.slice(0, 60);
      Array.from(items.querySelectorAll('.item-row')).forEach(function (row) {
        var cfop = row.querySelector('.cfop');
        if (row.dataset.cfopTouched !== 'true') cfop.value = state.natureCfopSuggestion;
        var product = state.products.find(function (entry) { return entry.id === row.querySelector('.product').value; });
        if (product) updateTaxSuggestion(row, product, false);
      });
    } else {
      Array.from(items.querySelectorAll('.item-row')).forEach(function (row) {
        var product = state.products.find(function (entry) { return entry.id === row.querySelector('.product').value; });
        if (product) updateTaxSuggestion(row, product, false);
        else if (row.dataset.cfopTouched !== 'true') row.querySelector('.cfop').value = '';
      });
    }
    if (typeof window.jvgNfeWizardRefresh === 'function') window.jvgNfeWizardRefresh();
  };

  function renderProductFiscalFacts(row, product, selected) {
    var target = row.querySelector('.product-fiscal-facts');
    if (!target) return;
    target.replaceChildren();
    var facts = [
      ['NCM deste item', row.querySelector('.item-ncm').value], ['CEST deste item', row.querySelector('.item-cest').value],
      ['Origem deste item', row.querySelector('.item-origin').value],
      ['Perfil opcional', selected && selected.profile && selected.profile.name],
      ['CFOP do item', row.querySelector('.cfop').value],
      ['CFOP sugerido', (selected && selected.rule && selected.rule.cfop) || (product && product.defaultCfop)],
      ['CSOSN sugerido', selected && selected.rule && selected.rule.csosn],
    ];
    facts.forEach(function (fact) {
      var item = document.createElement('div');
      var label = document.createElement('span'); label.textContent = fact[0];
      var value = document.createElement('strong'); value.textContent = fact[1] == null || fact[1] === '' ? 'Não cadastrado' : String(fact[1]);
      item.append(label, value); target.append(item);
    });
  }

  function focusTaxFieldControl(definition) {
    var label = document.createElement('label');
    label.className = 'field';
    var caption = document.createElement('span');
    caption.textContent = definition[1];
    var input = document.createElement('input');
    input.className = 'focus-tax-field';
    input.dataset.field = definition[0];
    input.dataset.touched = 'false';
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.placeholder = 'Informe somente se orientado';
    input.setAttribute('aria-label', definition[1]);
    input.addEventListener('input', function () { input.dataset.touched = 'true'; });
    label.append(caption, input);
    return label;
  }

  function buildFocusTaxFields(row) {
    var root = row.querySelector('.advanced-tax-groups');
    focusTaxFieldGroups.forEach(function (group) {
      var section = document.createElement('section');
      section.className = 'advanced-tax-group';
      var heading = document.createElement('h5');
      heading.textContent = group.title;
      var grid = document.createElement('div');
      grid.className = 'advanced-tax-grid';
      group.fields.forEach(function (field) { grid.append(focusTaxFieldControl(field)); });
      section.append(heading, grid);
      root.append(section);
    });
  }

  function updateItemTaxSuggestions() {
    Array.from(items.querySelectorAll('.item-row')).forEach(function (row) {
      var product = state.products.find(function (entry) { return entry.id === row.querySelector('.product').value; });
      if (product) updateTaxSuggestion(row, product, false);
    });
  }

  function addItem() {
    if (items.children.length >= 20) {
      report('Limite de 20 produtos por documento.', 'error');
      return;
    }
    var row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML =
      '<label class="field product-field"><span>Produto *</span><select class="product" required></select></label>' +
      '<label class="field"><span>Qtd. *</span><input class="quantity" type="number" min="0.001" max="100000" step="0.001" value="1" required></label>' +
      '<label class="field"><span>Preço (R$) *</span><input class="price" type="number" min="0" max="999999.99" step="0.01" required></label>' +
      '<label class="field"><span>CFOP do item</span><input class="cfop" maxlength="4" inputmode="numeric" list="cfopOptions" placeholder="Código de 4 dígitos"></label>' +
      '<label class="field"><span>CSOSN do ICMS</span><input class="csosn" maxlength="3" inputmode="numeric" placeholder="Código de 3 dígitos"></label>' +
      '<button type="button" class="remove-item" aria-label="Remover este produto" title="Remover produto">×</button>' +
      '<label class="field"><span>CST do PIS</span><input class="pis-cst" maxlength="2" inputmode="numeric" placeholder="2 dígitos"></label>' +
      '<label class="field"><span>CST da Cofins</span><input class="cofins-cst" maxlength="2" inputmode="numeric" placeholder="2 dígitos"></label>' +
      '<div class="item-fiscal-fields"><label class="field"><span>NCM do item</span><input class="item-ncm" maxlength="8" inputmode="numeric" placeholder="8 dígitos"></label>' +
      '<label class="field"><span>CEST do item</span><input class="item-cest" maxlength="9" inputmode="numeric" placeholder="Quando aplicável"></label>' +
      '<label class="field"><span>Origem da mercadoria</span><select class="item-origin"><option value="">Selecione</option><option value="0">Nacional</option><option value="1">Importação direta</option><option value="2">Importada, adquirida no mercado interno</option><option value="3">Nacional com conteúdo de importação acima de 40%</option><option value="4">Nacional, conforme processo produtivo básico</option><option value="5">Nacional com conteúdo de importação até 40%</option><option value="6">Importação direta, sem similar nacional</option><option value="7">Importada no mercado interno, sem similar nacional</option><option value="8">Nacional com conteúdo de importação acima de 70%</option></select></label></div>' +
      '<p class="tax-suggestion" role="status" aria-live="polite">Selecione produto e operação. As sugestões são opcionais e todos os códigos podem ser alterados neste item.</p>' +
      '<details class="product-fiscal-details"><summary>Valores tributários numéricos (avançado)</summary><p class="advanced-tax-help">Informe apenas os valores orientados para a combinação de CST/CSOSN deste item. O SigmaFiscal não calcula nem completa tributos.</p><div class="advanced-tax-groups"></div></details>' +
      '<details class="product-fiscal-details"><summary>Dados fiscais cadastrados</summary><div class="product-fiscal-facts"></div></details>';
    buildFocusTaxFields(row);
    var select = row.querySelector('.product');
    select.append(option('', 'Selecione'));
    state.products.filter(function (p) { return p.active; }).forEach(function (p) {
      select.append(option(p.id, p.name + ' · ' + p.sku));
    });
    select.addEventListener('change', function () {
      var product = state.products.find(function (p) { return p.id === select.value; });
      row.querySelector('.price').value = product ? Number(product.price || 0).toFixed(2) : '';
      updateTaxSuggestion(row, product, true);
      updateTotal();
    });
    row.querySelector('.cfop').addEventListener('input', function () {
      row.dataset.cfopTouched = 'true';
      var product = state.products.find(function (entry) { return entry.id === select.value; });
      if (product) updateTaxSuggestion(row, product, false);
    });
    row.querySelector('.csosn').addEventListener('input', function () { row.dataset.csosnTouched = 'true'; });
    row.querySelector('.item-ncm').addEventListener('input', function () { row.dataset.ncmTouched = 'true'; });
    row.querySelector('.item-cest').addEventListener('input', function () { row.dataset.cestTouched = 'true'; });
    row.querySelector('.item-origin').addEventListener('change', function () { row.dataset.originTouched = 'true'; });
    row.querySelector('.pis-cst').addEventListener('input', function () { row.dataset.pisCstTouched = 'true'; });
    row.querySelector('.cofins-cst').addEventListener('input', function () { row.dataset.cofinsCstTouched = 'true'; });
    row.querySelector('.remove-item').addEventListener('click', function () {
      if (items.children.length > 1) row.remove();
      else report('Mantenha pelo menos um produto na nota.', 'error');
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
        ncm: row.querySelector('.item-ncm').value.trim(),
        cest: row.querySelector('.item-cest').value.trim(),
        origin: row.querySelector('.item-origin').value,
        csosn: row.querySelector('.csosn').value.trim(),
        pisCst: row.querySelector('.pis-cst').value.trim(),
        cofinsCst: row.querySelector('.cofins-cst').value.trim(),
        focusFields: Object.fromEntries(Array.from(row.querySelectorAll('.focus-tax-field')).filter(function (input) {
          return input.value.trim() !== '';
        }).map(function (input) { return [input.dataset.field, input.value.trim()]; })),
      };
    });
  }

  function updateTotal() {
    var cents = readItems().reduce(function (sum, item) {
      var quantity = Number(item.quantity), price = Number(item.unitPrice);
      return sum + (Number.isFinite(quantity) && Number.isFinite(price) && quantity > 0 && price >= 0 ?
        Math.round(Math.round(quantity * 1000) * Math.round(price * 100) / 1000) : 0);
    }, 0);
    var total = document.getElementById('total');
    if (total) total.textContent = money.format(cents / 100);
    if (typeof window.jvgNfeWizardRefresh === 'function') window.jvgNfeWizardRefresh();
  }

  function renderHistory() {
    var target = document.getElementById('history');
    target.replaceChildren();
    var fiscalDocuments = state.drafts;
    if (!fiscalDocuments.length) {
      var empty = document.createElement('p');
      empty.textContent = 'Nenhum documento fiscal ou envio pendente registrado nesta empresa.';
      target.append(empty);
      return;
    }
    fiscalDocuments.forEach(function (draft) {
      var row = document.createElement('div');
      row.className = 'history-row';
      var name = document.createElement('strong');
      name.textContent = draft.recipientName;
      var date = document.createElement('small');
      var createdAt = new Date(draft.createdAt);
      var updatedAt = new Date(draft.updatedAt || draft.createdAt);
      var wasUpdated = Number.isFinite(updatedAt.getTime()) && Number.isFinite(createdAt.getTime()) &&
        updatedAt.getTime() > createdAt.getTime() + 1000;
      date.textContent = draft.itemsCount + ' produto(s) · ' + (wasUpdated ? 'Atualizado ' : 'Criado ') +
        (wasUpdated ? updatedAt : createdAt).toLocaleString('pt-BR');
      var source = document.createElement('small');
      source.textContent = draft.sourceOrderNumber ? 'Pedido de origem: ' + draft.sourceOrderNumber : 'Criado sem pedido de origem';
      var foot = document.createElement('div');
      var price = document.createElement('b');
      price.textContent = money.format(Number(draft.commercialTotalCents ?? draft.totalCents) / 100);
      var badge = document.createElement('span');
      var statusNames = { draft: 'Não enviada · revisar', processing: 'Em processamento na Focus', queued: 'Na fila da Focus',
        authorized: 'Autorizada', rejected: 'Rejeitada', denied: 'Denegada', cancelled: 'Cancelada', contingency: 'Contingência',
        waiting_certificate: 'Aguardando certificado' };
      badge.textContent = statusNames[draft.status] || draft.status;
      foot.append(price, badge);
      const preview = document.createElement('small');
      preview.textContent = 'Impostos não calculados';
      var inspect = document.createElement('button');
      inspect.type = 'button';
      inspect.className = 'draft-inspect';
      if (draft.status === 'draft' && !draft.focusReference) {
        inspect.textContent = 'Abrir para corrigir';
        inspect.addEventListener('click', function () { loadDraftForEditing(draft.id, inspect); });
      } else {
        inspect.textContent = draft.status === 'draft' ? 'Ver envio e tentar novamente' : 'Ver retorno e detalhes';
        inspect.addEventListener('click', function () { inspectDraft(draft.id); });
      }
      row.append(name, date, source, foot, preview, inspect);
      target.append(row);
    });
  }

  function appendLine(parent, tag, value) {
    var node = document.createElement(tag);
    node.textContent = value;
    parent.append(node);
  }

  async function runFocusAction(id, action, button) {
    button.disabled = true;
    var previousLabel = button.textContent;
    button.textContent = action === 'emit' ? 'Enviando para homologação...' : 'Consultando Focus...';
    try {
      var result = await api('/api/fiscal/nfe-drafts/transmit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, action: action, confirmHomologation: action === 'emit' }),
      });
      if (result.needsReconciliation) {
        report('A solicitação foi enviada à Focus para homologação e continua em processamento. Não reenvie; consulte o status.', 'info');
      } else if (result.status === 'authorized') {
        report('A Focus retornou status autorizado em homologação. Confira a chave e o protocolo nos detalhes; isso não é autorização de produção.', 'success');
      } else if (result.status === 'rejected' || result.status === 'denied') {
        report('A Focus retornou ' + result.status + '. Consulte a mensagem detalhada antes de tentar novamente.', 'error');
      } else {
        report('Status atualizado a partir da consulta à Focus: ' + (result.status || 'retorno recebido') + '.', 'info');
      }
      await refreshHistory();
      await inspectDraft(id);
    } catch (error) {
      report('Não foi possível concluir a ação na Focus: ' + error.message, 'error');
      try { await inspectDraft(id); } catch { /* A mensagem principal já foi mostrada. */ }
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }

  function renderHomologationActions(target, draft) {
    var panel = document.createElement('section');
    panel.className = 'homologation-actions';
    appendLine(panel, 'h4', 'Focus NFe · ambiente de homologação');
    if (draft.status === 'draft') {
      if (!draft.focusReference) {
        var editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'secondary-button';
        editButton.textContent = 'Corrigir dados da NF-e';
        editButton.addEventListener('click', function () { loadDraftForEditing(draft.id, editButton); });
        panel.append(editButton);
      } else {
        appendLine(panel, 'p', 'A referência desta tentativa já foi criada. Mantenha os dados e use o mesmo envio para evitar duplicidade.');
      }
      if (draft.canSubmitHomologation === true) {
        appendLine(panel, 'p', 'O envio só ficará disponível após sua confirmação explícita. Ele usa exclusivamente o ambiente de testes da Focus; não altera série ou numeração de produção.');
        var label = document.createElement('label');
        label.className = 'homologation-confirm';
        var check = document.createElement('input');
        check.type = 'checkbox';
        var copy = document.createElement('span');
        copy.textContent = 'Revisei os dados desta NF-e e confirmo que este envio será somente para homologação, sem emissão em produção.';
        label.append(check, copy);
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'add-button';
        button.disabled = true;
        button.textContent = 'Enviar NF-e de teste à Focus';
        check.addEventListener('change', function () { button.disabled = !check.checked; });
        button.addEventListener('click', function () {
          if (!check.checked) return;
          runFocusAction(draft.id, 'emit', button);
        });
        panel.append(label, button);
      } else {
        var setupIssues = draft.homologationSetup && Array.isArray(draft.homologationSetup.accessIssues)
          ? draft.homologationSetup.accessIssues : [];
        if (setupIssues.length) {
          appendLine(panel, 'p', 'Acesso ao ambiente de teste ou cadastro do emitente:');
          var setupList = document.createElement('ul');
          setupIssues.forEach(function (issue) { appendLine(setupList, 'li', String(issue)); });
          panel.append(setupList);
        } else {
          appendLine(panel, 'p', 'Envio bloqueado: conclua e revise os dados fiscais exigidos antes de transmitir.');
        }
        var issues = draft.homologationGate && Array.isArray(draft.homologationGate.issues)
          ? draft.homologationGate.issues : [];
        if (issues.length) {
          var list = document.createElement('ul');
          issues.forEach(function (issue) { appendLine(list, 'li', String(issue)); });
          panel.append(list);
        }
      }
    } else if (draft.focusReference && ['processing', 'queued', 'authorized', 'rejected', 'denied', 'cancelled'].includes(draft.status)) {
      appendLine(panel, 'p', 'A consulta atualiza o status desta referência. Ela não cria uma nova emissão.');
      var query = document.createElement('button');
      query.type = 'button';
      query.className = 'add-button';
      query.textContent = 'Consultar status na Focus';
      query.addEventListener('click', function () { runFocusAction(draft.id, 'reconcile', query); });
      panel.append(query);
    } else {
      appendLine(panel, 'p', 'Este documento não tem uma solicitação Focus consultável. Nenhuma transmissão será repetida automaticamente.');
    }
    target.append(panel);
  }

  function focusFieldLabel(key) {
    var labels = {
      codigo_produto: 'SKU', codigo_ncm: 'NCM', cfop: 'CFOP', codigo_barras_comercial: 'GTIN',
      cest: 'CEST',
      unidade_comercial: 'Unidade', quantidade_comercial: 'Quantidade',
      valor_unitario_comercial: 'Valor unitário', valor_bruto: 'Valor bruto',
      icms_origem: 'Origem da mercadoria', icms_situacao_tributaria: 'CSOSN / ICMS',
      pis_situacao_tributaria: 'CST do PIS', cofins_situacao_tributaria: 'CST da Cofins',
      ibs_cbs_situacao_tributaria: 'CST IBS/CBS',
      ibs_cbs_classificacao_tributaria: 'Classificação IBS/CBS (cClassTrib)',
    };
    if (labels[key]) return labels[key];
    var upper = { icms: 'ICMS', ibs: 'IBS', cbs: 'CBS', pis: 'PIS', cofins: 'Cofins', st: 'ST', uf: 'estadual', mun: 'municipal' };
    return key.split('_').map(function (word) {
      if (upper[word]) return upper[word];
      var labels = {
        aliquota: 'alíquota', base: 'base', calculo: 'cálculo', modalidade: 'modalidade',
        reducao: 'redução', margem: 'margem', valor: 'valor', adicionado: 'adicionado',
        credito: 'crédito', simples: 'Simples', retido: 'retido', substituto: 'substituto',
        quantidade: 'quantidade', vendida: 'vendida', porcentual: 'percentual',
      };
      return labels[word] || word;
    }).join(' ');
  }

  function focusFieldValue(key, value) {
    if (value === undefined || value === null || value === '') return 'Não mapeado';
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    if (/aliquota/.test(key)) return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(value) + ' %';
    if (/valor|base_calculo/.test(key)) return money.format(value);
    if (key === 'quantidade_comercial') return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(value);
    return String(value);
  }

  function appendFocusField(target, key, row) {
    var missing = !Object.prototype.hasOwnProperty.call(row, key) || row[key] === null || row[key] === '';
    var field = document.createElement('div');
    field.className = 'focus-preview-field' + (missing ? ' is-missing' : '');
    var label = document.createElement('span');
    label.textContent = focusFieldLabel(key);
    var value = document.createElement('strong');
    value.textContent = focusFieldValue(key, missing ? undefined : row[key]);
    field.append(label, value);
    target.append(field);
  }

  function renderFocusItemPreview(target, draft, focusReview) {
    var requestPreview = focusReview.requestPreview || {};
    var mappedItems = Array.isArray(requestPreview.items) ? requestPreview.items : [];
    var sourceItems = Array.isArray(draft.items) ? draft.items : [];
    if (!sourceItems.length) return;

    var section = document.createElement('section');
    section.className = 'focus-item-preview';
    var heading = document.createElement('div');
    heading.className = 'focus-item-preview-heading';
    var title = document.createElement('h4');
    title.textContent = 'Prévia fiscal por item';
    var note = document.createElement('p');
    note.textContent = 'Campos que serão enviados à Focus, conforme informados em cada item. O ERP não calcula impostos nem exige perfil tributário; confira as pendências antes do envio.';
    heading.append(title, note);
    section.append(heading);

    var fiscalKeys = [
      'cfop', 'icms_origem', 'icms_situacao_tributaria', 'cest', 'pis_situacao_tributaria',
      'cofins_situacao_tributaria', 'ibs_cbs_situacao_tributaria',
      'ibs_cbs_classificacao_tributaria',
    ];
    var commercialKeys = [
      'codigo_produto', 'codigo_ncm', 'codigo_barras_comercial', 'unidade_comercial',
      'quantidade_comercial', 'valor_unitario_comercial', 'valor_bruto',
    ];
    var knownKeys = commercialKeys.concat(fiscalKeys, ['numero_item', 'descricao']);
    var checks = Array.isArray(focusReview.checks) ? focusReview.checks : [];
    var pending = Array.isArray(draft.pending) ? draft.pending : [];

    sourceItems.forEach(function (item, index) {
      var row = mappedItems[index] && typeof mappedItems[index] === 'object' ? mappedItems[index] : {};
      var card = document.createElement('article');
      card.className = 'focus-item-card';
      var cardHeading = document.createElement('div');
      cardHeading.className = 'focus-item-card-heading';
      var name = document.createElement('strong');
      name.textContent = (index + 1) + '. ' + String(item.description || row.descricao || 'Produto');
      var state = document.createElement('span');
      state.className = 'focus-item-status';
      state.textContent = 'Tributação informada por item';
      cardHeading.append(name, state);
      card.append(cardHeading);

      var commercialHeading = document.createElement('h5');
      commercialHeading.textContent = 'Produto e valores comerciais';
      var commercial = document.createElement('div');
      commercial.className = 'focus-item-field-grid';
      commercialKeys.forEach(function (key) { appendFocusField(commercial, key, row); });
      var taxHeading = document.createElement('h5');
      taxHeading.textContent = 'Classificações fiscais do item';
      var classifications = document.createElement('div');
      classifications.className = 'focus-item-field-grid focus-item-tax-codes';
      fiscalKeys.forEach(function (key) { appendFocusField(classifications, key, row); });
      card.append(commercialHeading, commercial, taxHeading, classifications);

      var additionalKeys = Object.keys(row).filter(function (key) {
        return !knownKeys.includes(key) && /^(icms|pis|cofins|ibs|cbs)_/.test(key);
      });
      if (additionalKeys.length) {
        var valuesHeading = document.createElement('h5');
        valuesHeading.textContent = 'Valores fiscais mapeados';
        var values = document.createElement('div');
        values.className = 'focus-item-field-grid';
        additionalKeys.forEach(function (key) { appendFocusField(values, key, row); });
        card.append(valuesHeading, values);
      }

      var itemMarker = new RegExp('\\bItem\\s+' + (index + 1) + '\\b');
      var itemIssues = checks.filter(function (check) {
        return !check.ok && itemMarker.test(String(check.detail || ''));
      }).map(function (check) { return check.label + ': ' + check.detail; });
      itemIssues = itemIssues.concat(pending.filter(function (issue) { return itemMarker.test(String(issue)); }));
      itemIssues = Array.from(new Set(itemIssues));
      if (itemIssues.length) {
        var issuesHeading = document.createElement('h5');
        issuesHeading.textContent = 'Pendências deste item';
        var issues = document.createElement('ul');
        itemIssues.forEach(function (issue) { appendLine(issues, 'li', issue); });
        card.append(issuesHeading, issues);
      }
      section.append(card);
    });

    target.append(section);
  }

  async function inspectDraft(id) {
    var target = document.getElementById('draftDetails');
    target.replaceChildren();
    appendLine(target, 'p', 'Carregando detalhes da NF-e...');
    try {
      var response = await api('/api/fiscal/nfe-drafts?id=' + encodeURIComponent(id));
      var draft = response.draft;
      if (!draft || draft.readyToTransmit !== false || draft.transmissionEnabled !== false)
        throw new Error('Resposta fiscal inesperada. Consulte o suporte.');
      target.replaceChildren();
      var recipient = draft.recipient || {};
    var statusNames = { draft: 'Aguardando correção', processing: 'Em processamento na Focus', queued: 'Na fila da Focus',
        authorized: 'NF-e autorizada', rejected: 'NF-e rejeitada', denied: 'NF-e denegada', cancelled: 'NF-e cancelada', contingency: 'Contingência' };
      appendLine(target, 'h3', (statusNames[draft.status] || 'Documento NF-e') + ' · ' + (recipient.name || 'Destinatário'));
      if (draft.focusReference) appendLine(target, 'p', 'Referência Focus: ' + draft.focusReference);
      if (draft.documentNumber) appendLine(target, 'p', 'Número/Série: ' + draft.documentNumber + ' / ' + (draft.series || '—'));
      if (draft.accessKey) appendLine(target, 'p', 'Chave de acesso: ' + draft.accessKey);
      var providerResponse = draft.providerResponse || {};
      var providerBody = providerResponse.response || {};
      if (providerResponse.phase) appendLine(target, 'p', 'Etapa registrada: ' + providerResponse.phase);
      var providerStatus = providerBody.status_sefaz || providerBody.status || providerBody.codigo_status;
      var providerMessage = providerBody.mensagem_sefaz || providerBody.mensagem || providerBody.erro;
      if (providerStatus || providerMessage)
        appendLine(target, 'p', 'Retorno Focus/SEFAZ: ' + [providerStatus, providerMessage].filter(Boolean).join(' · '));
      if (providerBody.caminho_xml_nota_fiscal)
        appendLine(target, 'p', 'Caminho do XML na Focus: ' + providerBody.caminho_xml_nota_fiscal);
      if (providerBody.caminho_danfe)
        appendLine(target, 'p', 'Caminho do DANFE na Focus: ' + providerBody.caminho_danfe);
      var focusEvents = Array.isArray(providerBody.eventos) ? providerBody.eventos : [];
      if (focusEvents.length) {
        appendLine(target, 'h4', 'Eventos retornados pela Focus');
        focusEvents.slice(0, 20).forEach(function (event) {
          var eventInfo = [event.tipo_evento, event.status, event.codigo_status, event.mensagem_sefaz || event.mensagem]
            .filter(function (value) { return value != null && String(value).trim() !== ''; }).map(String).join(' · ');
          if (eventInfo) appendLine(target, 'p', eventInfo);
        });
      }
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
      if (draft.vehicle && draft.vehicle.plate)
        appendLine(target, 'p', 'Veículo: ' + draft.vehicle.plate.toUpperCase() +
          (draft.vehicle.state ? ' · ' + draft.vehicle.state.toUpperCase() : '') +
          (draft.vehicle.rntc ? ' · RNTC ' + draft.vehicle.rntc : ''));
      (Array.isArray(draft.volumes) ? draft.volumes : []).forEach(function (volume) {
        var weight = volume.netWeightMilli != null || volume.grossWeightMilli != null ?
          ' · peso líquido/bruto: ' + (volume.netWeightMilli == null ? '—' : (Number(volume.netWeightMilli) / 1000).toFixed(3)) +
          '/' + (volume.grossWeightMilli == null ? '—' : (Number(volume.grossWeightMilli) / 1000).toFixed(3)) : '';
        appendLine(target, 'p', 'Volumes: ' + volume.quantity + (volume.species ? ' · ' + volume.species : '') + weight);
      });
      if (draft.sourceOrder && draft.sourceOrder.number)
        appendLine(target, 'p', 'Pedido de origem: ' + draft.sourceOrder.number + ' · situação ' + (draft.sourceOrder.status || ''));
      appendLine(target, 'p', 'Total comercial: ' + money.format(Number(draft.commercialTotalCents ?? draft.totalCents ?? 0) / 100));
      if (draft.preflight) {
        appendLine(target, 'h4', 'Pré-conferência cadastral');
        appendLine(target, 'p', draft.preflight.dataComplete ?
          'Dados básicos presentes. Confira os campos fiscais obrigatórios para esta combinação.' :
          'Dados cadastrais incompletos: veja as pendências abaixo.');
        appendLine(target, 'p', 'A pré-conferência verifica dados cadastrais; ela não valida a autorização da SEFAZ. A emissão em produção continua bloqueada.');
      } else {
        appendLine(target, 'p', 'Documento antigo: pré-conferência cadastral indisponível.');
      }
      var documentReview = draft.documentReview || {};
      if (Array.isArray(documentReview.checks)) {
        appendLine(target, 'h4', 'Revisão da NF-e');
        var checkList = document.createElement('ul');
        documentReview.checks.filter(function (check) { return check.key !== 'taxPreview' && check.key !== 'transmission'; }).forEach(function (check) {
          appendLine(checkList, 'li', (check.ok ? '✓ ' : 'Pendente: ') +
            check.label + ' — ' + check.detail);
        });
        target.append(checkList);
        appendLine(target, 'p', 'Checklist interno: não é XML, DANFE, validação da SEFAZ ou permissão de emissão.');
      }
      var focusReview = draft.focusPayloadReview || {};
      appendLine(target, 'h4', 'Conferência do payload Focus');
      appendLine(target, 'p', 'Campos fiscais mapeados para análise. ' +
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
        previewSummary.textContent = 'Abrir JSON técnico mapeado para a Focus';
        var previewJson = document.createElement('pre');
        previewJson.className = 'focus-json-preview';
        previewJson.textContent = JSON.stringify(focusReview.requestPreview, null, 2);
        previewDetails.append(previewSummary, previewJson);
        target.append(previewDetails);
      }
      renderFocusItemPreview(target, draft, focusReview);
      appendLine(target, 'h4', 'Pendências de conferência');
      var pending = Array.isArray(draft.pending) ? draft.pending : [];
      if (pending.length) {
        var list = document.createElement('ul');
        pending.forEach(function (issue) { appendLine(list, 'li', String(issue)); });
        target.append(list);
      } else {
        appendLine(target, 'p', 'Sem pendências registradas neste documento. Isso não representa aprovação fiscal.');
      }
      appendLine(target, 'h4', 'Apuração tributária');
      appendLine(target, 'p', 'Não realizada. O ERP não calcula bases, alíquotas ou valores de impostos. A prévia mostra os campos informados e os dados obrigatórios que ainda faltam.');
      appendLine(target, 'p', 'O perfil tributário é opcional. A transmissão em homologação depende dos campos exigidos para cada CST/CSOSN e da conferência da operação real.');
      renderHomologationActions(target, draft);
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
    state.homologationSetup = response.homologationSetup || null;
    state.isJvgPilot = Boolean(state.homologationSetup && state.homologationSetup.pilotCompanyMatches === true);
    renderHistory();
    renderHomologationReadiness();
    if (state.isJvgPilot) updateItemTaxSuggestions();
  }

  function clearOrderQuery() {
    var url = new URL(window.location.href);
    url.searchParams.delete('orderId');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  async function loadDraftForEditing(id, button) {
    var hasUnsavedWork = Boolean(form.elements.namedItem('nature').value.trim() ||
      form.elements.namedItem('recipientId').value ||
      Array.from(items.querySelectorAll('.product')).some(function (field) { return field.value; }));
    if (hasUnsavedWork && !window.confirm('Abrir este documento substituirá os dados atuais ainda não salvos. Continuar?')) return;
    button.disabled = true;
    var oldLabel = button.textContent;
    button.textContent = 'Carregando documento…';
    try {
      var response = await api('/api/fiscal/nfe-drafts?id=' + encodeURIComponent(id));
      var draft = response.draft;
      if (!draft || draft.status !== 'draft') throw new Error('Somente NF-e ainda não transmitidas podem ser editadas.');
      if (!Array.isArray(draft.items) || !draft.items.length) throw new Error('O documento não contém itens para retomar.');
      if (!draft.recipient || !state.clients.some(function (client) { return client.active && client.id === draft.recipient.id; }))
        throw new Error('O destinatário da NF-e não está ativo ou disponível nesta empresa. O registro salvo foi preservado.');
      var unavailableProduct = draft.items.some(function (saved) {
        return !state.products.some(function (product) { return product.active && product.id === saved.productId; });
      });
      if (unavailableProduct) throw new Error('Um produto da NF-e não está ativo ou disponível no catálogo. O registro salvo foi preservado.');

      form.reset();
      if (typeof window.jvgNfeWizardReset === 'function') window.jvgNfeWizardReset();
      items.replaceChildren();
      state.sourceOrderId = draft.sourceOrder && draft.sourceOrder.id || null;
      state.sourceOrderNumber = draft.sourceOrder && draft.sourceOrder.number || '';
      document.getElementById('sourceOrderLabel').textContent = state.sourceOrderNumber;
      document.getElementById('sourceOrderNotice').hidden = !state.sourceOrderId;
      document.getElementById('recipientId').disabled = Boolean(state.sourceOrderId);
      document.getElementById('recipientId').value = draft.recipient && draft.recipient.id || '';
      document.getElementById('recipientId').dispatchEvent(new Event('change', { bubbles: true }));
      draft.items.forEach(function (saved) {
        addItem();
        var row = items.lastElementChild;
        var product = row.querySelector('.product');
        product.value = saved.productId;
        product.dispatchEvent(new Event('change', { bubbles: true }));
        row.querySelector('.quantity').value = String(saved.quantity || '');
        row.querySelector('.price').value = (Number(saved.unitPriceCents || 0) / 100).toFixed(2);
        row.querySelector('.cfop').value = String(saved.cfop || '');
        row.querySelector('.csosn').value = String(saved.taxRules && saved.taxRules.csosn || saved.csosn || '');
        row.querySelector('.pis-cst').value = String(saved.taxRules && saved.taxRules.pisCst || '');
        row.querySelector('.cofins-cst').value = String(saved.taxRules && saved.taxRules.cofinsCst || '');
        row.querySelector('.item-ncm').value = String(saved.ncm || '');
        row.querySelector('.item-cest').value = String(saved.cest || '');
        row.querySelector('.item-origin').value = saved.origin == null ? '' : String(saved.origin);
        var focusFields = saved.taxRules && saved.taxRules.focusFields || {};
        row.querySelectorAll('.focus-tax-field').forEach(function (input) {
          input.value = focusFields[input.dataset.field] == null ? '' : String(focusFields[input.dataset.field]);
          input.dataset.touched = 'true';
        });
        ['cfopTouched', 'csosnTouched', 'ncmTouched', 'cestTouched', 'originTouched', 'pisCstTouched', 'cofinsCstTouched']
          .forEach(function (key) { row.dataset[key] = 'true'; });
        if (state.sourceOrderId) {
          row.querySelectorAll('.product, .quantity, .price, .remove-item').forEach(function (field) { field.disabled = true; });
        }
      });
      document.getElementById('addItem').disabled = Boolean(state.sourceOrderId) || items.children.length >= 20;
      if (typeof window.jvgNfeWizardLoad === 'function') window.jvgNfeWizardLoad(draft);
      updateTotal();
      state.editingDraftId = draft.id;
      idempotencyKey = null;
      report('Documento aberto para edição. Ao concluir, salvar atualizará este registro; a transmissão continuará condicionada às validações de homologação.');
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      report('Não foi possível retomar o documento: ' + error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = oldLabel;
    }
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
    report('Vínculo com o pedido removido. Você pode editar os itens; a origem não será registrada na nota.');
  }

  function importOrder(order) {
    if (!order || !order.id) throw new Error('Pedido inválido.');
    if (order.status !== 'open' && order.status !== 'fulfilled')
      throw new Error('Somente pedidos em aberto ou concluídos podem ser preparados para NF-e.');
    if (!order.customer_id) throw new Error('O pedido precisa ter um cliente cadastrado.');
    if (!Array.isArray(order.items) || order.items.length < 1 || order.items.length > 20)
      throw new Error('A NF-e aceita até 20 itens por NF-e; este pedido não pode ser importado.');
    var recipient = state.clients.find(function (client) {
      return client.id === order.customer_id && client.active && client.isCustomer === true && client.type !== 'EXT';
    });
    if (!recipient) throw new Error('O cliente do pedido está inativo ou não está disponível para NF-e.');
    var mapped = order.items.map(function (item) {
      if (!item || !item.productId || item.serviceId)
        throw new Error('Este pedido contém serviço ou item sem produto vinculado. A NF-e atual é para mercadorias.');
      var product = state.products.find(function (entry) { return entry.id === item.productId && entry.active; });
      if (!product) throw new Error('Um produto do pedido está inativo ou não pertence ao catálogo carregado.');
      var quantity = Number(item.quantity), unitPrice = Number(item.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0)
        throw new Error('Quantidade ou preço do pedido está inválido.');
      return { productId: item.productId, quantity: quantity, unitPrice: unitPrice, product: product };
    });
    if (state.drafts.some(function (draft) { return draft.sourceOrderId === order.id; }) &&
        !window.confirm('Já existe uma NF-e não transmitida para este pedido. Deseja criar outra?'))
      return;
    if (items.children.length && !window.confirm('Carregar este pedido substituirá os dados atuais do formulário. Continuar?'))
      return;

    form.reset();
    if (typeof window.jvgNfeWizardReset === 'function') window.jvgNfeWizardReset();
    items.replaceChildren();
    document.getElementById('recipientId').value = order.customer_id;
    document.getElementById('recipientId').disabled = true;
    document.getElementById('recipientId').dispatchEvent(new Event('change', { bubbles: true }));
    mapped.forEach(function (entry) {
      addItem();
      var row = items.lastElementChild;
      var productSelect = row.querySelector('.product');
      productSelect.value = entry.productId;
      productSelect.dispatchEvent(new Event('change'));
      row.querySelector('.quantity').value = String(entry.quantity);
      row.querySelector('.price').value = Number(entry.unitPrice).toFixed(2);
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
      var results = await Promise.all([
        api('/api/records?scope=quotes'),
        api('/api/company').catch(function () { return {}; }),
        api('/api/fiscal/tax-profiles').catch(function () { return { records: [] }; }),
      ]);
      var data = results[0];
      var companyData = results[1];
      var profileData = results[2];
      state.products = Array.isArray(data.products) ? data.products : [];
      state.clients = Array.isArray(data.clients) ? data.clients : [];
      state.issuerState = String(companyData.company && companyData.company.state || '').trim().toUpperCase();
      state.taxProfiles = Array.isArray(profileData.records) ? profileData.records : [];
      renderHomologationReadiness();
      fillRecipients();
      fillCarriers();
      addItem();
      // Sugestões oficiais não podem impedir a emissão se o catálogo falhar.
      var auxiliary = await Promise.all([
        api('/api/fiscal/cfop').catch(function () { return { records: [] }; }),
        refreshHistory().catch(function () { return null; }),
      ]);
      try {
        var cfops = auxiliary[0];
        var options = document.getElementById('cfopOptions');
        (cfops.records || []).forEach(function (record) {
          options.append(option(record.code, record.customLabel || record.title));
        });
        var natureOptions = document.getElementById('natureCfopOptions');
        (cfops.records || []).filter(function (record) {
          return /^[567]/.test(String(record.code || '')) &&
            (!record.flags || record.flags.indNFe !== 0);
        }).sort(function (left, right) {
          return Number(right.code) - Number(left.code);
        }).forEach(function (record) {
          var description = String(record.customLabel || record.title || '').trim().slice(0, 60);
          if (description && natureOptions) natureOptions.append(option(record.code + ' - ' + description, record.title || description));
        });
      } catch { /* campo livre continua disponível */ }
      document.getElementById('recipientId').addEventListener('change', updateItemTaxSuggestions);
      state.ready = state.products.some(function (p) { return p.active; }) &&
        state.clients.some(function (c) { return c.active && c.isCustomer === true && c.type !== 'EXT'; });
      saveButton.disabled = !state.ready;
      report(state.ready ?
        'Conectado ao Supabase. A NF-e será vinculada à empresa ativa e só será enviada após sua confirmação.' :
        'Cadastre pelo menos um produto e um cliente ativos no ERP para preparar a NF-e.', state.ready ? '' : 'info');
      var sourceOrderId = new URLSearchParams(window.location.search).get('orderId');
      if (sourceOrderId) {
        try {
          var orderResponse = await api('/api/orders?id=' + encodeURIComponent(sourceOrderId));
          importOrder(orderResponse.order);
        } catch (error) {
          report('Não foi possível carregar o pedido na nota: ' + error.message, 'error');
        }
      }
    } catch (error) {
      report('Falha ao carregar a central fiscal: ' + error.message + ' Volte ao ERP ou recarregue esta página.', 'error');
      saveButton.disabled = true;
    }
  }

  document.getElementById('addItem').addEventListener('click', addItem);
  document.getElementById('unlinkSourceOrder').addEventListener('click', unlinkSourceOrder);
  function resetComposition() {
    idempotencyKey = null;
    state.sourceOrderId = null;
    state.sourceOrderNumber = '';
    state.editingDraftId = null;
    document.getElementById('sourceOrderNotice').hidden = true;
    document.getElementById('recipientId').disabled = false;
    document.getElementById('addItem').disabled = !state.ready;
    clearOrderQuery();
    form.reset();
    setDefaultIssueAt();
    if (typeof window.jvgNfeWizardReset === 'function') window.jvgNfeWizardReset();
    items.replaceChildren();
    addItem();
    items.querySelectorAll('.product, .quantity, .price, .remove-item').forEach(function (field) { field.disabled = false; });
  }

  async function createDraft() {
    if (!idempotencyKey) {
      if (!window.crypto || typeof window.crypto.randomUUID !== 'function')
        throw new Error('Este navegador não oferece uma chave segura para evitar duplicidade. Atualize o navegador.');
      idempotencyKey = window.crypto.randomUUID();
    }
    var result = await api('/api/fiscal/nfe-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(Object.assign({
        nature: form.elements.namedItem('nature').value.trim(),
        documentId: state.editingDraftId,
        purpose: selectedNumber('purpose'),
        issueAt: selectedIssueAt(),
        consumerFinal: form.elements.namedItem('consumerFinal').value === '' ? null :
          form.elements.namedItem('consumerFinal').value === '1',
        buyerPresence: selectedNumber('buyerPresence'),
        transportMode: selectedNumber('transportMode'),
        carrierId: form.elements.namedItem('carrierId').value || null,
        vehicle: {
          plate: form.elements.namedItem('vehiclePlate').value.trim(),
          state: form.elements.namedItem('vehicleState').value.trim(),
          rntc: form.elements.namedItem('vehicleRntc').value.trim(),
        },
        volumes: [{
          quantity: form.elements.namedItem('volumeQuantity').value,
          species: form.elements.namedItem('volumeSpecies').value.trim(),
          brand: form.elements.namedItem('volumeBrand').value.trim(),
          number: form.elements.namedItem('volumeNumber').value.trim(),
          netWeight: form.elements.namedItem('volumeNetWeight').value,
          grossWeight: form.elements.namedItem('volumeGrossWeight').value,
        }],
        recipientId: form.elements.namedItem('recipientId').value,
        sourceOrderId: state.sourceOrderId,
        items: readItems(),
      }, typeof window.jvgNfeWizardData === 'function' ? window.jvgNfeWizardData() : {})),
    });
    resetComposition();
    try { await refreshHistory(); }
    catch { result.historyRefreshFailed = true; }
    return result;
  }

  function selectedFinalizationChoice() {
    var selected = finalizeDialog.querySelector('input[name="finalizationChoice"]:checked');
    return selected ? selected.value : 'emit';
  }

  function updateFinalizationChoice() {
    var choice = selectedFinalizationChoice();
    var intro = finalizeDialog.querySelector('.finalize-intro');
    intro.textContent = state.editingDraftId
      ? 'Voc\u00ea est\u00e1 revisando uma NF-e ainda n\u00e3o transmitida. Confirme o envio em homologa\u00e7\u00e3o ou cancele as altera\u00e7\u00f5es.'
      : 'Confirme o envio desta NF-e de teste ou cancele para sair sem criar um documento.';
    var discardOption = finalizeDialog.querySelector('.finalize-option-danger');
    discardOption.querySelector('strong').textContent = state.editingDraftId ? 'Cancelar altera\u00e7\u00f5es' : 'Cancelar sem criar';
    discardOption.querySelector('small').textContent = state.editingDraftId
      ? 'Sai desta edi\u00e7\u00e3o e preserva os dados j\u00e1 salvos para revis\u00e3o.'
      : 'Sai sem salvar, sem criar registro e sem enviar dados \u00e0 Focus.';
    var confirmationRow = document.getElementById('homologationConfirmRow');
    var confirmation = document.getElementById('confirmHomologation');
    confirmationRow.hidden = choice !== 'emit';
    confirmFinalizeButton.textContent = choice === 'emit' ? 'Enviar para homologa\u00e7\u00e3o' :
      (state.editingDraftId ? 'Cancelar altera\u00e7\u00f5es' : 'Cancelar sem criar');
    confirmFinalizeButton.classList.toggle('is-danger', choice === 'discard');
    confirmFinalizeButton.disabled = choice === 'emit' && !confirmation.checked;
    finalizeFeedback.hidden = true;
    finalizeFeedback.classList.remove('error');
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!state.ready) return;
    if (typeof window.jvgNfeWizardCanSave === 'function' && !window.jvgNfeWizardCanSave()) return;
    finalizeDialog.querySelector('input[name="finalizationChoice"][value="emit"]').checked = true;
    document.getElementById('confirmHomologation').checked = false;
    updateFinalizationChoice();
    finalizeDialog.showModal();
  });
  finalizeDialog.querySelectorAll('input[name="finalizationChoice"]').forEach(function (input) {
    input.addEventListener('change', updateFinalizationChoice);
  });
  document.getElementById('confirmHomologation').addEventListener('change', updateFinalizationChoice);
  document.getElementById('closeFinalize').addEventListener('click', function () { finalizeDialog.close(); });
  document.getElementById('backToReview').addEventListener('click', function () { finalizeDialog.close(); });
  confirmFinalizeButton.addEventListener('click', async function () {
    var choice = selectedFinalizationChoice();
    if (choice === 'emit' && !document.getElementById('confirmHomologation').checked) return;
    if (choice === 'discard') {
      var wasEditing = Boolean(state.editingDraftId);
      resetComposition();
      finalizeDialog.close();
      report(wasEditing
        ? 'Altera\u00e7\u00f5es canceladas. Os dados j\u00e1 salvos foram preservados no hist\u00f3rico fiscal.'
        : 'Opera\u00e7\u00e3o cancelada. Nenhum documento foi criado nem enviado \u00e0 Focus.');
      return;
    }
    if (typeof window.jvgNfeWizardValidateFinalization === 'function' &&
        !window.jvgNfeWizardValidateFinalization('emit')) {
      finalizeFeedback.textContent = status.textContent;
      finalizeFeedback.classList.add('error');
      finalizeFeedback.hidden = false;
      return;
    }

    confirmFinalizeButton.disabled = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Enviando para homologa\u00e7\u00e3o\u2026';
    var documentId = null;
    try {
      var fiscalDocument = await createDraft();
      documentId = fiscalDocument.id;
      finalizeDialog.close();
      try {
        var result = await api('/api/fiscal/nfe-drafts/transmit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: fiscalDocument.id, action: 'emit', confirmHomologation: true }),
        });
        if (result.status === 'authorized') report('A Focus confirmou autoriza\u00e7\u00e3o em HOMOLOGA\u00c7\u00c3O. Confira o hist\u00f3rico fiscal e o retorno oficial.');
        else repor