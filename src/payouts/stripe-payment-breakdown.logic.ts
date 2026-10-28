import { isRegistrationOrder } from '../common/order-totals';
import { getEffectiveBaseAmount, roundMoney } from '../common/order-monetary';
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
  /** Amounts as charged on Stripe, per currency (e.g. EUR on Stripe Europe). */
  chargedByCurrency: Record<string, number>;
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
    chargedByCurrency: {},
  };
}

function addBucket(
  target: PaymentBreakdownBucket,
  amount: number,
): void {
  target.count += 1;
  target.amount = Math.round((target.amount + amount) * 100) / 100;
}

/**
 * Bucket paid Stripe checkouts by Stripe account. Amounts are the locked USD
 * base value (orders are charged in EUR, USD, … so raw totals can't be added);
 * chargedByCurrency keeps the original charged amounts per account.
 */
export function buildStripePaymentBreakdown(
  orders: Array<{
    orderNumber?: string;
    items?: { product?: string }[];
    totalAmount?: number;
    baseCurrencyAmount?: number;
    currency?: string;
    originalCurrency?: string;
    originalAmount?: number;
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
    const amount = Number(getEffectiveBaseAmount(order));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const userCountry =
      typeof order.user === 'object' && order.user !== null
        ? order.user.country
        : undefined;
    const isRegistration = isRegistrationOrder(order);
    // Same routing as checkout: registration by the user's country,
    // product orders by shipping country (then user country).
    const stripeAccountKey = isRegistration
      ? resolveShopOrderStripeAccountKey(
          undefined,
          userCountry || order.shippingAddress?.country,
        )
      : resolveShopOrderStripeAccountKey(
          order.shippingAddress?.country,
          userCountry,
        );
    const bucket = accounts[stripeAccountKey];
    const category = isRegistration ? 'registration' : 'shopOrder';

    addBucket(bucket[category], amount);
    addBucket(bucket.total, amount);

    const chargedCurrency = String(
      order.originalCurrency || order.currency || currency,
    ).toUpperCase();
    const chargedAmount = Number(order.originalAmount ?? order.totalAmount ?? 0);
    if (Number.isFinite(chargedAmount) && chargedAmount > 0) {
      bucket.chargedByCurrency[chargedCurrency] = roundMoney(
        (bucket.chargedByCurrency[chargedCurrency] || 0) + chargedAmount,
      );
    }
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
      'Paid, shipped and delivered orders with Stripe checkout, in USD at the rate locked on each order. Stripe balance may differ after payouts, refunds, or fees.',
    accounts,
    combined,
  };
}
