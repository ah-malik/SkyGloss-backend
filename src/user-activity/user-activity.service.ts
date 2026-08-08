import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserActivityAction,
  UserActivityLog,
  UserActivityLogDocument,
} from './entities/user-activity-log.entity';

export interface LogActivityInput {
  userId: string;
  action: UserActivityAction;
  actorId?: string;
  portal?: string;
  ipAddress?: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  device?: string;
  metadata?: Record<string, any>;
}

export interface ListActivityQuery {
  page?: number;
  limit?: number;
  search?: string;
  action?: string;
  userId?: string;
  portal?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class UserActivityService {
  private readonly logger = new Logger(UserActivityService.name);

  constructor(
    @InjectModel(UserActivityLog.name)
    private readonly activityModel: Model<UserActivityLogDocument>,
  ) {}

  async log(input: LogActivityInput): Promise<void> {
    try {
      if (!input.userId || !Types.ObjectId.isValid(input.userId)) {
        return;
      }

      const metadata = {
        ...(input.metadata || {}),
        ...(input.browser ? { browser: input.browser } : {}),
        ...(input.os ? { os: input.os } : {}),
        ...(input.device ? { device: input.device } : {}),
      };

      const doc = new this.activityModel({
        user: new Types.ObjectId(input.userId),
        action: input.action,
        actor:
          input.actorId && Types.ObjectId.isValid(input.actorId)
            ? new Types.ObjectId(input.actorId)
            : undefined,
        portal: input.portal,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: Object.keys(metadata).length ? metadata : undefined,
      });
      await doc.save();
    } catch (err) {
      // Never break primary flows because of logging failures
      this.logger.warn(
        `Failed to write activity log (${input.action}): ${(err as Error)?.message}`,
      );
    }
  }

  async findAll(query: ListActivityQuery) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 25));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};

    if (query.action && query.action !== 'all') {
      filter.action = query.action;
    }

    if (query.userId && Types.ObjectId.isValid(query.userId)) {
      filter.user = new Types.ObjectId(query.userId);
    }

    if (query.portal && query.portal !== 'all') {
      filter.portal = query.portal;
    }

    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) {
        filter.createdAt.$gte = new Date(query.from);
      }
      if (query.to) {
        const toDate = new Date(query.to);
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }

    const search = (query.search || '').trim();
    if (search) {
      const matchingUsers = await this.activityModel.db
        .collection('users')
        .find({
          $or: [
            { email: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } },
            { lastName: { $regex: search, $options: 'i' } },
            { partnerCode: { $regex: search, $options: 'i' } },
          ],
        })
        .project({ _id: 1 })
        .limit(200)
        .toArray();

      const userIds = matchingUsers.map((u) => u._id);
      if (userIds.length === 0) {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }

      if (filter.user) {
        const targetId = filter.user.toString();
        const inSearch = userIds.some((id) => id.toString() === targetId);
        if (!inSearch) {
          return { items: [], total: 0, page, limit, totalPages: 0 };
        }
      } else {
        filter.user = { $in: userIds };
      }
    }

    const [items, total] = await Promise.all([
      this.activityModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'firstName lastName email role partnerCode country')
        .populate('actor', 'firstName lastName email role')
        .lean()
        .exec(),
      this.activityModel.countDocuments(filter).exec(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }
}
