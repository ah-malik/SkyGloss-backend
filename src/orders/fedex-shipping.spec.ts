import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OrdersService } from './orders.service';
import { FedexService } from '../fedex/fedex.service';
import { GeoService } from '../geo/geo.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/entities/user.entity';
import { isFedexShippingDestination } from '../common/fedex-destinations';
import { getPostalCodeFormatError } from '../common/postal-codes';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const items = [
  { product: 'p1', name: 'FUSION', size: '250mL', quantity: 3, price: 95 },
];

const hub = {
  partnerCode: 'HUB1',
  country: 'United States',
  city: 'Memphis',
  address: '3875 Airways Blvd',
  state: 'Tennessee',
  zipCode: '38116',
};

const addresses = {
  canada: {
    address: '2359 Brand Road',
    city: 'Saskatoon',
    state: 'Saskatchewan',
    zipCode: 'S7J 4M6',
    country: 'Canada',
  },
  hawaii: {
    address: '1 Ala Moana Blvd',
    city: 'Honolulu',
    state: 'Hawaii',
    zipCode: '96813',
    country: 'United States',
  },
  alaska: {
    address: '1 W 4th Ave',
    city: 'Anchorage',
    state: 'Alaska',
    zipCode: '99501',
    country: 'United States',
  },
  puertoRicoState: {
    address: '1 Calle Fortaleza',
    city: 'San Juan',
    state: 'Puerto Rico',
    zipCode: '00901',
    country: 'United States',
  },
  puertoRicoCountry: {
    address: '1 Calle Fortaleza',
    city: 'San Juan',
    state: '',
    zipCode: '00901',
    country: 'Puerto Rico',
  },
  california: {
    address: '1 Main St',
    city: 'Beverly Hills',
    state: 'California',
    zipCode: '90210',
    country: 'United States',
  },
  germany: {
    address: 'Unter den Linden 1',
    city: 'Berlin',
    state: 'Berlin',
    zipCode: '10117',
    country: 'Germany',
  },
};

function buildOrdersService(opts?: {
  hub?: Record<string, unknown>;
  rateQuotes?: jest.Mock;
  geoLookup?: jest.Mock;
}) {
  const fedexService = new FedexService(
    new ConfigService({ FEDEX_API_KEY: 'k', FEDEX_SECRET_KEY: 's' }),
  );
  const getRateQuotes =
    opts?.rateQuotes ??
    jest.fn().mockResolvedValue([
      {
        serviceType: 'FEDEX_GROUND',
        serviceName: 'FedEx Ground',
        totalNetCharge: 40.75,
        currency: 'USD',
        transitDays: 3,
      },
    ]);
  (fedexService as any).getRateQuotes = getRateQuotes;

  const svc: any = Object.create(OrdersService.prototype);
  svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
  svc.fedexService = fedexService;
  svc.geoService = {
    validatePostcode:
      opts?.geoLookup ??
      jest.fn().mockResolvedValue({ valid: true, verified: false }),
  };
  svc.usersService = {
    resolveTerritoryHubPartnerCodeForShop: jest.fn().mockResolvedValue('HUB1'),
    findByPartnerCode: jest.fn().mockResolvedValue(opts?.hub ?? hub),
  };
  svc.productsService = {
    getSizeWeightsByProductIds: jest.fn().mockResolvedValue(new Map()),
  };
  svc.exchangeRatesService = {
    getRateToBase: jest.fn(async (c: string) =>
      c.toUpperCase() === 'CAD' ? 0.73 : 1,
    ),
  };
  return { svc, getRateQuotes };
}

const quote = (
  svc: any,
  address: Record<string, string>,
  itemsSubtotal: number,
  extra: Record<string, unknown> = {},
) =>
  svc.quoteCheckoutShipping({
    user: { _id: 'u1', country: address.country },
    items,
    shippingAddress: address,
    itemsSubtotal,
    orderCurrency: 'USD',
    rateToUsd: 1,
    ...extra,
  });

describe('FedEx destinations', () => {
  it.each([
    ['Canada', '', true],
    ['canada', 'Ontario', true],
    ['United States', 'Hawaii', true],
    ['USA', 'AK', true],
    ['United States', 'Puerto Rico', true],
    ['Puerto Rico', '', true],
    ['United States', 'California', false],
    ['United States', '', false],
    ['Germany', 'Berlin', false],
    ['Mexico', '', false],
  ])('%s / %s → %s', (country, state, expected) => {
    expect(isFedexShippingDestination(country, state)).toBe(expected);
  });
});

