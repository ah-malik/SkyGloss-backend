import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Inventory, InventoryDocument } from './entities/inventory.entity';
import { AdjustInventoryDto, UpdateInventoryDto } from './dto/update-inventory.dto';
import {
  INVENTORY_ITEM_KEYS,
  INVENTORY_MAX_QUANTITY,
  InventoryItemKey,
  clampInventoryQuantity,
} from './inventory.constants';

export type InventoryResponse = {
  bottlesAndPackaging: number;
  boxes: number;
  labels: number;
  components: number;
  lastSavedAt: Date | null;
  createdAt: Date | null;
};

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Inventory.name)
    private readonly inventoryModel: Model<InventoryDocument>,
  ) {}

  async getMine(userId: string): Promise<InventoryResponse> {
    const doc = await this.inventoryModel.findOne({ userId: this.toUserId(userId) });
    return doc ? this.toResponse(doc) : this.emptyResponse();
  }

  async updateMine(
    userId: string,
    dto: UpdateInventoryDto,
  ): Promise<InventoryResponse> {
    const patch: Partial<Record<InventoryItemKey, number>> = {};
    for (const key of INVENTORY_ITEM_KEYS) {
      if (dto[key] !== undefined) {
        patch[key] = clampInventoryQuantity(dto[key] as number);
      }
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Provide at least one inventory quantity to update');
    }

    const uid = this.toUserId(userId);
    try {
      const updated = await this.inventoryModel.findOneAndUpdate(
        { userId: uid },
        { $set: patch, $setOnInsert: { userId: uid } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      if (!updated) {
        throw new BadRequestException('Unable to save inventory');
      }
      return this.toResponse(updated);
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        const retry = await this.inventoryModel.findOneAndUpdate(
          { userId: uid },
          { $set: patch },
          { new: true },
        );
        if (retry) return this.toResponse(retry);
      }
      throw err;
    }
  }

  async adjustMine(
    userId: string,
    dto: AdjustInventoryDto,
  ): Promise<InventoryResponse> {
    if (!dto.delta) {
      throw new BadRequestException('Quantity change cannot be zero');
    }

    const uid = this.toUserId(userId);
    const field = dto.item as InventoryItemKey;

    if (dto.delta > 0) {
      try {
        const updated = await this.inventoryModel.findOneAndUpdate(
          { userId: uid },
          { $inc: { [field]: dto.delta }, $setOnInsert: { userId: uid } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        );
        if (!updated) {
          throw new BadRequestException('Unable to save inventory');
        }
        if (updated[field] > INVENTORY_MAX_QUANTITY) {
          updated[field] = INVENTORY_MAX_QUANTITY;
          await updated.save();
        }
        return this.toResponse(updated);
      } catch (err) {
        if (this.isDuplicateKey(err)) {
          const retry = await this.inventoryModel.findOneAndUpdate(
            { userId: uid },
            { $inc: { [field]: dto.delta } },
            { new: true },
          );
          if (retry) return this.toResponse(retry);
        }
        throw err;
      }
    }

    const decrease = Math.abs(dto.delta);
    const updated = await this.inventoryModel.findOneAndUpdate(
      { userId: uid, [field]: { $gte: decrease } },
      { $inc: { [field]: -decrease } },
      { new: true },
    );
    if (updated) {
      return this.toResponse(updated);
    }

    const current = await this.inventoryModel.findOne({ userId: uid });
    if (!current) {
      return this.emptyResponse();
    }
    current[field] = 0;
    await current.save();
    return this.toResponse(current);
  }

  private toUserId(userId: string): Types.ObjectId {
    const id = String(userId ?? '');
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user');
    }
    return new Types.ObjectId(id);
  }

  private isDuplicateKey(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: number }).code === 11000
    );
  }

  private emptyResponse(): InventoryResponse {
    return {
      bottlesAndPackaging: 0,
      boxes: 0,
      labels: 0,
      components: 0,
      lastSavedAt: null,
      createdAt: null,
    };
  }

  private toResponse(doc: InventoryDocument): InventoryResponse {
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return {
      bottlesAndPackaging: clampInventoryQuantity(obj.bottlesAndPackaging ?? 0),
      boxes: clampInventoryQuantity(obj.boxes ?? 0),
      labels: clampInventoryQuantity(obj.labels ?? 0),
      components: clampInventoryQuantity(obj.components ?? 0),
      lastSavedAt: obj.updatedAt ?? null,
      createdAt: obj.createdAt ?? null,
    };
  }
}
