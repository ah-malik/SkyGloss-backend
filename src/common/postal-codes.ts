/** Postal code formats by ISO country (countries not listed are not format-checked). */
const POSTAL_CODE_FORMATS: Record<
  string,
  { pattern: RegExp; example: string }
> = {
  US: { pattern: /^\d{5}(-\d{4})?$/, example: '12345 or 12345-6789' },
  PR: { pattern: /^\d{5}(-\d{4})?$/, example: '00901' },
  CA: {
    pattern:
      /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
    example: 'A1A 1A1',
  },
  GB: { pattern: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, example: 'SW1A 1AA' },
  IE: { pattern: /^[A-Z]\d[\dW] ?[A-Z\d]{4}$/i, example: 'D02 X285' },
  NL: { pattern: /^\d{4} ?[A-Z]{2}$/i, example: '1012 AB' },
  DE: { pattern: /^\d{5}$/, example: '10115' },
  FR: { pattern: /^\d{5}$/, example: '75001' },
  IT: { pattern: /^\d{5}$/, example: '00118' },
  ES: { pattern: /^\d{5}$/, example: '28001' },
  FI: { pattern: /^\d{5}$/, example: '00100' },
  EE: { pattern: /^\d{5}$/, example: '10111' },
  HR: { pattern: /^\d{5}$/, example: '10000' },
  LT: { pattern: /^(LT-?)?\d{5}$/i, example: '01100' },
  BE: { pattern: /^\d{4}$/, example: '1000' },
  AT: { pattern: /^\d{4}$/, example: '1010' },
  BG: { pattern: /^\d{4}$/, example: '1000' },
  CH: { pattern: /^\d{4}$/, example: '8001' },
  DK: { pattern: /^\d{4}$/, example: '1050' },
  HU: { pattern: /^\d{4}$/, example: '1011' },
  LU: { pattern: /^(L-?)?\d{4}$/i, example: '1111' },
  NO: { pattern: /^\d{4}$/, example: '0150' },
  SI: { pattern: /^\d{4}$/, example: '1000' },
  CY: { pattern: /^\d{4}$/, example: '1010' },
  LV: { pattern: /^(LV-?)?\d{4}$/i, example: 'LV-1010' },
  PL: { pattern: /^\d{2}-?\d{3}$/, example: '00-001' },
  PT: { pattern: /^\d{4}-?\d{3}$/, example: '1000-001' },
  SE: { pattern: /^\d{3} ?\d{2}$/, example: '111 22' },
  CZ: { pattern: /^\d{3} ?\d{2}$/, example: '110 00' },
  SK: { pattern: /^\d{3} ?\d{2}$/, example: '811 01' },
  GR: { pattern: /^\d{3} ?\d{2}$/, example: '105 57' },
  RO: { pattern: /^\d{6}$/, example: '010011' },
  MT: { pattern: /^[A-Z]{3} ?\d{4}$/i, example: 'VLT 1117' },
};

export function getPostalCodeFormatError(
  postcode: string,
  countryCode?: string | null,
): string | null {
  const value = String(postcode || '').trim();
  if (!value) return 'ZIP / Postal code is required.';
  const format = POSTAL_CODE_FORMATS[String(countryCode || '').toUpperCase()];
  if (format && !format.pattern.test(value)) {
    return `Invalid ZIP / Postal code format. Example: ${format.example}`;
  }
  return null;
}

/** Comparable form: uppercase, no spaces or dashes, no LT-/LV-/L- prefix. */
export function normalizePostalCode(postcode: string): string {
  return String(postcode || '')
    .toUpperCase()
    .replace(/^(LT|LV|L)-/, '')
    .replace(/[\s-]/g, '');
}

/** Countries whose postal codes are checked (format and existence). */
export function isPostalCodeCheckedCountry(
  countryCode?: string | null,
): boolean {
  return !!POSTAL_CODE_FORMATS[String(countryCode || '').toUpperCase()];
}
