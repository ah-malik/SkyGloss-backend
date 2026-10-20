import {
  canManageNetworkOrderStatus,
  canViewerManageShopDValueInvoice,
  canViewerManageShopOrderStatus,
  canViewerSeeCommissionRecipient,
  canViewerSeeOrderPlacerRole,
  isShopParentLinkRole,
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

  it('allows Hub and Distributor to manage network order status, not Representative', () => {
    expect(canManageNetworkOrderStatus('partner')).toBe(true);
    expect(canManageNetworkOrderStatus('distributor')).toBe(true);
    expect(canManageNetworkOrderStatus('master_partner')).toBe(false);
    expect(canManageNetworkOrderStatus('regional_partner')).toBe(false);
    expect(canManageNetworkOrderStatus('admin')).toBe(false);
  });

  it('treats Hub and Distributor as Shop Parent Link roles', () => {
    expect(isShopParentLinkRole('partner')).toBe(true);
    expect(isShopParentLinkRole('distributor')).toBe(true);
    expect(isShopParentLinkRole('master_partner')).toBe(false);
  });

  it('scopes Distributor order actions to assigned Parent Link shops', () => {
    expect(
      canViewerManageShopOrderStatus({
        viewerRole: 'distributor',
        viewerPartnerCode: 'DIST01',
        shopHubPartnerCode: 'DIST01',
        shopParentRole: 'distributor',
      }),
    ).toBe(true);
    expect(
      canViewerManageShopOrderStatus({
        viewerRole: 'distributor',
        viewerPartnerCode: 'DIST01',
        shopHubPartnerCode: 'HUB01',
        shopParentRole: 'partner',
      }),
    ).toBe(false);
  });

  it('does not allow Representative to manage shop order status', () => {
    expect(
      canViewerManageShopOrderStatus({
        viewerRole: 'master_partner',
        viewerPartnerCode: 'REP01',
        shopHubPartnerCode: 'HUB01',
        shopParentRole: 'partner',
      }),
    ).toBe(false);
  });

  it('keeps historical Hub orders with Hub after Parent Link moves to Distributor', () => {
    expect(
      canViewerManageShopOrderStatus({
        viewerRole: 'partner',
        viewerPartnerCode: 'HUB01',
        actingParentPartnerCode: 'HUB01',
        actingParentRole: 'partner',
      }),
    ).toBe(true);
    expect(
      canViewerManageShopOrderStatus({
        viewerRole: 'distributor',
        viewerPartnerCode: 'DIST01',
        actingParentPartnerCode: 'HUB01',
        actingParentRole: 'partner',
      }),
    ).toBe(false);
    expect(
      canViewerManageShopOrderStatus({
        viewerRole: 'distributor',
        viewerPartnerCode: 'DIST01',
        actingParentPartnerCode: 'DIST01',
        actingParentRole: 'distributor',
      }),
    ).toBe(true);
    expect(
      canViewerManageShopOrderStatus({
        viewerRole: 'partner',
        viewerPartnerCode: 'HUB01',
        actingParentPartnerCode: 'DIST01',
        actingParentRole: 'distributor',
      }),
    ).toBe(false);
  });

  it('does not let Hub manage its own non-shop orders', () => {
    expect(
      canViewerManageShopOrderStatus({
        viewerRole: 'partner',
        viewerPartnerCode: 'HUB01',
        actingParentPartnerCode: 'HUB01',
        orderPlacerRole: 'partner',
      }),
    ).toBe(false);
  });

  it('lets Hub (network shops) and Distributor (own Parent Link shops) manage D-Value', () => {
    const hub = { viewerRole: 'partner', viewerPartnerCode: 'HUB1' };
    const dist = { viewerRole: 'distributor', viewerPartnerCode: 'DIST1' };

    // Hub-linked shop: Hub yes, Distributor no
    expect(canViewerManageShopDValueInvoice({ ...hub, shopHubPartnerCode: 'hub1' })).toBe(true);
    expect(canViewerManageShopDValueInvoice({ ...dist, shopHubPartnerCode: 'HUB1' })).toBe(false);

    // Distributor-linked shop: both Distributor and Hub
    expect(canViewerManageShopDValueInvoice({ ...dist, shopHubPartnerCode: 'dist1' })).toBe(true);
    expect(canViewerManageShopDValueInvoice({ ...hub, shopHubPartnerCode: 'DIST1' })).toBe(true);

    // No stored Parent Link → Hub only
    expect(canViewerManageShopDValueInvoice({ ...hub, shopHubPartnerCode: '' })).toBe(true);
    expect(canViewerManageShopDValueInvoice({ ...dist, shopHubPartnerCode: null })).toBe(false);

    // Shops, Reps and Promoters never get the toggle
    for (const viewerRole of ['certified_shop', 'master_partner', 'regional_partner']) {
      expect(
        canViewerManageShopDValueInvoice({
          viewerRole,
          viewerPartnerCode: 'HUB1',
          shopHubPartnerCode: 'HUB1',
        }),
      ).toBe(false);
    }
  });
});
