(function () {
  'use strict';

  var state = { products: [], clients: [], taxProfiles: [], issuerState: '', drafts: [], homologationSetup: null, isJvgPilot: false, ready: false, sourceOrderId: null, sourceOrderNumber: '', sourceDocument: null, sourceDocumentLocksItems: false, sourceImportKind: '', sourceImportPage: 1, sourceImportHasMore: false, sourceImportRows: [], editingDraftId: null, natureCfopSuggestion: '' };
  var idempotencyKey = null;
  var status = document.getElementById('status');
  var form = document.getElementById('draftForm');
  var items = document.getElementById('items');
  var saveButton = document.getElementById('saveButton');
  var finalizeDialog = document.getElementById('finalizeDialog');
  var confirmFinalizeButton = document.getElementById('confirmFinalize');
  var finalizeFeedback = document.getElementById('finalizeFeedback');
  var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var focusTaxFieldSpecs = {
    icms_modalidade_base_calculo: ['Modalidade da base do ICMS', 'Código/modalidade orientado'],
    icms_reducao_base_calculo: ['Redução da base do ICMS (%)', 'Percentual orientado'],
    icms_base_calculo: ['Base do ICMS (R$)', 'Base do item nesta operação'],
    icms_aliquota: ['Alíquota do ICMS (%)', 'Percentual orientado'],
    icms_valor: ['Valor do ICMS (R$)', 'Valor correspondente ao item'],
    icms_modalidade_base_calculo_st: ['Modalidade da base do ICMS-ST', 'Código/modalidade orientado'],
    icms_margem_valor_adicionado_st: ['Margem de valor agregado ST (%)', 'Percentual orientado'],
    icms_reducao_base_calculo_st: ['Redução da base do ICMS-ST (%)', 'Percentual orientado'],
    icms_base_calculo_st: ['Base do ICMS-ST (R$)', 'Base do item nesta operação'],
    icms_aliquota_st: ['Alíquota do ICMS-ST (%)', 'Percentual orientado'],
    icms_valor_st: ['Valor do ICMS-ST (R$)', 'Valor correspondente ao item'],
    icms_aliquota_credito_simples: ['Alíquota de crédito do Simples (%)', 'Use apenas se houver crédito autorizado'],
    icms_valor_credito_simples: ['Valor de crédito do Simples (R$)', 'Valor correspondente ao item'],
    icms_base_calculo_retido_st: ['Base de ICMS-ST retido (R$)', 'Base informada para este item'],
    icms_valor_retido_st: ['ICMS-ST retido anteriormente (R$)', 'Valor informado para este item'],
    icms_valor_substituto: ['ICMS do substituto (R$)', 'Valor informado para este item'],
    icms_aliquota_final: ['Alíquota final do ICMS (%)', 'Percentual informado para este item'],
    pis_base_calculo: ['Base de cálculo do PIS (R$)', 'Base do item nesta operação'],
    pis_aliquota_porcentual: ['Alíquota percentual do PIS (%)', 'Percentual orientado'],
    pis_quantidade_vendida: ['Quantidade tributável do PIS', 'Quantidade tributável deste item'],
    pis_aliquota_valor: ['Alíquota do PIS por unidade (R$)', 'Valor por unidade orientado'],
    pis_valor: ['Valor do PIS (R$)', 'Valor correspondente ao item'],
    pis_base_calculo_st: ['Base de cálculo do PIS-ST (R$)', 'Base do item nesta operação'],
    pis_aliquota_porcentual_st: ['Alíquota percentual do PIS-ST (%)', 'Percentual orientado'],
    pis_quantidade_vendida_st: ['Quantidade tributável do PIS-ST', 'Quantidade tributável deste item'],
    pis_aliquota_valor_st: ['Alíquota do PIS-ST por unidade (R$)', 'Valor por unidade orientado'],
    pis_valor_st: ['Valor do PIS-ST (R$)', 'Valor correspondente ao item'],
    cofins_base_calculo: ['Base de cálculo da Cofins (R$)', 'Base do item nesta operação'],
    cofins_aliquota_porcentual: ['Alíquota percentual da Cofins (%)', 'Percentual orientado'],
    cofins_quantidade_vendida: ['Quantidade tributável da Cofins', 'Quantidade tributável deste item'],
    cofins_aliquota_valor: ['Alíquota da Cofins por unidade (R$)', 'Valor por unidade orientado'],
    cofins_valor: ['Valor da Cofins (R$)', 'Valor correspondente ao item'],
    cofins_base_calculo_st: ['Base de cálculo da Cofins-ST (R$)', 'Base do item nesta operação'],
    cofins_aliquota_porcentual_st: ['Alíquota percentual da Cofins-ST (%)', 'Percentual orientado'],
    cofins_quantidade_vendida_st: ['Quantidade tributável da Cofins-ST', 'Quantidade tributável deste item'],
    cofins_aliquota_valor_st: ['Alíquota da Cofins-ST por unidade (R$)', 'Valor por unidade orientado'],
    cofins_valor_st: ['Valor da Cofins-ST (R$)', 'Valor correspondente ao item']
  };

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
    var environmentAccessReady = setup.accountCanSubmit && setup.focusTokenConfigured;
    var regimeReady = setup.taxRegimeConfirmationAvailable && setup.taxRegimeConfirmed && setup.supportedTaxRegime;
    var issuerReady = setup.issuerFound && Array.isArray(setup.issuerMissing) && setup.issuerMissing.length === 0;
    var checks = [
      [environmentAccessReady, 'Empresa do login', setup.accountCanSubmit
        ? 'A homologação usa a empresa em que você está logado.'
        : 'Este perfil só consulta e não transmite.'],
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

  function applicableFocusTaxGroups(row) {
    var groups = [];
    var csosn = row.querySelector('.csosn').value.trim();
    var pisCst = row.querySelector('.pis-cst').value.trim();
    var cofinsCst = row.querySelector('.cofins-cst').value.trim();
    var icmsBasic = ['icms_modalidade_base_calculo', 'icms_reducao_base_calculo', 'icms_base_calculo', 'icms_aliquota', 'icms_valor'];
    var icmsSt = ['icms_modalidade_base_calculo_st', 'icms_margem_valor_adicionado_st', 'icms_reducao_base_calculo_st', 'icms_base_calculo_st', 'icms_aliquota_st', 'icms_valor_st'];
    var icmsCredit = ['icms_aliquota_credito_simples', 'icms_valor_credito_simples'];
    var icmsRetained = ['icms_base_calculo_retido_st', 'icms_valor_retido_st', 'icms_valor_substituto', 'icms_aliquota_final'];
    function add(title, fields, optional) { groups.push({ title: title, fields: fields, optional: optional === true }); }
    function addPisCofins(prefix, cst) {
      var label = prefix.toUpperCase();
      if (cst === '01' || cst === '02') add(label + ' · CST ' + cst, [prefix + '_base_calculo', prefix + '_aliquota_porcentual', prefix + '_valor']);
      else if (cst === '03') add(label + ' · CST 03', [prefix + '_quantidade_vendida', prefix + '_aliquota_valor', prefix + '_valor']);
      else if (cst === '05') add(label + '-ST · CST 05', [prefix + '_base_calculo_st', prefix + '_aliquota_porcentual_st', prefix + '_valor_st']);
      else if (cst === '99') add(label + ' · CST 99 · escolha percentual ou quantidade', [prefix + '_base_calculo', prefix + '_aliquota_porcentual', prefix + '_quantidade_vendida', prefix + '_aliquota_valor', prefix + '_valor']);
    }
    if (csosn === '101') add('Crédito do Simples Nacional · CSOSN 101', icmsCredit);
    else if (csosn === '201') { add('ICMS-ST · CSOSN 201', icmsSt); add('Crédito do Simples · CSOSN 201', icmsCredit); }
    else if (csosn === '202' || csosn === '203') add('ICMS-ST · CSOSN ' + csosn, icmsSt);
    else if (csosn === '500') add('ICMS-ST retido anteriormente · opcional', icmsRetained, true);
    else if (csosn === '900') { add('ICMS · CSOSN 900 · opcional', icmsBasic, true); add('ICMS-ST · CSOSN 900 · opcional', icmsSt, true); add('Crédito do Simples · CSOSN 900 · opcional', icmsCredit, true); }
    addPisCofins('pis', pisCst);
    addPisCofins('cofins', cofinsCst);
    return groups;
  }

  function applicableFocusTaxFieldNames(row) {
    return new Set(applicableFocusTaxGroups(row).reduce(function (all, group) { return all.concat(group.fields); }, []));
  }

  function renderFocusTaxFields(row, configuredValues) {
    var root = row.querySelector('.advanced-tax-groups');
    if (!root) return;
    var manualValues = row.__manualFocusTaxValues || (row.__manualFocusTaxValues = {});
    var groups = applicableFocusTaxGroups(row);
    root.replaceChildren();
    if (!groups.length) {
      var empty = document.createElement('p');
      empty.className = 'advanced-tax-empty';
      empty.textContent = 'Para os códigos fiscais deste item, não há campos numéricos adicionais a preencher. As regras comuns do Simples não exigem estes valores; grupos condicionais aparecem aqui conforme o CSOSN e os CSTs selecionados.';
      root.append(empty);
      return;
    }
    groups.forEach(function (group) {
      var section = document.createElement('section');
      section.className = 'advanced-tax-group';
      var heading = document.createElement('h5');
      heading.textContent = group.title + (group.optional ? ' · opcional' : '');
      var grid = document.createElement('div');
      grid.className = 'advanced-tax-grid';
      group.fields.forEach(function (name) {
        var spec = focusTaxFieldSpecs[name];
        if (!spec) return;
        var input = focusTaxFieldControl([name, spec[0], spec[1]]);
        var hasManualValue = Object.prototype.hasOwnProperty.call(manualValues, name);
        var profileValue = configuredValues && configuredValues[name];
        input.value = hasManualValue ? manualValues[name] : (profileValue == null ? '' : String(profileValue));
        input.dataset.touched = hasManualValue ? 'true' : 'false';
        input.addEventListener('input', function () {
          manualValues[name] = input.value;
          input.dataset.touched = 'true';
        });
        grid.append(input.closest('.field'));
      });
      section.append(heading, grid);
      if (group.optional) {
        var note = document.createElement('p');
        note.className = 'advanced-tax-group-note';
        note.textContent = 'Preencha apenas quando esta situação se aplicar e a contabilidade fornecer os dados.';
        section.append(note);
      }
      if (!group.optional) {
        var configuredNote = document.createElement('p');
        configuredNote.className = 'advanced-tax-group-note';
        configuredNote.textContent = 'Valores existentes no perfil do produto ou da operação aparecem preenchidos e podem ser ajustados neste item. O ERP não inventa bases, alíquotas ou valores.';
        section.append(configuredNote);
      }
      root.append(section);
    });
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
      row.__manualFocusTaxValues = {};
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
      row.__configuredFocusTaxFields = {};
      renderFocusTaxFields(row, {});
      renderProductFiscalFacts(row, null, null);
      note.textContent = 'Selecione o produto. Os perfis e o CFOP do cadastro podem sugerir valores; a escolha final é sua em cada item.';
      return;
    }

    var natureCfop = String(state.natureCfopSuggestion || '');
    var effectiveCfop = row.dataset.cfopTouched !== 'true' && !cfop.value ? natureCfop : cfop.value;
    var selected = taxRuleFor(product, effectiveCfop);
    var rule = selected.rule;
    // A nature explicitly chosen by the user may prefill its CFOP. Product and
    // profile CFOPs remain suggestions and are never silently applied.
    var profileCfop = rule && rule.cfop ? String(rule.cfop) : '';
    var productCfop = String(product.defaultCfop || '');
    var suggestedCfop = natureCfop;
    var suggestedCsosn = rule && rule.csosn ? String(rule.csosn) : (state.isJvgPilot ? '102' : '');
    var effectiveCsosn = row.dataset.csosnTouched === 'true' ? csosn.value : suggestedCsosn;
    var commonSimplesSale = Boolean(state.homologationSetup && state.homologationSetup.supportedTaxRegime && state.homologationSetup.taxRegimeConfirmed) &&
      ['5101', '5102', '6101', '6102'].indexOf(String(effectiveCfop)) >= 0 && (!effectiveCsosn || effectiveCsosn === '102');
    var defaultPisCofinsCst = commonSimplesSale ? '49' : '';
    var suggestedPisCst = rule && rule.pisCst ? String(rule.pisCst) : defaultPisCofinsCst;
    var suggestedCofinsCst = rule && rule.cofinsCst ? String(rule.cofinsCst) : defaultPisCofinsCst;
    if (row.dataset.cfopTouched !== 'true') cfop.value = suggestedCfop;
    if (row.dataset.csosnTouched !== 'true') csosn.value = suggestedCsosn;
    if (row.dataset.pisCstTouched !== 'true') row.querySelector('.pis-cst').value = suggestedPisCst;
    if (row.dataset.cofinsCstTouched !== 'true') row.querySelector('.cofins-cst').value = suggestedCofinsCst;
    if (row.dataset.ncmTouched !== 'true') ncm.value = String(product.ncm || '').replace(/\D/g, '');
    if (row.dataset.cestTouched !== 'true') cest.value = String(product.cest || '').replace(/\D/g, '');
    if (row.dataset.originTouched !== 'true') origin.value = /^[0-8]$/.test(String(product.origin || '')) ? String(product.origin) : '';
    var configuredFocusFields = rule && rule.focusFields && typeof rule.focusFields === 'object' ? rule.focusFields : {};
    row.__configuredFocusTaxFields = configuredFocusFields;
    renderFocusTaxFields(row, configuredFocusFields);
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
      profileNote.textContent = 'Perfil do produto aplicado automaticamente para esta operação. Os códigos e valores são editáveis e suas alterações ficam neste item.';
      note.append(document.createTextNode(' '), profileNote);
    } else if (suggestedPisCst === '49' && suggestedCofinsCst === '49') {
      var simplesNote = document.createElement('span');
      simplesNote.className = 'profile-suggestion-note';
      simplesNote.textContent = 'CST 49 preenchido como referência para venda comum do Simples Nacional. Produtos monofásicos, sujeitos a tratamento específico ou exportação precisam da regra própria do produto; não há cálculo de alíquotas ou valores.';
      note.append(document.createTextNode(' '), simplesNote);
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
      ['CSOSN aplicado ao item', row.querySelector('.csosn').value],
      ['CST do PIS aplicado ao item', row.querySelector('.pis-cst').value],
      ['CST da Cofins aplicado ao item', row.querySelector('.cofins-cst').value],
    ];
    var applicableNames = applicableFocusTaxFieldNames(row);
    var configuredFocusFields = selected && selected.rule && selected.rule.focusFields || {};
    var configuredDetails = Object.keys(configuredFocusFields).filter(function (name) {
      return applicableNames.has(name) && configuredFocusFields[name] != null && configuredFocusFields[name] !== '';
    }).map(function (name) {
      var spec = focusTaxFieldSpecs[name];
      return (spec ? spec[0] : name) + ': ' + String(configuredFocusFields[name]);
    });
    facts.push(['Valores numericos do perfil', configuredDetails.length ? configuredDetails.join(' | ') : 'Nenhum para esta combinacao']);
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
    input.placeholder = 'Valor da regra cadastrada, se aplicável';
    input.setAttribute('aria-label', definition[1]);
    label.append(caption, input);
    return label;
  }

  function buildFocusTaxFields(row) {
    renderFocusTaxFields(row, {});
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
      '<details class="product-fiscal-details"><summary>Valores tributários específicos (somente quando a regra exigir)</summary><p class="advanced-tax-help">Em venda comum no Simples com CSOSN 102 e CST PIS/Cofins 49, estes valores numéricos não são preenchidos. Se o perfil fiscal deste produto tiver valores orientados para a operação, eles aparecem automaticamente aqui. Só informe valores quando a regra selecionada exigir e houver orientação contábil; o SigmaFiscal não inventa nem calcula impostos.</p><div class="advanced-tax-groups"></div></details>' +
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
    row.querySelector('.csosn').addEventListener('input', function () {
      row.dataset.csosnTouched = 'true';
      var product = state.products.find(function (entry) { return entry.id === select.value; });
      if (product) updateTaxSuggestion(row, product, false);
      else renderFocusTaxFields(row, {});
    });
    row.querySelector('.item-ncm').addEventListener('input', function () { row.dataset.ncmTouched = 'true'; });
    row.querySelector('.item-cest').addEventListener('input', function () { row.dataset.cestTouched = 'true'; });
    row.querySelector('.item-origin').addEventListener('change', function () { row.dataset.originTouched = 'true'; });
    row.querySelector('.pis-cst').addEventListener('input', function () {
      row.dataset.pisCstTouched = 'true';
      var product = state.products.find(function (entry) { return entry.id === select.value; });
      if (product) updateTaxSuggestion(row, product, false);
      else renderFocusTaxFields(row, {});
    });
    row.querySelector('.cofins-cst').addEventListener('input', function () {
      row.dataset.cofinsCstTouched = 'true';
      var product = state.products.find(function (entry) { return entry.id === select.value; });
      if (product) updateTaxSuggestion(row, product, false);
      else renderFocusTaxFields(row, {});
    });
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
        manualTaxFields: [
          row.dataset.csosnTouched === 'true' ? 'csosn' : '',
          row.dataset.pisCstTouched === 'true' ? 'pisCst' : '',
          row.dataset.cofinsCstTouched === 'true' ? 'cofinsCst' : ''
        ].concat(Array.from(row.querySelectorAll('.focus-tax-field')).filter(function (input) {
          return input.dataset.touched === 'true' && applicableFocusTaxFieldNames(row).has(input.dataset.field);
        }).map(function (input) { return input.dataset.field; })).filter(Boolean),
        focusFields: Object.fromEntries(Array.from(row.querySelectorAll('.focus-tax-field')).filter(function (input) {
          return input.value.trim() !== '' && applicableFocusTaxFieldNames(row).has(input.dataset.field);
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
      var sourceDocument = draft.sourceDocument || null;
      var sourceName = sourceDocument && sourceDocument.number || draft.sourceOrderNumber || '';
      var sourceTypeLabels = { quote: 'Orçamento', order: 'Pedido', service_order: 'OS' };
      source.textContent = sourceName ? (sourceTypeLabels[sourceDocument && sourceDocument.type || 'order'] || 'Origem') + ' de origem: ' + sourceName : 'Criado sem origem comercial';
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

  function focusHomologFileUrl(value) {
    var raw = String(value || '').trim();
    if (raw.indexOf('https://homologacao.focusnfe.com.br/') === 0) return raw;
    if (raw.charAt(0) === '/' && raw.indexOf('//') !== 0 && raw.indexOf('\\') === -1)
      return 'https://homologacao.focusnfe.com.br' + raw;
    return '';
  }

  function appendFocusFile(parent, label, value) {
    appendLine(parent, 'p', label + ': ' + value);
    var href = focusHomologFileUrl(value);
    if (!href) return;
    var link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'draft-inspect';
    link.textContent = label.indexOf('DANFE') >= 0 ? 'Abrir DANFE de homologação' : 'Abrir XML de homologação';
    parent.append(link);
  }

  async function runFocusAction(id, action, button, justificativa) {
    button.disabled = true;
    var previousLabel = button.textContent;
    button.textContent = action === 'emit' ? 'Enviando para homologação...' : action === 'cancel' ? 'Cancelando na Focus...' : 'Consultando Focus...';
    try {
      var result = await api('/api/fiscal/nfe-drafts/transmit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, action: action, confirmHomologation: action === 'emit', justificativa: justificativa || undefined }),
      });
      if (result.status === 'cancelled') {
        report(result.message || 'NF-e cancelada em homologação.', 'success');
      } else if (result.needsReconciliation) {
        report(result.message || 'A solicitação foi enviada à Focus para homologação e continua em processamento. Não reenvie; consulte o status.', 'info');
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
      if (draft.status === 'authorized') {
        var reason = document.createElement('textarea');
        reason.className = 'cancel-reason';
        reason.maxLength = 255;
        reason.rows = 3;
        reason.placeholder = 'Justificativa do cancelamento, de 15 a 255 caracteres';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary-button';
        cancel.textContent = 'Cancelar NF-e de homologação';
        cancel.addEventListener('click', function () {
          var value = reason.value.replace(/\s+/g, ' ').trim();
          if (value.length < 15) {
            report('Escreva uma justificativa com pelo menos 15 caracteres.', 'error');
            reason.focus();
            return;
          }
          runFocusAction(draft.id, 'cancel', cancel, value);
        });
        panel.append(reason, cancel);
      }
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
        appendFocusFile(target, 'Caminho do XML na Focus', providerBody.caminho_xml_nota_fiscal);
      if (providerBody.caminho_danfe)
        appendFocusFile(target, 'Caminho do DANFE na Focus', providerBody.caminho_danfe);
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
      var sourceDocument = draft.sourceDocument || draft.sourceOrder;
      if (sourceDocument && sourceDocument.number)
        appendLine(target, 'p', 'Origem comercial: ' + sourceDocument.number + ' · situação ' + (sourceDocument.status || '') +
          (Number(sourceDocument.servicesExcluded || 0) ? ' · ' + sourceDocument.servicesExcluded + ' serviço(s) excluído(s) da NF-e' : ''));
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
    state.isJvgPilot = Boolean(state.homologationSetup && state.homologationSetup.isPilotCompany === true);
    renderHistory();
    renderHomologationReadiness();
    updateItemTaxSuggestions();
  }

  function clearOrderQuery() {
    var url = new URL(window.location.href);
    url.searchParams.delete('orderId');
    url.searchParams.delete('sourceType');
    url.searchParams.delete('sourceId');
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
      state.sourceDocument = draft.sourceDocument || draft.sourceOrder || null;
      if (state.sourceDocument && !state.sourceDocument.type) state.sourceDocument.type = 'order';
      state.sourceOrderId = state.sourceDocument && state.sourceDocument.type === 'order' ? state.sourceDocument.id : null;
      state.sourceOrderNumber = state.sourceDocument && state.sourceDocument.number || '';
      state.sourceDocumentLocksItems = Boolean(state.sourceDocument && state.sourceDocument.type !== 'service_order');
      document.getElementById('sourceOrderLabel').textContent = state.sourceOrderNumber;
      document.getElementById('sourceOrderDescription').textContent = state.sourceDocument
        ? state.sourceDocument.type === 'service_order'
          ? 'A OS foi vinculada. O serviço estimado não é importado como mercadoria; esta OS ainda não registra peças em uma lista de produtos.'
          : 'Mercadorias, quantidades e preços da origem foram copiados. Serviços foram excluídos e os itens importados permanecem protegidos; CFOP e tributos continuam editáveis.'
        : '';
      document.getElementById('sourceOrderNotice').hidden = !state.sourceDocument;
      document.getElementById('recipientId').disabled = Boolean(state.sourceDocument);
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
        var manualTaxFields = Array.isArray(saved.taxRules && saved.taxRules.manualTaxFields)
          ? saved.taxRules.manualTaxFields : [];
        var hasTaxOverrideTracking = Array.isArray(saved.taxRules && saved.taxRules.manualTaxFields);
        row.querySelector('.item-ncm').value = String(saved.ncm || '');
        row.querySelector('.item-cest').value = String(saved.cest || '');
        row.querySelector('.item-origin').value = saved.origin == null ? '' : String(saved.origin);
        var focusFields = saved.taxRules && saved.taxRules.focusFields || {};
        row.__manualFocusTaxValues = {};
        var savedManualFocusFields = hasTaxOverrideTracking ? manualTaxFields.filter(function (field) {
          return Object.prototype.hasOwnProperty.call(focusTaxFieldSpecs, field);
        }) : Object.keys(focusFields);
        savedManualFocusFields.forEach(function (field) {
          row.__manualFocusTaxValues[field] = focusFields[field] == null ? '' : String(focusFields[field]);
        });
        ['cfopTouched', 'ncmTouched', 'cestTouched', 'originTouched']
          .forEach(function (key) { row.dataset[key] = 'true'; });
        row.dataset.csosnTouched = manualTaxFields.indexOf('csosn') >= 0 || (!hasTaxOverrideTracking && row.querySelector('.csosn').value !== '') ? 'true' : 'false';
        row.dataset.pisCstTouched = manualTaxFields.indexOf('pisCst') >= 0 || (!hasTaxOverrideTracking && row.querySelector('.pis-cst').value !== '') ? 'true' : 'false';
        row.dataset.cofinsCstTouched = manualTaxFields.indexOf('cofinsCst') >= 0 || (!hasTaxOverrideTracking && row.querySelector('.cofins-cst').value !== '') ? 'true' : 'false';
        updateTaxSuggestion(row, state.products.find(function (entry) { return entry.id === saved.productId; }), false);
        if (state.sourceDocumentLocksItems) {
          row.querySelectorAll('.product, .quantity, .price, .remove-item').forEach(function (field) { field.disabled = true; });
        }
      });
      document.getElementById('addItem').disabled = state.sourceDocumentLocksItems || items.children.length >= 20;
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
    state.sourceDocument = null;
    state.sourceDocumentLocksItems = false;
    idempotencyKey = null;
    items.querySelectorAll('.product, .quantity, .price, .remove-item').forEach(function (field) {
      field.disabled = false;
    });
    document.getElementById('addItem').disabled = !state.ready || items.children.length >= 20;
    document.getElementById('sourceOrderNotice').hidden = true;
    document.getElementById('recipientId').disabled = false;
    clearOrderQuery();
    report('Origem removida. Você pode editar os itens; o documento de origem não será registrado na NF-e.');
  }

  var sourceConfig = {
    quote: { label: 'orçamento', collection: 'quotes', detail: 'quote', path: '/api/quotes', allowed: function (row) { return row.status === 'accepted'; } },
    order: { label: 'pedido', collection: 'orders', detail: 'order', path: '/api/orders', allowed: function (row) { return row.status === 'open' || row.status === 'fulfilled'; } },
    service_order: { label: 'ordem de serviço', collection: 'serviceOrders', detail: 'serviceOrder', path: '/api/service-orders', allowed: function (row) { return row.status !== 'cancelled'; } },
  };

  function sourceNumber(kind, row) {
    if (kind === 'quote') return row.quote_number != null ? 'ORC-' + String(row.quote_number).padStart(6, '0') : 'ORC-' + String(row.id).slice(0, 8).toUpperCase();
    if (kind === 'service_order') return 'OS-' + String(row.os_number || '').padStart(5, '0');
    return 'PED-' + String(row.id).slice(0, 8).toUpperCase();
  }

  function openSourceImport(kind) {
    if (!sourceConfig[kind]) return;
    state.sourceImportKind = kind;
    state.sourceImportPage = 1;
    document.getElementById('sourceImportDialogTitle').textContent = 'Importar ' + sourceConfig[kind].label + ' para NF-e';
    document.getElementById('sourceImportLabel').textContent = 'Selecione o ' + sourceConfig[kind].label;
    document.getElementById('sourceImportHelp').textContent = kind === 'service_order'
      ? 'A OS atual não possui uma lista estruturada de peças. O sistema vincula o cliente e a OS; o valor estimado de serviço não será convertido em produto.'
      : 'Serão trazidos o cliente e somente os produtos. Linhas de serviço ficam fora desta NF-e e devem ser faturadas em NFS-e.';
    document.getElementById('sourceImportStatus').textContent = '';
    document.getElementById('sourceImportStatus').classList.remove('is-error');
    document.getElementById('sourceImportDialog').showModal();
    loadSourcePage();
  }

  async function loadSourcePage() {
    var config = sourceConfig[state.sourceImportKind];
    if (!config) return;
    var select = document.getElementById('sourceImportSelect');
    var status = document.getElementById('sourceImportStatus');
    select.replaceChildren(option('', 'Carregando documentos…'));
    document.getElementById('loadSourceIntoNfe').disabled = true;
    document.getElementById('sourceImportPrevious').disabled = true;
    document.getElementById('sourceImportNext').disabled = true;
    status.textContent = '';
    try {
      var result = await api(config.path + '?page=' + state.sourceImportPage + '&status=invoiceable');
      var rows = Array.isArray(result[config.collection]) ? result[config.collection] : [];
      state.sourceImportRows = rows.filter(config.allowed);
      state.sourceImportHasMore = result.hasMore === true;
      select.replaceChildren(option('', 'Selecione…'));
      state.sourceImportRows.forEach(function (row) {
        var customer = state.clients.find(function (client) { return client.id === row.customer_id; });
        var customerName = customer ? customer.name : 'Cliente não disponível';
        var created = row.created_at ? new Date(row.created_at).toLocaleDateString('pt-BR') : '';
        var amount = Number(row.total != null ? row.total : row.estimated_value);
        var label = sourceNumber(state.sourceImportKind, row) + ' · ' + customerName + (created ? ' · ' + created : '') + (Number.isFinite(amount) && amount >= 0 ? ' · ' + money.format(amount) : '');
        select.append(option(row.id, label));
      });
      document.getElementById('sourceImportPage').textContent = 'Página ' + state.sourceImportPage;
      document.getElementById('sourceImportPrevious').disabled = state.sourceImportPage <= 1;
      document.getElementById('sourceImportNext').disabled = !state.sourceImportHasMore;
      document.getElementById('loadSourceIntoNfe').disabled = !state.sourceImportRows.length;
      if (!state.sourceImportRows.length) status.textContent = state.sourceImportKind === 'quote'
        ? 'Nenhum orçamento aceito disponível nesta página.'
        : state.sourceImportKind === 'order' ? 'Nenhum pedido aberto ou concluído disponível nesta página.' : 'Nenhuma OS não cancelada disponível nesta página.';
    } catch (error) {
      select.replaceChildren(option('', 'Não foi possível carregar'));
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  }

  async function importSelectedSource() {
    var kind = state.sourceImportKind;
    var config = sourceConfig[kind];
    var id = document.getElementById('sourceImportSelect').value;
    if (!config || !id) return;
    var button = document.getElementById('loadSourceIntoNfe');
    button.disabled = true;
    try {
      var result = await api(config.path + '?id=' + encodeURIComponent(id));
      if (importSourceDocument(kind, result[config.detail])) document.getElementById('sourceImportDialog').close();
    } catch (error) {
      var status = document.getElementById('sourceImportStatus');
      status.textContent = error.message;
      status.classList.add('is-error');
    } finally {
      button.disabled = false;
    }
  }

  function importSourceDocument(kind, source) {
    var config = sourceConfig[kind];
    if (!config || !source || !source.id) throw new Error('Documento de origem inválido.');
    if (!config.allowed(source)) throw new Error('A situação atual deste documento não permite importar para uma NF-e.');
    if (!source.customer_id) throw new Error('O documento de origem precisa ter um cliente cadastrado.');
    var recipient = state.clients.find(function (client) {
      return client.id === source.customer_id && client.active && client.isCustomer === true && client.type !== 'EXT';
    });
    if (!recipient) throw new Error('O cliente da origem está inativo ou não está disponível para NF-e nesta empresa.');
    var sourceItems = Array.isArray(source.items) ? source.items : [];
    var goods = kind === 'service_order' ? [] : sourceItems.filter(function (item) { return item && item.productId && !item.serviceId; });
    var serviceCount = kind === 'service_order' ? 0 : sourceItems.filter(function (item) { return item && item.serviceId; }).length;
    if (goods.length > 20) throw new Error('A NF-e aceita até 20 produtos. Esta origem tem ' + goods.length + '; divida a emissão em mais de uma nota.');
    var mapped = goods.map(function (item) {
      var product = state.products.find(function (entry) { return entry.id === item.productId && entry.active; });
      if (!product) throw new Error('Um produto da origem está inativo ou não existe no catálogo desta empresa. Cadastre ou reative o produto antes de importar.');
      var quantity = Number(item.quantity), unitPrice = Number(item.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0)
        throw new Error('A quantidade ou o preço de um produto na origem está inválido. Corrija o documento de origem.');
      return { productId: item.productId, quantity: quantity, unitPrice: unitPrice };
    });
    var duplicate = state.drafts.some(function (draft) {
      var linked = draft.sourceDocument || draft.sourceOrder;
      return linked && linked.id === source.id && (linked.type || 'order') === kind && draft.status === 'draft';
    });
    if (duplicate && !window.confirm('Já existe uma NF-e não transmitida vinculada a este documento. Deseja iniciar outra?')) return false;
    var hasCurrentData = Boolean(state.sourceDocument || form.elements.namedItem('nature').value.trim() || form.elements.namedItem('recipientId').value ||
      Array.from(items.querySelectorAll('.product')).some(function (field) { return field.value; }));
    if (hasCurrentData && !window.confirm('A importação substituirá os dados atuais da NF-e. Continuar?')) return false;

    form.reset();
    setDefaultIssueAt();
    if (typeof window.jvgNfeWizardReset === 'function') window.jvgNfeWizardReset();
    items.replaceChildren();
    document.getElementById('recipientId').value = source.customer_id;
    document.getElementById('recipientId').disabled = true;
    document.getElementById('recipientId').dispatchEvent(new Event('change', { bubbles: true }));
    mapped.forEach(function (entry) {
      addItem();
      var row = items.lastElementChild;
      var productSelect = row.querySelector('.product');
      productSelect.value = entry.productId;
      productSelect.dispatchEvent(new Event('change', { bubbles: true }));
      row.querySelector('.quantity').value = String(entry.quantity);
      row.querySelector('.price').value = Number(entry.unitPrice).toFixed(2);
      row.querySelectorAll('.product, .quantity, .price, .remove-item').forEach(function (field) { field.disabled = true; });
    });
    if (!mapped.length) addItem();
    state.sourceDocument = { id: source.id, type: kind };
    state.sourceOrderId = kind === 'order' ? source.id : null;
    state.sourceOrderNumber = sourceNumber(kind, source);
    state.sourceDocumentLocksItems = mapped.length > 0;
    idempotencyKey = null;
    document.getElementById('sourceOrderLabel').textContent = state.sourceOrderNumber;
    document.getElementById('sourceOrderDescription').textContent = kind === 'service_order'
      ? 'Cliente e OS vinculados. A OS não possui itens de peças cadastrados; serviço e valor estimado não foram convertidos em mercadoria. Adicione os produtos vendidos manualmente.'
      : 'Cliente e ' + mapped.length + ' produto(s) vinculados. ' + serviceCount + ' serviço(s) foram excluídos; serviço deve ser faturado em NFS-e.';
    document.getElementById('sourceOrderNotice').hidden = false;
    document.getElementById('addItem').disabled = state.sourceDocumentLocksItems || items.children.length >= 20;
    updateTotal();
    report('Origem carregada. Somente mercadorias entraram na NF-e; revise CFOP, CSOSN e demais dados fiscais de cada item. Nenhuma nota foi transmitida.');
    document.getElementById('draftForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
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
      fillRecipients();
      fillCarriers();
      addItem();
      // Sugestões oficiais não podem impedir a emissão se o catálogo falhar.
      var auxiliary = await Promise.all([
        api('/api/fiscal/cfop').catch(function () { return { records: [] }; }),
        refreshHistory().catch(function () {
          var target = document.getElementById('homologationReadiness');
          var summary = document.getElementById('readinessSummary');
          if (summary) summary.textContent = 'Indisponível';
          if (target) target.textContent = 'Não foi possível conferir os cadastros. Atualize a página.';
          return null;
        }),
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
        'Cadastros carregados. A NF-e fica vinculada a esta empresa e só é enviada depois da sua confirmação.' :
        'Cadastre pelo menos um produto e um cliente ativos no ERP para preparar a NF-e.', state.ready ? '' : 'info');
      var sourceOrderId = new URLSearchParams(window.location.search).get('orderId');
      if (sourceOrderId) {
        try {
          var orderResponse = await api('/api/orders?id=' + encodeURIComponent(sourceOrderId));
          importSourceDocument('order', orderResponse.order);
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
  document.querySelectorAll('[data-source-kind]').forEach(function (button) {
    button.addEventListener('click', function () { openSourceImport(button.dataset.sourceKind); });
  });
  document.getElementById('closeSourceImport').addEventListener('click', function () { document.getElementById('sourceImportDialog').close(); });
  document.getElementById('cancelSourceImport').addEventListener('click', function () { document.getElementById('sourceImportDialog').close(); });
  document.getElementById('loadSourceIntoNfe').addEventListener('click', importSelectedSource);
  document.getElementById('sourceImportPrevious').addEventListener('click', function () {
    if (state.sourceImportPage > 1) { state.sourceImportPage -= 1; loadSourcePage(); }
  });
  document.getElementById('sourceImportNext').addEventListener('click', function () {
    if (state.sourceImportHasMore) { state.sourceImportPage += 1; loadSourcePage(); }
  });
  document.getElementById('sourceImportSelect').addEventListener('change', function () {
    document.getElementById('loadSourceIntoNfe').disabled = !this.value;
  });
  function resetComposition() {
    idempotencyKey = null;
    state.sourceOrderId = null;
    state.sourceOrderNumber = '';
    state.sourceDocument = null;
    state.sourceDocumentLocksItems = false;
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
        sourceDocument: state.sourceDocument,
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
        else report('Solicita\u00e7\u00e3o recebida pela Focus em HOMOLOGA\u00c7\u00c3O. Situa\u00e7\u00e3o: ' + (result.status || 'em processamento') + '. Consulte o hist\u00f3rico antes de tentar novamente.');
        await inspectDraft(fiscalDocument.id);
      } catch (error) {
        var issues = error.responseData && Array.isArray(error.responseData.issues) ? error.responseData.issues.filter(Boolean).join(' \u00b7 ') : '';
        report('A Focus n\u00e3o confirmou o envio. Os dados foram preservados para corre\u00e7\u00e3o. ' +
          (issues || error.message) + ' Corrija o que estiver pendente antes de enviar novamente.', 'error');
        await inspectDraft(fiscalDocument.id);
      }
    } catch (error) {
      finalizeFeedback.textContent = error.message;
      finalizeFeedback.classList.add('error');
      finalizeFeedback.hidden = false;
      report((documentId ? 'A NF-e continua dispon\u00edvel para revis\u00e3o. ' : 'N\u00e3o foi poss\u00edvel criar a NF-e. ') + error.message, 'error');
    } finally {
      confirmFinalizeButton.disabled = selectedFinalizationChoice() === 'emit' &&
        !document.getElementById('confirmHomologation').checked;
      saveButton.disabled = !state.ready;
      saveButton.textContent = 'Concluir NF-e';
    }
  });

  setDefaultIssueAt();
  load();
})();
