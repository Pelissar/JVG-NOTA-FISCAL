(function () {
  'use strict';
  var state = { records: [], filtered: [], selected: null, page: 0, available: false, editable: false, saving: false };
  var PAGE_SIZE = 30;
  var list = document.getElementById('list');
  var details = document.getElementById('details');
  var notice = document.getElementById('notice');

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function message(text, kind) {
    notice.textContent = text;
    notice.className = 'notice' + (kind ? ' ' + kind : '');
  }

  async function request(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}, { signal: controller.signal }));
      if (response.status === 401) {
        window.location.replace('/login');
        throw new Error('Faça login novamente.');
      }
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir esta operação.');
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('O servidor demorou a responder. Tente novamente.');
      throw err;
    } finally { clearTimeout(timer); }
  }

  function filter() {
    var search = document.getElementById('search').value.trim().toLocaleLowerCase('pt-BR');
    var group = document.getElementById('group').value;
    state.filtered = state.records.filter(function (record) {
      if (group !== 'all' && !record.code.startsWith(group)) return false;
      return !search || [record.code, record.title, record.description, record.customLabel || ''].some(function (value) {
        return value.toLocaleLowerCase('pt-BR').includes(search);
      });
    });
    state.page = 0;
    renderList();
  }

  function renderList() {
    list.replaceChildren();
    var pageCount = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, pageCount - 1);
    var rows = state.filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    rows.forEach(function (record) {
      var selected = state.selected && state.selected.code === record.code;
      var button = element('button', 'cfop-record' + (selected ? ' selected' : ''));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(!!selected));
      button.append(element('span', 'cfop-code', record.code));
      var names = element('span', 'cfop-record-text');
      names.append(element('strong', '', record.customLabel || record.title));
      if (record.customLabel) names.append(element('small', '', record.title));
      button.append(names);
      if (record.customLabel) button.append(element('span', 'cfop-custom-badge', 'Personalizado'));
      button.addEventListener('click', function () { state.selected = record; renderList(); renderDetails(); });
      list.append(button);
    });
    if (!rows.length) list.append(element('p', 'placeholder', 'Nenhum código encontrado para esta pesquisa.'));
    document.getElementById('matches').textContent = state.filtered.length + ' encontrados';
    document.getElementById('pageInfo').textContent = 'Página ' + (state.page + 1) + ' de ' + pageCount;
    document.getElementById('previous').disabled = state.page === 0;
    document.getElementById('next').disabled = state.page + 1 >= pageCount;
  }

  function renderDetails() {
    details.replaceChildren();
    var record = state.selected;
    if (!record) { details.append(element('p', 'placeholder', 'Selecione um código para consultar os detalhes.')); return; }
    details.append(element('span', 'cfop-detail-code', record.code));
    details.append(element('h3', '', record.title));
    var block = element('div');
    block.append(element('h4', '', 'Descrição fiscal oficial'));
    block.append(element('p', 'official-description', record.description));
    details.append(block);
    var validity = element('p', '', 'Vigência informada na tabela: desde ' + (record.validFrom ? record.validFrom.split('-').reverse().join('/') : 'não informada') + '.');
    details.append(validity);
    var editor = element('div', 'cfop-editor');
    editor.append(element('label', '', 'Nome interno deste CFOP'));
    var input = element('input');
    input.id = 'customLabel';
    input.maxLength = 140;
    input.placeholder = 'Ex.: Venda de mercadoria — loja';
    input.value = record.customLabel || '';
    input.disabled = !state.editable || state.saving;
    editor.querySelector('label').htmlFor = input.id;
    editor.append(input);
    editor.append(element('small', '', 'A personalização é exclusiva desta empresa. O código, o título e a descrição oficial permanecem intactos.'));
    if (state.editable) {
      var actions = element('div', 'cfop-actions');
      var save = element('button', 'primary', state.saving ? 'Salvando...' : 'Salvar nome personalizado');
      save.disabled = state.saving;
      save.type = 'button';
      save.addEventListener('click', function () { saveLabel(record, input.value); });
      actions.append(save);
      var reset = element('button', '', 'Restaurar nome padrão');
      reset.type = 'button';
      reset.disabled = state.saving || !record.customLabel;
      reset.addEventListener('click', function () { resetLabel(record); });
      actions.append(reset);
      editor.append(actions);
    } else {
      editor.append(element('small', '', state.available ? 'Sua conta tem permissão apenas para consultar.' : 'Para salvar nomes personalizados, aplique a migração de CFOP no Supabase.'));
    }
    details.append(editor);
  }

  async function saveLabel(record, label) {
    var normalized = label.trim().replace(/\s+/g, ' ');
    if (normalized.length < 2 || normalized.length > 140) { message('Informe um nome entre 2 e 140 caracteres.', 'error'); return; }
    state.saving = true;
    renderDetails();
    try {
      await request('/api/fiscal/cfop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: record.code, customLabel: normalized }) });
      record.customLabel = normalized;
      message('Nome personalizado salvo para esta empresa. A descrição oficial não foi alterada.');
      renderList();
    } catch (error) { message('Não foi possível salvar: ' + error.message, 'error'); }
    finally { state.saving = false; renderDetails(); }
  }

  async function resetLabel(record) {
    state.saving = true;
    renderDetails();
    try {
      await request('/api/fiscal/cfop?code=' + encodeURIComponent(record.code), { method: 'DELETE' });
      record.customLabel = null;
      message('Nome padrão restaurado para esta empresa.');
      renderList();
    } catch (error) { message('Não foi possível restaurar: ' + error.message, 'error'); }
    finally { state.saving = false; renderDetails(); }
  }

  async function load() {
    try {
      var result = await request('/api/fiscal/cfop');
      state.records = Array.isArray(result.records) ? result.records : [];
      state.available = !!result.customizationAvailable;
      state.editable = !!result.customizable;
      document.getElementById('total').textContent = state.records.length + ' códigos oficiais';
      document.getElementById('sourceInfo').textContent = result.metadata.document + ' · publicada em ' + result.metadata.publishedOn.split('-').reverse().join('/');
      state.selected = state.records.find(function (r) { return r.code === '5102'; }) || state.records[0];
      filter();
      renderDetails();
      var hint = !state.available ? 'Catálogo oficial disponível para consulta. A personalização será liberada após aplicar a migração de CFOP no banco.' :
        !state.editable ? 'Catálogo oficial carregado. Sua conta pode consultar, mas não alterar nomes.' :
          'Catálogo oficial carregado. Selecione um CFOP para criar ou restaurar seu nome interno.';
      message(hint, state.available ? '' : 'info');
    } catch (error) { message('Falha ao carregar a tabela de CFOP: ' + error.message, 'error'); }
  }

  document.getElementById('search').addEventListener('input', filter);
  document.getElementById('group').addEventListener('change', filter);
  document.getElementById('previous').addEventListener('click', function () { state.page--; renderList(); });
  document.getElementById('next').addEventListener('click', function () { state.page++; renderList(); });
  load();
})();
