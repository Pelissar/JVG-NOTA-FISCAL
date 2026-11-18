import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRtcValue,
  rtcCalendarDate,
  rtcCalculatorUrl,
  rtcDecimal,
  rtcOffsetDateTime,
  rtcRegularNominalRates,
  rtcSubmittedOrFallback,
} from '../lib/fiscal/rtc-calculator.ts';

test('RTC endpoints are constrained to supported HTTPS roots and API paths', () => {
  assert.equal(rtcCalculatorUrl('https://rtc.example/api', 'versao').pathname, '/api/versao');
  assert.equal(rtcCalculatorUrl('https://rtc.example/api/calculadora', 'calculadora/observabilidade/regime-geral').pathname,
    '/api/calculadora/observabilidade/regime-geral');
  assert.throws(() => rtcCalculatorUrl('http://rtc.example', 'versao'));
  assert.throws(() => rtcCalculatorUrl('https://user:pass@rtc.example', 'versao'));
  assert.throws(() => rtcCalculatorUrl('https://rtc.example', 'versao?redirect=1'));
});

test('RTC decimal parser preserves string values and rejects locale/grouping forms', () => {
  assert.equal(rtcDecimal('1234.50', 'base'), '1234.50');
  assert.equal(rtcDecimal('', 'taxa', { required: false }), null);
  assert.throws(() => rtcDecimal('1.234,50', 'base'));
  assert.throws(() => rtcDecimal('-1', 'base'));
});

test('RTC date and offset date-time validators reject impossible dates and offsets', () => {
  assert.equal(rtcCalendarDate('2026-11-17'), '2026-11-17');
  assert.equal(rtcCalendarDate('2026-02-30'), null);
  assert.equal(rtcOffsetDateTime('2026-11-17T12:30:00-03:00'), '2026-11-17T12:30:00-03:00');
  assert.equal(rtcOffsetDateTime('2026-11-17T12:30:00'), null);
  assert.equal(rtcOffsetDateTime('2026-11-17T12:30:00+19:00'), null);
});

test('explicitly blank item values do not silently fall back to product data', () => {
  assert.equal(rtcSubmittedOrFallback({ cClassTrib: '' }, 'cClassTrib', '000001'), '');
  assert.equal(rtcSubmittedOrFallback({}, 'cClassTrib', '000001'), '000001');
  assert.equal(hasRtcValue(null), false);
  assert.equal(hasRtcValue('0'), true);
});

test('regular nominal rates stay omitted in 2026 and reject partial values', () => {
  assert.equal(rtcRegularNominalRates({}, 2026, 1), null);
  assert.throws(() => rtcRegularNominalRates({ cbs: '1' }, 2026, 1), /até 2026/);
  assert.throws(() => rtcRegularNominalRates({ cbs: '1' }, 2027, 1), /IBS estadual, IBS municipal/);
  // Values below are synthetic parser inputs, not fiscal guidance or rates for any operation.
  assert.deepEqual(rtcRegularNominalRates({ cbs: '1', ibsEstadual: '2', ibsMunicipal: '3' }, 2027, 1), {
    cbs: 1, ibsEstadual: 2, ibsMunicipal: 3,
  });
});
