import {
  applyFormAddressToWiseAddress,
  ensureUsAddressStateField,
  guessWiseRecipientType,
  normalizeUsStateCode,
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

  it('adds a US state field when Wise address requirements omit it', () => {
    const fields = ensureUsAddressStateField(
      [
        { key: 'accountNumber', name: 'Account number' },
        { key: 'address.city', name: 'City' },
        { key: 'address.firstLine', name: 'Recipient address' },
        { key: 'address.postCode', name: 'Post code' },
      ],
      'US',
    );
    expect(fields.map((field) => field.key)).toEqual([
      'accountNumber',
      'address.city',
      'address.state',
      'address.firstLine',
      'address.postCode',
    ]);
    expect(fields.find((field) => field.key === 'address.state')).toMatchObject({
      name: 'State',
      required: true,
    });
    expect(
      ensureUsAddressStateField(
        [{ key: 'address.city', name: 'City' }],
        'GB',
      ).some((field) => field.key === 'address.state'),
    ).toBe(false);
  });

  it('nests form address fields, including state, into the Wise address', () => {
    expect(normalizeUsStateCode('Washington')).toBe('WA');
    const merged = applyFormAddressToWiseAddress(
      {
        country: 'US',
        city: 'Unknown',
        postCode: '00000',
        firstLine: 'Address on file',
      },
      {
        'address.city': 'BELLEVUE',
        'address.firstLine': '17305 NE 15TH ST',
        'address.postCode': '98008',
        'address.state': 'Washington',
        accountType: 'CHECKING',
      },
    );
    expect(merged.address).toEqual({
      country: 'US',
      city: 'BELLEVUE',
      postCode: '98008',
      firstLine: '17305 NE 15TH ST',
      state: 'WA',
    });
    expect(merged.extra).toEqual({ accountType: 'CHECKING' });
  });
});
