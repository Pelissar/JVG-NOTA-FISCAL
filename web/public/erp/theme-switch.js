(function () {
  'use strict';
  var KEY = 'sigmafiscal-theme';
  function saved() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }
  function apply(value) {
    var mode = value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = mode;
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = mode === 'dark' ? '#121a23' : '#f4f6f8';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.textContent = mode === 'dark' ? '☀ Modo claro' : '◐ Modo escuro';
      button.setAttribute('aria-label', mode === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
      button.setAttribute('aria-pressed', String(mode === 'dark'));
      button.title = mode === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro';
    });
  }
  apply(saved() || 'light');
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    var next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (_) { /* Tema continua ativo nesta página. */ }
    apply(next);
  });
  document.addEventListener('DOMContentLoaded', function () { apply(saved() || 'light'); });
})();
