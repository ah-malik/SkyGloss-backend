import axios from 'axios';
import { isEuropeCountryName } from '../payouts/stripe-wise-payouts.logic';

const VIES_CHECK_URL =
  'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

/**
 * VIES country codes for countries in the existing EUROPE_COUNTRY_NAMES list.
 * Greece uses EL (not GR). Norway/Switzerland are in the Europe list but not
 * covered by VIES — null means require VAT presence only, skip remote check.
 */
const EUROPE_COUNTRY_TO_VIES_CODE: Record<string, string | null> = {
  austria: 'AT',
  belgium: 'BE',
  croatia: 'HR',
  cyprus: 'CY',
  'czech republic': 'CZ',
  czechia: 'CZ',
  denmark: 'DK',
  estonia: 'EE',
  finland: 'FI',
  france: 'FR',
  germany: 'DE',
  greece: 'EL',
  hungary: 'HU',
  ireland: 'IE',
  italy: 'IT',
  latvia: 'LV',
  lithuania: 'LT',
  luxembourg: 'LU',
  malta: 'MT',
  netherlands: 'NL',
  holland: 'NL',
  'the netherlands': 'NL',
  poland: 'PL',
  portugal: 'PT',
  romania: 'RO',
  slovakia: 'SK',
  slovenia: 'SI',
  spain: 'ES',
  sweden: 'SE',
  norway: null,
  switzerland: null,
};

/** Accept ISO-2 codes when country fields store DE/FR instead of full names. */
const EUROPE_ISO_TO_VIES_CODE: Record<string, string | null> = {
  AT: 'AT',
  BE: 'BE',
  HR: 'HR',
  CY: 'CY',
  CZ: 'CZ',
  DK: 'DK',
  EE: 'EE',
  FI: 'FI',
  FR: 'FR',
  DE: 'DE',
  GR: 'EL',
  EL: 'EL',
  HU: 'HU',
  IE: 'IE',
  IT: 'IT',
  LV: 'LV',
  LT: 'LT',
  LU: 'LU',
  MT: 'MT',
  NL: 'NL',
  PL: 'PL',
  PT: 'PT',
  RO: 'RO',
  SK: 'SK',
  SI: 'SI',
  ES: 'ES',
  SE: 'SE',
  NO: null,
  CH: null,
};

export type ViesVatValidationResult =
  | { ok: true; normalizedVat: string; viesCountryCode?: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'unavailable'; message: string };

/** Resolve shipping destination the same way Europe Stripe routing does. */
export function resolveOrderDestinationCountry(
  shippingCountry?: string | null,
  userCountry?: string | null,
): string {
  const shipping = String(shippingCountry || '').trim();
  if (shipping) return shipping;
  return String(userCountry || '').trim();
}

export function requiresEuropeanVat(
  shippingCountry?: string | null,
  userCountry?: string | null,
): boolean {
  return isEuropeCountryName(
    resolveOrderDestinationCountry(shippingCountry, userCountry),
  );
}

export function getViesCountryCode(country?: string | null): string | null | undefined {
  const raw = String(country || '').trim();
  if (!raw) return undefined;

  const key = raw.toLowerCase();
  if (key in EUROPE_COUNTRY_TO_VIES_CODE) {
    return EUROPE_COUNTRY_TO_VIES_CODE[key];
  }

  const iso = raw.toUpperCase();
  if (iso in EUROPE_ISO_TO_VIES_CODE) {
    return EUROPE_ISO_TO_VIES_CODE[iso];
  }

  return undefined;
}

/**
 * Normalize a VAT / tax ID: strip spaces/punctuation, uppercase.
 * Also strip a leading country prefix when it matches the expected VIES code.
 */
export function normalizeVatNumber(
  taxId: string,
  viesCountryCode?: string | null,
): string {
  let value = String(taxId || '')
    .toUpperCase()
    .replace(/[\s.\-/]/g, '');

  if (viesCountryCode && value.startsWith(viesCountryCode)) {
    value = value.slice(viesCountryCode.length);
  }
  // Greece users often type GR… while VIES expects EL
  if (viesCountryCode === 'EL' && value.startsWith('GR')) {
    value = value.slice(2);
  }
  return value;
}

export function formatVatForStorage(
  taxId: string,
  viesCountryCode?: string | null,
): string {
  const normalized = normalizeVatNumber(taxId, viesCountryCode);
  if (!normalized) return '';
  if (viesCountryCode) return `${viesCountryCode}${normalized}`;
  return normalized;
}

