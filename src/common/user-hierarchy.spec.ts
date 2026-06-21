import {
  canViewerSeeCommissionRecipient,
  canViewerSeeOrderPlacerRole,
  isStrictDescendantRole,
  shouldIncludeViewerInNetworkOrders,
} from './user-hierarchy';

describe('user-hierarchy visibility', () => {
  it('defines strict descendant roles', () => {
    expect(isStrictDescendantRole('partner', 'certified_shop')).toBe(true);
    expect(isStrictDescendantRole('regional_partner', 'sub_promoter')).toBe(true);
    expect(isStrictDescendantRole('regional_partner', 'regional_partner')).toBe(false);
    expect(isStrictDescendantRole('sub_promoter', 'regional_partner')).toBe(false);
  });

  it('limits order placer visibility to child roles', () => {
    expect(canViewerSeeOrderPlacerRole('regional_partner', 'sub_promoter')).toBe(true);
    expect(canViewerSeeOrderPlacerRole('regional_partner', 'certified_shop')).toBe(true);
    expect(canViewerSeeOrderPlacerRole('regional_partner', 'regional_partner')).toBe(false);
    expect(canViewerSeeOrderPlacerRole('sub_promoter', 'certified_shop')).toBe(true);
    expect(canViewerSeeOrderPlacerRole('sub_promoter', 'sub_promoter')).toBe(false);
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
        'regional_partner',
        'sub_promoter',
        'SUB01',
        'PROM01',
      ),
    ).toBe(true);
  });

  it('only includes viewer orders for hub', () => {
    expect(shouldIncludeViewerInNetworkOrders('partner')).toBe(true);
    expect(shouldIncludeViewerInNetworkOrders('regional_partner')).toBe(false);
    expect(shouldIncludeViewerInNetworkOrders('sub_promoter')).toBe(false);
  });
});
