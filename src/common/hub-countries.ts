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

/** Case-insensitive check: is `country` in the Hub's assigned countries list? */
export function hubOwnsCountry(
  countries: string[] | null | undefined,
  country?: string | null,
): boolean {
  const target = normalizeCountryName(country).toLowerCase();
  if (!target) return false;
  return normalizeHubCountries(countries).some(
    (assigned) => assigned.toLowerCase() === target,
  );
}

export function hubCountryMismatchError(
  hubCode: string,
  country: string,
): string {
  return `Hub ID ${hubCode} is not assigned to ${country}. Select a country from this Hub's assigned countries, or enter a different Partner ID.`;
}
