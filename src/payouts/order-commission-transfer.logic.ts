import { OrderCommissionTransferStatus } from './entities/order-commission-transfer.entity';
import {
  StripeWisePayoutStatus,
  WiseReceiptStatus,
} from './stripe-wise-payouts.logic';

export type OrderCommissionTransferLine = {
  recipientUserId?: string;
  recipientPartnerCode?: string;
  earningType?: string;
  amount: number;
  percentage?: number;
};

export function extractCommissionLines(
  commissions?: Array<{
    recipientUserId?: string;
    recipientPartnerCode?: string;
    earningType?: string;
    amount?: number;
    percentage?: number;
  }> | null,
): OrderCommissionTransferLine[] {
  if (!Array.isArray(commissions)) return [];
  return commissions
    .map((row) => ({
      recipientUserId: row.recipientUserId
        ? String(row.recipientUserId)
        : undefined,
      recipientPartnerCode: row.recipientPartnerCode || undefined,
      earningType: row.earningType || undefined,
      amount: Math.round(Number(row.amount ?? 0) * 100) / 100,
      percentage:
        row.percentage != null && Number.isFinite(Number(row.percentage))
          ? Number(row.percentage)
          : undefined,
    }))
    .filter((row) => row.amount > 0);
}

export function summarizeCommissionTypes(
  lines: OrderCommissionTransferLine[],
): string {
  if (!lines.length) return '—';
  const shortLabel = (type?: string) => {
    switch (type) {
      case 'Partner Development':
        return 'Partner';
      case 'Shop Introduction':
        return 'Shop';
      case 'Operational Support':
        return 'Operational';
      default:
        return type || 'Commission';
    }
  };
  const unique = Array.from(
    new Set(lines.map((line) => shortLabel(line.earningType))),
  );
  return unique.join(' + ');
}

export function sumOrderCommissionAmount(
  commissions?: Array<{ amount?: number }> | null,
): number {
  return sumCommissionLines(extractCommissionLines(commissions as any));
}

export function sumCommissionLines(
  lines: OrderCommissionTransferLine[],
): number {
  if (!lines.length) return 0;
  const total = lines.reduce((sum, row) => sum + row.amount, 0);
  return Math.round(total * 100) / 100;
}

export function buildOrderCommissionIdempotencyKey(
  orderId: string,
  retryCount = 0,
): string {
  const base = `order-commission:${orderId}`;
  return retryCount > 0 ? `${base}:retry:${retryCount}` : base;
}

export function mapStripePayoutToTransferStatus(
  stripeStatus?: StripeWisePayoutStatus | string | null,
  wiseStatus?: WiseReceiptStatus | string | null,
): OrderCommissionTransferStatus {
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
    return 'failed';
  }
  if (stripeStatus === 'paid') {
    return 'completed';
  }
  if (
    stripeStatus === 'creating' ||
    stripeStatus === 'pending' ||
    stripeStatus === 'in_transit'
  ) {
    return 'processing';
  }
  if (wiseStatus === 'received') {
    return 'completed';
  }
  return 'pending';
}

export function transferStatusLabel(status: OrderCommissionTransferStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'processing':
      return 'Processing';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return String(status);
  }
}

export function isRetryableTransferStatus(
  status: OrderCommissionTransferStatus,
): boolean {
  return status === 'failed' || status === 'pending';
}
