import { UserRole } from '../users/entities/user.entity';
import { formatRoleLabel } from './role-labels';

/** Top-to-bottom partner network hierarchy (includes shop as leaf). */
export const NETWORK_HIERARCHY_ORDER = [
  UserRole.PARTNER,
  UserRole.DISTRIBUTOR,
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
  UserRole.SUB_PROMOTER,
  UserRole.CERTIFIED_SHOP,
] as const;

export function getNetworkRoleIndex(role?: string): number {
  if (!role) return -1;
  return NETWORK_HIERARCHY_ORDER.indexOf(role as (typeof NETWORK_HIERARCHY_ORDER)[number]);
}

export function isStrictDescendantRole(
  ancestorRole?: string,
  descendantRole?: string,
): boolean {
  const ancestorIdx = getNetworkRoleIndex(ancestorRole);
  const descendantIdx = getNetworkRoleIndex(descendantRole);
  if (ancestorIdx < 0 || descendantIdx < 0) return false;
  return descendantIdx > ancestorIdx;
}

/** Whether the viewer may see orders placed by users in placerRole. */
export function canViewerSeeOrderPlacerRole(
  viewerRole?: string,
  placerRole?: string,
): boolean {
  return isStrictDescendantRole(viewerRole, placerRole);
}

/** Hub may see its own direct orders; other roles only see strictly lower roles. */
export function shouldIncludeViewerInNetworkOrders(viewerRole?: string): boolean {
  return viewerRole === UserRole.PARTNER;
}

export type CommissionLike = {
  recipientRole?: string;
  recipientPartnerCode?: string;
};

/** Parent sees child commission; everyone sees their own. */
export function canViewerSeeCommissionRecipient(
  viewerRole?: string,
  recipientRole?: string,
  recipientPartnerCode?: string,
  viewerPartnerCode?: string,
): boolean {
  const normalizedRecipientCode = recipientPartnerCode?.trim();
  const normalizedViewerCode = viewerPartnerCode?.trim();
  if (
    normalizedViewerCode &&
    normalizedRecipientCode &&
    normalizedViewerCode === normalizedRecipientCode
  ) {
    return true;
  }
  if (!recipientRole) return false;
  return isStrictDescendantRole(viewerRole, recipientRole);
}

export function filterCommissionsForViewer<T extends CommissionLike>(
  commissions: T[] | undefined,
  viewerRole?: string,
  viewerPartnerCode?: string,
): T[] {
  if (!commissions?.length) return [];
  return commissions.filter((entry) =>
    canViewerSeeCommissionRecipient(
      viewerRole,
      entry.recipientRole,
      entry.recipientPartnerCode,
      viewerPartnerCode,
    ),
  );
}

/** Roles that must be linked to a parent network user via referredByPartnerCode. */
export const HIERARCHY_PARENT_ROLES: Partial<Record<UserRole, UserRole[]>> = {
  [UserRole.DISTRIBUTOR]: [UserRole.PARTNER],
  [UserRole.MASTER_PARTNER]: [UserRole.DISTRIBUTOR, UserRole.PARTNER],
  [UserRole.REGIONAL_PARTNER]: [UserRole.MASTER_PARTNER],
  [UserRole.SUB_PROMOTER]: [UserRole.REGIONAL_PARTNER],
  [UserRole.CERTIFIED_SHOP]: [
    UserRole.PARTNER,
    UserRole.DISTRIBUTOR,
    UserRole.MASTER_PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.SUB_PROMOTER,
  ],
};

export function requiresParentLink(role?: string): boolean {
  return !!role && role in HIERARCHY_PARENT_ROLES;
}

export function getAllowedParentRoles(childRole?: string): UserRole[] {
  if (!childRole) return [];
  return HIERARCHY_PARENT_ROLES[childRole as UserRole] || [];
}

export function getParentLinkLabel(childRole?: string): string {
  switch (childRole) {
    case UserRole.DISTRIBUTOR:
      return 'Assigned Hub';
    case UserRole.MASTER_PARTNER:
      return 'Assigned Distributor';
    case UserRole.REGIONAL_PARTNER:
      return 'Assigned Representative';
    case UserRole.SUB_PROMOTER:
      return 'Assigned Main Promoter';
    case UserRole.CERTIFIED_SHOP:
      return 'Assigned Network User';
    default:
      return 'Parent Link';
  }
}

export const NETWORK_TRAVERSAL_ROLES = [
  UserRole.PARTNER,
  UserRole.DISTRIBUTOR,
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
  UserRole.SUB_PROMOTER,
] as const;

export function canTraverseNetwork(role?: string): boolean {
  return NETWORK_TRAVERSAL_ROLES.includes(role as (typeof NETWORK_TRAVERSAL_ROLES)[number]);
}

export function canCertifyShops(role?: string, partnerCode?: string): boolean {
  if (role === UserRole.PARTNER || role === 'partner') return true;
  if (partnerCode === 'GLOBAL77') return true;
  return false;
}

export function validateParentRole(
  childRole: string,
  parentRole: string,
): string | null {
  const allowed = getAllowedParentRoles(childRole);
  if (!allowed.length) return null;
  if (!allowed.includes(parentRole as UserRole)) {
    const labels = allowed.map((r) => formatRoleLabel(r)).join(' or ');
    return `${getParentLinkLabel(childRole)} must be a ${labels} user`;
  }
  return null;
}
