(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { company: null, products: [], drafts: [], migrationReady: false, rtcEnabled: false, canManageInvites: false };
  var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var regimeNames = { mei: 'MEI', simples_nacional: 'Simples Nacional', lucro_presumido: 'Lucro Presumido', lucro_real: 'Lucro Real', outro: 'Outro / a confirmar' };
  var productFields = [
    ['ncm', 'NCM', '8 dígitos'], ['cest', 'CEST', '7 dígitos, quando aplicável'], ['origin', 'Origem da mercadoria', 'Obrigatório conforme operação'], ['default_cfop', 'CFOP sugerido', '4 dígitos'],
    ['default_csosn', 'CSOSN sugerido', '3 dígitos'], ['default_pis_cst', 'CST do PIS', 'Opcional'], ['default_cofins_cst', 'CST da Cofins', 'Opcional'],
    ['rtc_cst', 'CST IBS/CBS', '3 dígitos, com orientação'], ['rtc_class_trib', 'cClassTrib', '6 dígitos, com orientação'],
    ['rtc_simple_activity', 'Atividade do Simples', 'cAtivSN, quando orientado']
  ];

  function node(tag, className, content) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined && content !== null) element.textContent = String(content);
    return element;
  }
  function setStatus(message, tone) {
    var status = $('accountingStatus');
    status.className = 'accounting-alert' + (tone ? ' accounting-alert-' + tone : '');
    status.textContent = message;
  }
  async function api(url, options) {
    var response = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}));
    var data = await response.json().catch(function () { return {}; });
    if (response.status === 401) { window.location.replace('/login'); throw new Error('Sua sessão expirou. Entre novamente.'); }
    if (!response.ok) { var error = new Error(data.error || 'Não foi possível concluir a operação.'); error.data = data; throw error; }
    return data;
  }
  function jsonOptions(method, body) {
    return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }
  function fmtDate(value) {
    if (!value) return 'Data não informada';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Data não informada' : date.toLocaleString('pt-BR');
  }
  function companySummary(company) {
    $('companyTitle').textContent = company.tradeName || company.legalName || 'Empresa ativa';
    var regime = regimeNames[company.taxRegime] || 'Regime não informado';
    $('regimeBadge').textContent = company.taxRegimeConfirmed ? regime + ' · confirmado' : regime + ' · não confirmado';
    var address = company.address && typeof company.address === 'object' ? company.address : {};
    var facts = [
      ['Razão social', company.legalName], ['CNPJ', company.cnpj], ['Inscrição estadual', company.stateRegistration],
      ['Inscrição municipal', company.municipalRegistration], ['CNAE', company.cnae],
      ['Endereço', [address.street, address.number, address.city, address.state].filter(Boolean).join(', ')]
    ];
    var root = $('companyFacts'); root.replaceChildren();
    facts.forEach(function (fact) {
      var block = node('div'); block.append(node('dt', '', fact[0]), node('dd', '', fact[1] || 'Não informado')); root.append(block);
    });
    var form = $('companyForm');
    form.elements.taxRegime.value = company.taxRegime || '';
    form.elements.crt.value = company.crt == null ? '' : String(company.crt);
    form.elements.tpRegimeIbsCbs.value = company.tpRegimeIbsCbs == null ? '' : String(company.tpRegimeIbsCbs);
    form.elements.taxRegimeConfirmed.checked = company.taxRegimeConfirmed === true;
    form.querySelector('button[type="submit"]').disabled = !state.migrationReady;
    if (!company.regimeConfirmationAvailable) form.elements.taxRegimeConfirmed.disabled = true;
  }
  function productInput(field, value) {
    var wrapper = node('label'); wrapper.append(node('span', '', field[1] + ' · ' + field[2]));
    var input;
    if (field[0] === 'origin') {
      input = document.createElement('select');
      [['', 'Não informado'], ['0', '0 · Nacional'], ['1', '1 · Importação direta'], ['2', '2 · Adquirida no mercado interno'], ['3', '3 · Nacional, conteúdo de importação superior a 40%'], ['4', '4 · Nacional, conforme processo produtivo básico'], ['5', '5 · Nacional, conteúdo de importação inferior ou igual a 40%'], ['6', '6 · Importação sem similar nacional'], ['7', '7 · Importação do mercado interno'], ['8', '8 · Importação com similar nacional']].forEach(function (optionData) {
        var option = node('option', '', optionData[1]); option.value = optionData[0]; input.append(option);
      });
    } else { input = document.createElement('input'); input.type = 'text'; input.maxLength = 24; input.autocomplete = 'off'; }
    input.name = field[0]; input.value = value == null ? '' : String(value); input.placeholder = field[2]; input.disabled = !state.migrationReady;
    wrapper.append(input); return wrapper;
  }
  function renderProducts() {
    var root = $('productList'); root.replaceChildren();
    if (!state.products.length) { root.append(node('div', 'accounting-empty', 'Nenhum produto ativo para configurar nesta empresa.')); return; }
    state.products.forEach(function (product) {
      var card = node('article', 'accounting-product-card');
      var header = node('header', 'accounting-product-head'); var title = node('div');
      title.append(node('strong', '', product.name || 'Produto'), node('small', '', 'SKU ' + (product.sku || '—') + (product.unit ? ' · ' + product.unit : '')));
      header.append(title); card.append(header);
      var form = document.createElement('form'); form.className = 'accounting-field-grid';
      productFields.forEach(function (field) { form.append(productInput(field, product[field[0]])); });
      var actions = node('div', 'accounting-form-actions'); var save = node('button', 'accounting-button accounting-button-primary', 'Salvar dados fiscais'); save.type = 'submit'; save.disabled = !state.migrationReady;
      actions.append(save, node('small', '', 'As alterações valem para este produto e ficam auditadas. Campos em branco são limpos.')); form.append(actions);
      form.addEventListener('submit', async function (event) {
        event.preventDefault(); save.disabled = true; save.textContent = 'Salvando...';
        var fields = {}; productFields.forEach(function (field) { fields[field[0]] = form.elements[field[0]].value.trim(); });
        try { await api('/api/accounting/fiscal', jsonOptions('PATCH', { target: 'product', productId: product.id, fields: fields })); setStatus('Dados fiscais do produto salvos e registrados no histórico.', 'success'); await load(); }
        catch (error) { setStatus(error.message, 'error'); save.disabled = !state.migrationReady; save.textContent = 'Salvar dados fiscais'; }
      });
      card.append(form); root.append(card);
    });
  }
  function renderInvites(records) {
    var root = $('inviteList'); root.replaceChildren();
    if (!records.length) { root.append(node('div', 'accounting-empty', 'Nenhum contador convidado para esta empresa.')); return; }
    records.forEach(function (invite) {
      var row = node('article', 'accounting-list-row'); var main = node('div');
      main.append(node('strong', '', invite.display_name || invite.email || 'Contador'), node('small', '', (invite.email || '') + ' · ' + (invite.status === 'active' ? 'Acesso ativo' : invite.status === 'revoked' ? 'Acesso revogado' : 'Convite enviado') + ' · ' + fmtDate(invite.updated_at || invite.invited_at)));
      row.append(main);
      if (invite.status !== 'revoked') {
        var actions = node('div', 'accounting-list-actions'); var revoke = node('button', 'accounting-button accounting-button-secondary', 'Revogar acesso'); revoke.type = 'button';
        revoke.addEventListener('click', async function () {
          if (!window.confirm('Revogar o acesso contábil desta empresa para ' + (invite.email || 'este usuário') + '?')) return;
          revoke.disabled = true;
          try { await api('/api/company/accountants', jsonOptions('DELETE', { id: invite.id })); $('inviteStatus').textContent = 'Acesso revogado nesta empresa.'; await load(); }
          catch (error) { $('inviteStatus').textContent = error.message; revoke.disabled = false; }
        }); actions.append(revoke); row.append(actions);
      }
      root.append(row);
    });
  }
  function renderAudit(records) {
    var root = $('auditList'); root.replaceChildren();
    if (!state.migrationReady) { root.append(node('div', 'accounting-empty', 'O histórico fica disponível após aplicar a migration de auditoria.')); return; }
    if (!records.length) { root.append(node('div', 'accounting-empty', 'Nenhuma alteração fiscal registrada ainda.')); return; }
    records.forEach(function (record) {
      var row = node('article', 'accounting-list-row'); var main = node('div');
      var actions = { company_fiscal_update: 'Dados fiscais da empresa alterados', product_fiscal_update: 'Dados fiscais de produto alterados', accountant_invited: 'Contador convidado', accountant_revoked: 'Acesso do contador revogado' };
      main.append(node('strong', '', actions[record.action] || 'Configuração alterada'), node('small', '', 'Usuário ' + (record.actor_user_id || 'não identificado') + ' · ' + fmtDate(record.created_at) + ' · ' + (record.entity_type || '') + ' ' + (record.entity_id || '')));
      var details = document.createElement('details'); var summary = node('summary', '', 'Ver alteração'); var pre = node('pre', 'accounting-audit-json', JSON.stringify({ antes: record.before_values || {}, depois: record.after_values || {} }, null, 2)); details.append(summary, pre); row.append(main, details); root.append(row);
    });
  }
  function draftTotal(draft) { return money(Number(draft.totalCents || 0) / 100); }
  function renderDraftOptions() {
    var select = $('rtcForm').elements.draftId; select.replaceChildren(node('option', '', 'Selecione um rascunho')); select.options[0].value = '';
    state.drafts.forEach(function (draft) { var option = node('option', '', (draft.recipientName || 'Destinatário') + ' · ' + draftTotal(draft) + ' · ' + fmtDate(draft.updatedAt)); option.value = draft.id; select.append(option); });
  }
  function rtcField(container, key, label, value, required, hint, className) {
    var field = node('label', className || ''); field.append(node('span', '', label + (required ? ' *' : ' · opcional')));
    var input = document.createElement('input'); input.name = key; input.type = 'text'; input.autocomplete = 'off'; input.maxLength = 30; input.value = value == null ? '' : String(value); input.placeholder = hint || 'Informado pela contabilidade'; input.required = !!required;
    if (/baseCalculo|valorImpostoSeletivo|pIBSSN|pCBSSN|quantity|impostoInformado|adValorem|adRem/i.test(key)) input.inputMode = 'decimal';
    field.append(input); container.append(field);
    return input;
  }
  function rtcSection(container, title, description) {
    var section = node('section', 'accounting-rtc-section');
    section.append(node('h4', '', title));
    if (description) section.append(node('p', 'accounting-help', description));
    var grid = node('div', 'accounting-field-grid'); section.append(grid); container.append(section); return grid;
  }
  function syncSelectiveGroup(card) {
    var keys = ['selectiveCst', 'selectiveCClassTrib', 'selectiveBase', 'selectiveQuantity', 'selectiveUnit', 'selectiveAmount'];
    var hasGroupInput = keys.some(function (key) { var field = card.querySelector('[name="' + key + '"]'); return field && field.value.trim() !== ''; });
    ['selectiveCst', 'selectiveCClassTrib', 'selectiveBase'].forEach(function (key) {
      var field = card.querySelector('[name="' + key + '"]'); if (field) field.required = hasGroupInput;
    });
    var operationBase = card.querySelector('[name="baseCalculo"]');
    if (operationBase) operationBase.required = !hasGroupInput;
  }
  function renderRtcItems(draft) {
    var root = $('rtcItems'); root.replaceChildren();
    if (!draft) { $('rtcDraftSummary').textContent = 'Selecione um rascunho para informar os parâmetros oficiais item a item.'; $('rtcGovernmentField').hidden = true; return; }
    var isSimple = state.company.taxRegime === 'simples_nacional';
    var isRegular = state.company.taxRegime === 'lucro_presumido' || state.company.taxRegime === 'lucro_real';
    if (!isSimple && !isRegular) {
      $('rtcDraftSummary').textContent = 'O regime cadastrado não tem uma calculadora RTC compatível nesta integração. Confirme o regime com a contabilidade.';
      $('rtcGovernmentField').hidden = true;
      $('calculateRtc').disabled = true;
      return;
    }
    var issueDate = String(draft.issueAt || '').slice(0, 10); var taxYear = Number(issueDate.slice(0, 4));
    $('rtcGovernmentField').hidden = false;
    $('rtcGovernmentField').querySelectorAll('[data-regular-only]').forEach(function (option) { option.hidden = isSimple; option.disabled = isSimple; });
    if (isSimple && Number($('rtcForm').elements.tpEnteGov.value) > 4) $('rtcForm').elements.tpEnteGov.value = '';
    var dateLabel = issueDate ? ' · fato gerador em ' + new Date(issueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    $('rtcDraftSummary').textContent = (draft.recipientName || 'Destinatário') + ' · ' + draft.items.length + ' item(ns) · ' + draftTotal(draft) + dateLabel + '. O valor comercial não vira base tributária automaticamente.';
    draft.items.forEach(function (item, index) {
      var product = state.products.find(function (entry) { return entry.id === item.productId; }) || {};
      var card = node('article', 'accounting-rtc-item'); card.dataset.productId = item.productId;
      card.append(node('h3', '', 'Item ' + (index + 1) + ' · ' + (item.description || 'Produto')));
      card.append(node('p', '', 'Valor comercial: ' + money(Number(item.subtotalCents || 0) / 100) + ' · informe a base conforme a orientação fiscal, sem copiar automaticamente o total da venda.'));
      var grid = rtcSection(card, 'Classificação e base da operação', 'Use códigos e valores da operação confirmados pela contabilidade.');
      rtcField(grid, 'cClassTrib', 'cClassTrib IBS/CBS', product.rtc_class_trib, true, '6 dígitos');
      if (isSimple) {
        rtcField(grid, 'baseCalculo', 'Base de cálculo sem Imposto Seletivo', '', true, 'Valor confirmado para este item');
        rtcField(grid, 'cAtivSN', 'Atividade do Simples (cAtivSN)', product.rtc_simple_activity, true, 'Código oficial de 2 caracteres');
        var simpleRates = rtcSection(card, 'Dados adicionais exigidos pelo contrato do Simples', 'Informe somente dados confirmados. O valor do Imposto Seletivo não é obtido automaticamente do produto.');
        rtcField(simpleRates, 'valorImpostoSeletivo', 'Valor do Imposto Seletivo', '', true, 'Informe o valor confirmado, inclusive zero somente se confirmado');
        rtcField(simpleRates, 'pIBSSN', 'Alíquota efetiva IBS do Simples', '', false, 'Pontos percentuais; quando exigida pelo serviço');
        rtcField(simpleRates, 'pCBSSN', 'Alíquota efetiva CBS do Simples', '', false, 'Pontos percentuais; quando exigida pelo serviço');
      } else {
        rtcField(grid, 'cst', 'CST IBS/CBS', product.rtc_cst, true, '3 dígitos');
        rtcField(grid, 'ncm', 'NCM', item.ncm || product.ncm, false, '8 dígitos, se aplicável');
        rtcField(grid, 'nbs', 'NBS', '', false, '9 dígitos, se aplicável');
        rtcField(grid, 'baseCalculo', 'Base de cálculo IBS/CBS', '', true, 'Obrigatória se não houver grupo IS ou componentes da base');
        rtcField(grid, 'quantity', 'Quantidade', item.quantity || '', false, 'Quantidade do item, se aplicável');
        rtcField(grid, 'unit', 'Unidade', item.unit || product.unit || '', false, 'Unidade do item, se aplicável');
        var selective = rtcSection(card, 'Imposto Seletivo', 'Deixe o grupo vazio se não se aplicar. Se informar qualquer campo, CST, cClassTrib e base do grupo se tornam obrigatórios.');
        rtcField(selective, 'selectiveCst', 'CST do Imposto Seletivo', '', false, '3 dígitos');
        rtcField(selective, 'selectiveCClassTrib', 'cClassTrib do Imposto Seletivo', '', false, '6 dígitos');
        rtcField(selective, 'selectiveBase', 'Base do Imposto Seletivo', '', false, 'Valor confirmado');
        rtcField(selective, 'selectiveQuantity', 'Quantidade tributável do IS', '', false, 'Se aplicável');
        rtcField(selective, 'selectiveUnit', 'Unidade do IS', '', false, 'Se aplicável');
        rtcField(selective, 'selectiveAmount', 'Imposto Seletivo informado', '', false, 'Se aplicável');
        if (taxYear >= 2027) {
          var regularRates = rtcSection(card, 'Alíquotas nominais · fatos geradores a partir de 2027', 'Não preencha por estimativa. Se alguma alíquota IBS/CBS for informada, as três precisam estar confirmadas. O serviço oficial verifica se o CST exige esse grupo.');
          rtcField(regularRates, 'rateCbs', 'CBS (%)', '', false, 'Valor oficial para a operação');
          rtcField(regularRates, 'rateIbsState', 'IBS estadual (%)', '', false, 'Valor oficial para a operação');
          rtcField(regularRates, 'rateIbsCity', 'IBS municipal (%)', '', false, 'Valor oficial para a operação');
          rtcField(regularRates, 'rateIsAdValorem', 'IS ad valorem (%)', '', false, 'Quando houver orientação oficial');
          rtcField(regularRates, 'rateIsAdRem', 'IS ad rem', '', false, 'Valor por unidade, quando houver orientação oficial');
        } else {
          card.append(node('p', 'accounting-help', 'Para esta data até 2026, o contrato oficial não aceita o grupo aliquotasNominais; não informe essas taxas nesta consulta.'));
        }
      }
      card.querySelectorAll('[name^="selective"]').forEach(function (input) { input.addEventListener('input', function () { syncSelectiveGroup(card); }); });
      syncSelectiveGroup(card); root.append(card);
    });
  }
  function showRtcResult(data, historic) {
    var root = $('rtcResult'); root.hidden = false; root.replaceChildren();
    var result = data.result && typeof data.result === 'object' ? data.result : data.result_snapshot || {};
    var simulated = data.warning === true || data.simulated === true || data.simulated_data_warning === true || Boolean(result.warning);
    var calculated = result.allItemsCalculated === true;
    root.append(node('h3', '', simulated ? 'Simulação registrada para conferência' : calculated ? (historic ? 'Resultado oficial registrado' : 'Resultado da calculadora oficial') : 'Resultado com pendências'));
    var metadata = [
      ['Regime', regimeNames[data.regime] || data.regime || '—'],
      ['Calculadora', data.endpoint || data.calculator_endpoint || '—'],
      ['Versão da aplicação', data.calculatorVersion || data.calculator_version || '—'],
      ['Versão da base oficial', data.calculatorDatabaseVersion || data.calculator_db_version || '—'],
      ['Versão do contrato', result.operationContractVersion || data.request_version || '—'],
      ['Registrado em', fmtDate(data.created_at)]
    ].filter(function (entry) { return entry[1] !== '—'; }).map(function (entry) { return entry[0] + ': ' + entry[1]; }).join(' · ');
    root.append(node('p', 'accounting-help', metadata || 'Resposta vinculada ao rascunho selecionado.'));
    if (simulated) root.append(node('div', 'accounting-alert accounting-alert-warning', 'A calculadora sinalizou dados simulados. Use apenas para conferência; o resultado não é fiscalmente utilizável nem enviado à emissão.'));
    if (data.error) root.append(node('div', 'accounting-alert accounting-alert-error', data.error));
    var itemStates = Array.isArray(result.itemStates) ? result.itemStates : Array.isArray(data.itemStates) ? data.itemStates : [];
    if (itemStates.length) {
      var list = node('div', 'accounting-rtc-result-items');
      var responseObject = result.response && typeof result.response === 'object' ? result.response : {};
      var responseItems = Array.isArray(responseObject.objetos) ? responseObject.objetos : Array.isArray(responseObject.itens) ? responseObject.itens : Array.isArray(responseObject.resultados) ? responseObject.resultados : [];
      itemStates.forEach(function (status, index) {
        var itemResult = responseItems[index] && typeof responseItems[index] === 'object' ? responseItems[index] : {};
        var itemRow = node('article', 'accounting-rtc-result-state');
        itemRow.append(node('strong', '', 'Item ' + (index + 1) + ': ' + (status || 'sem situação informada')));
        if (itemResult.tribCalc && typeof itemResult.tribCalc === 'object') {
          var taxDetails = document.createElement('details'); taxDetails.append(node('summary', '', 'Ver valores IBS/CBS retornados'));
          taxDetails.append(node('pre', '', JSON.stringify(itemResult.tribCalc, null, 2))); itemRow.append(taxDetails);
        }
        var itemErrors = Array.isArray(itemResult.erros) ? itemResult.erros : Array.isArray(itemResult.errors) ? itemResult.errors : [];
        itemErrors.forEach(function (issue) {
          var detail = issue && typeof issue === 'object' ? [issue.codigo, issue.mensagem, issue.campo].filter(Boolean).join(' · ') : String(issue || '');
          if (detail) itemRow.append(node('p', 'accounting-alert accounting-alert-warning', detail));
        });
        list.append(itemRow);
      });
      root.append(list);
    }
    var details = document.createElement('details'); var summary = node('summary', '', 'Ver resposta técnica completa da Receita');
    var raw = result.response || result; details.append(summary, node('pre', '', JSON.stringify(raw, null, 2))); root.append(details);
    if (data.focusTransmissionEnabled === false || result.focusTransmissionEnabled === false) root.append(node('p', 'accounting-help', 'Este resultado não foi inserido no payload Focus e não transmitiu nem autorizou uma nota.'));
  }
  async function loadRtcHistory(draftId) {
    var root = $('rtcHistory'); root.replaceChildren();
    if (!draftId || !state.migrationReady) return;
    try {
      var data = await api('/api/fiscal/rtc?draftId=' + encodeURIComponent(draftId));
      if (!data.records || !data.records.length) { root.append(node('div', 'accounting-empty', 'Ainda não há cálculo registrado para este rascunho.')); return; }
      data.records.forEach(function (record) {
        var row = node('article', 'accounting-list-row'); var info = node('div');
        info.append(node('strong', '', (regimeNames[record.regime] || record.regime) + ' · ' + record.calculator_endpoint), node('small', '', 'Versão ' + record.calculator_version + ' · ' + fmtDate(record.created_at) + (record.simulated_data_warning ? ' · dados simulados' : '')));
        var button = node('button', 'accounting-button accounting-button-secondary', 'Ver resultado'); button.type = 'button'; button.addEventListener('click', function () { showRtcResult(record, true); }); row.append(info, button); root.append(row);
      });
    } catch (error) { root.append(node('div', 'accounting-alert accounting-alert-error', error.message)); }
  }
  async function load() {
    setStatus('Carregando os dados fiscais desta empresa...');
    try {
      var data = await api('/api/accounting/fiscal');
      state.company = data.company; state.products = Array.isArray(data.products) ? data.products : []; state.drafts = Array.isArray(data.drafts) ? data.drafts : [];
      state.migrationReady = data.migrationReady === true; state.rtcEnabled = data.rtcEnabled === true; state.canManageInvites = data.canManageInvites === true;
      companySummary(state.company); renderProducts(); renderAudit(Array.isArray(data.auditRecords) ? data.auditRecords : []); renderDraftOptions();
      $('inviteSection').hidden = !state.canManageInvites;
      if (state.canManageInvites) {
        try { var inviteData = await api('/api/company/accountants'); renderInvites(Array.isArray(inviteData.records) ? inviteData.records : []); }
        catch (error) { $('inviteList').replaceChildren(node('div', 'accounting-alert accounting-alert-error', error.message)); }
      }
      $('migrationNotice').hidden = state.migrationReady;
      if (!state.migrationReady) $('migrationNotice').textContent = data.configurationAudit || 'Aplique a migration versionada para ativar auditoria, convites, parâmetros RTC e histórico de cálculos. Nenhuma alteração fiscal será salva antes disso.';
      var rtcRegimeSupported = state.company.taxRegimeConfirmed && ['simples_nacional', 'lucro_presumido', 'lucro_real'].includes(state.company.taxRegime);
      $('rtcModeBadge').textContent = !state.rtcEnabled ? 'Desativada' : !rtcRegimeSupported ? 'Regime não compatível' : 'Ativada no servidor';
      $('rtcUnavailable').hidden = state.rtcEnabled && rtcRegimeSupported;
      if (state.rtcEnabled && !rtcRegimeSupported) $('rtcUnavailable').textContent = 'Confirme um regime compatível com a contabilidade. MEI e regimes ainda não implementados não usam a calculadora de outro regime.';
      $('rtcForm').hidden = !state.rtcEnabled || !rtcRegimeSupported;
      $('rtcForm').querySelector('button[type="submit"]').disabled = !state.migrationReady || !state.rtcEnabled || !rtcRegimeSupported;
      if (state.rtcEnabled && state.drafts.length === 0) $('rtcDraftSummary').textContent = 'Não há rascunhos homologação salvos. Crie e salve uma NF-e em preparação antes de usar a calculadora.';
      if (Array.isArray(data.calculations) && data.calculations.length) $('rtcHistory').append(node('p', 'accounting-help', data.calculations.length + ' cálculo(s) RTC registrados nesta empresa. Selecione o rascunho para consultar cada resultado.'));
      setStatus('Dados carregados para ' + (state.company.tradeName || state.company.legalName || 'a empresa ativa') + '. As consultas e alterações estão limitadas a esta empresa.', 'success');
    } catch (error) { setStatus(error.message, 'error'); }
  }

  $('companyForm').addEventListener('submit', async function (event) {
    event.preventDefault(); var form = event.currentTarget; var button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      var companyFields = { taxRegime: form.elements.taxRegime.value, crt: form.elements.crt.value || null, tpRegimeIbsCbs: form.elements.tpRegimeIbsCbs.value || null };
      if (state.company.regimeConfirmationAvailable) companyFields.taxRegimeConfirmed = form.elements.taxRegimeConfirmed.checked;
      await api('/api/accounting/fiscal', jsonOptions('PATCH', { target: 'company', fields: companyFields }));
      setStatus('Dados fiscais da empresa salvos e registrados no histórico.', 'success'); await load();
    } catch (error) { setStatus(error.message, 'error'); button.disabled = !state.migrationReady; }
  });
  $('inviteForm').addEventListener('submit', async function (event) {
    event.preventDefault(); var form = event.currentTarget; var button = form.querySelector('button'); button.disabled = true; $('inviteStatus').textContent = 'Enviando convite...';
    try { var result = await api('/api/company/accountants', jsonOptions('POST', { name: form.elements.name.value.trim(), email: form.elements.email.value.trim() }));
      $('inviteStatus').textContent = result.status === 'active' ? 'O usuário já tinha conta; acesso contábil vinculado somente a esta empresa.' : 'Convite enviado por e-mail.'; form.reset(); await load();
    } catch (error) { $('inviteStatus').textContent = error.message; } finally { button.disabled = false; }
  });
  $('rtcForm').elements.draftId.addEventListener('change', function () {
    var draft = state.drafts.find(function (entry) { return entry.id === this.value; }, this);
    renderRtcItems(draft || null); $('rtcResult').hidden = true; loadRtcHistory(this.value);
  });
  $('rtcForm').addEventListener('submit', async function (event) {
    event.preventDefault(); var form = event.currentTarget; var draftId = form.elements.draftId.value;
    var draft = state.drafts.find(function (entry) { return entry.id === draftId; }); if (!draft) return;
    var button = $('calculateRtc'); button.disabled = true; button.textContent = 'Consultando calculadora oficial...'; $('rtcResult').hidden = true;
    var isSimple = state.company.taxRegime === 'simples_nacional';
    var issueDate = String(draft.issueAt || '').slice(0, 10);
    var taxYear = Number(issueDate.slice(0, 4));
    var governmentType = form.elements.tpEnteGov.value;
    var items = Array.from($('rtcItems').querySelectorAll('.accounting-rtc-item')).map(function (card) {
      var value = function (key) { var input = card.querySelector('[name="' + key + '"]'); return input ? input.value.trim() : ''; };
      var item = { productId: card.dataset.productId, cClassTrib: value('cClassTrib') };
      if (isSimple) {
        Object.assign(item, {
          baseCalculo: value('baseCalculo'), cAtivSN: value('cAtivSN'),
          valorImpostoSeletivo: value('valorImpostoSeletivo'), pIBSSN: value('pIBSSN'), pCBSSN: value('pCBSSN')
        });
      } else {
        Object.assign(item, {
          baseCalculo: value('baseCalculo'), cst: value('cst'), ncm: value('ncm'), nbs: value('nbs'),
          quantity: value('quantity'), unit: value('unit'),
          impostoSeletivo: {
            cst: value('selectiveCst'), cClassTrib: value('selectiveCClassTrib'), baseCalculo: value('selectiveBase'),
            quantidade: value('selectiveQuantity'), unidade: value('selectiveUnit'), impostoInformado: value('selectiveAmount')
          }
        });
        if (taxYear >= 2027) Object.assign(item, { aliquotasNominais: {
          cbs: value('rateCbs'), ibsEstadual: value('rateIbsState'), ibsMunicipal: value('rateIbsCity'),
          impostoSeletivo: { adValorem: value('rateIsAdValorem'), adRem: value('rateIsAdRem') }
        } });
      }
      return item;
    });
    var request = { draftId: draftId, items: items };
    if (governmentType) request.tpEnteGov = governmentType;
    try { var result = await api('/api/fiscal/rtc', jsonOptions('POST', request)); showRtcResult(result, false); await loadRtcHistory(draftId); setStatus(result.message || 'Resultado oficial registrado para o rascunho.', 'success'); }
    catch (error) { if (error.data) showRtcResult(error.data, false); setStatus(error.message, 'error'); }
    finally { button.disabled = !state.rtcEnabled || !state.migrationReady || !state.company.taxRegimeConfirmed; button.textContent = 'Consultar calculadora oficial'; }
  });
  load();
})();
