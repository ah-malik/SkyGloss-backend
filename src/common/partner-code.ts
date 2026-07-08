import { getNetworkIdLabel } from './role-labels';

export const PARTNER_CODE_MIN_LENGTH = 4;
export const PARTNER_CODE_MAX_LENGTH = 15;
export const PARTNER_CODE_REGEX = /^[A-Z0-9]{4,15}$/;

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

  return null;
}
