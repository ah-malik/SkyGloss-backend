import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Coupon,
  CouponDocument,
  CouponDiscountType,
  CouponUsageType,
} from './entities/coupon.entity';
import { Order, OrderDocument } from '../orders/entities/order.entity';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import {
  calculateCouponDiscountAmount,
  canUserRedeemShopRegistrationCoupon,
  isCouponCurrentlyValid,
  normalizeCouponCode,
} from '../common/coupon-discount';
import { StripeCouponSyncService } from './stripe-coupon-sync.service';
import { roundMoney } from '../common/order-monetary';
import {
  CouponAnalyticsOverview,
  CouponReport,
  CouponTransactionLogEntry,
  CouponUsageStats,
} from './coupon-analytics.types';

const PAID_ORDER_STATUSES = ['PAID', 'SHIPPED', 'DELIVERED'];

export interface CouponValidationResult {
  valid: true;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  discountAmount: number;
  description?: string;
}

export interface ShopRegistrationCouponResult extends CouponValidationResult {
  subtotal: number;
  totalAfterDiscount: number;
  isFullyCovered: boolean;
}

@Injectable()
export class CouponsService implements OnModuleInit {
  constructor(
    @InjectModel(Coupon.name)
    private couponModel: Model<CouponDocument>,
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,
    private stripeCouponSync: StripeCouponSyncService,
  ) {}

  async onModuleInit() {
    await this.couponModel.updateMany(
      { usageType: { $exists: false } },
      { $set: { usageType: CouponUsageType.ORDER } },
    );

    const legacyCode = 'CERTIFICATIONONUS';
    const existingLegacy = await this.couponModel.findOne({ code: legacyCode });
    if (!existingLegacy) {
      await this.couponModel.create({
        code: legacyCode,
        usageType: CouponUsageType.SHOP_REGISTRATION,
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 100,
        isActive: true,
        description: 'Legacy shop registration waiver (100% off)',
      });
    }
  }

  async create(createCouponDto: CreateCouponDto): Promise<Coupon> {
    const code = normalizeCouponCode(createCouponDto.code);
    if (!code) {
      throw new BadRequestException('Coupon code is required');
    }

    const existing = await this.couponModel.findOne({ code });
    if (existing) {
      throw new BadRequestException('Coupon code already exists');
    }

    this.validateDiscountValue(
      createCouponDto.discountType,
      createCouponDto.discountValue,
    );

    const coupon = new this.couponModel({
      ...createCouponDto,
      code,
      expiresAt: createCouponDto.expiresAt
        ? new Date(createCouponDto.expiresAt)
        : undefined,
      isActive: createCouponDto.isActive ?? true,
    });

    const saved = await coupon.save();
    this.stripeCouponSync.syncCouponToAllAccounts(saved as CouponDocument).catch(() => undefined);
    return saved;
  }

  async findAll(): Promise<Coupon[]> {
    return this.couponModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<Coupon> {
    const coupon = await this.couponModel.findById(id).exec();
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    return coupon;
  }

  async update(id: string, updateCouponDto: UpdateCouponDto): Promise<Coupon> {
    const coupon = await this.couponModel.findById(id);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    const nextType =
      updateCouponDto.discountType ?? coupon.discountType;
    const nextValue =
      updateCouponDto.discountValue ?? coupon.discountValue;

    if (
      updateCouponDto.discountType !== undefined ||
      updateCouponDto.discountValue !== undefined
    ) {
      this.validateDiscountValue(nextType, nextValue);
    }

    if (updateCouponDto.code !== undefined) {
      const code = normalizeCouponCode(updateCouponDto.code);
      if (!code) {
        throw new BadRequestException('Coupon code is required');
      }
      const duplicate = await this.couponModel.findOne({
        code,
        _id: { $ne: id },
      });
      if (duplicate) {
        throw new BadRequestException('Coupon code already exists');
      }
      coupon.code = code;
    }

    if (updateCouponDto.discountType !== undefined) {
      coupon.discountType = updateCouponDto.discountType;
    }
    if (updateCouponDto.usageType !== undefined) {
      coupon.usageType = updateCouponDto.usageType;
    }
    if (updateCouponDto.discountValue !== undefined) {
      coupon.discountValue = updateCouponDto.discountValue;
    }
    if (updateCouponDto.isActive !== undefined) {
      coupon.isActive = updateCouponDto.isActive;
    }
    if (updateCouponDto.description !== undefined) {
      coupon.description = updateCouponDto.description;
    }
    if ('maxUses' in updateCouponDto) {
      const rawMaxUses = (updateCouponDto as { maxUses?: number | string }).maxUses;
      coupon.maxUses =
        rawMaxUses === '' || rawMaxUses == null
          ? undefined
          : Number(rawMaxUses);
    }
    if ('expiresAt' in updateCouponDto) {
      const rawExpires = (updateCouponDto as { expiresAt?: string }).expiresAt;
      coupon.expiresAt = rawExpires ? new Date(rawExpires) : undefined;
    }

    const saved = await coupon.save();
    if (saved.usageType === CouponUsageType.SHOP_REGISTRATION) {
      if (saved.isActive === false || !isCouponCurrentlyValid(saved)) {
        this.stripeCouponSync.deactivateCouponPromos(saved.code).catch(() => undefined);
      } else {
        this.stripeCouponSync.syncCouponToAllAccounts(saved).catch(() => undefined);
      }
    }
    return saved;
  }

  async remove(id: string): Promise<void> {
    const result = await this.couponModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('Coupon not found');
    }
    this.stripeCouponSync.deactivateCouponPromos(result.code).catch(() => undefined);
  }

