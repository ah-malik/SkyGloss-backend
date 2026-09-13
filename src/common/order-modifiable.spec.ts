import { OrderStatus } from '../orders/entities/order.entity';
import { shouldMarkFailedOnCheckoutExpire } from './order-modifiable';

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
