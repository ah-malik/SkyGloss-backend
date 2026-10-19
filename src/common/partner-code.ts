import { getNetworkIdLabel } from './role-labels';

export const PARTNER_CODE_MIN_LENGTH = 4;
export const PARTNER_CODE_MAX_LENGTH = 15;
export const PARTNER_CODE_REGEX = /^[A-Z0-9]{4,15}$/;

/**
 * Codes double as short links (portal.skygloss.com/<code>), so they can't
 * shadow existing single-segment portal routes.
 */
export const RESERVED_PARTNER_CODES = new Set([
  'CART',
  'CHECKOUT',
  'ASSETS',
  'ASSETS2',
  'RESOURCES',
  'SUPPORT',
  'PROFILE',
  'ACTIVITIES',
  'LIVECHAT',
  'MAPWIDGET',
  'ASSETSHOP',
  'ASSETSSHOP',
  'ORDERPLACED',
  'LOGIN',
  'REGISTER',
  'DASHBOARD',
  'RESETPASSWORD',
  'SETUPPASSWORD',
  'THANKYOU',
]);

export function normalizePartnerCode(code?: string): string {
  return (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function validatePartnerCode(code?: string, role?: string): string | null {
  const label = getNetworkIdLabel(role);
  const normalized = normalizePartnerCode(code);

  if (!normalized) {
    return `${label} is required`;
  }

  if (
    normalized.length < PARTNER_CODE_MIN_LENGTH ||
    normalized.length > PARTNER_CODE_MAX_LENGTH
  ) {
    return `${label} must be ${PARTNER_CODE_MIN_LENGTH}-${PARTNER_CODE_MAX_LENGTH} characters`;
  }

  if (!PARTNER_CODE_REGEX.test(normalized)) {
    return `${label} must contain only letters and numbers (${PARTNER_CODE_MIN_LENGTH}-${PARTNER_CODE_MAX_LENGTH} characters)`;
  }

  if (RESERVED_PARTNER_CODES.has(normalized)) {
    return `${label} "${normalized}" is reserved. Please choose a different one`;
  }

  return null;
}
