import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OrderCommissionTransfer,
  OrderCommissionTransferDocument,
} from '../entities/order-commission-transfer.entity';
import {
  StripeEuropeCommissionWithdrawal,
  StripeEuropeCommissionWithdrawalDocument,
} from '../entities/stripe-europe-commission-withdrawal.entity';
import { CreateEuropeCommissionWithdrawalDto } from '../dto/create-europe-commission-withdrawal.dto';

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

@Injectable()
export class EuropeCommissionTrackingService {
  constructor(
    @InjectModel(OrderCommissionTransfer.name)
    private readonly transferModel: Model<OrderCommissionTransferDocument>,
    @InjectModel(StripeEuropeCommissionWithdrawal.name)
    private readonly withdrawalModel: Model<StripeEuropeCommissionWithdrawalDocument>,
  ) {}

  /**
   * Stripe Europe only: lifetime commission earned from order transfers,
   * admin-recorded received/withdrawn amounts, remaining balance, and history.
   */
  async getTracking(params?: { page?: number; limit?: number }) {
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 50));

    const [earnedAgg, withdrawnAgg, items, historyTotal] = await Promise.all([
      this.transferModel
        .aggregate<{ total: number; count: number }>([
          { $match: { stripeAccountKey: 'europe' } },
          {
            $group: {
              _id: null,
              total: { $sum: '$commissionAmount' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
      this.withdrawalModel
        .aggregate<{ total: number; count: number }>([
          {
            $group: {
              _id: null,
              total: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
      this.withdrawalModel
        .find()
        .sort({ receivedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.withdrawalModel.countDocuments().exec(),
    ]);

    const totalCommission = roundMoney(earnedAgg[0]?.total ?? 0);
    const commissionTransferCount = earnedAgg[0]?.count ?? 0;
    const totalReceived = roundMoney(withdrawnAgg[0]?.total ?? 0);
    const withdrawalCount = withdrawnAgg[0]?.count ?? 0;
    const remainingCommission = roundMoney(totalCommission - totalReceived);

    return {
      stripeAccountKey: 'europe' as const,
      currency: 'USD',
      totalCommission,
      totalReceived,
      remainingCommission,
      commissionTransferCount,
      withdrawalCount,
      history: {
        items: items.map((item) => this.toPublicWithdrawal(item)),
        total: historyTotal,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(historyTotal / limit)),
      },
    };
  }

  async recordWithdrawal(
    adminId: string,
    dto: CreateEuropeCommissionWithdrawalDto,
  ) {
    const amount = roundMoney(dto.amount);
    if (!(amount > 0)) {
      throw new BadRequestException('Amount must be greater than zero.');
    }

    const tracking = await this.getTracking({ page: 1, limit: 1 });
    if (amount > tracking.remainingCommission + 0.001) {
      throw new BadRequestException(
        `Amount exceeds remaining Europe commission (${tracking.remainingCommission.toFixed(2)} USD).`,
      );
    }

    let receivedAt = new Date();
    if (dto.receivedAt) {
      const parsed = new Date(dto.receivedAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid receivedAt date.');
      }
      receivedAt = parsed;
    }

    const note = dto.note?.trim() || undefined;

    const created = await this.withdrawalModel.create({
      createdBy: new Types.ObjectId(adminId),
      amount,
      currency: 'USD',
      receivedAt,
      note,
    });

    return {
      withdrawal: this.toPublicWithdrawal(created),
      tracking: await this.getTracking({ page: 1, limit: 50 }),
    };
  }

  private toPublicWithdrawal(item: StripeEuropeCommissionWithdrawalDocument) {
    return {
      id: String(item._id),
      amount: roundMoney(item.amount),
      currency: item.currency || 'USD',
      receivedAt: item.receivedAt,
      note: item.note || null,
      createdBy: item.createdBy ? String(item.createdBy) : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
