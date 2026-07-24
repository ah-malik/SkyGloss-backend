import { UserRole } from '../users/entities/user.entity';

export const PARTNER_NETWORK_ROLES = [
  UserRole.PARTNER,
  UserRole.DISTRIBUTOR,
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
  // UserRole.SUB_PROMOTER, // removed — Sub-Promoters migrated to Promoters
] as const;

export const HUB_ID_LABEL = 'Hub ID';
export const NETWORK_REFERENCE_ID_LABEL =
  'Hub, Distributor, Representative, or Promoter ID';

export function getNetworkIdLabel(role?: string): string {
  switch (role) {
    case UserRole.PARTNER:
    case 'partner':
      return 'Hub ID';
    case UserRole.DISTRIBUTOR:
    case 'distributor':
      return 'Distributor ID';
    case UserRole.MASTER_PARTNER:
    case 'master_partner':
      return 'Representative ID';
    case UserRole.REGIONAL_PARTNER:
    case 'regional_partner':
      return 'Promoter ID';
    // Legacy display only — Sub-Promoter role removed
    case UserRole.SUB_PROMOTER:
    case 'sub_promoter':
      return 'Sub-Promoter ID';
    default:
      return HUB_ID_LABEL;
  }
}

export function isPartnerNetworkRole(role?: string): boolean {
  return PARTNER_NETWORK_ROLES.includes(role as (typeof PARTNER_NETWORK_ROLES)[number]);
}

export function formatRoleLabel(role?: string): string {
  switch (role) {
    case UserRole.PARTNER:
    case 'partner':
      return 'Hub';
    case UserRole.DISTRIBUTOR:
    case 'distributor':
      return 'Distributor';
    case UserRole.MASTER_PARTNER:
    case 'master_partner':
      return 'Representative';
    case UserRole.REGIONAL_PARTNER:
    case 'regional_partner':
      return 'Promoter';
    // Legacy display only — Sub-Promoter role removed
    case UserRole.SUB_PROMOTER:
    case 'sub_promoter':
      return 'Sub-Promoter';
    case UserRole.CERTIFIED_SHOP:
    case 'certified_shop':
      return 'Certified Shop';
    case UserRole.ADMIN:
    case 'admin':
      return 'Admin';
    default:
      return role || '';
  }
}

export function getRegistrationFeeName(role?: string): string {
  if (role === UserRole.CERTIFIED_SHOP || role === 'certified_shop') {
    return 'Shop Registration Fee';
  }
  if (role === UserRole.PARTNER || role === 'partner') {
    return 'Hub Registration Fee';
  }
  if (role === UserRole.DISTRIBUTOR || role === 'distributor') {
    return 'Distributor Registration Fee';
  }
  if (role === UserRole.REGIONAL_PARTNER || role === 'regional_partner') {
    return 'Promoter Registration Fee';
  }
  // if (role === UserRole.SUB_PROMOTER || role === 'sub_promoter') {
  //   return 'Sub-Promoter Registration Fee';
  // }
  if (role === UserRole.MASTER_PARTNER || role === 'master_partner') {
    return 'Representative Registration Fee';
  }
  return 'Registration Fee';
}

export function getRegistrationFeeDescription(role?: string): string {
  if (role === UserRole.CERTIFIED_SHOP || role === 'certified_shop') {
    return 'One-time fee to activate FUSION certification and online training courses';
  }
  if (isPartnerNetworkRole(role)) {
    return `One-time fee to activate your SkyGloss ${formatRoleLabel(role)} account.`;
  }
  return 'One-time fee to activate your SkyGloss account.';
}
