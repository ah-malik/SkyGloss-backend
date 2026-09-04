/** Map country names (and common aliases) to ISO 3166-1 alpha-2 for Wise. */
const COUNTRY_ISO: Record<string, string> = {
  afghanistan: 'AF',
  albania: 'AL',
  algeria: 'DZ',
  andorra: 'AD',
  angola: 'AO',
  argentina: 'AR',
  armenia: 'AM',
  australia: 'AU',
  austria: 'AT',
  azerbaijan: 'AZ',
  bahrain: 'BH',
  bangladesh: 'BD',
  belarus: 'BY',
  belgium: 'BE',
  belize: 'BZ',
  bolivia: 'BO',
  'bosnia and herzegovina': 'BA',
  botswana: 'BW',
  brazil: 'BR',
  bulgaria: 'BG',
  cambodia: 'KH',
  cameroon: 'CM',
  canada: 'CA',
  chile: 'CL',
  china: 'CN',
  colombia: 'CO',
  'costa rica': 'CR',
  croatia: 'HR',
  cyprus: 'CY',
  'czech republic': 'CZ',
  czechia: 'CZ',
  denmark: 'DK',
  'dominican republic': 'DO',
  ecuador: 'EC',
  egypt: 'EG',
  estonia: 'EE',
  ethiopia: 'ET',
  finland: 'FI',
  france: 'FR',
  georgia: 'GE',
  germany: 'DE',
  ghana: 'GH',
  greece: 'GR',
  guatemala: 'GT',
  'hong kong': 'HK',
  hungary: 'HU',
  iceland: 'IS',
  india: 'IN',
  indonesia: 'ID',
  iran: 'IR',
  iraq: 'IQ',
  ireland: 'IE',
  israel: 'IL',
  italy: 'IT',
  jamaica: 'JM',
  japan: 'JP',
  jordan: 'JO',
  kazakhstan: 'KZ',
  kenya: 'KE',
  kuwait: 'KW',
  latvia: 'LV',
  lebanon: 'LB',
  lithuania: 'LT',
  luxembourg: 'LU',
  malaysia: 'MY',
  maldives: 'MV',
  malta: 'MT',
  mauritius: 'MU',
  mexico: 'MX',
  moldova: 'MD',
  monaco: 'MC',
  mongolia: 'MN',
  morocco: 'MA',
  mozambique: 'MZ',
  myanmar: 'MM',
  nepal: 'NP',
  netherlands: 'NL',
  'new zealand': 'NZ',
  nigeria: 'NG',
  norway: 'NO',
  oman: 'OM',
  pakistan: 'PK',
  panama: 'PA',
  paraguay: 'PY',
  peru: 'PE',
  philippines: 'PH',
  poland: 'PL',
  portugal: 'PT',
  qatar: 'QA',
  romania: 'RO',
  russia: 'RU',
  'saudi arabia': 'SA',
  serbia: 'RS',
  singapore: 'SG',
  slovakia: 'SK',
  slovenia: 'SI',
  'south africa': 'ZA',
  'south korea': 'KR',
  korea: 'KR',
  spain: 'ES',
  'sri lanka': 'LK',
  sweden: 'SE',
  switzerland: 'CH',
  taiwan: 'TW',
  tanzania: 'TZ',
  thailand: 'TH',
  tunisia: 'TN',
  turkey: 'TR',
  'türkiye': 'TR',
  uganda: 'UG',
  ukraine: 'UA',
  'united arab emirates': 'AE',
  uae: 'AE',
  emirates: 'AE',
  'the united arab emirates': 'AE',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  us: 'US',
  uruguay: 'UY',
  uzbekistan: 'UZ',
  venezuela: 'VE',
  vietnam: 'VN',
  'viet nam': 'VN',
  yemen: 'YE',
  zambia: 'ZM',
  zimbabwe: 'ZW',
};