  async validateForCheckout(
    code: string,
    subtotal: number,
  ): Promise<CouponValidationResult> {
    const coupon = await this.findValidCoupon(
      code,
      CouponUsageType.ORDER,
    );
    const discountAmount = calculateCouponDiscountAmount(coupon, subtotal);

    return {
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount,
      description: coupon.description,
    };
  }

  async validateForShopRegistration(
    code: string,
    subtotal: number,
    existingUserCouponCode?: string,
  ): Promise<ShopRegistrationCouponResult> {
    if (
      !canUserRedeemShopRegistrationCoupon(existingUserCouponCode, code)
    ) {
      throw new BadRequestException(
        'This account has already used a registration coupon. Each user can redeem a coupon only once.',
      );
    }

    const alreadyRedeemedOnAccount =
      !!existingUserCouponCode &&
      normalizeCouponCode(existingUserCouponCode) === normalizeCouponCode(code);

    const coupon = alreadyRedeemedOnAccount
      ? await this.findShopRegistrationCoupon(code)
      : await this.findValidCoupon(code, CouponUsageType.SHOP_REGISTRATION);

    const discountAmount = calculateCouponDiscountAmount(coupon, subtotal);
    const totalAfterDiscount = Math.max(0, roundMoney(subtotal - discountAmount));

    return {
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount,
      description: coupon.description,
      subtotal: roundMoney(subtotal),
      totalAfterDiscount,
      isFullyCovered: totalAfterDiscount <= 0,
    };
  }

  async findShopRegistrationCoupon(code: string): Promise<CouponDocument> {
    const normalized = normalizeCouponCode(code);
    const coupon = await this.couponModel.findOne({ code: normalized });
    if (!coupon) {
      throw new BadRequestException('Invalid coupon code');
    }
    const usageType = coupon.usageType || CouponUsageType.ORDER;
    if (usageType !== CouponUsageType.SHOP_REGISTRATION) {
      throw new BadRequestException(
        'This coupon is only valid for order checkout',
      );
    }
    return coupon;
  }

