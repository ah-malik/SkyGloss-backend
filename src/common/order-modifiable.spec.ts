import { OrderStatus } from '../orders/entities/order.entity';
import {
  isOrderPaymentRecorded,
  isStripeCheckoutSessionPaid,
  paymentNotRecordedStatusFilter,
  shouldMarkFailedOnCheckoutExpire,
} from './order-modifiable';

describe('shouldMarkFailedOnCheckoutExpire', () => {
  it('does not fail already-paid orders when a leftover checkout session expires', () => {
    expect(shouldMarkFailedOnCheckoutExpire(OrderStatus.PAID)).toBe(false);
  });

  it('does not fail pending-payment, shipped, delivered, cancelled, or failed orders', () => {
    expect(shouldMarkFailedOnCheckoutExpire(OrderStatus.PENDING_PAYMENT)).toBe(
      false,
    );
    expect(shouldMarkFailedOnCheckoutExpire(OrderStatus.SHIPPED)).toBe(false);
    expect(shouldMarkFailedOnCheckoutExpire(OrderStatus.DELIVERED)).toBe(false);
    expect(shouldMarkFailedOnCheckoutExpire(OrderStatus.CANCELLED)).toBe(false);
    expect(shouldMarkFailedOnCheckoutExpire(OrderStatus.FAILED)).toBe(false);
  });

  it('fails unpaid PENDING checkout orders', () => {
    expect(shouldMarkFailedOnCheckoutExpire(OrderStatus.PENDING)).toBe(true);
  });
});

describe('isOrderPaymentRecorded', () => {
  it('treats PAID, SHIPPED and DELIVERED as already paid (duplicate webhook must not reprocess)', () => {
    expect(isOrderPaymentRecorded(OrderStatus.PAID)).toBe(true);
    expect(isOrderPaymentRecorded(OrderStatus.SHIPPED)).toBe(true);
    expect(isOrderPaymentRecorded(OrderStatus.DELIVERED)).toBe(true);
    expect(isOrderPaymentRecorded('shipped')).toBe(true);
  });

  it('allows payment to be recorded for awaiting / pending / failed / cancelled orders', () => {
    expect(isOrderPaymentRecorded(OrderStatus.PENDING_PAYMENT)).toBe(false);
    expect(isOrderPaymentRecorded(OrderStatus.PENDING)).toBe(false);
    expect(isOrderPaymentRecorded(OrderStatus.FAILED)).toBe(false);
    expect(isOrderPaymentRecorded(OrderStatus.CANCELLED)).toBe(false);
    expect(isOrderPaymentRecorded(undefined)).toBe(false);
  });

  it('builds a Mongo filter excluding already-paid statuses', () => {
    expect(paymentNotRecordedStatusFilter()).toEqual({
      $nin: [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED],
    });
  });
});

describe('isStripeCheckoutSessionPaid', () => {
  it('accepts only verified paid sessions', () => {
    expect(isStripeCheckoutSessionPaid({ payment_status: 'paid' })).toBe(true);
    expect(
      isStripeCheckoutSessionPaid({ payment_status: 'no_payment_required' }),
    ).toBe(true);
  });

  it('rejects unpaid, missing or incomplete sessions', () => {
    expect(isStripeCheckoutSessionPaid({ payment_status: 'unpaid' })).toBe(false);
    expect(isStripeCheckoutSessionPaid({})).toBe(false);
    expect(isStripeCheckoutSessionPaid(null)).toBe(false);
  });
});
