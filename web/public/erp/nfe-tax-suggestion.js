(function (root) {
  'use strict';

  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function resolve(product, recipient, issuerState, profiles) {
    var issuerUf = String(issuerState || '').trim().toUpperCase();
    var recipientUf = String(recipient && recipient.state || '').trim().toUpperCase();
    if (!product || !/^[A-Z]{2}$/.test(issuerUf) || !/^[A-Z]{2}$/.test(recipientUf))
      return { rule: null, operation: null, profile: null };

    var operation = issuerUf === recipientUf ? 'interna' : 'interestadual';
    var profile = (Array.isArray(profiles) ? profiles : []).find(function (entry) {
      return entry && entry.id === product.taxProfileId;
    }) || null;
    var profileRules = object(profile && profile.rules);
    var operations = object(profileRules.operations);
    var rule = object(operations[operation]);
    if (!Object.keys(rule).length) rule = null;
    return { rule: rule, operation: operation, profile: profile };
  }

  root.JvgNfeTaxSuggestion = { resolve: resolve };
})(typeof window !== 'undefined' ? window : globalThis);
