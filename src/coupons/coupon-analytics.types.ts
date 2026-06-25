export interface CouponUsageStats {
  usageCount: number;
  uniqueUsersCount: number;
  orderCount: number;
  paidOrderCount: number;
  totalDiscountAmount: number;
  totalRevenue: number;
}

export interface CouponAnalyticsTotals extends CouponUsageStats {
  totalCoupons: number;
  activeCoupons: number;
}

export interface CouponAnalyticsRow {
  _id: string;
  code: string;
  discountType: string;
  discountValue: number;
  isActive: boolean;
  expiresAt?: Date;
  maxUses?: number;
  timesUsed: number;
  description?: string;
  createdAt?: Date;
  stats: CouponUsageStats;
}

export interface CouponAnalyticsOverview {
  totals: CouponAnalyticsTotals;
  coupons: CouponAnalyticsRow[];
}

export interface CouponTransactionLogEntry {
  orderId: string;
  orderNumber: string;
  orderAmount: number;
  discountAmount: number;
  currency: string;
  status: string;
  placedAt: Date;
  user: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    shopName?: string;
    role?: string;
  } | null;
}

export interface CouponReport {
  coupon: CouponAnalyticsRow;
  summary: CouponUsageStats;
  transactions: CouponTransactionLogEntry[];
}
