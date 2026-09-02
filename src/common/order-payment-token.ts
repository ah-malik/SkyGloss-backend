import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_PREFIX = 'order-pay:';

export function createOrderPaymentToken(
  orderId: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${TOKEN_PREFIX}${orderId}`)
    .digest('hex');
}

export function verifyOrderPaymentToken(
  orderId: string,
  token: string | undefined,
  secret: string,
): boolean {
  if (!orderId || !token || !secret) return false;
  const expected = createOrderPaymentToken(orderId, secret);
  try {
    const left = Buffer.from(token, 'hex');
    const right = Buffer.from(expected, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