/** VIES sometimes returns error as string, actionError, errorWrappers, or error[]. */
function extractViesErrorCode(data: any): string {
  const candidates: unknown[] = [
    data?.actionError,
    data?.errorWrappers?.[0]?.error,
    data?.errorWrappers?.[0]?.message,
  ];

  if (Array.isArray(data?.error)) {
    candidates.push(data.error[0]?.error, data.error[0]?.message, data.error[0]);
  } else {
    candidates.push(data?.error);
  }

  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    if (typeof candidate === 'object') {
      const nested =
        (candidate as any).error ||
        (candidate as any).message ||
        (candidate as any).code;
      if (nested) return String(nested);
      continue;
    }
    return String(candidate);
  }
  return '';
}

function isViesUnavailableError(errorCode: string): boolean {
  const errorUpper = String(errorCode || '').toUpperCase();
  return (
    errorUpper.includes('UNAVAILABLE') ||
    errorUpper.includes('TIMEOUT') ||
    errorUpper.includes('MS_MAX') ||
    errorUpper.includes('GLOBAL_MAX') ||
    errorUpper.includes('BUSY')
  );
}

/**
 * Validate a European VAT number via the official VIES REST API.
 * Non-European callers should not invoke this — use requiresEuropeanVat first.
 */
export async function validateEuropeanVatNumber(params: {
  country?: string | null;
  taxId?: string | null;
}): Promise<ViesVatValidationResult> {
  const country = String(params.country || '').trim();
  const rawTaxId = String(params.taxId || '').trim();

  if (!rawTaxId) {
    return {
      ok: false,
      reason: 'missing',
      message: 'VAT Number is required for European orders.',
    };
  }

  const viesCountryCode = getViesCountryCode(country);

  // Country not in Europe map (should not happen if requiresEuropeanVat gated)
  if (viesCountryCode === undefined) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Unable to validate VAT Number for the selected country.',
    };
  }

  // Europe list includes Norway/Switzerland — VIES does not cover them.
  // Require a non-empty VAT and accept after format normalization.
  if (viesCountryCode === null) {
    const normalized = normalizeVatNumber(rawTaxId, null);
    if (!normalized || normalized.length < 4) {
      return {
        ok: false,
        reason: 'invalid',
        message: 'Please enter a valid VAT Number.',
      };
    }
    return { ok: true, normalizedVat: normalized };
  }

  const vatNumber = normalizeVatNumber(rawTaxId, viesCountryCode);
  if (!vatNumber) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Please enter a valid VAT Number.',
    };
  }

  try {
    const { data } = await axios.post(
      VIES_CHECK_URL,
      { countryCode: viesCountryCode, vatNumber },
      {
        timeout: 12000,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        validateStatus: (status) => status >= 200 && status < 500,
      },
    );

    if (data?.valid === true) {
      return {
        ok: true,
        normalizedVat: formatVatForStorage(vatNumber, viesCountryCode),
        viesCountryCode,
      };
    }

    const errorCode = extractViesErrorCode(data);
    if (isViesUnavailableError(errorCode)) {
      return {
        ok: false,
        reason: 'unavailable',
        message:
          'VAT verification service is temporarily unavailable. Please try again shortly.',
      };
    }

    if (data?.valid === false) {
      return {
        ok: false,
        reason: 'invalid',
        message:
          'VAT Number could not be verified with VIES. Please check the number and try again.',
      };
    }

    // Unexpected / empty response body
    return {
      ok: false,
      reason: 'unavailable',
      message:
        'VAT verification service did not return a valid response. Please try again shortly.',
    };
  } catch (err: any) {
    const status = err?.response?.status;
    const responseError = extractViesErrorCode(err?.response?.data);
    if (isViesUnavailableError(responseError)) {
      return {
        ok: false,
        reason: 'unavailable',
        message:
          'VAT verification service is temporarily unavailable. Please try again shortly.',
      };
    }
    // 4xx from VIES for bad country/input → treat as invalid VAT
    if (status && status >= 400 && status < 500) {
      return {
        ok: false,
        reason: 'invalid',
        message:
          'VAT Number could not be verified with VIES. Please check the number and try again.',
      };
    }
    return {
      ok: false,
      reason: 'unavailable',
      message:
        'VAT verification service is temporarily unavailable. Please try again shortly.',
    };
  }
}
