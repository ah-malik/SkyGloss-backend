import {
  guessWiseRecipientType,
  pickWiseAccountRequirement,
  sanitizePayoutCurrency,
  toIsoCountryCode,
} from './wise-country-iso';

describe('UAE / Wise currency helpers', () => {
  it('maps UAE country names to AE / AED', () => {
    expect(toIsoCountryCode('UAE')).toBe('AE');
    expect(toIsoCountryCode('United Arab Emirates')).toBe('AE');
    expect(sanitizePayoutCurrency(undefined, 'UAE')).toBe('AED');
    expect(sanitizePayoutCurrency('UAE', 'United Arab Emirates')).toBe('AED');
  });

  it('does not send country codes as ISO currencies', () => {
    expect(sanitizePayoutCurrency('UAE', 'UAE')).toBe('AED');
    expect(sanitizePayoutCurrency('USA', 'United States')).toBe('USD');
    expect(sanitizePayoutCurrency('AED', 'UAE')).toBe('AED');
  });

  it('prefers emirates over iban for AED', () => {
    const selected = pickWiseAccountRequirement(
      [{ type: 'iban' }, { type: 'emirates' }, { type: 'swift_code' }],
      'AED',
    );
    expect(selected?.type).toBe('emirates');
    expect(guessWiseRecipientType({ currency: 'AED', iban: 'AE070331234567890123456' })).toBe(
      'emirates',
    );
  });

  it('uses iban type for PKR IBANs (pakistan local type is not creatable on this Wise profile)', () => {
    expect(
      guessWiseRecipientType({
        currency: 'PKR',
        iban: 'PK36SCBL0000001123456702',
      }),
    ).toBe('iban');
    expect(
      pickWiseAccountRequirement(
        [{ type: 'iban' }, { type: 'pakistan' }, { type: 'swift_code' }],
        'PKR',
      )?.type,
    ).toBe('iban');
  });
});