describe('Postal code formats', () => {
  it.each([
    ['90210', 'US', null],
    ['90210-1234', 'US', null],
    ['1234', 'US', 'format'],
    ['S7J 4M6', 'CA', null],
    ['S7J4M6', 'CA', null],
    ['Z9Z 9Z9', 'CA', 'format'],
    ['00901', 'PR', null],
    ['ABCDE', 'PR', 'format'],
    ['10117', 'DE', null],
    ['54000', 'PK', null],
    ['', 'US', 'required'],
  ])('%s (%s)', (postcode, cc, expected) => {
    const error = getPostalCodeFormatError(postcode, cc);
    if (expected === null) expect(error).toBeNull();
    else expect(error?.toLowerCase()).toContain(expected);
  });
});

describe('OrdersService.quoteCheckoutShipping', () => {
  it.each([
    ['canada', 285],
    ['canada', 700],
    ['hawaii', 285],
    ['hawaii', 700],
    ['alaska', 700],
    ['puertoRicoState', 700],
    ['puertoRicoCountry', 285],
  ] as const)(
    'charges FedEx for %s at $%s (no free threshold)',
    async (key, subtotal) => {
      const { svc, getRateQuotes } = buildOrdersService();
      const result = await quote(svc, addresses[key], subtotal);
      expect(result).toMatchObject({ source: 'fedex', shippingFee: 40.75 });
      expect(getRateQuotes).toHaveBeenCalledTimes(1);
    },
  );

  it('rates Puerto Rico as its own country, also when entered as a US state', async () => {
    const { svc, getRateQuotes } = buildOrdersService();
    await quote(svc, addresses.puertoRicoState, 285);
    const { recipient } = getRateQuotes.mock.calls[0][0];
    expect(recipient.countryCode).toBe('PR');
    expect(recipient.stateOrProvinceCode).toBeUndefined();
  });

  it('keeps the flat rule elsewhere: $25 under 500, free over 500', async () => {
    const { svc, getRateQuotes } = buildOrdersService();
    expect(await quote(svc, addresses.california, 285)).toMatchObject({
      source: 'flat',
      shippingFee: 25,
    });
    expect(await quote(svc, addresses.california, 700)).toMatchObject({
      source: 'free',
      shippingFee: 0,
    });
    expect(
      await quote(svc, addresses.germany, 285, { orderCurrency: 'EUR' }),
    ).toMatchObject({ source: 'flat', shippingFee: 25 });
    expect(getRateQuotes).not.toHaveBeenCalled();
  });

  it('is free for pickup and the Certification Kit, even in FedEx regions', async () => {
    const { svc, getRateQuotes } = buildOrdersService();
    expect(
      await quote(svc, addresses.canada, 285, { isPickup: true }),
    ).toMatchObject({ source: 'free', shippingFee: 0 });
    expect(
      await quote(svc, addresses.hawaii, 285, {
        includesCertificationKit: true,
      }),
    ).toMatchObject({ source: 'free', shippingFee: 0 });
    expect(getRateQuotes).not.toHaveBeenCalled();
  });

  it('falls back to the flat $25 (not free) when FedEx fails, even over 500', async () => {
    const { svc } = buildOrdersService({
      rateQuotes: jest.fn().mockRejectedValue(new Error('FedEx down')),
    });
    expect(await quote(svc, addresses.canada, 700)).toMatchObject({
      source: 'flat',
      shippingFee: 25,
    });
  });

  it('converts a USD FedEx quote into the order currency', async () => {
    const { svc } = buildOrdersService();
    const result = await quote(svc, addresses.canada, 285, {
      orderCurrency: 'CAD',
      rateToUsd: 0.73,
    });
    // 40.75 USD / 0.73 USD per CAD
    expect(result.currency).toBe('CAD');
    expect(result.shippingFee).toBeCloseTo(55.82, 2);
  });

  it('looks up a missing Hub state from its ZIP', async () => {
    const geoLookup = jest
      .fn()
      .mockResolvedValue({ valid: true, verified: true, stateCode: 'TN' });
    const { svc, getRateQuotes } = buildOrdersService({
      hub: { ...hub, state: undefined },
      geoLookup,
    });
    const result = await quote(svc, addresses.canada, 285);
    expect(result.source).toBe('fedex');
    expect(geoLookup).toHaveBeenCalledWith('38116', 'United States');
    expect(getRateQuotes.mock.calls[0][0].shipper.stateOrProvinceCode).toBe(
      'TN',
    );
  });

  it('adds per-size weights (1 LB default) to the FedEx weight', async () => {
    const { svc, getRateQuotes } = buildOrdersService();
    svc.productsService.getSizeWeightsByProductIds.mockResolvedValue(
      new Map([['p1', new Map([['250mL', 2.5]])]]),
    );
    await svc.quoteCheckoutShipping({
      user: { _id: 'u1', country: 'Canada' },
      items: [
        ...items,
        { product: 'p2', name: 'Cleaner', size: '1L', quantity: 1, price: 10 },
      ],
      shippingAddress: addresses.canada,
      itemsSubtotal: 295,
      orderCurrency: 'USD',
      rateToUsd: 1,
    });
    // 3 × 2.5 LB + 1 × 1 LB default
    expect(getRateQuotes.mock.calls[0][0].weight).toBe(8.5);
  });
});

