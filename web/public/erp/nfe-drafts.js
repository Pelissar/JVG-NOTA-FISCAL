(function () {
  'use strict';

  var state = { products: [], clients: [], taxProfiles: [], issuerState: '', drafts: [], homologationSetup: null, ready: false, sourceOrderId: null, sourceOrderNumber: '' };
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
      return /^\d{8}$/.test(String(product.ncm || '')) && /^[0-8]$/.test(String(product.origin || '')) && Boolean(product.taxProfileId);
    }).length;
    var incompleteProducts = activeProducts.length - readyProducts;
    var missingNcm = activeProducts.filter(function (product) { return !/^\d{8}$/.test(String(product.ncm || '')); }).length;
    var missingOrigin = activeProducts.filter(function (product) { return !/^[0-8]$/.test(String(product.origin || '')); }).length;
    var missingProfile = activeProducts.filter(function (product) { return !product.taxProfileId; }).length;
    var productReady = readyProducts > 0;
    var approvedProfiles = state.taxProfiles.filter(function (profile) {
      var rules = profile && profile.rules && typeof profile.rules === 'object' ? profile.rules : {};
      var operations = rules.operations && typeof rules.operations === 'object' ? rules.operations : {};
      return profile.review_status === 'reviewed' && Object.keys(operations).length > 0;
    }).length;
    var reviewPending = state.taxProfiles.filter(function (profile) { return profile.review_status !== 'reviewed'; }).length;
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
        ? activeProducts.length + ' produto(s) ativo(s); ' + readyProducts + ' completo(s), ' + incompleteProducts + ' incompleto(s). NCM pendente: ' + missingNcm + ', origem: ' + missingOrigin + ', perfil fiscal: ' + missingProfile + '. Só os itens escolhidos no rascunho precisam passar por esta conferência.'
        : 'Cadastre ao menos um produto ativo para preparar uma NF-e.'],
      [approvedProfiles > 0, 'Regra fiscal revisada', approvedProfiles > 0
        ? approvedProfiles + ' perfil(is) com operação registrada e revisão declarada' + (reviewPending ? '; ' + reviewPending + ' perfil(is) ainda aguardam revisão.' : '. Confirme se o perfil corresponde à venda.')
        : state.taxProfiles.length
          ? state.taxProfiles.length + ' perfil(is) cadastrado(s), ainda sem revisão contábil registrada.'
          : 'Nenhum perfil fiscal cadastrado. As regras precisam ser fornecidas e conferidas com a contabilidade para cada operação.'],
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
      if (!response.ok) throw new Error(data.error || data.message ||
        (Array.isArray(data.issues) ? data.issues.join(' · ') : '') || 'Não foi possível concluir a operação.');
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

  function taxRuleFor(product, recipientId) {
    var recipient = state.clients.find(function (client) { return client.id === recipientId; });
    return window.JvgNfeTaxSuggestion.resolve(product, recipient, state.issuerState, state.taxProfiles);
  }

  function updateTaxSuggestion(row, product, resetTouched) {
    var cfop = row.querySelector('.cfop');
    var csosn = row.querySelector('.csosn');
    var note = row.querySelector('.tax-suggestion');
    if (resetTouched) {
      row.dataset.cfopTouched = 'false';
      row.dataset.csosnTouched = 'false';
    }
    if (!product) {
      if (row.dataset.cfopTouched !== 'true') cfop.value = '';
      if (row.dataset.csosnTouched !== 'true') csosn.value = '';
      renderProductFiscalFacts(row, null, null);
      note.textContent = 'Selecione produto e destinatário para consultar a regra fiscal vinculada.';
      return;
    }

    var selected = taxRuleFor(product, document.getElementById('recipientId').value);
    var rule = selected.rule;
    var suggestedCfop = rule && rule.cfop ? String(rule.cfop) :
      selected.operation ? '' : String(product.defaultCfop || '');
    var suggestedCsosn = rule && rule.csosn ? String(rule.csosn) : '';
    if (row.dataset.cfopTouched !== 'true') cfop.value = suggestedCfop;
    if (row.dataset.csosnTouched !== 'true') csosn.value = suggestedCsosn;
    renderProductFiscalFacts(row, product, selected);

    if (rule && selected.profile) {
      var reviewLabel = selected.profile.review_status === 'reviewed'
        ? 'declaração de revisão registrada; confira a orientação contábil'
        : 'rascunho ainda sem revisão contábil';
      note.textContent = (selected.profile.name || 'Perfil fiscal') + ' · ' +
        (selected.operation === 'interna' ? 'venda interna' : 'venda interestadual') +
        ' · ' + reviewLabel + '. A emissão continua sujeita à conferência dos demais campos.';
    } else if (selected.operation) {
      note.textContent = (product.taxProfileId ? 'O perfil deste produto não tem regra' : 'Este produto não tem perfil fiscal vinculado') +
        ' para ' + (selected.operation === 'interna' ? 'venda interna' : 'venda interestadual') +
        '. Configure a operação no perfil fiscal; nenhum código foi presumido.';
    } else if (product.defaultCfop) {
      note.textContent = 'CFOP cadastrado como sugestão geral do produto. Selecione o destinatário e confirme a operação com a contabilidade.';
    } else {
      note.textContent = 'Informe a UF do emitente e selecione um destinatário com UF para identificar a regra da operação.';
    }
  }

  function renderProductFiscalFacts(row, product, selected) {
    var target = row.querySelector('.product-fiscal-facts');
    if (!target) return;
    target.replaceChildren();
    var facts = [
      ['NCM', product && product.ncm], ['CEST', product && product.cest],
      ['Origem', product && product.origin],
      ['Perfil tributário', selected && selected.profile && selected.profile.name],
      ['CFOP sugerido', selected && selected.rule && selected.rule.cfop],
      ['CSOSN sugerido', selected && selected.rule && selected.rule.csosn],
    ];
    facts.forEach(function (fact) {
      var item = document.createElement('div');
      var label = document.createElement('span'); label.textContent = fact[0];
      var value = document.createElement('strong'); value.textContent = fact[1] == null || fact[1] === '' ? 'Não cadastrado' : String(fact[1]);
      item.append(label, value); target.append(item);
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
      report('Limite de 20 produtos por rascunho.', 'error');
      return;
    }
    var row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML =
      '<label class="field product-field"><span>Produto *</span><select class="product" required></select></label>' +
      '<label class="field"><span>Qtd. *</span><input class="quantity" type="number" min="0.001" max="100000" step="0.001" value="1" required></label>' +
      '<label class="field"><span>Preço (R$) *</span><input class="price" type="number" min="0" max="999999.99" step="0.01" required></label>' +
      '<label class="field"><span>CFOP da operação</span><input class="cfop" maxlength="4" inputmode="numeric" list="cfopOptions" placeholder="Sugestão do perfil"></label>' +
      '<label class="field"><span>CSOSN da operação</span><input class="csosn" maxlength="3" inputmode="numeric" placeholder="Sugestão do perfil"></label>' +
      '<button type="button" class="remove-item" aria-label="Remover este produto" title="Remover produto">×</button>' +
      '<p class="tax-suggestion" role="status" aria-live="polite">Selecione produto e destinatário para consultar a regra fiscal vinculada.</p>' +
      '<details class="product-fiscal-details"><summary>Dados fiscais cadastrados</summary><div class="product-fiscal-facts"></div></details>';
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
    row.querySelector('.cfop').addEventListener('input', function () { row.dataset.cfopTouched = 'true'; });
    row.querySelector('.csosn').addEventListener('input', function () { row.dataset.csosnTouched = 'true'; });
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
    var total = document.getElementById('total');
    if (total) total.textContent = money.format(cents / 100);
    if (typeof window.jvgNfeWizardRefresh === 'function') window.jvgNfeWizardRefresh();
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
      price.textContent = money.format(Number(draft.commercialTotalCents ?? draft.totalCents) / 100);
      var badge = document.createElement('span');
      var statusNames = { draft: 'Rascunho', processing: 'Em processamento na Focus', queued: 'Na fila da Focus',
        authorized: 'Autorizada', rejected: 'Rejeitada', denied: 'Denegada', cancelled: 'Cancelada', contingency: 'Contingência',
        waiting_certificate: 'Aguardando certificado' };
      badge.textContent = draft.status === 'draft' ? 'Rascunho · ' + draft.pendingCount + ' pendência(s)' :
        (statusNames[draft.status] || draft.status);
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

  async function runFocusAction(id, action, button) {
    button.disabled = true;
    var previousLabel = button.textContent;
    button.textContent = action === 'emit' ? 'Enviando para homologação...' : 'Consultando Focus...';
    try {
      var result = await api('/api/fiscal/nfe-drafts/transmit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, action: action, confirmFiscalReview: action === 'emit' }),
      });
      if (result.needsReconciliation) {
        report('A solicitação foi enviada à Focus para homologação e continua em processamento. Não reenvie; consulte o status.', 'info');
      } else if (result.status === 'authorized') {
        report('A Focus retornou status autorizado em homologação. Confira a chave e o protocolo nos detalhes; isso não é autorização de produção.', 'success');
      } else if (result.status === 'rejected' || result.status === 'denied') {
        report('A Focus retornou ' + result.status + '. Consulte a mensagem detalhada antes de qualquer nova preparação.', 'error');
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
      if (draft.canSubmitHomologation === true) {
        appendLine(panel, 'p', 'O envio só ficará disponível após sua confirmação explícita. Ele usa exclusivamente o ambiente de testes da Focus; não altera série ou numeração de produção.');
        var label = document.createElement('label');
        label.className = 'homologation-confirm';
        var check = document.createElement('input');
        check.type = 'checkbox';
        var copy = document.createElement('span');
        copy.textContent = 'Revisei os dados desta operação com a contabilidade e confirmo que este envio é apenas para homologação.';
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
    note.textContent = 'Campos que o servidor conseguiu mapear para a Focus. O ERP não calcula impostos nem presume códigos; confira as pendências e a aprovação contábil antes de qualquer envio.';
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
      var profile = item.taxProfile && typeof item.taxProfile === 'object' ? item.taxProfile : {};
      var state = document.createElement('span');
      state.className = profile.reviewStatus === 'reviewed' && profile.accountantReviewDeclared === true
        ? 'focus-item-status is-review-declared' : 'focus-item-status is-review-pending';
      state.textContent = profile.reviewStatus === 'reviewed' && profile.accountantReviewDeclared === true
        ? 'Revisão registrada no ERP' : 'Revisão contábil pendente';
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
    appendLine(target, 'p', 'Buscando detalhes do rascunho...');
    try {
      var response = await api('/api/fiscal/nfe-drafts?id=' + encodeURIComponent(id));
      var draft = response.draft;
      if (!draft || draft.readyToTransmit !== false || draft.transmissionEnabled !== false)
        throw new Error('Resposta fiscal inesperada. Consulte o suporte.');
      target.replaceChildren();
      var recipient = draft.recipient || {};
      var statusNames = { draft: 'Rascunho', processing: 'Em processamento na Focus', queued: 'Na fila da Focus',
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
          'Dados básicos presentes. Revisão fiscal e homologação ainda obrigatórias.' :
          'Dados cadastrais incompletos: veja as pendências abaixo.');
        appendLine(target, 'p', 'A pré-conferência verifica dados cadastrais; ela não substitui revisão fiscal. A emissão em produção continua bloqueada.');
      } else {
        appendLine(target, 'p', 'Rascunho antigo: pré-conferência cadastral indisponível.');
      }
      var documentReview = draft.documentReview || {};
      if (Array.isArray(documentReview.checks)) {
        appendLine(target, 'h4', 'Checklist de preparação da NF-e');
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
        appendLine(target, 'p', 'Sem pendências registradas neste rascunho. Isso não representa aprovação fiscal.');
      }
      appendLine(target, 'h4', 'Apuração tributária');
      appendLine(target, 'p', 'Não realizada. O ERP ainda não calcula bases, alíquotas ou valores de impostos. A prévia mostra os campos da Focus já mapeados e os dados que dependem da contabilidade.');
      appendLine(target, 'p', 'A integração não calcula nem presume tributos. O envio de homologação depende da regra aprovada por operação e da conferência de todos os campos exigidos pela Focus.');
      appendLine(target, 'p', '“Revisão registrada no ERP” indica apenas uma declaração salva no sistema; não valida a qualificação do contador nem substitui a aprovação fiscal da operação.');
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
    renderHistory();
    renderHomologationReadiness();
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
      // Sugestões oficiais não podem impedir o uso de rascunhos se o catálogo falhar.
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
      } catch { /* campo livre continua disponível */ }
      document.getElementById('recipientId').addEventListener('change', updateItemTaxSuggestions);
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
        body: JSON.stringify(Object.assign({
          nature: form.elements.namedItem('nature').value.trim(),
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
      idempotencyKey = null;
      state.sourceOrderId = null;
      state.sourceOrderNumber = '';
      document.getElementById('sourceOrderNotice').hidden = true;
      document.getElementById('recipientId').disabled = false;
      clearOrderQuery();
      form.reset();
      if (typeof window.jvgNfeWizardReset === 'function') window.jvgNfeWizardReset();
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
