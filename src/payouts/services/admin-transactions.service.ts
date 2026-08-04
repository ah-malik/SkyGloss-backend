import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CommissionLifecycleStatus,
  CommissionRecord,
  CommissionRecordDocument,
} from '../entities/commission-record.entity';
import {
  WithdrawalRequest,
  WithdrawalRequestDocument,
  WithdrawalStatus,
} from '../entities/withdrawal-request.entity';
import {
  WebsiteWallet,
  WebsiteWalletDocument,
} from '../entities/website-wallet.entity';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTransactionType,
} from '../entities/wallet-transaction.entity';
import {
  TransactionHistory,
  TransactionHistoryDocument,
} from '../entities/transaction-history.entity';

const round = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class AdminTransactionsService {
  constructor(
    @InjectModel(CommissionRecord.name)
    private commissionModel: Model<CommissionRecordDocument>,
    @InjectModel(WithdrawalRequest.name)
    private withdrawalModel: Model<WithdrawalRequestDocument>,
    @InjectModel(WebsiteWallet.name)
    private walletModel: Model<WebsiteWalletDocument>,
    @InjectModel(WalletTransaction.name)
    private walletTxModel: Model<WalletTransactionDocument>,
    @InjectModel(TransactionHistory.name)
    private transactionHistoryModel: Model<TransactionHistoryDocument>,
  ) {}

  async getSummary() {
    const [
      commissionByStatus,
      withdrawalByStatus,
      walletTotals,
      walletTxTotals,
      transactionCount,
    ] = await Promise.all([
      this.commissionModel.aggregate([
        {
          $group: {
            _id: '$status',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.withdrawalModel.aggregate([
        {
          $group: {
            _id: '$status',
            total: { $sum: '$requestedAmount' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.walletModel.aggregate([
        {
          $group: {
            _id: null,
            totalBalance: { $sum: '$availableBalance' },
            lifetimeWithdrawn: { $sum: '$lifetimeWithdrawn' },
            walletCount: { $sum: 1 },
          },
        },
      ]),
      this.walletTxModel.aggregate([
        {
          $group: {
            _id: '$type',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.transactionHistoryModel.countDocuments(),
    ]);

    const commissionMap = Object.fromEntries(
      commissionByStatus.map((r) => [r._id, { total: r.total, count: r.count }]),
    );

    const getCommission = (status: string) =>
      commissionMap[status] || { total: 0, count: 0 };

    const pendingHold = getCommission(CommissionLifecycleStatus.PENDING_HOLD);
    const available = getCommission(CommissionLifecycleStatus.AVAILABLE);
    const locked = getCommission(CommissionLifecycleStatus.LOCKED);
    const withdrawnComm = getCommission(CommissionLifecycleStatus.WITHDRAWN);
    const cancelled = getCommission(CommissionLifecycleStatus.CANCELLED);

    const totalDistributed = round(
      pendingHold.total +
        available.total +
        locked.total +
        withdrawnComm.total,
    );

    const withdrawalMap = Object.fromEntries(
      withdrawalByStatus.map((r) => [r._id, { total: r.total, count: r.count }]),
    );
    const getWithdrawal = (status: string) =>
      withdrawalMap[status] || { total: 0, count: 0 };

    const completed = getWithdrawal(WithdrawalStatus.COMPLETED);
    const sentToAdmin = getWithdrawal(WithdrawalStatus.SENT_TO_ADMIN);
    const waitingHub = getWithdrawal(WithdrawalStatus.WAITING_HUB_APPROVAL);
    const paymentProcessing = getWithdrawal(WithdrawalStatus.PAYMENT_PROCESSING);

    const pendingWithdrawalTotal = round(
      waitingHub.total +
        sentToAdmin.total +
        paymentProcessing.total +
        (withdrawalMap[WithdrawalStatus.HUB_APPROVED]?.total || 0) +
        (withdrawalMap[WithdrawalStatus.ADMIN_APPROVED]?.total || 0) +
        (withdrawalMap[WithdrawalStatus.WAITING_BANK_DETAILS]?.total || 0),
    );

    const walletRow = walletTotals[0] || {
      totalBalance: 0,
      lifetimeWithdrawn: 0,
      walletCount: 0,
    };

    const hubCredits =
      walletTxTotals.find((t) => t._id === WalletTransactionType.HUB_APPROVAL_CREDIT)
        ?.total || 0;
    const adminPayouts = Math.abs(
      walletTxTotals.find((t) => t._id === WalletTransactionType.ADMIN_PAYOUT_DEBIT)
        ?.total || 0,
    );

    return {
      currency: 'USD',
      commissions: {
        totalDistributed,
        pendingHold: round(pendingHold.total),
        available: round(available.total),
        locked: round(locked.total),
        withdrawn: round(withdrawnComm.total),
        cancelled: round(cancelled.total),
        recordCounts: {
          pendingHold: pendingHold.count,
          available: available.count,
          locked: locked.count,
          withdrawn: withdrawnComm.count,
          cancelled: cancelled.count,
        },
      },
      withdrawals: {
        totalProcessed: round(completed.total),
        pendingTotal: pendingWithdrawalTotal,
        waitingHub: round(waitingHub.total),
        sentToAdmin: round(sentToAdmin.total),
        paymentProcessing: round(paymentProcessing.total),
        completedCount: completed.count,
        pendingCount:
          waitingHub.count +
          sentToAdmin.count +
          paymentProcessing.count,
      },
      wallets: {
        totalBalance: round(walletRow.totalBalance),
        lifetimeWithdrawn: round(walletRow.lifetimeWithdrawn),
        totalHubCredits: round(hubCredits),
        totalPayoutsProcessed: round(adminPayouts),
        walletCount: walletRow.walletCount,
      },
      activity: {
        totalLoggedTransactions: transactionCount,
      },
    };
  }

  async listTransactions(filters?: {
    category?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 30, 100);
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};
    if (filters?.category && filters.category !== 'all') {
      query.category = filters.category;
    }
    if (filters?.search?.trim()) {
      const regex = new RegExp(filters.search.trim(), 'i');
      query.$or = [{ title: regex }, { referenceId: regex }];
    }

    const [items, total] = await Promise.all([
      this.transactionHistoryModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'firstName lastName email partnerCode role')
        .lean(),
      this.transactionHistoryModel.countDocuments(query),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        id: t._id?.toString?.(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async listWalletMovements(filters?: { page?: number; limit?: number }) {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 30, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.walletTxModel
        .find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'firstName lastName email partnerCode role')
        .populate('performedBy', 'firstName lastName email')
        .lean(),
      this.walletTxModel.countDocuments(),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        id: t._id?.toString?.(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
