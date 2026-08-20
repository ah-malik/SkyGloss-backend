import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WebsiteWallet,
  WebsiteWalletDocument,
} from '../entities/website-wallet.entity';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTransactionType,
} from '../entities/wallet-transaction.entity';

@Injectable()
export class WalletsService {
  constructor(
    @InjectModel(WebsiteWallet.name)
    private walletModel: Model<WebsiteWalletDocument>,
    @InjectModel(WalletTransaction.name)
    private walletTxModel: Model<WalletTransactionDocument>,
  ) {}

  async getOrCreateWallet(userId: string): Promise<WebsiteWalletDocument> {
    let wallet = await this.walletModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    if (!wallet) {
      wallet = await this.walletModel.create({
        userId: new Types.ObjectId(userId),
      });
    }
    return wallet;
  }

  async getWalletSummary(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return {
      availableBalance: wallet.availableBalance,
      pendingWithdrawalBalance: wallet.pendingWithdrawalBalance,
      lifetimeWithdrawn: wallet.lifetimeWithdrawn,
      currency: wallet.currency,
    };
  }

  async creditFromHubApproval(
    userId: string,
    amount: number,
    withdrawalRequestId: string,
    performedBy?: string,
  ) {
    const wallet = await this.getOrCreateWallet(userId);
    wallet.availableBalance = Math.round((wallet.availableBalance + amount) * 100) / 100;
    wallet.version += 1;
    await wallet.save();

    await this.walletTxModel.create({
      userId: new Types.ObjectId(userId),
      walletId: wallet._id,
      type: WalletTransactionType.HUB_APPROVAL_CREDIT,
      amount,
      balanceAfter: wallet.availableBalance,
      withdrawalRequestId: new Types.ObjectId(withdrawalRequestId),
      description: `Hub approved withdrawal credit`,
      performedBy: performedBy ? new Types.ObjectId(performedBy) : undefined,
    });

    return wallet;
  }

  async debitFromAdminPayout(
    userId: string,
    amount: number,
    withdrawalRequestId: string,
    performedBy?: string,
  ) {
    const existing = await this.walletTxModel.findOne({
      withdrawalRequestId: new Types.ObjectId(withdrawalRequestId),
      type: WalletTransactionType.ADMIN_PAYOUT_DEBIT,
    });
    if (existing) {
      return this.getOrCreateWallet(userId);
    }

    const wallet = await this.getOrCreateWallet(userId);
    wallet.availableBalance = Math.round((wallet.availableBalance - amount) * 100) / 100;
    wallet.lifetimeWithdrawn = Math.round((wallet.lifetimeWithdrawn + amount) * 100) / 100;
    wallet.version += 1;
    await wallet.save();

    await this.walletTxModel.create({
      userId: new Types.ObjectId(userId),
      walletId: wallet._id,
      type: WalletTransactionType.ADMIN_PAYOUT_DEBIT,
      amount: -amount,
      balanceAfter: wallet.availableBalance,
      withdrawalRequestId: new Types.ObjectId(withdrawalRequestId),
      description: `Admin payout completed`,
      performedBy: performedBy ? new Types.ObjectId(performedBy) : undefined,
    });

    return wallet;
  }

  async reverseHubCredit(
    userId: string,
    amount: number,
    withdrawalRequestId: string,
    performedBy?: string,
  ) {
    const wrId = new Types.ObjectId(withdrawalRequestId);
    const alreadyDebited = await this.walletTxModel.findOne({
      withdrawalRequestId: wrId,
      type: WalletTransactionType.ADMIN_PAYOUT_DEBIT,
    });
    if (alreadyDebited) {
      return this.getOrCreateWallet(userId);
    }
    const existing = await this.walletTxModel.findOne({
      withdrawalRequestId: wrId,
      type: WalletTransactionType.ADMIN_REJECT_REVERSAL,
    });
    if (existing) {
      return this.getOrCreateWallet(userId);
    }

    const wallet = await this.getOrCreateWallet(userId);
    wallet.availableBalance = Math.max(
      0,
      Math.round((wallet.availableBalance - amount) * 100) / 100,
    );
    wallet.version += 1;
    await wallet.save();

    await this.walletTxModel.create({
      userId: new Types.ObjectId(userId),
      walletId: wallet._id,
      type: WalletTransactionType.ADMIN_REJECT_REVERSAL,
      amount: -amount,
      balanceAfter: wallet.availableBalance,
      withdrawalRequestId: new Types.ObjectId(withdrawalRequestId),
      description: `Withdrawal rejected — wallet reversed`,
      performedBy: performedBy ? new Types.ObjectId(performedBy) : undefined,
    });

    return wallet;
  }

  async getTransactions(userId: string, limit = 30) {
    return this.walletTxModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}
