import { BadRequestException } from '@nestjs/common';
import { StripeWisePayoutsService } from './stripe-wise-payouts.service';

function mockDoc(data: Record<string, unknown>): any {
  return {
    ...data,
    save: jest.fn().mockResolvedValue(true),
  };
}

describe('StripeWisePayoutsService', () => {
  let service: StripeWisePayoutsService;
  let destinationModel: any;
  let payoutModel: any;
  let stripeAccounts: any;
  let moneyManagement: any;
  let wiseService: any;
  let destination: any;

  const adminId = '64b000000000000000000001';

  beforeEach(() => {
    destination = mockDoc({
      key: 'default',
      accountName: 'Wise USD Account',
      currency: 'USD',
      country: 'US',
      accountHolderName: 'SkyGloss',
      accountNumber: '000123456789',
      routingNumber: '110000000',
      stripeAccountKey: 'global',
      payoutToDefaultStripeBank: true,
      europeAccountName: 'COLUMN NA WISE (Wise US)',
      europeCurrency: 'USD',
      europeBankName: 'Column National Association',
      europeAccountNumber: '537681803567744',
      europeRoutingNumber: '084009519',
      europeSwiftBic: 'TRWIUS35XXX',
      europePayoutToDefaultStripeBank: true,
      iban: undefined,
    });

    const query = (result) => ({
      exec: jest.fn().mockResolvedValue(result),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
    });

    destinationModel = {
      findOne: jest.fn().mockReturnValue(query(destination)),
      create: jest.fn(),
    };

    payoutModel = {
      findOne: jest.fn().mockReturnValue(query(null)),
      find: jest.fn().mockReturnValue(query([])),
      create: jest.fn(),
      countDocuments: jest.fn().mockReturnValue(query(0)),
      findById: jest.fn().mockReturnValue(query(null)),
    };

    stripeAccounts = {
      inspect: jest.fn().mockResolvedValue({
        key: 'global',
        configured: true,
        livemode: false,
        payoutsEnabled: true,
        chargesEnabled: true,
        country: 'US',
        defaultCurrency: 'USD',
        accountId: 'acct_test',
        available: [{ currency: 'USD', available: 2500, pending: 0, sourceTypes: { card: 2500 } }],
        externalAccounts: [
          {
            id: 'ba_wise',
            last4: '6789',
            routingNumber: '110000000',
            country: 'US',
            currency: 'USD',
            bankName: 'Wise',
            status: 'verified',
            defaultForCurrency: true,
            availablePayoutMethods: ['standard'],
          },
        ],
      }),
      availableForCurrency: jest.fn().mockReturnValue(2500),
      preferredSourceType: jest.fn().mockReturnValue('card'),
      resolveDestination: jest.fn().mockReturnValue({
        ok: true,
        usedDefault: true,
        destinationId: 'ba_wise',
        summary: 'Wise • USD • ****6789',
      }),
      createPayout: jest.fn(),
      retrievePayout: jest.fn(),
    };

    moneyManagement = {
      listFinancialAccounts: jest.fn().mockResolvedValue({
        configured: true,
        accounts: [
          {
            id: 'fa_test',
            type: 'storage',
            status: 'open',
            country: 'US',
            displayName: 'Storage',
            balances: [{ currency: 'USD', available: 100, inboundPending: 0, outboundPending: 0 }],
          },
        ],
      }),
      availableOnAccount: jest.fn().mockReturnValue(100),
      resolveWiseOutboundTarget: jest.fn().mockResolvedValue({
        ok: true,
        recipientId: 'acct_recipient',
        payoutMethodId: 'usba_wise',
        summary: 'COLUMN NA WISE • ****7744',
      }),
      createOutboundPayment: jest.fn(),
      retrieveOutboundPayment: jest.fn(),
      mapOutboundStatus: jest.fn().mockReturnValue('paid'),
    };

    wiseService = {
      isConfigured: jest.fn().mockReturnValue(true),
      getAccountSummary: jest.fn().mockResolvedValue({
        profile: { name: 'SkyGloss' },
        environment: 'sandbox',
        balances: [{ currency: 'USD', amount: 100, reserved: 0 }],
      }),
      findIncomingCredit: jest.fn().mockResolvedValue({ available: true }),
      getReceivingAccountDetails: jest.fn().mockResolvedValue({
        configured: true,
        accounts: [
          {
            currency: 'USD',
            accountName: 'COLUMN NA WISE (Wise US)',
            bankName: 'Column National Association',
            accountNumber: '537681803567744',
            routingNumber: '084009519',
            swiftBic: 'TRWIUS35XXX',
            issued: true,
          },
        ],
      }),
    };

    const paymentsToFaModel = {
      findOne: jest.fn().mockReturnValue(query(null)),
      find: jest.fn().mockReturnValue(query([])),
      create: jest.fn(),
    };
    const paymentBreakdown = {
      getBreakdown: jest.fn().mockResolvedValue({
        accounts: {},
        combined: {},
        note: '',
      }),
    };
    const config = { get: jest.fn() };

    service = new StripeWisePayoutsService(
      destinationModel,
      payoutModel,
      paymentsToFaModel,
      stripeAccounts,
      moneyManagement,
      paymentBreakdown,
      wiseService,
      config,
    );
  });

  function dto(overrides: Record<string, unknown> = {}) {
    return {
      amount: 500,
      currency: 'USD',
      stripeAccountKey: 'global' as const,
      confirmed: true,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      ...overrides,
    };
  }

  it('creates a Stripe payout when balance and destination are valid', async () => {
    const created = mockDoc({
      _id: 'payout1',
      idempotencyKey: dto().idempotencyKey,
      amount: 500,
      currency: 'USD',
      stripeAccountKey: 'global',
      status: 'creating',
      wiseStatus: 'not_started',
      estimatedAmount: 500,
    });
    payoutModel.create.mockResolvedValue(created);
    stripeAccounts.createPayout.mockResolvedValue({
      id: 'po_success',
      status: 'pending',
      arrival_date: Math.floor(Date.now() / 1000) + 86400,
      destination: 'ba_wise',
    });

    const result = await service.createPayout(adminId, dto() as any);

    expect(stripeAccounts.createPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'global',
        amount: 50000,
        currency: 'USD',
        idempotencyKey: dto().idempotencyKey,
      }),
    );
    expect(result.stripePayoutId).toBe('po_success');
    expect(result.status).toBe('pending');
    expect(result.wiseStatus).toBe('not_started');
    expect(created.save).toHaveBeenCalled();
  });

  it('does not mark Wise as received just because Stripe payout was created', async () => {
    const created = mockDoc({
      _id: 'payout1',
      amount: 500,
      currency: 'USD',
      stripeAccountKey: 'global',
      status: 'creating',
      wiseStatus: 'not_started',
      estimatedAmount: 500,
    });
    payoutModel.create.mockResolvedValue(created);
    stripeAccounts.createPayout.mockResolvedValue({
      id: 'po_paid_now',
      status: 'paid',
      destination: 'ba_wise',
    });
    wiseService.findIncomingCredit.mockResolvedValue({ available: true });

    const result = await service.createPayout(adminId, dto() as any);

    expect(result.status).toBe('paid');
    expect(result.wiseStatus).toBe('awaiting_receipt');
    expect(result.settlement).toBeNull();
  });

  it('rejects amounts above the Stripe available balance', async () => {
    stripeAccounts.availableForCurrency.mockReturnValue(2500);

    await expect(
      service.createPayout(adminId, dto({ amount: 3000 }) as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(stripeAccounts.createPayout).not.toHaveBeenCalled();
    expect(payoutModel.create).not.toHaveBeenCalled();
  });

  it('rejects zero or negative amounts', async () => {
    await expect(
      service.createPayout(adminId, dto({ amount: 0 }) as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stripeAccounts.createPayout).not.toHaveBeenCalled();
  });

  it('does not send a payout until the admin confirms', async () => {
    await expect(
      service.createPayout(adminId, dto({ confirmed: false }) as any),
    ).rejects.toThrow(/Confirm the payout/);
    expect(stripeAccounts.createPayout).not.toHaveBeenCalled();
  });

  it('returns the existing record for a duplicate idempotency key', async () => {
    const existing = mockDoc({
      _id: 'existing',
      idempotencyKey: dto().idempotencyKey,
      amount: 500,
      currency: 'USD',
      stripeAccountKey: 'global',
      status: 'pending',
      wiseStatus: 'not_started',
      stripePayoutId: 'po_existing',
      estimatedAmount: 500,
    });
    payoutModel.findOne.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(existing),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
    });

    const result = await service.createPayout(adminId, dto() as any);

    expect(result.stripePayoutId).toBe('po_existing');
    expect(stripeAccounts.createPayout).not.toHaveBeenCalled();
  });

  it('blocks a second in-flight payout of the same amount', async () => {
    payoutModel.findOne
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(null),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(
          mockDoc({
            _id: 'recent',
            amount: 500,
            currency: 'USD',
            status: 'pending',
          }),
        ),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
      });

    await expect(
      service.createPayout(
        adminId,
        dto({ idempotencyKey: '22222222-2222-4222-8222-222222222222' }) as any,
      ),
    ).rejects.toThrow(/already in progress/);
    expect(stripeAccounts.createPayout).not.toHaveBeenCalled();
  });

  it('records a failed Stripe payout without pretending Wise received funds', async () => {
    const created = mockDoc({
      _id: 'payout-fail',
      amount: 500,
      currency: 'USD',
      stripeAccountKey: 'global',
      status: 'creating',
      wiseStatus: 'not_started',
      estimatedAmount: 500,
    });
    payoutModel.create.mockResolvedValue(created);
    stripeAccounts.createPayout.mockRejectedValue({
      code: 'balance_insufficient',
      message: 'Insufficient funds',
    });

    await expect(
      service.createPayout(adminId, dto() as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(created.status).toBe('failed');
    expect(created.wiseStatus).toBe('not_started');
    expect(created.save).toHaveBeenCalled();
  });

  it('shows a configuration error when Stripe cannot pay the Wise account', async () => {
    stripeAccounts.resolveDestination.mockReturnValue({
      ok: false,
      error:
        'This Stripe account cannot pay out to the configured Wise receiving account.',
    });

    await expect(
      service.createPayout(adminId, dto() as any),
    ).rejects.toThrow(/cannot pay out to the configured Wise/);
    expect(stripeAccounts.createPayout).not.toHaveBeenCalled();
  });
});