describe('Pickup is limited to FedEx regions', () => {
  const pickupService = (shop: Record<string, unknown>) => {
    const svc: any = Object.create(OrdersService.prototype);
    svc.usersService = {
      findOne: jest.fn().mockResolvedValue({
        _id: 's1',
        role: UserRole.CERTIFIED_SHOP,
        pickupEnabled: true,
        hubPartnerCode: 'HUB1',
        ...shop,
      }),
      resolveActingParentPartnerCodeForShop: jest
        .fn()
        .mockResolvedValue('HUB1'),
      findByPartnerCode: jest.fn().mockResolvedValue({
        ...hub,
        firstName: 'Hub',
        phoneNumber: '+1',
      }),
    };
    return svc;
  };

  it.each([
    [{ country: 'Canada' }, true],
    [{ country: 'United States', state: 'Hawaii' }, true],
    [{ country: 'Puerto Rico' }, true],
    [{ country: 'United States', state: 'California' }, false],
    [{ country: 'Spain' }, false],
  ])('%o → pickup offered: %s', async (shop, offered) => {
    const hubForPickup = await pickupService(shop).getPickupHubForUser('s1');
    expect(Boolean(hubForPickup)).toBe(offered);
  });

  it('rejects enabling pickup for a shop outside the FedEx regions', async () => {
    const users: any = Object.create(UsersService.prototype);
    const updateOne = jest.fn(() => ({ exec: async () => undefined }));
    users.assertViewerCanManageShopToggle = jest
      .fn()
      .mockResolvedValue(undefined);
    users.invalidateNetworkAndOrderCaches = jest
      .fn()
      .mockResolvedValue(undefined);
    users.userModel = {
      findById: jest.fn(() => ({
        select: () => ({
          lean: () => ({ exec: async () => ({ country: 'Spain' }) }),
        }),
      })),
      updateOne,
    };

    await expect(
      users.setShopPickupEnabled('s1', true, { role: UserRole.ADMIN }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateOne).not.toHaveBeenCalled();

    // Turning it off is always allowed.
    await users.setShopPickupEnabled('s1', false, { role: UserRole.ADMIN });
    expect(updateOne).toHaveBeenCalledTimes(1);
  });
});

describe('GeoService.validatePostcode', () => {
  const geo = () =>
    new GeoService(
      new ConfigService({ GEOAPIFY_API: 'key' }),
      new FedexService(new ConfigService({})),
    );

  beforeEach(() => mockedAxios.get.mockReset());

  it('rejects a bad format without calling Geoapify', async () => {
    const result = await geo().validatePostcode('Z9Z 9Z9', 'Canada');
    expect(result.valid).toBe(false);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects a ZIP from another state', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        results: [{ postcode: '96813', state: 'Hawaii', state_code: 'HI' }],
      },
    });
    const result = await geo().validatePostcode(
      '96813',
      'United States',
      'Alaska',
    );
    expect(result).toMatchObject({ valid: false });
    expect(result.message).toContain('Hawaii');
  });

  it('looks up Puerto Rico ZIPs under the US', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        results: [
          { postcode: '00901', state: 'Puerto Rico', state_code: 'PR' },
        ],
      },
    });
    const result = await geo().validatePostcode('00901', 'Puerto Rico');
    expect(result).toMatchObject({ valid: true, verified: true });
    expect(mockedAxios.get.mock.calls[0][1]?.params?.filter).toBe(
      'countrycode:us',
    );
  });

  it('rejects a ZIP that does not exist', async () => {
    mockedAxios.get.mockResolvedValue({ data: { results: [] } });
    const result = await geo().validatePostcode(
      '00000',
      'United States',
      'Alaska',
    );
    expect(result.valid).toBe(false);
  });

  it('does not block checkout when the lookup fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network'));
    const result = await geo().validatePostcode(
      '90210',
      'United States',
      'California',
    );
    expect(result).toMatchObject({ valid: true, verified: false });
  });
});
