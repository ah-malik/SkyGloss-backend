import { isRegistrationOrder } from '../common/order-totals';
import {
  resolveShopOrderStripeAccountKey,
  StripeAccountKey,
} from './stripe-wise-payouts.logic';

export type PaymentBreakdownBucket = {
  count: number;
  amount: number;
};

export type StripeAccountPaymentBreakdown = {
  stripeAccountKey: StripeAccountKey;
  registration: PaymentBreakdownBucket;
  shopOrder: PaymentBreakdownBucket;
  total: PaymentBreakdownBucket;
};

export type StripePaymentBreakdown = {
  currency: string;
  note: string;
  accounts: Record<StripeAccountKey, StripeAccountPaymentBreakdown>;
  combined: {
    registration: PaymentBreakdownBucket;
    shopOrder: PaymentBreakdownBucket;
    total: PaymentBreakdownBucket;
  };
};

function emptyBucket(): PaymentBreakdownBucket {
  return { count: 0, amount: 0 };
}

function emptyAccount(key: StripeAccountKey): StripeAccountPaymentBreakdown {
  return {
    stripeAccountKey: key,
    registration: emptyBucket(),
    shopOrder: emptyBucket(),
    total: emptyBucket(),
  };
}

function addBucket(
  target: PaymentBreakdownBucket,
  amount: number,
): void {
  target.count += 1;
  target.amount = Math.round((target.amount + amount) * 100) / 100;
}

export function buildStripePaymentBreakdown(
  orders: Array<{
    orderNumber?: string;
    items?: { product?: string }[];
    totalAmount?: number;
    baseCurrencyAmount?: number;
    shippingAddress?: { country?: string };
    user?: { country?: string } | string;
  }>,
  currency = 'USD',
): StripePaymentBreakdown {
  const accounts: Record<StripeAccountKey, StripeAccountPaymentBreakdown> = {
    global: emptyAccount('global'),
    usa: emptyAccount('usa'),
    europe: emptyAccount('europe'),
  };

  for (const order of orders) {
    const amount = Number(order.totalAmount ?? order.baseCurrencyAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const userCountry =
      typeof order.user === 'object' && order.user !== null
        ? order.user.country
        : undefined;
    const stripeAccountKey = resolveShopOrderStripeAccountKey(
      order.shippingAddress?.country,
      userCountry,
    );
    const bucket = accounts[stripeAccountKey];
    const category = isRegistrationOrder(order) ? 'registration' : 'shopOrder';

    addBucket(bucket[category], amount);
    addBucket(bucket.total, amount);
  }

  const combined = {
    registration: emptyBucket(),
    shopOrder: emptyBucket(),
    total: emptyBucket(),
  };
  for (const key of ['global', 'usa', 'europe'] as const) {
    combined.registration.count += accounts[key].registration.count;
    combined.registration.amount = Math.round(
      (combined.registration.amount + accounts[key].registration.amount) * 100,
    ) / 100;
    combined.shopOrder.count += accounts[key].shopOrder.count;
    combined.shopOrder.amount = Math.round(
      (combined.shopOrder.amount + accounts[key].shopOrder.amount) * 100,
    ) / 100;
    combined.total.count += accounts[key].total.count;
    combined.total.amount = Math.round(
      (combined.total.amount + accounts[key].total.amount) * 100,
    ) / 100;
  }

  return {
    currency,
    note:
      'Paid orders with Stripe checkout in SkyGloss. Stripe balance may differ after payouts, refunds, or fees.',
    accounts,
    combined,
  };
}
