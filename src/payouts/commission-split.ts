import { Types } from 'mongoose';

/** Strip withdrawal split suffixes so "Shop Introduction (partial)" matches the original type. */
export function canonicalEarningType(earningType?: string | null): string {
  const raw = String(earningType || '').trim();
  if (!raw) return 'Shop Introduction';
  return (
    raw.replace(/\s*\(partial[^)]*\)\s*$/i, '').trim() || 'Shop Introduction'
  );
}

/** Unique earningType so Mongo unique (orderId, recipient, earningType) allows multiple partial locks. */
export function uniqueSplitEarningType(
  earningType?: string | null,
  splitId?: string,
): string {
  const id = splitId || new Types.ObjectId().toHexString();
  return `${canonicalEarningType(earningType)} (partial:${id})`;
}

export function missingCommissionAmount(
  expectedAmount: number,
  recordAmounts: number[],
): number {
  const expected = Math.round(Number(expectedAmount || 0) * 100) / 100;
  const sum =
    Math.round(
      recordAmounts.reduce((total, value) => total + Number(value || 0), 0) * 100,
    ) / 100;
  const missing = Math.round((expected - sum) * 100) / 100;
  return missing > 0.01 ? missing : 0;
}
