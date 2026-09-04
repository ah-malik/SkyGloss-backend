import {
  isOmittedBankSecret,
  keepOrReplaceBankSecret,
  mergeExtraBankDetails,
} from './bank-secret';

describe('bank secret merge', () => {
  it('treats masked last4 as omitted', () => {
    expect(isOmittedBankSecret('****1234')).toBe(true);
    expect(isOmittedBankSecret('****')).toBe(true);
    expect(isOmittedBankSecret('  ')).toBe(true);
    expect(isOmittedBankSecret('DE89370400440532013000')).toBe(false);
  });

  it('keeps existing IBAN when the user does not re-enter it', () => {
    expect(keepOrReplaceBankSecret('', 'DE89370400440532013000')).toBe(
      'DE89370400440532013000',
    );
    expect(keepOrReplaceBankSecret('****1300', 'DE89370400440532013000')).toBe(
      'DE89370400440532013000',
    );
  });

  it('merges extra fields without dropping stored values', () => {
    expect(
      mergeExtraBankDetails(
        { bankCode: '' },
        { bankCode: 'HABB', accountType: 'CHECKING' },
      ),
    ).toEqual({ bankCode: 'HABB', accountType: 'CHECKING' });
  });
});
