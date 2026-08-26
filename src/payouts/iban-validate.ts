import { toIsoCountryCode } from './wise-country-iso';

export function normalizeIban(iban?: string | null): string {
  return (iban || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toUpperCase()
    .replace(/^IBAN/, '')
    .replace(/[^A-Z0-9]/g, '');
}

/** ISO 13616 IBAN checksum (mod 97). */
export function isValidIbanChecksum(iban?: string | null): boolean {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let expanded = '';
  for (const ch of rearranged) {
    expanded += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  }
  let remainder = 0;
  for (const ch of expanded) {
    remainder = (remainder * 10 + Number(ch)) % 97;
  }
  return remainder === 1;
}

export function ibanCountryCode(iban?: string | null): string | null {
  const s = normalizeIban(iban);
  if (s.length < 2) return null;
  return s.slice(0, 2);
}

export function ibanValidationError(
  iban?: string | null,
  country?: string | null,
): string | null {
  const s = normalizeIban(iban);
  if (!s) return null;
  if (!isValidIbanChecksum(s)) {
    return 'IBAN is invalid. Check the number and try again.';
  }
  const iso = toIsoCountryCode(country);
  const prefix = ibanCountryCode(s);
  if (iso && prefix && prefix !== iso) {
    return `IBAN country (${prefix}) does not match the selected country (${iso}).`;
  }
  return null;
}
