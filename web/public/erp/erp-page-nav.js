(function () {
  'use strict';
  var mount = document.getElementById('erpGlobalNav');
  if (!mount) return;

  var groups = [
    { label: 'Comercial', links: [['Vendas', '/erp/sales.html'], ['Orçamentos', '/erp/quotes.html'], ['Pedidos', '/erp/orders.html']] },
    { label: 'Assistência', links: [['Ordens de serviço', '/erp/service-orders.html']] },
    { label: 'Cadastros', links: [['Pessoas e clientes', '/erp/index.html#clients'], ['Produtos', '/erp/index.html#products'], ['Serviços', '/erp/index.html#services']] },
    { label: 'Operação', links: [['Estoque', '/erp/index.html#inventory'], ['Relatórios', '/erp/index.html#reports']] },
    { label: 'Fiscal', links: [['Central fiscal', '/erp/index.html#fiscal'], ['Rascunhos NF-e', '/erp/nfe-drafts.html'], ['CFOP', '/erp/cfop.html'], ['Perfis tributários', '/erp/tax-profiles.html']] },
    { label: 'Conta', links: [['Meu perfil', '/erp/index.html#profile'], ['Empresa e sistema', '/erp/index.html#settings']] },
  ];
  var currentPath = window.location.pathname.replace(/\/$/, '/index.html');
  var nav = document.createElement('header');
  nav.className = 'erp-global-nav';
  nav.innerHTML = '<a class="erp-global-brand" href="/erp/index.html"><img src="/branding/sigmafiscal-icon.svg" alt=""><span><strong>SigmaFiscal</strong><small>GESTÃO DA EMPRESA</small></span></a>' +
    '<button class="erp-nav-toggle" type="button" aria-expanded="false" aria-controls="erpGlobalLinks">Menu</button>' +
    '<nav class="erp-global-links" id="erpGlobalLinks" aria-label="Módulos do sistema"></nav>' +
    '<div class="erp-global-actions"></div>';
  var linksRoot = nav.querySelector('.erp-global-links');
  var overview = document.createElement('a');
  overview.href = '/erp/index.html'; overview.textContent = 'Visão geral';
  if (currentPath === '/erp/index.html') overview.setAttribute('aria-current', 'page');
  linksRoot.appendChild(overview);
  groups.forEach(function (group) {
    var details = document.createElement('details');
    var summary = document.createElement('summary'); summary.textContent = group.label;
    var menu = document.createElement('div');
    group.links.forEach(function (entry) {
      var link = document.createElement('a'); link.href = entry[1]; link.textContent = entry[0];
      var target = new URL(link.href, window.location.origin);
      if (target.pathname === currentPath && target.hash === window.location.hash) {
        link.setAttribute('aria-current', 'page');
        details.classList.add('has-active');
      }
      menu.appendChild(link);
    });
    details.addEventListener('toggle', function () {
      if (details.open) linksRoot.querySelectorAll('details[open]').forEach(function (other) { if (other !== details) other.open = false; });
    });
    details.append(summary, menu); linksRoot.appendChild(details);
  });

  var actions = nav.querySelector('.erp-global-actions');
  var theme = document.querySelector('[data-theme-toggle]');
  if (!theme) {
    theme = document.createElement('button');
    theme.type = 'button'; theme.className = 'theme-toggle'; theme.setAttribute('data-theme-toggle', '');
    theme.setAttribute('aria-label', 'Alternar tema'); theme.textContent = '◐ Modo escuro';
  }
  theme.removeAttribute('style'); theme.classList.add('theme-toggle'); actions.appendChild(theme);
  mount.replaceWith(nav);

  var toggle = nav.querySelector('.erp-nav-toggle');
  toggle.addEventListener('click', function () {
    var expanded = nav.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', String(expanded));
    if (expanded) linksRoot.querySelector('a, summary')?.focus();
  });
  nav.addEventListener('click', function (event) {
    var anchor = event.target.closest('a');
    if (anchor) { nav.classList.remove('menu-open'); toggle.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { nav.classList.remove('menu-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
  });
})();
