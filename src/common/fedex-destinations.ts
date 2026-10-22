// Destinations shipped at the live FedEx rate (from the shop's Hub), with no
// free-shipping threshold: Canada, plus Hawaii, Alaska and Puerto Rico.
// Everywhere else keeps the flat rule in shipping-config.ts.

const USA_NAMES = ['united states', 'usa', 'us', 'united states of america'];
const FEDEX_US_STATES: Record<string, string> = {
  hawaii: 'HI',
  hi: 'HI',
  alaska: 'AK',
  ak: 'AK',
  'puerto rico': 'PR',
  pr: 'PR',
};

function norm(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .trim();
}

export function isPuertoRicoDestination(
  country?: string | null,
  state?: string | null,
): boolean {
  const c = norm(country);
  if (c === 'puerto rico' || c === 'pr') return true;
  return USA_NAMES.includes(c) && FEDEX_US_STATES[norm(state)] === 'PR';
}

export function isFedexShippingDestination(
  country?: string | null,
  state?: string | null,
): boolean {
  const c = norm(country);
  if (c === 'canada' || c === 'ca') return true;
  if (c === 'puerto rico' || c === 'pr') return true;
  return USA_NAMES.includes(c) && !!FEDEX_US_STATES[norm(state)];
}
