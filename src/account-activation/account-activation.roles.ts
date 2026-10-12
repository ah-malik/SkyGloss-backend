import { UserRole } from '../users/entities/user.entity';

/** Representative, Promoter, and Distributor go through Account Activation. */
export const ACCOUNT_ACTIVATION_ELIGIBLE_ROLES = [
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
  UserRole.DISTRIBUTOR,
] as const;

/** Bank details are required during activation for Rep/Promoter only. */
export const ACCOUNT_ACTIVATION_BANK_REQUIRED_ROLES = [
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
] as const;

export function isAccountActivationEligibleRole(
  role?: string | null,
): boolean {
  return (
    role === UserRole.MASTER_PARTNER ||
    role === UserRole.REGIONAL_PARTNER ||
    role === UserRole.DISTRIBUTOR
  );
}

export function requiresActivationBankDetails(
  role?: string | null,
): boolean {
  return (
    role === UserRole.MASTER_PARTNER || role === UserRole.REGIONAL_PARTNER
  );
}
