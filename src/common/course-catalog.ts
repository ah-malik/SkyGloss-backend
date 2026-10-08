/** Role-based required courses — keep in sync with frontend `courseCatalog.ts`. */

export const COURSE_STEPS: Record<string, number> = {
  UNDERSTANDING_SKYGLOSS: 48,
  WELCOME_TO_SKYGLOSS: 24,
  PARTNER_SALES_MANUAL: 30,
  SHOP_SALES: 26,
  MARKETING_MASTERCLASS: 20,
  PARTNER_MARKETING_MANUAL: 15,
  YOUR_ROLE_DISTRIBUTOR: 55,
  YOUR_ROLE_PROMOTER: 33,
  YOUR_ROLE_REPRESENTATIVE: 52,
  SKYGLOSS_SHOP_SETUP: 4,
  SOCIAL_MEDIA_COMMUNICATION: 11,
  FUSION: 20,
  RESIN_FILM: 8,
  SEAL: 5,
  SHINE: 6,
  MATTE: 6,
};

export const ALL_USER_PRODUCT_KEYS = [
  'RESIN_FILM',
  'SHINE',
  'MATTE',
  'SEAL',
] as const;

export const PAID_SHOP_AND_PARTNER_KEYS = [
  'WELCOME_TO_SKYGLOSS',
  'SHOP_SALES',
  'MARKETING_MASTERCLASS',
  'SKYGLOSS_SHOP_SETUP',
  'FUSION',
] as const;

export const PARTNER_EXCEPT_HUB_SHOP_KEYS = [
  'UNDERSTANDING_SKYGLOSS',
  'PARTNER_SALES_MANUAL',
  'PARTNER_MARKETING_MANUAL',
] as const;

export function roleCourseKeyForUser(role?: string | null): string | null {
  if (role === 'distributor') return 'YOUR_ROLE_DISTRIBUTOR';
  if (role === 'regional_partner') return 'YOUR_ROLE_PROMOTER';
  if (role === 'master_partner') return 'YOUR_ROLE_REPRESENTATIVE';
  return null;
}

export function isFieldPartnerRole(role?: string | null) {
  return (
    role === 'distributor' ||
    role === 'regional_partner' ||
    role === 'master_partner'
  );
}

/** Required course keys for a role (includes standard product courses). */
export function getRequiredCourseKeysForRole(role?: string | null): string[] {
  const keys: string[] = [...PAID_SHOP_AND_PARTNER_KEYS];

  if (isFieldPartnerRole(role)) {
    keys.push(...PARTNER_EXCEPT_HUB_SHOP_KEYS);
    const roleKey = roleCourseKeyForUser(role);
    if (roleKey) keys.push(roleKey);
  }

  for (const key of ALL_USER_PRODUCT_KEYS) {
    if (!keys.includes(key)) keys.push(key);
  }

  return keys.filter((k) => k !== 'SOCIAL_MEDIA_COMMUNICATION');
}
