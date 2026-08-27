import {
  mapWiseReceivingAccount,
  parseWiseReceivingAccounts,
  pickWiseReceivingAccount,
} from './wise-receiving-details';

const wisePayload = [
  {
    id: 14000001,
    currency: { code: 'EUR', name: 'Euro' },
    title: 'Your EUR account details',
    status: 'ACTIVE',
    deprecated: false,
    receiveOptions: [
      {
        type: 'LOCAL',
        title: 'Local',
        details: [
          { type: 'ACCOUNT_HOLDER', title: 'Account holder', body: 'SKYGLOBAL, LLC' },
          { type: 'SWIFT_CODE', title: 'SWIFT/BIC', body: 'TRWIBEB1XXX' },
          { type: 'IBAN', title: 'IBAN', body: 'BE12345678901234' },
          {
            type: 'BANK_NAME_AND_ADDRESS',
            title: 'Bank',
            body: 'Wise\nRue du Trône 100, Brussels',
          },
        ],
      },
    ],
  },
  {
    id: null,
    currency: { code: 'USD', name: 'US Dollar' },
    title: 'Your USD account details',
    status: 'AVAILABLE',
    receiveOptions: [],
  },
];

describe('wise receiving details', () => {
  it('extracts IBAN and currency.code from the Wise account-details payload', () => {
    const mapped = mapWiseReceivingAccount(wisePayload[0]);
    expect(mapped).toMatchObject({
      currency: 'EUR',
      accountName: 'Your EUR account details',
      accountHolderName: 'SKYGLOBAL, LLC',
      iban: 'BE12345678901234',
      swiftBic: 'TRWIBEB1XXX',
      bankName: 'Wise',
      country: 'BE',
      issued: true,
    });
  });

  it('does not treat example AVAILABLE accounts as issued receiving details', () => {
    const mapped = mapWiseReceivingAccount(wisePayload[1]);
    expect(mapped?.issued).toBe(false);
    expect(mapped?.currency).toBe('USD');
  });

  it('prefers an issued account with bank details over a USD preview', () => {
    const accounts = parseWiseReceivingAccounts(wisePayload);
    const picked = pickWiseReceivingAccount(accounts, 'USD');
    expect(picked?.currency).toBe('EUR');
    expect(picked?.iban).toBe('BE12345678901234');
  });
});
