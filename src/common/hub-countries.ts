/** Normalize country names for Hub territory matching. */
export function normalizeCountryName(country?: string | null): string {
  return (country || '').trim();
}

/** Dedupe and trim a Hub countries list (preserves first-seen order). */
export function normalizeHubCountries(countries?: string[] | null): string[] {
  if (!Array.isArray(countries)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of countries) {
    const name = normalizeCountryName(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export function hubCountriesOverlapError(country: string): string {
  return `${country} is already assigned to another HUB. One country can only be assigned to one HUB.`;
}
