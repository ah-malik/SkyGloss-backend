import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  ApprovalAction,
  ApprovalHistory,
  ApprovalHistoryDocument,
} from '../entities/approval-history.entity';
import {
  TransactionHistory,
  TransactionHistoryDocument,
} from '../entities/transaction-history.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(ApprovalHistory.name)
    private approvalHistoryModel: Model<ApprovalHistoryDocument>,
    @InjectModel(TransactionHistory.name)
    private transactionHistoryModel: Model<TransactionHistoryDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  async logApproval(data: Partial<ApprovalHistory>): Promise<void> {
    await this.approvalHistoryModel.create(data);
  }

  async logTransaction(data: Partial<TransactionHistory>): Promise<void> {
    await this.transactionHistoryModel.create(data);
  }

  async getWithdrawalHistory(withdrawalRequestId: string) {
    return this.approvalHistoryModel
      .find({ withdrawalRequestId: new Types.ObjectId(withdrawalRequestId) })
      .sort({ createdAt: 1 })
      .lean();
  }

  async getUserTransactions(userId: string, limit = 50) {
    return this.transactionHistoryModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const result = await fn();
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  assertValidTransition(
    current: string,
    allowed: string[],
    next: string,
    label: string,
  ): void {
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid ${label} transition from ${current} to ${next}`,
      );
    }
  }
}

export { ApprovalAction };
