/** True when the client omitted a secret or sent a masked display value like ****1234. */
export function isOmittedBankSecret(value?: string | null): boolean {
  if (value == null) return true;
  const trimmed = String(value).replace(/\s/g, '');
  if (!trimmed) return true;
  return /^\*+/.test(trimmed) || /^x{3,}/i.test(trimmed);
}

export function keepOrReplaceBankSecret(
  incoming: string | undefined,
  existing?: string,
): string | undefined {
  if (isOmittedBankSecret(incoming)) return existing;
  return incoming;
}

export function mergeExtraBankDetails(
  incoming: Record<string, string> | undefined,
  existing?: Record<string, string>,
  countryChanged = false,
): Record<string, string> | undefined {
  const base = countryChanged ? {} : { ...(existing || {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (!isOmittedBankSecret(value)) base[key] = value;
  }
  return Object.keys(base).length ? base : undefined;
}
