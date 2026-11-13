(() => {
  'use strict';

  const status = document.getElementById('status');
  const form = document.getElementById('profileForm');
  const save = document.getElementById('save');
  const saveHelp = document.getElementById('saveHelp');
  const cancelEdit = document.getElementById('cancelEdit');
  const list = document.getElementById('records');
  const count = document.getElementById('recordsCount');
  const reviewDialog = document.getElementById('reviewDialog');
  const reviewForm = document.getElementById('reviewForm');
  let accessLoaded = false;
  let canEdit = false;
  let profileCreationAllowed = false;
  let regimeConfirmationAvailable = false;
  let taxRegimeConfirmed = false;
  let taxRegime = null;
  let records = [];
  let focusFieldCache = {};

  const operationLabels = { interna: 'Venda interna', interestadual: 'Venda interestadual' };
  const operationNames = ['interna', 'interestadual'];
  const focusFieldSpecs = {
    icms_modalidade_base_calculo: ['Modalidade da base do ICMS', 'Código informado pela contabilidade.'],
    icms_reducao_base_calculo: ['Redução da base do ICMS (%)', 'Percentual orientado para esta operação.'],
    icms_base_calculo: ['Base de cálculo do ICMS (R$)', 'Base informada para este item.'],
    icms_aliquota: ['Alíquota do ICMS (%)', 'Percentual orientado para esta operação.'],
    icms_valor: ['Valor do ICMS (R$)', 'Valor informado para este item.'],
    icms_modalidade_base_calculo_st: ['Modalidade da base do ICMS-ST', 'Código informado pela contabilidade.'],
    icms_margem_valor_adicionado_st: ['MVA do ICMS-ST (%)', 'Percentual orientado para esta operação.'],
    icms_reducao_base_calculo_st: ['Redução da base do ICMS-ST (%)', 'Percentual orientado para esta operação.'],
    icms_base_calculo_st: ['Base de cálculo do ICMS-ST (R$)', 'Base informada para este item.'],
    icms_aliquota_st: ['Alíquota do ICMS-ST (%)', 'Percentual orientado para esta operação.'],
    icms_valor_st: ['Valor do ICMS-ST (R$)', 'Valor informado para este item.'],
    icms_aliquota_credito_simples: ['Alíquota de crédito do Simples (%)', 'Use somente se a operação aprovada conceder crédito.'],
    icms_valor_credito_simples: ['Valor de crédito do Simples (R$)', 'Use somente se a operação aprovada conceder crédito.'],
    icms_base_calculo_retido_st: ['Base do ICMS-ST retido anteriormente (R$)', 'Valor informado para este item, se aplicável.'],
    icms_valor_retido_st: ['ICMS-ST retido anteriormente (R$)', 'Valor informado para este item, se aplicável.'],
    icms_aliquota_final: ['Alíquota final informada para o ICMS (%)', 'Percentual orientado para este item, se aplicável.'],
    icms_valor_substituto: ['Valor do ICMS do substituto (R$)', 'Valor informado para este item, se aplicável.'],
    pis_base_calculo: ['Base de cálculo do PIS (R$)', 'Base informada para este item.'],
    pis_aliquota_porcentual: ['Alíquota percentual do PIS (%)', 'Percentual orientado para esta operação.'],
    pis_quantidade_vendida: ['Quantidade tributável do PIS', 'Quantidade informada para este item.'],
    pis_aliquota_valor: ['Alíquota do PIS por unidade (R$)', 'Valor por unidade informado pela contabilidade.'],
    pis_valor: ['Valor do PIS (R$)', 'Valor informado para este item.'],
    pis_base_calculo_st: ['Base do PIS-ST (R$)', 'Base informada para este item.'],
    pis_aliquota_porcentual_st: ['Alíquota percentual do PIS-ST (%)', 'Percentual orientado para esta operação.'],
    pis_quantidade_vendida_st: ['Quantidade tributável do PIS-ST', 'Quantidade informada para este item.'],
    pis_aliquota_valor_st: ['Alíquota do PIS-ST por unidade (R$)', 'Valor por unidade informado pela contabilidade.'],
    pis_valor_st: ['Valor do PIS-ST (R$)', 'Valor informado para este item.'],
    cofins_base_calculo: ['Base de cálculo da Cofins (R$)', 'Base informada para este item.'],
    cofins_aliquota_porcentual: ['Alíquota percentual da Cofins (%)', 'Percentual orientado para esta operação.'],
    cofins_quantidade_vendida: ['Quantidade tributável da Cofins', 'Quantidade informada para este item.'],
    cofins_aliquota_valor: ['Alíquota da Cofins por unidade (R$)', 'Valor por unidade informado pela contabilidade.'],
    cofins_valor: ['Valor da Cofins (R$)', 'Valor informado para este item.'],
    cofins_base_calculo_st: ['Base da Cofins-ST (R$)', 'Base informada para este item.'],
    cofins_aliquota_porcentual_st: ['Alíquota percentual da Cofins-ST (%)', 'Percentual orientado para esta operação.'],
    cofins_quantidade_vendida_st: ['Quantidade tributável da Cofins-ST', 'Quantidade informada para este item.'],
    cofins_aliquota_valor_st: ['Alíquota da Cofins-ST por unidade (R$)', 'Valor por unidade informado pela contabilidade.'],
    cofins_valor_st: ['Valor da Cofins-ST (R$)', 'Valor informado para este item.'],
    ibs_cbs_base_calculo: ['Base do IBS/CBS (R$)', 'Base informada para este item.'],
    ibs_uf_aliquota: ['Alíquota do IBS estadual (%)', 'Percentual orientado para esta operação.'],
    ibs_uf_valor: ['Valor do IBS estadual (R$)', 'Valor informado para este item.'],
    ibs_mun_aliquota: ['Alíquota do IBS municipal (%)', 'Percentual orientado para esta operação.'],
    ibs_mun_valor: ['Valor do IBS municipal (R$)', 'Valor informado para este item.'],
    cbs_aliquota: ['Alíquota da CBS (%)', 'Percentual orientado para esta operação.'],
    cbs_valor: ['Valor da CBS (R$)', 'Valor informado para este item.'],
  };
  const focusIcmsBasic = ['icms_modalidade_base_calculo', 'icms_base_calculo', 'icms_reducao_base_calculo', 'icms_aliquota', 'icms_valor'];
  const focusIcmsSt = ['icms_modalidade_base_calculo_st', 'icms_margem_valor_adicionado_st', 'icms_reducao_base_calculo_st', 'icms_base_calculo_st', 'icms_aliquota_st', 'icms_valor_st'];
  const focusIcmsRetainedSt = ['icms_base_calculo_retido_st', 'icms_valor_retido_st', 'icms_aliquota_final', 'icms_valor_substituto'];
  const focusIcmsCredit = ['icms_aliquota_credito_simples', 'icms_valor_credito_simples'];
  const focusIbsCbs000 = ['ibs_cbs_base_calculo', 'ibs_uf_aliquota', 'ibs_uf_valor', 'ibs_mun_aliquota', 'ibs_mun_valor', 'cbs_aliquota', 'cbs_valor'];

  function updateCsosnHelp() {
    const control = form.elements.namedItem('csosn');
    const help = document.getElementById('csosnHelp');
    if (!control || !help) return;
    help.textContent = control.value.trim() === '102'
      ? '102 = tributada pelo Simples Nacional sem permissão de crédito de ICMS ao destinatário. Use somente na operação confirmada pela contabilidade; mercadoria sujeita à ST precisa de classificação própria.'
      : 'Use o código indicado pelo contador para a operação.';
  }

  function show(message, tone) {
    status.textContent = message;
    status.className = `notice status-banner ${tone || 'info'}`;
  }

  function updateControls() {
    const enabled = accessLoaded && canEdit && profileCreationAllowed;
    save.disabled = !enabled;
    if (!accessLoaded) {
      saveHelp.textContent = 'Aguardando confirmação do seu acesso e do regime tributário da empresa.';
    } else if (!canEdit) {
      saveHelp.textContent = 'Seu acesso é somente leitura. Peça a um administrador ou gerente para cadastrar o perfil.';
    } else if (!regimeConfirmationAvailable) {
      saveHelp.textContent = 'A confirmação do regime ainda não está disponível nos dados fiscais da empresa.';
    } else if (!taxRegimeConfirmed) {
      saveHelp.textContent = 'Bloqueado até o regime ser confirmado com a contabilidade nos dados da empresa.';
    } else if (taxRegime !== 'simples_nacional') {
      saveHelp.textContent = 'Esta versão só permite configurar perfis para empresas com Simples Nacional confirmado.';
    } else {
      saveHelp.textContent = form.elements.profileId.value
        ? 'Salvar altera a regra selecionada e retorna o perfil para não revisado.'
        : 'Salve uma operação por vez. As regras do perfil podem ser reutilizadas nos produtos vinculados.';
    }
  }

  async function api(path, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, Object.assign(
        { credentials: 'same-origin', cache: 'no-store' }, options || {}, { signal: controller.signal }
      ));
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        location.replace('/login');
        throw new Error('Sua sessão expirou. Entre novamente.');
      }
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar o servidor.');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('O servidor demorou para responder. Tente novamente.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function emptyState() {
    const state = document.createElement('div');
    state.className = 'empty-state';
    const symbol = document.createElement('span');
    symbol.className = 'empty-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = '+';
    const title = document.createElement('strong');
    title.textContent = 'Nenhum perfil cadastrado ainda';
    const description = document.createElement('p');
    description.textContent = 'Crie regras orientadas pela contabilidade e separe-as por operação.';
    state.append(symbol, title, description);
    return state;
  }

  function setValue(name, value) {
    const control = form.elements.namedItem(name);
    if (control) control.value = value == null ? '' : String(value);
  }

  function readFocusFields() {
    const fields = {};
    document.querySelectorAll('[data-focus-tax-field]').forEach(input => {
      const value = input.value.trim();
      if (value) fields[input.dataset.focusTaxField] = value;
    });
    focusFieldCache = Object.assign({}, focusFieldCache, fields);
    return fields;
  }

  function addFocusFieldGroup(target, title, names, values, optional) {
    const section = document.createElement('section');
    section.className = 'focus-tax-field-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    if (optional) {
      const tag = document.createElement('span');
      tag.className = 'optional-tag';
      tag.textContent = 'Opcional';
      heading.append(' ', tag);
    }
    const description = document.createElement('p');
    description.className = 'group-description';
    description.textContent = optional
      ? 'Preencha somente se esta parte da operação se aplicar. Ao iniciar um grupo, complete todos os campos.'
      : 'Grupo exigido pelo mapeamento Focus para os códigos selecionados. Informe os valores aprovados.';
    const grid = document.createElement('div');
    grid.className = 'field-grid';
    for (const name of names) {
      const spec = focusFieldSpecs[name];
      if (!spec) continue;
      const label = document.createElement('label');
      label.className = 'field';
      const caption = document.createElement('span');
      caption.className = 'field-label';
      caption.textContent = spec[0];
      const input = document.createElement('input');
      input.className = 'field-control';
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.placeholder = 'Informado pela contabilidade';
      const integerCode = name === 'icms_modalidade_base_calculo' || name === 'icms_modalidade_base_calculo_st';
      input.pattern = integerCode ? '[0-9]+' : '(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)';
      input.title = integerCode ? 'Informe o código inteiro recebido da contabilidade.' : 'Use ponto para separar casas decimais.';
      input.dataset.focusTaxField = name;
      input.value = values && values[name] != null ? String(values[name]) : '';
      const help = document.createElement('small');
      help.className = 'field-help';
      help.textContent = spec[1];
      label.append(caption, input, help);
      grid.append(label);
    }
    section.append(heading, description, grid);
    target.append(section);
  }

  function renderFocusFields(savedValues) {
    const target = document.getElementById('focusTaxFields');
    const guidance = document.getElementById('focusTaxGuidance');
    const visibleValues = readFocusFields();
    const values = Object.assign({}, focusFieldCache, visibleValues,
      savedValues && typeof savedValues === 'object' ? savedValues : {});
    focusFieldCache = values;
    const csosn = form.elements.namedItem('csosn').value.trim();
    const pisCst = form.elements.namedItem('pisCst').value.trim();
    const cofinsCst = form.elements.namedItem('cofinsCst').value.trim();
    const cstIbsCbs = form.elements.namedItem('cstIbsCbs').value.trim();
    const classTrib = form.elements.namedItem('classTrib').value.trim();
    const ibsCbsFutureEnabled = form.elements.namedItem('ibsCbsRegularRegimeEnabled').checked === true;
    const unsupported = [];
    let groups = 0;
    target.replaceChildren();

    if (csosn === '101') {
      addFocusFieldGroup(target, 'ICMS · crédito do Simples', ['icms_aliquota_credito_simples', 'icms_valor_credito_simples'], values, false); groups++;
    } else if (csosn === '201') {
      addFocusFieldGroup(target, 'ICMS-ST · campos condicionais', [...focusIcmsSt, 'icms_aliquota_credito_simples', 'icms_valor_credito_simples'], values, false); groups++;
    } else if (csosn === '202' || csosn === '203') {
      addFocusFieldGroup(target, 'ICMS-ST · campos condicionais', focusIcmsSt, values, false); groups++;
    } else if (csosn === '900') {
      addFocusFieldGroup(target, 'ICMS · grupo opcional', focusIcmsBasic, values, true); groups++;
      addFocusFieldGroup(target, 'ICMS-ST · grupo opcional', focusIcmsSt, values, true); groups++;
      addFocusFieldGroup(target, 'Crédito do Simples · opcional', focusIcmsCredit, values, true); groups++;
      const basicPresent = focusIcmsBasic.some(name => values && values[name] != null && String(values[name]).trim() !== '');
      const stPresent = focusIcmsSt.some(name => values && values[name] != null && String(values[name]).trim() !== '');
      if (basicPresent === stPresent) unsupported.push('CSOSN 900 exige exatamente um dos grupos opcionais de ICMS ou ICMS-ST.');
    } else if (csosn === '500') {
      addFocusFieldGroup(target, 'ICMS-ST retido anteriormente', focusIcmsRetainedSt, values, true); groups++;
    } else if (csosn && !['102', '103', '300', '400', '500'].includes(csosn)) {
      unsupported.push(`CSOSN ${csosn}: grupo condicional ainda não mapeado.`);
    }

    function addPisCofinsGroup(prefix, cst) {
      if (!cst) return;
      let fields = [];
      if (cst === '01' || cst === '02') fields = [`${prefix}_base_calculo`, `${prefix}_aliquota_porcentual`, `${prefix}_valor`];
      else if (cst === '03') fields = [`${prefix}_quantidade_vendida`, `${prefix}_aliquota_valor`, `${prefix}_valor`];
      else if (cst === '05') fields = [`${prefix}_base_calculo_st`, `${prefix}_aliquota_porcentual_st`, `${prefix}_valor_st`];
      else if (!['04', '06', '07', '08', '09'].includes(cst)) {
        unsupported.push(`CST ${prefix.toUpperCase()} ${cst}: grupo condicional ainda não mapeado.`);
        return;
      }
      if (fields.length) {
        addFocusFieldGroup(target, `${prefix.toUpperCase()} · CST ${cst}`, fields, values, false);
        groups++;
      }
    }
    addPisCofinsGroup('pis', pisCst);
    addPisCofinsGroup('cofins', cofinsCst);

    if (ibsCbsFutureEnabled && (cstIbsCbs || classTrib)) {
      if (cstIbsCbs === '000' && ['000001', '000005'].includes(classTrib)) {
        addFocusFieldGroup(target, `IBS/CBS · CST ${cstIbsCbs} · classificação ${classTrib}`, focusIbsCbs000, values, false);
        groups++;
      } else {
        unsupported.push(`IBS/CBS ${cstIbsCbs || '(CST pendente)'}/${classTrib || '(classificação pendente)'}: grupo ainda não mapeado.`);
      }
    }

    guidance.className = `notice form-notice ${unsupported.length ? 'warning' : 'info'}`;
    if (!ibsCbsFutureEnabled) {
      guidance.textContent = 'ICMS, PIS e Cofins seguem os grupos informados. IBS/CBS está desligado: Simples Nacional não envia esses campos; a flag futura só produz efeito para regime regular confirmado e emissão a partir de 01/01/2027.';
      if (unsupported.length) guidance.textContent += ` ${unsupported.join(' ')}`;
    } else if (unsupported.length) {
      guidance.textContent = `${unsupported.join(' ')} Esta combinação permanece bloqueada para emissão até o mapeamento e a revisão fiscal.`;
    } else if (groups) {
      guidance.textContent = 'Preencha os grupos exibidos com os valores aprovados pela contabilidade. A Focus pode totalizar campos calculados; o ERP não calcula nem presume estes valores.';
    } else if (csosn || pisCst || cofinsCst) {
      guidance.textContent = 'Para os códigos informados, o mapeamento atual não exige outros campos numéricos de ICMS/PIS/Cofins. IBS/CBS só será considerado com a flag futura, regime regular confirmado e vigência aplicável.';
    } else {
      guidance.textContent = 'Selecione os códigos fiscais para ver os grupos numéricos conhecidos. Informe apenas valores recebidos da contabilidade; o ERP não calcula nem presume impostos.';
    }
  }

  function editProfile(record, operation) {
    const rules = record.rules && typeof record.rules === 'object' ? record.rules : {};
    const variants = rules.operations && typeof rules.operations === 'object' ? rules.operations : {};
    const variant = variants[operation] && typeof variants[operation] === 'object' ? variants[operation] : {};
    focusFieldCache = {};
    form.reset();
    setValue('profileId', record.id);
    setValue('name', record.name);
    setValue('operation', operation);
    for (const field of ['cfop', 'csosn', 'pisCst', 'cofinsCst', 'cstIbsCbs', 'classTrib']) setValue(field, variant[field]);
    form.elements.namedItem('ibsCbsRegularRegimeEnabled').checked = variant.ibsCbsRegularRegimeEnabled === true;
    renderFocusFields(variant.focusFields);
    updateCsosnHelp();
    document.getElementById('formTitle').textContent = variants[operation]
      ? `Editar regra · ${operationLabels[operation]}`
      : `Adicionar regra · ${operationLabels[operation]}`;
    save.textContent = 'Salvar regra da operação';
    cancelEdit.hidden = false;
    updateControls();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.elements.namedItem('operation').focus({ preventScroll: true });
  }

  function resetForm() {
    focusFieldCache = {};
    form.reset();
    renderFocusFields({});
    updateCsosnHelp();
    setValue('profileId', '');
    document.getElementById('formTitle').textContent = 'Criar perfil';
    save.textContent = 'Salvar regra da operação';
    cancelEdit.hidden = true;
    updateControls();
  }

  function openReview(record) {
    reviewForm.reset();
    const feedback = document.getElementById('reviewFeedback');
    feedback.hidden = true;
    feedback.textContent = '';
    document.getElementById('reviewProfileId').value = record.id;
    if (typeof reviewDialog.showModal === 'function') reviewDialog.showModal();
  }

  function render(rows) {
    records = Array.isArray(rows) ? rows : [];
    list.replaceChildren();
    count.textContent = String(records.length);
    count.setAttribute('aria-label', `${records.length} ${records.length === 1 ? 'perfil cadastrado' : 'perfis cadastrados'}`);
    if (!records.length) {
      list.append(emptyState());
      return;
    }

    for (const record of records) {
      const item = document.createElement('article');
      item.className = 'record';
      const heading = document.createElement('div');
      heading.className = 'record-heading';
      const name = document.createElement('strong');
      name.textContent = record.name || 'Perfil sem nome';
      const tag = document.createElement('span');
      tag.className = `tag${record.review_status === 'reviewed' ? ' reviewed-tag' : ''}`;
      tag.textContent = record.review_status === 'reviewed' ? 'Conferência registrada · opcional' : 'Não revisado · conferência opcional';
      heading.append(name, tag);

      const rootRules = record.rules && typeof record.rules === 'object' ? record.rules : {};
      const variants = rootRules.operations && typeof rootRules.operations === 'object' ? rootRules.operations : {};
      const meta = document.createElement('small');
      const configured = operationNames.filter(key => variants[key]);
      meta.textContent = configured.length
        ? configured.map(key => {
          const rule = variants[key] || {};
          return `${operationLabels[key]}: CFOP ${rule.cfop || 'pendente'} · CSOSN ${rule.csosn || 'pendente'} · PIS ${rule.pisCst || 'pendente'} · Cofins ${rule.cofinsCst || 'pendente'}`;
        }).join(' | ')
        : 'Perfil antigo sem regra separada por operação. Configure cada operação para não reaproveitar códigos automaticamente.';
      item.append(heading, meta);

      const actions = document.createElement('div');
      actions.className = 'record-actions';
      for (const operation of operationNames) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary-action compact-action';
        button.textContent = `${variants[operation] ? 'Editar' : 'Configurar'} ${operation === 'interna' ? 'interna' : 'interestadual'}`;
        button.disabled = !canEdit;
        button.addEventListener('click', () => editProfile(record, operation));
        actions.append(button);
      }
      if (canEdit) {
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'secondary-action compact-action review-action';
        review.textContent = record.review_status === 'reviewed' ? 'Atualizar conferência opcional' : 'Registrar conferência opcional';
        review.addEventListener('click', () => openReview(record));
        actions.append(review);
      }
      item.append(actions);

      list.append(item);
    }
  }

  async function refresh() {
    const result = await api('/api/fiscal/tax-profiles');
    accessLoaded = true;
    canEdit = result.editable === true;
    regimeConfirmationAvailable = result.regimeConfirmationAvailable === true;
    taxRegimeConfirmed = result.taxRegimeConfirmed === true;
    taxRegime = result.taxRegime || null;
    profileCreationAllowed = regimeConfirmationAvailable && taxRegimeConfirmed && taxRegime === 'simples_nacional';
    render(result.records);
    updateControls();

    if (!canEdit) show('Seu perfil de acesso permite consultar os perfis, mas não alterar cadastros fiscais.', 'warning');
    else if (!regimeConfirmationAvailable) show('A confirmação do regime ainda não está disponível nos dados fiscais da empresa.', 'warning');
    else if (!taxRegimeConfirmed) show('O cadastro está bloqueado até o regime tributário ser confirmado com a contabilidade.', 'warning');
    else if (taxRegime !== 'simples_nacional') show('Esta versão permite configurar perfis apenas para Simples Nacional confirmado.', 'warning');
    else show('Cadastre uma regra para cada operação orientada. Salvar não calcula imposto nem transmite NF-e.', 'info');
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!canEdit || !profileCreationAllowed) return;
    save.disabled = true;
    show('Salvando a regra como não revisado...', 'info');
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const visibleFocusFields = readFocusFields();
      const ibsCbsFlag = form.elements.namedItem('ibsCbsRegularRegimeEnabled').checked === true;
      const preservedIbsCbsFields = ibsCbsFlag ? {} : Object.fromEntries(Object.entries(focusFieldCache)
        .filter(([name]) => name.toLowerCase().startsWith('ibs_') || name.toLowerCase().startsWith('cbs_')));
      values.focusFields = Object.assign({}, preservedIbsCbsFields, visibleFocusFields);
      values.ibsCbsRegularRegimeEnabled = ibsCbsFlag;
      const profileId = String(values.profileId || '');
      delete values.profileId;
      await api('/api/fiscal/tax-profiles', {
        method: profileId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileId ? { ...values, id: profileId } : values)
      });
      resetForm();
      await refresh();
      show('Regra salva como referência opcional. A emissão confere os códigos informados em cada item e não exige revisão deste perfil.', 'success');
    } catch (error) {
      show(error.message, 'error');
    } finally {
      updateControls();
    }
  });

  cancelEdit.addEventListener('click', resetForm);
  document.getElementById('cancelReview').addEventListener('click', () => reviewDialog.close());
  reviewForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = document.getElementById('saveReview');
    const feedback = document.getElementById('reviewFeedback');
    const values = Object.fromEntries(new FormData(reviewForm).entries());
    const profileId = String(values.profileId || '');
    const confirmed = values.confirmed === 'on';
    delete values.profileId;
    delete values.confirmed;
    submit.disabled = true;
    submit.textContent = 'Salvando conferência...';
    feedback.hidden = true;
    feedback.textContent = '';
    try {
      await api('/api/fiscal/tax-profiles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, id: profileId, action: 'register-accountant-review', confirmed })
      });
      reviewDialog.close();
      show('Conferência opcional registrada. Ela não autentica o contador, não altera os itens já lançados e não é exigida para salvar ou emitir NF-e.', 'success');
      refresh().catch(() => show('A conferência foi salva, mas a lista de perfis não atualizou. Recarregue esta página para conferir.', 'warning'));
    } catch (error) {
      feedback.hidden = false;
      feedback.className = 'notice error form-notice';
      feedback.textContent = error.message || 'Não foi possível salvar a conferência. Tente novamente.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Salvar conferência opcional';
    }
  });

  form.elements.namedItem('csosn').addEventListener('input', () => {
    const values = readFocusFields();
    updateCsosnHelp();
    renderFocusFields(values);
  });
  for (const name of ['pisCst', 'cofinsCst', 'cstIbsCbs', 'classTrib']) {
    form.elements.namedItem(name).addEventListener('input', () => renderFocusFields(readFocusFields()));
  }
  form.elements.namedItem('ibsCbsRegularRegimeEnabled').addEventListener('change', () => renderFocusFields(readFocusFields()));
  updateCsosnHelp();
  renderFocusFields({});

  const loading = document.createElement('p');
  loading.className = 'loading-state';
  loading.textContent = 'Carregando perfis...';
  list.replaceChildren(loading);
  refresh().catch(error => {
    canEdit = false;
    profileCreationAllowed = false;
    updateControls();
    show(`Não foi possível carregar os perfis: ${error.message}`, 'error');
    list.replaceChildren();
    const unavailable = document.createElement('p');
    unavailable.className = 'unavailable-state';
    unavailable.textContent = 'A lista está indisponível no momento. Tente recarregar a página.';
    list.append(unavailable);
  });

  api('/api/fiscal/cfop').then(result => {
    const target = document.getElementById('cfopOptions');
    for (const cfop of result.records || []) {
      const option = document.createElement('option');
      option.value = cfop.code;
      option.label = cfop.customLabel || cfop.title;
      target.append(option);
    }
  }).catch(() => {});
})();
