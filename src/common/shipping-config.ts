// Shipping configuration for North America & Europe regions
// Excluded countries: Russia, Ukraine, Turkey, North Macedonia, Bulgaria, Belarus

export const EXCLUDED_COUNTRIES = [
  'russia', 'ukraine', 'turkey', 'north macedonia', 'bulgaria', 'belarus',
  'türkiye',
];

export const NORTH_AMERICA_COUNTRIES = [
  'united states', 'usa', 'us', 'united states of america',
  'canada',
  'mexico',
  'antigua and barbuda', 'bahamas', 'barbados', 'belize', 'costa rica',
  'cuba', 'dominica', 'dominican republic', 'el salvador', 'grenada',
  'guatemala', 'haiti', 'honduras', 'jamaica', 'nicaragua', 'panama',
  'saint kitts and nevis', 'saint lucia', 'saint vincent and the grenadines',
  'trinidad and tobago', 'puerto rico',
];

export const EUROPE_COUNTRIES = [
  'albania', 'andorra', 'armenia', 'austria', 'azerbaijan',
  'belgium', 'bosnia and herzegovina',
  'croatia', 'cyprus', 'czech republic', 'czechia',
  'denmark',
  'estonia',
  'finland', 'france',
  'georgia', 'germany', 'greece',
  'hungary',
  'iceland', 'ireland', 'italy',
  'kazakhstan', 'kosovo',
  'latvia', 'liechtenstein', 'lithuania', 'luxembourg',
  'malta', 'moldova', 'monaco', 'montenegro',
  'netherlands', 'norway',
  'poland', 'portugal',
  'romania',
  'san marino', 'serbia', 'slovakia', 'slovenia', 'spain', 'sweden', 'switzerland',
  'united kingdom', 'uk', 'england', 'scotland', 'wales', 'northern ireland',
  'vatican city',
];

export const SHIPPING_FEE_THRESHOLD = 500; // $500 or €500
export const SHIPPING_FEE_AMOUNT = 25;     // $25 or €25

export function getShippingRegion(country: string): 'NA' | 'EU' | null {
  if (!country) return null;
  const c = country.toLowerCase().trim();
  if (EXCLUDED_COUNTRIES.includes(c)) return null;
  if (NORTH_AMERICA_COUNTRIES.includes(c)) return 'NA';
  if (EUROPE_COUNTRIES.includes(c)) return 'EU';
  return null;
}

export function calculateShippingFee(country: string, subtotal: number): number {
  const region = getShippingRegion(country);
  if (!region) return 0;
  if (subtotal >= SHIPPING_FEE_THRESHOLD) return 0;
  return SHIPPING_FEE_AMOUNT;
}
