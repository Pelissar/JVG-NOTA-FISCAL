(function () {
  'use strict';

  const status = document.getElementById('status');
  const form = document.getElementById('profileForm');
  const save = document.getElementById('save');
  const saveHelp = document.getElementById('saveHelp');
  const list = document.getElementById('records');
  const count = document.getElementById('recordsCount');
  let accessLoaded = false;
  let canEdit = false;
  let profileCreationAllowed = false;
  let regimeConfirmationAvailable = false;
  let taxRegimeConfirmed = false;
  let taxRegime = null;

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
      saveHelp.textContent = 'A confirmação de regime ainda não está disponível no banco; a etapa fiscal precisa ser preparada no Supabase.';
    } else if (!taxRegimeConfirmed) {
      saveHelp.textContent = 'Confirme o regime tributário nos dados da empresa, com orientação da contabilidade.';
    } else if (taxRegime !== 'simples_nacional') {
      saveHelp.textContent = 'Esta versão só permite criar perfis para empresas com Simples Nacional confirmado.';
    } else {
      saveHelp.textContent = 'O perfil será salvo como rascunho para revisão contábil. Nenhum campo libera a emissão.';
    }
  }

  async function api(path, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, Object.assign(
        { credentials: 'same-origin', cache: 'no-store' },
        options || {},
        { signal: controller.signal }
      ));
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        location.assign('/login');
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
    description.textContent = 'Depois de salvar, os perfis desta empresa aparecerão aqui para consulta.';
    state.append(symbol, title, description);
    return state;
  }

  function render(records) {
    const rows = Array.isArray(records) ? records : [];
    list.replaceChildren();
    count.textContent = String(rows.length);
    count.setAttribute('aria-label', `${rows.length} ${rows.length === 1 ? 'perfil cadastrado' : 'perfis cadastrados'}`);

    if (!rows.length) {
      list.append(emptyState());
      return;
    }

    for (const record of rows) {
      const item = document.createElement('article');
      item.className = 'record';

      const name = document.createElement('strong');
      name.textContent = record.name || 'Perfil sem nome';

      const meta = document.createElement('small');
      const rules = record.rules && typeof record.rules === 'object' ? record.rules : {};
      const details = [
        `CFOP ${rules.cfop || 'não definido'}`,
        `CSOSN ${rules.csosn || 'não definido'}`,
        `PIS ${rules.pisCst || '—'}`,
        `Cofins ${rules.cofinsCst || '—'}`,
        `IBS/CBS ${rules.cstIbsCbs || '—'}`
      ];
      const rates = rules.previewRates && typeof rules.previewRates === 'object' ? rules.previewRates : {};
      const rateSummary = Object.entries(rates)
        .map(([tax, value]) => `${tax.toUpperCase()} ${value}%`)
        .join(', ');
      if (rateSummary) details.push(`Percentuais para estimativa: ${rateSummary}`);
      meta.textContent = details.join(' · ');

      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = record.review_status === 'draft' ? 'Aguardando revisão contábil' : 'Revisão fiscal pendente';

      item.append(name, meta, tag);
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

    if (!canEdit) {
      show('Seu perfil de acesso permite consultar os perfis, mas não criar ou alterar cadastros fiscais.', 'warning');
    } else if (!regimeConfirmationAvailable) {
      show('A confirmação do regime tributário ainda não está disponível. A estrutura fiscal do banco precisa ser aplicada no Supabase para liberar esta etapa.', 'warning');
    } else if (!taxRegimeConfirmed) {
      show('Confirme o regime tributário nos dados da empresa com a contabilidade antes de criar perfis.', 'warning');
    } else if (taxRegime !== 'simples_nacional') {
      show('A empresa não está confirmada no Simples Nacional. Esta versão permite perfis fiscais apenas para esse regime.', 'warning');
    } else {
      show('Simples Nacional confirmado. Os perfis ficam como rascunho, aguardam revisão contábil e não habilitam transmissão de NF-e.', 'info');
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!canEdit || !profileCreationAllowed) return;

    save.disabled = true;
    show('Salvando o perfil como rascunho...', 'info');
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await api('/api/fiscal/tax-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      form.reset();

      try {
        await refresh();
        show('Perfil salvo como rascunho. Peça ao contador para revisar as classificações antes de usar os dados em qualquer fluxo fiscal.', 'success');
      } catch (refreshError) {
        show(`Perfil salvo, mas a lista não atualizou. Recarregue a página. ${refreshError.message}`, 'warning');
      }
    } catch (error) {
      show(error.message, 'error');
    } finally {
      updateControls();
    }
  });

  list.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'loading-state';
  loading.textContent = 'Carregando perfis...';
  list.append(loading);

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