export function toIsoCountryCode(country?: string | null): string | null {
  const raw = (country || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const key = raw.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
  return COUNTRY_ISO[key] || null;
}

/** Best-effort IBAN country → default payout currency. */
const ISO_CURRENCY: Record<string, string> = {
  AT: 'EUR',
  BE: 'EUR',
  CY: 'EUR',
  DE: 'EUR',
  EE: 'EUR',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GR: 'EUR',
  IE: 'EUR',
  IT: 'EUR',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  MT: 'EUR',
  NL: 'EUR',
  PT: 'EUR',
  SI: 'EUR',
  SK: 'EUR',
  GB: 'GBP',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BG: 'BGN',
  AE: 'AED',
  SA: 'SAR',
  PK: 'PKR',
  IN: 'INR',
  AU: 'AUD',
  NZ: 'NZD',
  CA: 'CAD',
  US: 'USD',
  JP: 'JPY',
  CN: 'CNY',
  KR: 'KRW',
  TR: 'TRY',
  MX: 'MXN',
  BR: 'BRL',
  ZA: 'ZAR',
  NG: 'NGN',
  KE: 'KES',
  EG: 'EGP',
  BD: 'BDT',
  PH: 'PHP',
  TH: 'THB',
  MY: 'MYR',
  SG: 'SGD',
  HK: 'HKD',
  ID: 'IDR',
  VN: 'VND',
  QA: 'QAR',
  KW: 'KWD',
  BH: 'BHD',
  OM: 'OMR',
  JO: 'JOD',
  LB: 'LBP',
};

export function currencyFromIban(iban?: string | null): string | null {
  const code = (iban || '').replace(/\s/g, '').slice(0, 2).toUpperCase();
  if (code.length !== 2) return null;
  return ISO_CURRENCY[code] || null;
}

/** Default local currency guess from country. Wise requirements remain the source of truth. */
export function defaultCurrencyForCountry(country?: string | null): string | null {
  const iso = toIsoCountryCode(country);
  if (!iso) return null;
  return ISO_CURRENCY[iso] || null;
}

/** ISO 3166 country alpha-3 codes that are NOT ISO 4217 currencies (e.g. UAE ≠ AED). */
const COUNTRY_ALPHA3_NOT_CURRENCY = new Set([
  'UAE',
  'USA',
  'GBR',
  'IND',
  'SAU',
  'PAK',
  'CAN',
  'AUS',
  'DEU',
  'FRA',
  'ITA',
  'ESP',
  'NLD',
  'CHE',
  'CHN',
  'JPN',
  'KOR',
  'EGY',
  'QAT',
  'KWT',
  'BHR',
  'OMN',
  'JOR',
  'LBN',
  'TUR',
  'ARE',
]);

export function sanitizePayoutCurrency(
  currency?: string | null,
  country?: string | null,
): string {
  const raw = (currency || '').trim().toUpperCase();
  const fromCountry = defaultCurrencyForCountry(country);
  if (
    /^[A-Z]{3}$/.test(raw) &&
    !COUNTRY_ALPHA3_NOT_CURRENCY.has(raw)
  ) {
    return raw;
  }
  if (fromCountry) return fromCountry;
  return 'USD';
}

const PREFERRED_WISE_TYPE: Record<string, string[]> = {
  AED: ['emirates'],
  USD: ['aba'],
  GBP: ['sort_code'],
  EUR: ['iban'],
  INR: ['indian'],
  AUD: ['australian'],
  CAD: ['canadian'],
  PKR: ['iban', 'pakistan'],
  SAR: ['iban', 'saudiarabia'],
  QAR: ['iban'],
  EGP: ['iban', 'egyptlocal'],
};

export function pickWiseAccountRequirement<T extends { type: string }>(
  options: T[],
  currency: string,
): T | undefined {
  if (!options.length) return undefined;
  const code = (currency || '').toUpperCase();
  for (const type of PREFERRED_WISE_TYPE[code] || []) {
    const match = options.find((o) => o.type === type);
    if (match) return match;
  }
  if (code === 'AED') {
    const emirates = options.find((o) => o.type === 'emirates');
    if (emirates) return emirates;
  }
  if (code !== 'EUR' && code !== 'GBP') {
    const local = options.find(
      (o) => o.type && o.type !== 'iban' && o.type !== 'swift_code',
    );
    if (local) return local;
  }
  return (
    options.find((o) => o.type === 'iban') ||
    options.find((o) => o.type === 'aba') ||
    options.find((o) => o.type === 'sort_code') ||
    options.find((o) => o.type === 'swift_code') ||
    options[0]
  );
}

export function guessWiseRecipientType(input: {
  currency: string;
  iban?: string;
  accountNumber?: string;
  routingNumber?: string;
  sortCode?: string;
  swiftBic?: string;
}): string {
  const currency = (input.currency || '').toUpperCase();
  if (currency === 'AED') return 'emirates';
  if (currency === 'USD' && input.routingNumber && input.accountNumber) {
    return 'aba';
  }
  if (currency === 'GBP' && (input.sortCode || input.routingNumber) && input.accountNumber) {
    return 'sort_code';
  }
  if (currency === 'EUR' && input.iban) return 'iban';
  if (input.iban && (PREFERRED_WISE_TYPE[currency] || []).includes('iban')) {
    return 'iban';
  }
  if (input.iban && currency !== 'AED') return 'iban';
  if (input.swiftBic && input.accountNumber) return 'swift_code';
  if (input.accountNumber) return 'swift_code';
  return 'iban';
}

/** Wise Confirmation of Payee / live existence checks. Other currencies are format + payout-time. */
export const WISE_LIVE_ACCOUNT_CHECK_CURRENCIES = [
  'EUR',
  'INR',
  'IDR',
  'CNY',
  'KRW',
] as const;

export function wiseSupportsLiveAccountCheck(currency?: string | null): boolean {
  const code = (currency || '').trim().toUpperCase();
  return (WISE_LIVE_ACCOUNT_CHECK_CURRENCIES as readonly string[]).includes(code);
}
