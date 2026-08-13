/**
 * Match country names across registration (country-state-city),
 * admin fee groups, and common aliases.
 *
 * Example: shop saves "Czech Republic" while a fee group stores
 * "Czechia (Czech Republic)" — exact string match fails.
 */

const COUNTRY_ALIAS_GROUPS: string[][] = [
  ['czechia', 'czech republic', 'czechia (czech republic)'],
  ['united states', 'united states of america', 'usa', 'us'],
  ['united kingdom', 'great britain', 'uk'],
  ['turkey', 'türkiye'],
  ['myanmar', 'myanmar (formerly burma)', 'burma'],
  ['congo (congo-brazzaville)', 'republic of the congo', 'congo'],
  ['democratic republic of the congo', 'congo, the democratic republic of the congo', 'drc'],
  ['holy see', 'vatican city', 'holy see (vatican city state)'],
];

function addToken(tokens: Set<string>, value: string) {
  const token = value.toLowerCase().trim().replace(/\s+/g, ' ');
  if (token) tokens.add(token);
}

export function countryMatchTokens(country?: string | null): Set<string> {
  const tokens = new Set<string>();
  const raw = (country || '').toLowerCase().trim();
  if (!raw) return tokens;

  addToken(tokens, raw);

  const withoutParens = raw.replace(/\s*\([^)]*\)\s*/g, ' ');
  addToken(tokens, withoutParens);

  for (const match of raw.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1].replace(/^(formerly|also known as|aka)\s+/i, '');
    addToken(tokens, inner);
  }

  for (const group of COUNTRY_ALIAS_GROUPS) {
    if ([...tokens].some((token) => group.includes(token))) {
      for (const alias of group) addToken(tokens, alias);
    }
  }

  return tokens;
}

export function countriesMatch(a?: string | null, b?: string | null): boolean {
  const aTokens = countryMatchTokens(a);
  const bTokens = countryMatchTokens(b);
  for (const token of aTokens) {
    if (bTokens.has(token)) return true;
  }
  return false;
}
