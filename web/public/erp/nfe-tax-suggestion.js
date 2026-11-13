(function (root) {
  'use strict';

  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function resolve(product, cfop, profiles) {
    var code = String(cfop || '').trim();
    var operation = code[0] === '5' ? 'interna' : code[0] === '6' ? 'interestadual' : null;
    if (!product)
      return { rule: null, operation: null, profile: null };
    var profile = (Array.isArray(profiles) ? profiles : []).find(function (entry) {
      return entry && entry.id === product.taxProfileId;
    }) || null;
    if (!operation || !/^\d{4}$/.test(code))
      return { rule: null, operation: null, profile: profile };
    var profileRules = object(profile && profile.rules);
    var operations = object(profileRules.operations);
    var rule = object(operations[operation]);
    if (!Object.keys(rule).length) rule = null;
    return { rule: rule, operation: operation, profile: profile };
  }

  root.JvgNfeTaxSuggestion = { resolve: resolve };
})(typeof window !== 'undefined' ? window : globalThis);
