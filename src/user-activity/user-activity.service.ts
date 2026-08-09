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
  country?: string;
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
  country?: string;
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

      const country =
        (input.country || input.metadata?.country || '').toString().trim() ||
        undefined;

      const metadata = {
        ...(input.metadata || {}),
        ...(country ? { country } : {}),
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
        country,
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

  private async findUserIdsByCountry(country: string): Promise<Types.ObjectId[]> {
    const matchingUsers = await this.activityModel.db
      .collection('users')
      .find({ country })
      .project({ _id: 1 })
      .limit(2000)
      .toArray();
    return matchingUsers.map((u) => u._id as Types.ObjectId);
  }

  private async findUserIdsBySearch(search: string): Promise<Types.ObjectId[]> {
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
    return matchingUsers.map((u) => u._id as Types.ObjectId);
  }

  private intersectIds(
    a?: Types.ObjectId | { $in: Types.ObjectId[] },
    b?: Types.ObjectId[],
  ): Types.ObjectId | { $in: Types.ObjectId[] } | null {
    if (!b) return a || null;
    if (!a) return { $in: b };

    if (a instanceof Types.ObjectId || (a as any)?._bsontype === 'ObjectId') {
      const id = a as Types.ObjectId;
      return b.some((x) => x.toString() === id.toString()) ? id : null;
    }

    const existing = ((a as any).$in || []) as Types.ObjectId[];
    const set = new Set(b.map((x) => x.toString()));
    const intersected = existing.filter((x) => set.has(x.toString()));
    return intersected.length ? { $in: intersected } : null;
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
      const userIds = await this.findUserIdsBySearch(search);
      if (userIds.length === 0) {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }
      const next = this.intersectIds(filter.user, userIds);
      if (!next) {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }
      filter.user = next;
    }

    const country = (query.country || '').trim();
    if (country && country !== 'all') {
      // Match denormalized country on log, or linked users with that country
      // (covers older logs that only stored country in metadata/user).
      const countryUserIds = await this.findUserIdsByCountry(country);
      filter.$or = [
        { country },
        { 'metadata.country': country },
        ...(countryUserIds.length
          ? [{ user: { $in: countryUserIds } }]
          : []),
      ];
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

  /** Distinct countries for admin filter dropdown. */
  async listCountries(): Promise<string[]> {
    const fromLogs = await this.activityModel.distinct('country').exec();
    const fromMeta = await this.activityModel.distinct('metadata.country').exec();
    const fromUsers = await this.activityModel.db
      .collection('users')
      .distinct('country');

    const set = new Set<string>();
    for (const value of [...fromLogs, ...fromMeta, ...fromUsers]) {
      if (typeof value === 'string' && value.trim()) {
        set.add(value.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }
}
