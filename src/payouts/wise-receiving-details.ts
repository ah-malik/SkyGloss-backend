import { isValidCurrency, normalizeCurrency } from './stripe-wise-payouts.logic';

export type WiseReceivingAccount = {
  currency: string;
  accountName?: string;
  accountHolderName?: string;
  bankName?: string;
  country?: string;
  iban?: string;
  accountNumber?: string;
  routingNumber?: string;
  sortCode?: string;
  swiftBic?: string;
  issued: boolean;
  status?: string;
};

const DETAIL_KEY: Record<string, keyof Pick<
  WiseReceivingAccount,
  | 'iban'
  | 'accountNumber'
  | 'routingNumber'
  | 'sortCode'
  | 'swiftBic'
  | 'accountHolderName'
  | 'bankName'
  | 'country'
>> = {
  IBAN: 'iban',
  ACCOUNT_NUMBER: 'accountNumber',
  ACCOUNTNUMBER: 'accountNumber',
  ACCOUNT: 'accountNumber',
  ACH_ROUTING_NUMBER: 'routingNumber',
  ACHROUTINGNUMBER: 'routingNumber',
  ROUTING_NUMBER: 'routingNumber',
  ROUTINGNUMBER: 'routingNumber',
  WIRE_ROUTING_NUMBER: 'routingNumber',
  ABA: 'routingNumber',
  ABARTN: 'routingNumber',
  SORT_CODE: 'sortCode',
  SORTCODE: 'sortCode',
  SWIFT_CODE: 'swiftBic',
  SWIFT: 'swiftBic',
  SWIFT_BIC: 'swiftBic',
  BIC: 'swiftBic',
  ACCOUNT_HOLDER: 'accountHolderName',
  ACCOUNT_HOLDER_NAME: 'accountHolderName',
  ACCOUNTHOLDER: 'accountHolderName',
  ACCOUNTHOLDERNAME: 'accountHolderName',
  BANK_NAME: 'bankName',
  BANKNAME: 'bankName',
  BANK_NAME_AND_ADDRESS: 'bankName',
  COUNTRY: 'country',
  BANK_COUNTRY: 'country',
  COUNTRY_CODE: 'country',
};

function asText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

function normalizeDetailType(value: unknown): string {
  return asText(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function applyDetail(
  target: WiseReceivingAccount,
  type: unknown,
  value: unknown,
) {
  const key = DETAIL_KEY[normalizeDetailType(type)];
  const text = asText(value);
  if (!key || !text || target[key]) return;
  if (key === 'bankName') {
    target.bankName = text.split('\n')[0].trim();
    return;
  }
  target[key] = text;
}

export function mapWiseReceivingAccount(row: any): WiseReceivingAccount | null {
  const currency = normalizeCurrency(
    row?.currency?.code || row?.currency || row?.details?.currency,
  );
  if (!currency) return null;

  const mapped: WiseReceivingAccount = {
    currency,
    accountName: asText(row?.title || row?.name) || `Wise ${currency} account`,
    issued: row?.id != null && String(row.status || '').toUpperCase() !== 'AVAILABLE',
    status: asText(row?.status).toUpperCase() || undefined,
  };

  const options = Array.isArray(row?.receiveOptions) ? row.receiveOptions : [];
  const ordered = [...options].sort((a, b) => {
    if (a?.type === 'LOCAL' && b?.type !== 'LOCAL') return -1;
    if (b?.type === 'LOCAL' && a?.type !== 'LOCAL') return 1;
    return 0;
  });

  for (const opt of ordered) {
    if (Array.isArray(opt?.details)) {
      for (const detail of opt.details) {
        applyDetail(
          mapped,
          detail?.type || detail?.title,
          detail?.body || detail?.value,
        );
      }
    } else if (opt?.details && typeof opt.details === 'object') {
      for (const [type, value] of Object.entries(opt.details)) {
        applyDetail(mapped, type, value);
      }
    }
    applyDetail(mapped, opt?.description?.cta?.label, opt?.description?.cta?.content);
  }

  if (!mapped.iban && asText(row?.iban)) mapped.iban = asText(row.iban);
  if (!mapped.accountNumber && asText(row?.accountNumber)) {
    mapped.accountNumber = asText(row.accountNumber);
  }
  if (!mapped.accountHolderName) {
    mapped.accountHolderName = asText(
      row?.accountHolderName || row?.details?.accountHolderName,
    );
  }
  if (!mapped.bankName) {
    mapped.bankName = asText(row?.bankName);
  }
  if (!mapped.country) {
    mapped.country = asText(
      row?.country || row?.details?.bankCountry || row?.details?.country,
    );
  }
  if (!mapped.country && mapped.iban && /^[A-Z]{2}/i.test(mapped.iban)) {
    mapped.country = mapped.iban.slice(0, 2).toUpperCase();
  }

  return mapped;
}

export function parseWiseReceivingAccounts(payload: unknown): WiseReceivingAccount[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.accountDetails)
      ? (payload as any).accountDetails
      : [];
  return rows
    .filter((row: any) => row && row.deprecated !== true)
    .map((row: any) => mapWiseReceivingAccount(row))
    .filter((row): row is WiseReceivingAccount => Boolean(row?.currency));
}

export function pickWiseReceivingAccount(
  accounts: WiseReceivingAccount[],
  preferredCurrency?: string,
): WiseReceivingAccount | undefined {
  const usable = accounts.filter(
    (item) => item.issued && (item.iban || item.accountNumber),
  );
  const pool = usable.length ? usable : accounts.filter((item) => item.issued);
  const wanted = normalizeCurrency(preferredCurrency);
  if (wanted && isValidCurrency(wanted)) {
    const match = pool.find((item) => item.currency === wanted);
    if (match) return match;
  }
  return pool.find((item) => item.currency === 'USD') || pool[0];
}

export function hasReceivingBankDetails(account?: WiseReceivingAccount | null): boolean {
  return Boolean(account?.iban || account?.accountNumber);
}
