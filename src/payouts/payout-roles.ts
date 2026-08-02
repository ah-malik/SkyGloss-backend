import { UserRole } from '../users/entities/user.entity';

/** Rep, Promoter, Distributor — can withdraw their own commissions */
export const WITHDRAWAL_ELIGIBLE_ROLES = [
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
  UserRole.DISTRIBUTOR,
] as const;

/** Hub manages network withdrawal reviews only — cannot withdraw personally */
export const HUB_PAYOUT_ROLES = [UserRole.PARTNER] as const;

export const PAYOUT_VIEW_ROLES = [
  ...WITHDRAWAL_ELIGIBLE_ROLES,
  ...HUB_PAYOUT_ROLES,
] as const;
