import {
  DOLLAR_ISO_CURRENCIES,
  DEFAULT_EXCHANGE_RATES,
  getCurrencyDisplaySymbol,
  isUsdCurrency,
  normalizeCurrencyCode,
} from './currency-codes';

describe('currency-codes', () => {
  it('keeps ISO codes distinct', () => {
    expect(normalizeCurrencyCode('CAD')).toBe('CAD');
    expect(normalizeCurrencyCode('AUD')).toBe('AUD');
    expect(normalizeCurrencyCode('USD')).toBe('USD');
  });

  it('uses different display symbols for dollar currencies', () => {
    expect(getCurrencyDisplaySymbol('USD')).toBe('$');
    expect(getCurrencyDisplaySymbol('CAD')).toBe('CA$');
    expect(getCurrencyDisplaySymbol('AUD')).toBe('A$');
  });

  it('does not treat CAD/AUD as USD', () => {
    expect(isUsdCurrency('CAD')).toBe(false);
    expect(isUsdCurrency('AUD')).toBe(false);
    expect(isUsdCurrency('USD')).toBe(true);
  });

  it('includes major dollar ISO codes', () => {
    expect(DOLLAR_ISO_CURRENCIES.has('CAD')).toBe(true);
    expect(DOLLAR_ISO_CURRENCIES.has('AUD')).toBe(true);
    expect(DEFAULT_EXCHANGE_RATES.CAD).toBeGreaterThan(0);
    expect(DEFAULT_EXCHANGE_RATES.AUD).toBeGreaterThan(0);
    expect(DEFAULT_EXCHANGE_RATES.CAD).not.toBe(1);
    expect(DEFAULT_EXCHANGE_RATES.AUD).not.toBe(1);
  });
});
