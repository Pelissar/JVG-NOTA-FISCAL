(function () {
  'use strict';
  var mount = document.getElementById('erpGlobalNav');
  if (!mount) return;

  var iconPaths = {
    grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
    briefcase: ['M3 7h18v13H3z', 'M7 7V4h10v3', 'M8 12h8'],
    chart: ['M3 3v18h18', 'M7 14l4-4 4 4 6-7', 'M17 7h4v4'],
    file: ['M6 3h8l4 4v14H6z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
    box: ['M3 7.5 12 3l9 4.5-9 4.5z', 'M3 7.5v9L12 21v-9', 'M21 7.5v9L12 21', 'M7.5 5.2 16.5 9.8'],
    wrench: ['M14.2 6.1a5 5 0 0 0-6.3 6.3l-4.4 4.4a2 2 0 0 0 2.8 2.8l4.4-4.4a5 5 0 0 0 6.3-6.3l-3 3-3-3z'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M20 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21a8 8 0 0 1 16 0'],
    building: ['M4 21h16', 'M6 21V5l6-2 6 2v16', 'M9 8h.01', 'M15 8h.01', 'M9 12h.01', 'M15 12h.01', 'M10 21v-5h4v5'],
    warehouse: ['M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M9 21v-8h6v8', 'M3 10h18'],
    receipt: ['M6 2h12v20l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6', 'M9 16h4'],
    hash: ['M4 9h16', 'M4 15h16', 'M10 3 8 21', 'M16 3l-2 18'],
    sliders: ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M8 4v4', 'M15 10v4', 'M10 16v4'],
    settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'M4.93 4.93l1.42 1.42', 'M17.65 17.65l1.42 1.42', 'M2 12h2', 'M20 12h2', 'M4.93 19.07l1.42-1.42', 'M17.65 6.35l1.42-1.42'],
    logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M21 19V5']
  };
  function makeIcon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'erp-nav-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    (iconPaths[name] || iconPaths.file).forEach(function (pathData) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      svg.appendChild(path);
    });
    return svg;
  }
  function addIconLabel(element, label, iconName) {
    element.appendChild(makeIcon(iconName));
    element.appendChild(document.createTextNode(label));
  }
  var groups = [
    { label: 'Comercial', icon: 'briefcase', links: [['Vendas', '/erp/sales.html', 'chart'], ['Orçamentos', '/erp/quotes.html', 'file'], ['Pedidos', '/erp/orders.html', 'box']] },
    { label: 'Assistência', icon: 'wrench', links: [['Ordens de serviço', '/erp/service-orders.html', 'wrench']] },
    { label: 'Cadastros', icon: 'users', links: [['Pessoas e clientes', '/erp/index.html#clients', 'users'], ['Produtos', '/erp/index.html#products', 'box'], ['Serviços', '/erp/index.html#services', 'wrench']] },
    { label: 'Operação', icon: 'warehouse', links: [['Estoque', '/erp/index.html#inventory', 'box'], ['Relatórios', '/erp/index.html#reports', 'chart']] },
    { label: 'Fiscal', icon: 'receipt', links: [['Central fiscal', '/erp/index.html#fiscal', 'receipt'], ['NF-e emitidas', '/erp/nfe-issued.html', 'file'], ['Rascunhos NF-e', '/erp/nfe-drafts.html', 'file'], ['Preparar NFS-e', '/erp/nfse-drafts.html', 'file'], ['Histórico fiscal', '/erp/fiscal-history.html', 'file'], ['Notas de entrada · XML', '/erp/inbound-nfe.html', 'file'], ['Naturezas e CFOP', '/erp/cfop.html', 'hash'], ['Perfis tributários', '/erp/tax-profiles.html', 'sliders']] },
  ];

  var currentPath = window.location.pathname.replace(/\/$/, '/index.html');
  var nav = document.createElement('header');
  nav.className = 'erp-global-nav';
  nav.innerHTML = '<a class="erp-global-brand" href="/erp/index.html"><img src="/branding/sigmafiscal-icon.svg" alt=""><span><strong>SigmaFiscal</strong><small>GESTÃO DA EMPRESA</small></span></a>' +
    '<button class="erp-nav-toggle" type="button" aria-expanded="false" aria-controls="erpGlobalLinks">Menu</button>' +
    '<nav class="erp-global-links" id="erpGlobalLinks" aria-label="Módulos do sistema"></nav>' +
    '<div class="erp-global-actions"></div>';
  var linksRoot = nav.querySelector('.erp-global-links');
  function closeOpenGroups(except) {
    linksRoot.querySelectorAll('details[open]').forEach(function (group) {
      if (group !== except) group.open = false;
    });
  }
  var workspaceMenu;
  function closeWorkspaceMenu() { if (workspaceMenu) workspaceMenu.open = false; }
  function normalizePath(path) {
    var clean = path.replace(/\/$/, '');
    if (!clean || clean === '/erp') return '/erp/index';
    return clean.replace(/\.html$/, '');
  }
  var normalizedCurrentPath = normalizePath(currentPath);
  var overview = document.createElement('a');
  overview.href = '/erp/index.html';
  addIconLabel(overview, 'Visão geral', 'grid');
  if (normalizedCurrentPath === normalizePath('/erp/index.html')) overview.setAttribute('aria-current', 'page');
  linksRoot.appendChild(overview);
  groups.forEach(function (group) {
    var details = document.createElement('details');
    var summary = document.createElement('summary');
    addIconLabel(summary, group.label, group.icon);
    var menu = document.createElement('div');
    group.links.forEach(function (entry) {
      var link = document.createElement('a');
      link.href = entry[1];
      addIconLabel(link, entry[0], entry[2]);
      var target = new URL(link.href, window.location.origin);
      if (normalizePath(target.pathname) === normalizedCurrentPath && target.hash === window.location.hash) {
        link.setAttribute('aria-current', 'page');
        details.classList.add('has-active');
      }
      menu.appendChild(link);
    });
    details.addEventListener('toggle', function () { if (details.open) { closeOpenGroups(details); closeWorkspaceMenu(); } });
    details.append(summary, menu);
    linksRoot.appendChild(details);
  });
  var shortcutIcons = {
    '/erp/sales.html': 'chart',
    '/erp/quotes.html': 'file',
    '/erp/orders.html': 'box'
  };
  document.querySelectorAll('.commercial-switcher a').forEach(function (link) {
    var path = new URL(link.href, window.location.origin).pathname;
    if (shortcutIcons[path] && !link.querySelector('.erp-nav-icon')) link.prepend(makeIcon(shortcutIcons[path]));
  });

  var actions = nav.querySelector('.erp-global-actions');
  workspaceMenu = document.createElement('details');
  workspaceMenu.className = 'erp-workspace-menu';
  workspaceMenu.setAttribute('aria-label', 'Menu da empresa ativa');
  workspaceMenu.innerHTML = '<summary class="erp-workspace-switch" aria-label="Abrir menu da empresa ativa"><span class="erp-workspace-avatar" id="erpWorkspaceAvatar"><img id="erpWorkspaceLogo" alt=""><span id="erpWorkspaceInitials">SF</span></span><span class="erp-workspace-name"><strong id="erpWorkspaceName">Minha empresa</strong><small>Empresa ativa</small></span></summary>';
  var workspacePopover = document.createElement('div');
  workspacePopover.className = 'erp-workspace-popover';
  function workspaceLink(label, href, iconName, className) {
    var link = document.createElement('a');
    link.href = href;
    if (className) link.className = className;
    addIconLabel(link, label, iconName);
    return link;
  }
  workspacePopover.appendChild(workspaceLink('Editar perfil', '/erp/index.html#profile', 'user'));
  workspacePopover.appendChild(workspaceLink('Empresa e sistema', '/erp/index.html#settings', 'building'));
  workspacePopover.appendChild(workspaceLink('Sair da conta', '/logout', 'logout', 'erp-workspace-logout'));
  workspaceMenu.appendChild(workspacePopover);
  workspaceMenu.addEventListener('toggle', function () { if (workspaceMenu.open) closeOpenGroups(); });
  actions.appendChild(workspaceMenu);

  var theme = document.querySelector('[data-theme-toggle]');
  if (!theme) {
    theme = document.createElement('button');
    theme.type = 'button'; theme.className = 'theme-toggle'; theme.setAttribute('data-theme-toggle', '');
    theme.setAttribute('aria-label', 'Alternar tema'); theme.textContent = '◐ Modo escuro';
  }
  theme.removeAttribute('style'); theme.classList.add('theme-toggle'); actions.appendChild(theme);
  var dashboardSearch = document.querySelector('.topbar-right .global-search');
  if (dashboardSearch) actions.insertBefore(dashboardSearch, workspaceMenu);
  if (document.querySelector('.app-shell')) document.body.classList.add('page-with-global-nav');
  mount.replaceWith(nav);

  fetch('/api/company', { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
    if (!response.ok) return null;
    return response.json();
  }).then(function (data) {
    var company = data && data.company ? data.company : {};
    var companyName = String(company.tradeName || company.legalName || '').trim() || 'Minha empresa';
    var name = nav.querySelector('#erpWorkspaceName');
    var initials = nav.querySelector('#erpWorkspaceInitials');
    var avatar = nav.querySelector('#erpWorkspaceAvatar');
    var logo = nav.querySelector('#erpWorkspaceLogo');
    if (name) name.textContent = companyName;
    if (initials) {
      var parts = companyName.split(/\s+/).filter(Boolean);
      initials.textContent = (parts.length > 1 ? parts[0][0] + parts[1][0] : companyName.slice(0, 2)).toUpperCase();
    }
    if (logo && avatar && data && data.status === 'ready') {
      logo.onload = function () { avatar.classList.add('has-logo'); };
      logo.onerror = function () { avatar.classList.remove('has-logo'); };
      logo.src = '/api/company/logo?v=' + Date.now();
    }
    var summary = workspaceMenu.querySelector('summary');
    if (summary) { summary.setAttribute('aria-label', 'Abrir menu da empresa ativa: ' + companyName); summary.title = companyName + ' · Empresa ativa'; }
  }).catch(function () {});


  var toggle = nav.querySelector('.erp-nav-toggle');
  toggle.addEventListener('click', function () {
    var expanded = nav.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', String(expanded));
    if (expanded) linksRoot.querySelector('a, summary')?.focus();
  });
  nav.addEventListener('click', function (event) {
    var anchor = event.target.closest('a');
    if (anchor) { closeOpenGroups(); closeWorkspaceMenu(); nav.classList.remove('menu-open'); toggle.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('.erp-global-links details')) closeOpenGroups();
    if (!event.target.closest('.erp-workspace-menu')) closeWorkspaceMenu();
    if (!nav.contains(event.target)) { nav.classList.remove('menu-open'); toggle.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      var opened = linksRoot.querySelector('details[open]');
      var workspaceWasOpen = workspaceMenu.open;
      var mobileMenuWasOpen = nav.classList.contains('menu-open');
      closeOpenGroups();
      closeWorkspaceMenu();
      nav.classList.remove('menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      if (mobileMenuWasOpen) toggle.focus();
      else if (opened) opened.querySelector('summary')?.focus();
      else if (workspaceWasOpen) workspaceMenu.querySelector('summary')?.focus();
    }
  });
})();
