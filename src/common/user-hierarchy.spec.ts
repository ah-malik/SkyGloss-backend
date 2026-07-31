import {
  canManageNetworkOrderStatus,
  canViewerSeeCommissionRecipient,
  canViewerSeeOrderPlacerRole,
  isStrictDescendantRole,
  shouldIncludeViewerInNetworkOrders,
} from './user-hierarchy';

describe('user-hierarchy visibility', () => {
  it('defines strict descendant roles', () => {
    expect(isStrictDescendantRole('partner', 'certified_shop')).toBe(true);
    expect(isStrictDescendantRole('regional_partner', 'certified_shop')).toBe(true);
    expect(isStrictDescendantRole('regional_partner', 'regional_partner')).toBe(false);
    // Sub-Promoter removed from hierarchy — same-level / unknown roles are not descendants
    expect(isStrictDescendantRole('regional_partner', 'sub_promoter')).toBe(false);
    expect(isStrictDescendantRole('sub_promoter', 'regional_partner')).toBe(false);
  });

  it('limits order placer visibility to child roles', () => {
    expect(canViewerSeeOrderPlacerRole('regional_partner', 'certified_shop')).toBe(true);
    expect(canViewerSeeOrderPlacerRole('regional_partner', 'regional_partner')).toBe(false);
    expect(canViewerSeeOrderPlacerRole('master_partner', 'regional_partner')).toBe(true);
    expect(canViewerSeeOrderPlacerRole('master_partner', 'certified_shop')).toBe(true);
  });

  it('allows own commission but hides parent commission', () => {
    expect(
      canViewerSeeCommissionRecipient(
        'regional_partner',
        'master_partner',
        'REP01',
        'PROM01',
      ),
    ).toBe(false);
    expect(
      canViewerSeeCommissionRecipient(
        'regional_partner',
        'regional_partner',
        'PROM01',
        'PROM01',
      ),
    ).toBe(true);
    expect(
      canViewerSeeCommissionRecipient(
        'master_partner',
        'regional_partner',
        'PROM01',
        'REP01',
      ),
    ).toBe(true);
  });

  it('only includes viewer orders for hub', () => {
    expect(shouldIncludeViewerInNetworkOrders('partner')).toBe(true);
    expect(shouldIncludeViewerInNetworkOrders('regional_partner')).toBe(false);
    expect(shouldIncludeViewerInNetworkOrders('master_partner')).toBe(false);
  });

  it('allows Hub and Representative to manage network order status', () => {
    expect(canManageNetworkOrderStatus('partner')).toBe(true);
    expect(canManageNetworkOrderStatus('master_partner')).toBe(true);
    expect(canManageNetworkOrderStatus('regional_partner')).toBe(false);
    expect(canManageNetworkOrderStatus('distributor')).toBe(false);
    expect(canManageNetworkOrderStatus('admin')).toBe(false);
  });
});
