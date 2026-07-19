import { UserRole } from '../users/entities/user.entity';
import { formatRoleLabel } from './role-labels';
import { isGlobalHubPartnerCode } from './global-hub';

/** Top-to-bottom partner network hierarchy (includes shop as leaf). */
export const NETWORK_HIERARCHY_ORDER = [
  UserRole.PARTNER,
  UserRole.DISTRIBUTOR,
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
  // UserRole.SUB_PROMOTER, // removed — Sub-Promoters migrated to Promoters
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
  const normalizedRecipientCode = recipientPartnerCode?.trim().toUpperCase();
  const normalizedViewerCode = viewerPartnerCode?.trim().toUpperCase();
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

/**
 * Includes related Representative first-order split lines when the viewer is
 * already a commission recipient on the same order (e.g. Shop Intro + Partner Dev).
 */
export function filterCommissionsForViewerWithSplitContext<T extends CommissionLike & {
  amount?: number;
  earningType?: string;
}>(
  commissions: T[] | undefined,
  viewerRole?: string,
  viewerPartnerCode?: string,
): T[] {
  if (!commissions?.length) return [];

  const base = filterCommissionsForViewer(
    commissions,
    viewerRole,
    viewerPartnerCode,
  );

  const normalizedViewerCode = viewerPartnerCode?.trim().toUpperCase();
  // Rep Network + Promoter Network FO split transparency
  if (
    (viewerRole !== UserRole.MASTER_PARTNER &&
      viewerRole !== UserRole.REGIONAL_PARTNER) ||
    !normalizedViewerCode
  ) {
    return base;
  }

  const viewerIsRecipient = commissions.some(
    (entry) =>
      entry.recipientPartnerCode?.trim().toUpperCase() === normalizedViewerCode,
  );
  if (!viewerIsRecipient) return base;

  const siblingRole =
    viewerRole === UserRole.REGIONAL_PARTNER
      ? UserRole.REGIONAL_PARTNER
      : UserRole.MASTER_PARTNER;
  const relatedRepLines = commissions.filter((entry) => {
    const code = entry.recipientPartnerCode?.trim().toUpperCase();
    if (!code || code === normalizedViewerCode) return false;
    return entry.recipientRole === siblingRole;
  });

  if (relatedRepLines.length === 0) return base;

  const seen = new Set(
    base.map(
      (entry) =>
        `${entry.recipientPartnerCode?.trim().toUpperCase() || ''}:${entry.recipientRole || ''}:${(entry as any).amount ?? ''}:${(entry as any).earningType || ''}`,
    ),
  );

  const merged = [...base];
  relatedRepLines.forEach((entry) => {
    const key = `${entry.recipientPartnerCode?.trim().toUpperCase() || ''}:${entry.recipientRole || ''}:${(entry as any).amount ?? ''}:${(entry as any).earningType || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(entry);
  });

  return merged;
}

/** Roles that must be linked to a parent network user via referredByPartnerCode. */
export const HIERARCHY_PARENT_ROLES: Partial<Record<UserRole, UserRole[]>> = {
  [UserRole.DISTRIBUTOR]: [UserRole.PARTNER],
  // Representative → Representative / Distributor / Hub (never Promoter)
  [UserRole.MASTER_PARTNER]: [
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    UserRole.PARTNER,
  ],
  // Promoter → Promoter / Representative / Distributor / Hub
  [UserRole.REGIONAL_PARTNER]: [
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    UserRole.PARTNER,
  ],
  // [UserRole.SUB_PROMOTER]: [UserRole.REGIONAL_PARTNER], // removed — use Promoter Network operational links
  [UserRole.CERTIFIED_SHOP]: [
    UserRole.PARTNER,
    UserRole.DISTRIBUTOR,
    UserRole.MASTER_PARTNER,
    UserRole.REGIONAL_PARTNER,
    // UserRole.SUB_PROMOTER, // removed
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
    case UserRole.REGIONAL_PARTNER:
      return 'Add Network';
    // case UserRole.SUB_PROMOTER:
    //   return 'Assigned Main Promoter';
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
  // UserRole.SUB_PROMOTER, // removed
] as const;

export function canTraverseNetwork(role?: string): boolean {
  return NETWORK_TRAVERSAL_ROLES.includes(role as (typeof NETWORK_TRAVERSAL_ROLES)[number]);
}

export const SHOP_CERTIFIER_ROLES = [
  UserRole.PARTNER,
  UserRole.DISTRIBUTOR,
  UserRole.MASTER_PARTNER,
] as const;

export function canCertifyShops(role?: string, partnerCode?: string): boolean {
  if (SHOP_CERTIFIER_ROLES.includes(role as (typeof SHOP_CERTIFIER_ROLES)[number])) return true;
  if (isGlobalHubPartnerCode(partnerCode)) return true;
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