  async findValidCoupon(
    code: string,
    expectedUsage?: CouponUsageType,
  ): Promise<CouponDocument> {
    const normalized = normalizeCouponCode(code);
    const coupon = await this.couponModel.findOne({ code: normalized });
    if (!coupon) {
      throw new BadRequestException('Invalid coupon code');
    }

    const usageType = coupon.usageType || CouponUsageType.ORDER;
    if (expectedUsage && usageType !== expectedUsage) {
      throw new BadRequestException(
        expectedUsage === CouponUsageType.ORDER
          ? 'This coupon is only valid for shop registration'
          : 'This coupon is only valid for order checkout',
      );
    }

    if (!isCouponCurrentlyValid(coupon)) {
      if (coupon.isActive === false) {
        throw new BadRequestException('This coupon is not active');
      }
      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        throw new BadRequestException('This coupon has expired');
      }
      throw new BadRequestException('This coupon is no longer available');
    }
    return coupon;
  }

  async recordUsage(code: string): Promise<void> {
    const normalized = normalizeCouponCode(code);
    await this.couponModel.updateOne(
      { code: normalized },
      { $inc: { timesUsed: 1 } },
    );
  }

  async getAnalyticsOverview(): Promise<CouponAnalyticsOverview> {
    const coupons = await this.couponModel.find().sort({ createdAt: -1 }).lean();
    const codes = coupons.map((c) => c.code);
    const statsByCode = await this.aggregateStatsByCode(codes);

    const couponRows = coupons.map((coupon) => ({
      ...coupon,
      _id: String(coupon._id),
      stats: statsByCode.get(coupon.code) ?? this.buildEmptyStats(),
    }));

    const totals: CouponAnalyticsOverview['totals'] = {
      ...this.buildEmptyStats(),
      totalCoupons: coupons.length,
      activeCoupons: coupons.filter((c) => c.isActive !== false).length,
      uniqueUsersCount: 0,
    };

    for (const row of couponRows) {
      totals.usageCount += row.stats.usageCount;
      totals.orderCount += row.stats.orderCount;
      totals.paidOrderCount += row.stats.paidOrderCount;
      totals.totalDiscountAmount = roundMoney(
        totals.totalDiscountAmount + row.stats.totalDiscountAmount,
      );
      totals.totalRevenue = roundMoney(
        totals.totalRevenue + row.stats.totalRevenue,
      );
    }

    const uniqueUserIds = await this.orderModel.distinct('user', {
      couponCode: { $in: codes },
    });
    totals.uniqueUsersCount = uniqueUserIds.filter(Boolean).length;

    return {
      totals,
      coupons: couponRows,
    };
  }

  async getCouponReport(id: string): Promise<CouponReport> {
    const couponDoc = await this.couponModel.findById(id).lean();
    if (!couponDoc) {
      throw new NotFoundException('Coupon not found');
    }

    const orders = await this.orderModel
      .find({ couponCode: couponDoc.code })
      .populate('user', 'firstName lastName email shopName role')
      .sort({ createdAt: -1 })
      .lean();

    const transactions = orders.map((order) =>
      this.mapOrderToTransaction(order),
    );
    const summary = this.summarizeTransactions(transactions);

    return {
      coupon: {
        ...couponDoc,
        _id: String(couponDoc._id),
        stats: summary,
      },
      summary,
      transactions,
    };
  }

  private buildEmptyStats(): CouponUsageStats {
    return {
      usageCount: 0,
      uniqueUsersCount: 0,
      orderCount: 0,
      paidOrderCount: 0,
      totalDiscountAmount: 0,
      totalRevenue: 0,
    };
  }

  private async aggregateStatsByCode(
    codes: string[],
  ): Promise<Map<string, CouponUsageStats>> {
    const map = new Map<string, CouponUsageStats>();
    if (codes.length === 0) return map;

    const rows = await this.orderModel.aggregate([
      { $match: { couponCode: { $in: codes } } },
      {
        $group: {
          _id: '$couponCode',
          orderCount: { $sum: 1 },
          uniqueUsers: { $addToSet: '$user' },
          totalDiscountAmount: { $sum: { $ifNull: ['$discount', 0] } },
          totalRevenue: {
            $sum: {
              $ifNull: ['$originalAmount', { $ifNull: ['$totalAmount', 0] }],
            },
          },
          paidOrderCount: {
            $sum: {
              $cond: [{ $in: ['$status', PAID_ORDER_STATUSES] }, 1, 0],
            },
          },
        },
      },
    ]);

    for (const row of rows) {
      map.set(row._id, {
        usageCount: row.orderCount,
        orderCount: row.orderCount,
        uniqueUsersCount: (row.uniqueUsers || []).filter(Boolean).length,
        paidOrderCount: row.paidOrderCount,
        totalDiscountAmount: roundMoney(row.totalDiscountAmount),
        totalRevenue: roundMoney(row.totalRevenue),
      });
    }

    return map;
  }

  private summarizeTransactions(
    transactions: CouponTransactionLogEntry[],
  ): CouponUsageStats {
    const uniqueUsers = new Set<string>();
    let paidOrderCount = 0;
    let totalDiscountAmount = 0;
    let totalRevenue = 0;

    for (const tx of transactions) {
      if (tx.user?.id) uniqueUsers.add(tx.user.id);
      if (PAID_ORDER_STATUSES.includes(tx.status)) paidOrderCount += 1;
      totalDiscountAmount += tx.discountAmount;
      totalRevenue += tx.orderAmount;
    }

    return {
      usageCount: transactions.length,
      orderCount: transactions.length,
      uniqueUsersCount: uniqueUsers.size,
      paidOrderCount,
      totalDiscountAmount: roundMoney(totalDiscountAmount),
      totalRevenue: roundMoney(totalRevenue),
    };
  }

  private mapOrderToTransaction(order: {
    _id: unknown;
    orderNumber?: string;
    originalAmount?: number;
    totalAmount?: number;
    discount?: number;
    originalCurrency?: string;
    currency?: string;
    status?: string;
    createdAt?: Date;
    user?: {
      _id?: unknown;
      firstName?: string;
      lastName?: string;
      email?: string;
      shopName?: string;
      role?: string;
    } | null;
  }): CouponTransactionLogEntry {
    const user = order.user;
    const userId = user?._id ?? user;

    return {
      orderId: String(order._id),
      orderNumber: String(order.orderNumber || ''),
      orderAmount: roundMoney(
        Number(order.originalAmount ?? order.totalAmount ?? 0),
      ),
      discountAmount: roundMoney(Number(order.discount ?? 0)),
      currency: String(
        order.originalCurrency || order.currency || 'USD',
      ).toUpperCase(),
      status: String(order.status || ''),
      placedAt: order.createdAt as Date,
      user: user && userId
        ? {
            id: String(userId),
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            shopName: user.shopName,
            role: user.role,
          }
        : null,
    };
  }

  private validateDiscountValue(
    discountType: CouponDiscountType,
    discountValue: number,
  ): void {
    if (discountValue < 0) {
      throw new BadRequestException('Discount value cannot be negative');
    }
    if (
      discountType === CouponDiscountType.PERCENTAGE &&
      discountValue > 100
    ) {
      throw new BadRequestException('Percentage discount cannot exceed 100%');
    }
    if (
      discountType === CouponDiscountType.FIXED &&
      discountValue <= 0
    ) {
      throw new BadRequestException('Fixed discount must be greater than 0');
    }
    if (
      discountType === CouponDiscountType.PERCENTAGE &&
      discountValue <= 0
    ) {
      throw new BadRequestException('Percentage discount must be greater than 0');
    }
  }
}
