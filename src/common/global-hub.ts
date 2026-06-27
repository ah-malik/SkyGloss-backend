export const GLOBAL_HUB_PARTNER_CODE = 'GLOBALHUB';

/** Legacy global hub code kept for existing records. */
export const LEGACY_GLOBAL_HUB_PARTNER_CODE = 'GLOBAL77';

export function isGlobalHubPartnerCode(code?: string | null): boolean {
  if (!code?.trim()) return false;
  const normalized = code.trim().toUpperCase();
  return (
    normalized === GLOBAL_HUB_PARTNER_CODE ||
    normalized === LEGACY_GLOBAL_HUB_PARTNER_CODE
  );
}

/** True when linked to a real partner (not the global hub fallback). */
export function isUserPartnerAssigned(referredByPartnerCode?: string | null): boolean {
  if (!referredByPartnerCode?.trim()) return false;
  return !isGlobalHubPartnerCode(referredByPartnerCode);
}
