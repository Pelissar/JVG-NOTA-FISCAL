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

  const operationLabels = { interna: 'Venda interna', interestadual: 'Venda interestadual' };
  const operationNames = ['interna', 'interestadual'];

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
        ? 'Salvar altera a regra selecionada e retorna o perfil para rascunho.'
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

  function editProfile(record, operation) {
    const rules = record.rules && typeof record.rules === 'object' ? record.rules : {};
    const variants = rules.operations && typeof rules.operations === 'object' ? rules.operations : {};
    const variant = variants[operation] && typeof variants[operation] === 'object' ? variants[operation] : {};
    form.reset();
    setValue('profileId', record.id);
    setValue('name', record.name);
    setValue('operation', operation);
    for (const field of ['cfop', 'csosn', 'pisCst', 'cofinsCst', 'cstIbsCbs', 'classTrib']) setValue(field, variant[field]);
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
    form.reset();
    setValue('profileId', '');
    document.getElementById('formTitle').textContent = 'Criar perfil';
    save.textContent = 'Salvar regra da operação';
    cancelEdit.hidden = true;
    updateControls();
  }

  function openReview(record) {
    reviewForm.reset();
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
      tag.textContent = record.review_status === 'reviewed' ? 'Revisão registrada' : 'Aguardando revisão';
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
        button.disabled = !canEdit || !profileCreationAllowed;
        button.addEventListener('click', () => editProfile(record, operation));
        actions.append(button);
      }
      if (canEdit && profileCreationAllowed) {
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'secondary-action compact-action review-action';
        review.textContent = record.review_status === 'reviewed' ? 'Atualizar registro da revisão' : 'Registrar revisão contábil';
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
    show('Salvando a regra como rascunho...', 'info');
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const profileId = String(values.profileId || '');
      delete values.profileId;
      await api('/api/fiscal/tax-profiles', {
        method: profileId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileId ? { ...values, id: profileId } : values)
      });
      resetForm();
      await refresh();
      show('Regra salva como rascunho. A prévia vai selecioná-la pela operação, mas continuará bloqueada até revisar os grupos fiscais pendentes.', 'success');
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
    const values = Object.fromEntries(new FormData(reviewForm).entries());
    const profileId = String(values.profileId || '');
    const confirmed = values.confirmed === 'on';
    delete values.profileId;
    delete values.confirmed;
    try {
      await api('/api/fiscal/tax-profiles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, id: profileId, action: 'register-accountant-review', confirmed })
      });
      reviewDialog.close();
      await refresh();
      show('Declaração da revisão registrada. A emissão continua bloqueada e depende de todos os campos exigidos.', 'success');
    } catch (error) {
      show(error.message, 'error');
    }
  });

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
