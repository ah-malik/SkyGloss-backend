import { BadRequestException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ProductInventory,
  ProductInventoryDocument,
} from './entities/product-inventory.entity';
import {
  AdjustProductInventoryDto,
  UpdateProductInventoryDto,
} from './dto/update-product-inventory.dto';
import {
  INVENTORY_MAX_QUANTITY,
  clampInventoryQuantity,
} from './inventory.constants';
import { ProductsService } from '../products/products.service';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/entities/user.entity';
import { normalizePartnerCode } from '../common/partner-code';

/** Starting stock for products with no saved inventory row yet. */
export const DEFAULT_PRODUCT_STOCK = 100;

export type ProductStockStatus = 'available' | 'out_of_stock';

export type ProductInventoryItemResponse = {
  productId: string;
  name: string;
  image?: string | null;
  stock: number;
  stockStatus: ProductStockStatus;
  lastSavedAt: Date | null;
};

export type ProductInventoryListResponse = {
  products: ProductInventoryItemResponse[];
  lastSavedAt: Date | null;
};

  type OrderLikeForInventory = {
  _id?: Types.ObjectId | string;
  actingParentPartnerCode?: string | null;
  createdAt?: Date | string;
  items?: Array<{
    product?: string;
    quantity?: number;
    orderType?: string | null;
  }>;
  user?:
    | Types.ObjectId
    | string
    | {
        _id?: Types.ObjectId | string;
        hubPartnerCode?: string;
        referredByPartnerCode?: string;
        country?: string;
        parentLinkAssignedAt?: Date;
        previousParentPartnerCode?: string;
        role?: string;
      };
};

type LeanProductInventoryRow = {
  productId: Types.ObjectId | string;
  stock?: number;
  /** Legacy fields from Unit/Case split — used only for migration reads. */
  unitQuantity?: number;
  caseQuantity?: number;
  updatedAt?: Date;
};

@Injectable()
export class ProductInventoryService {
  constructor(
    @InjectModel(ProductInventory.name)
    private readonly productInventoryModel: Model<ProductInventoryDocument>,
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    private readonly usersService: UsersService,
  ) {}

  async listMine(userId: string): Promise<ProductInventoryListResponse> {
    const uid = this.toUserId(userId);
    const [catalog, rows] = await Promise.all([
      this.productsService.findAll('published'),
      this.productInventoryModel.find({ userId: uid }).lean(),
    ]);

    const byProduct = new Map(
      (rows as LeanProductInventoryRow[]).map(
        (row) => [String(row.productId), row] as const,
      ),
    );

    const missing = (catalog || []).filter(
      (product: any) => !byProduct.has(String(product._id)),
    );
    const allRowsEmpty =
      rows.length > 0 &&
      (rows as LeanProductInventoryRow[]).every(
        (row) => this.readStock(row) === 0,
      );

    if (missing.length > 0 || allRowsEmpty) {
      const ops = (catalog || [])
        .map((product: any) => {
          const productId = new Types.ObjectId(String(product._id));
          if (byProduct.has(String(product._id)) && !allRowsEmpty) {
            return null;
          }
          return {
            updateOne: {
              filter: { userId: uid, productId },
              update: {
                $set: { stock: DEFAULT_PRODUCT_STOCK },
                $setOnInsert: { userId: uid, productId },
                $unset: { unitQuantity: 1, caseQuantity: 1 },
              },
              upsert: true,
            },
          };
        })
        .filter(Boolean) as any[];

      if (ops.length > 0) {
        await this.productInventoryModel.bulkWrite(ops, { ordered: false });
      }
      const refreshed = await this.productInventoryModel
        .find({ userId: uid })
        .lean();
      byProduct.clear();
      for (const row of refreshed as LeanProductInventoryRow[]) {
        byProduct.set(String(row.productId), row);
      }
    }

    // Migrate legacy unit/case rows that still lack `stock`.
    const legacyOps = (catalog || [])
      .map((product: any) => {
        const productId = String(product._id);
        const row = byProduct.get(productId);
        if (!row || row.stock !== undefined) return null;
        const stock = this.readStock(row);
        return {
          updateOne: {
            filter: {
              userId: uid,
              productId: new Types.ObjectId(productId),
            },
            update: {
              $set: { stock },
              $unset: { unitQuantity: 1, caseQuantity: 1 },
            },
          },
        };
      })
      .filter(Boolean) as any[];
    if (legacyOps.length > 0) {
      await this.productInventoryModel.bulkWrite(legacyOps, { ordered: false });
      const refreshed = await this.productInventoryModel
        .find({ userId: uid })
        .lean();
      byProduct.clear();
      for (const row of refreshed as LeanProductInventoryRow[]) {
        byProduct.set(String(row.productId), row);
      }
    }

    let lastSavedAt: Date | null = null;
    const products: ProductInventoryItemResponse[] = (catalog || []).map(
      (product: any) => {
        const productId = String(product._id);
        const row = byProduct.get(productId);
        const stock = clampInventoryQuantity(
          row ? this.readStock(row) : DEFAULT_PRODUCT_STOCK,
        );
        const savedAt = row?.updatedAt ? new Date(row.updatedAt) : null;
        if (savedAt && (!lastSavedAt || savedAt > lastSavedAt)) {
          lastSavedAt = savedAt;
        }
        return {
          productId,
          name: product.name || 'Product',
          image: product.shopImages?.[0] || product.images?.[0] || null,
          stock,
          stockStatus: this.resolveStockStatus(stock),
          lastSavedAt: savedAt,
        };
      },
    );

    return { products, lastSavedAt };
  }

  async updateMine(
    userId: string,
    productId: string,
    dto: UpdateProductInventoryDto,
  ): Promise<ProductInventoryItemResponse> {
    if (dto.stock === undefined) {
      throw new BadRequestException('Provide stock to update');
    }

    const uid = this.toUserId(userId);
    const pid = this.toProductId(productId);
    await this.assertProductExists(pid);

    const updated = await this.upsertStock(
      uid,
      pid,
      clampInventoryQuantity(dto.stock),
    );
    return this.toItemResponse(updated, await this.getProductMeta(pid));
  }

  async adjustMine(
    userId: string,
    productId: string,
    dto: AdjustProductInventoryDto,
  ): Promise<ProductInventoryItemResponse> {
    if (!dto.delta) {
      throw new BadRequestException('Quantity change cannot be zero');
    }

    const uid = this.toUserId(userId);
    const pid = this.toProductId(productId);
    await this.assertProductExists(pid);

    const updated = await this.applyDelta(uid, pid, dto.delta);
    return this.toItemResponse(updated, await this.getProductMeta(pid));
  }

  /**
   * Deduct shared stock for the Hub/Distributor that owns this order.
   * Unit and Case orders both pull from the same stock pool.
   */
  async deductForOrder(order: OrderLikeForInventory): Promise<boolean> {
    const ownerId = await this.resolveInventoryOwnerUserId(order);
    if (!ownerId) return false;

    const deltas = this.aggregateItemDeltas(order.items || []);
    if (deltas.size === 0) return false;

    const uid = this.toUserId(ownerId);
    for (const [productId, qty] of deltas) {
      if (!Types.ObjectId.isValid(productId)) continue;
      await this.applyDelta(uid, new Types.ObjectId(productId), -Math.abs(qty));
    }
    return true;
  }

  async restoreForOrder(order: OrderLikeForInventory): Promise<boolean> {
    const ownerId = await this.resolveInventoryOwnerUserId(order);
    if (!ownerId) return false;

    const deltas = this.aggregateItemDeltas(order.items || []);
    if (deltas.size === 0) return false;

    const uid = this.toUserId(ownerId);
    for (const [productId, qty] of deltas) {
      if (!Types.ObjectId.isValid(productId)) continue;
      await this.applyDelta(uid, new Types.ObjectId(productId), Math.abs(qty));
    }
    return true;
  }

  /**
   * Stock map for the Hub/Distributor inventory that applies to this viewer.
   * Shops → acting Parent Link (Hub/Distributor). Hub/Distributor → own stock.
   */
  async getStockMapForViewer(
    user?: User | null,
  ): Promise<Map<string, number> | null> {
    if (!user) return null;
    const ownerId = await this.resolveInventoryOwnerUserIdForViewer(user);
    if (!ownerId) return null;

    const rows = (await this.productInventoryModel
      .find({ userId: this.toUserId(ownerId) })
      .lean()) as LeanProductInventoryRow[];

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(String(row.productId), this.readStock(row));
    }
    return map;
  }

  /**
   * Reject the order when the acting Hub/Distributor does not have enough stock.
   * Unit and Case both consume the same stock pool (1 qty = 1 stock).
   */
  async assertStockAvailableForOrder(order: {
    items?: Array<{
      product?: string;
      name?: string;
      quantity?: number;
    }>;
    actingParentPartnerCode?: string | null;
    createdAt?: Date | string;
    user?: OrderLikeForInventory['user'];
  }): Promise<void> {
    const ownerId = await this.resolveInventoryOwnerUserId(order);
    if (!ownerId) return;

    const deltas = this.aggregateItemDeltas(order.items || []);
    if (deltas.size === 0) return;

    const uid = this.toUserId(ownerId);
    const productIds = [...deltas.keys()].filter((id) =>
      Types.ObjectId.isValid(id),
    );
    const rows = (await this.productInventoryModel
      .find({
        userId: uid,
        productId: { $in: productIds.map((id) => new Types.ObjectId(id)) },
      })
      .lean()) as LeanProductInventoryRow[];

    const byProduct = new Map(
      rows.map((row) => [String(row.productId), this.readStock(row)] as const),
    );

    const shortages: string[] = [];
    for (const [productId, needed] of deltas) {
      const available = byProduct.has(productId)
        ? byProduct.get(productId)!
        : DEFAULT_PRODUCT_STOCK;
      if (needed > available) {
        const itemName =
          order.items?.find((i) => String(i.product) === productId)?.name ||
          'Product';
        shortages.push(
          `${itemName}: need ${needed}, available ${available}`,
        );
      }
    }

    if (shortages.length > 0) {
      throw new BadRequestException(
        `Out of stock for your Hub/Distributor inventory. ${shortages.join('; ')}`,
      );
    }
  }

  private async resolveInventoryOwnerUserIdForViewer(
    user: User,
  ): Promise<string | null> {
    return this.resolveInventoryOwnerFromMember(user as any);
  }

  /**
   * Walk referredByPartnerCode until Hub (partner) or Distributor.
   * Used for Representatives and Promoters so they consume parent Hub stock.
   */
  private async resolveHubOrDistributorAncestorId(
    member: {
      referredByPartnerCode?: string;
      role?: string;
      _id?: Types.ObjectId | string;
    } | null,
  ): Promise<string | null> {
    if (!member) return null;

    let code = normalizePartnerCode(member.referredByPartnerCode);
    let guard = 0;
    while (code && guard++ < 12) {
      const parent = await this.usersService.findByPartnerCode(code);
      if (!parent) return null;
      if (
        parent.role === UserRole.PARTNER ||
        parent.role === UserRole.DISTRIBUTOR
      ) {
        return String((parent as any)._id);
      }
      code = normalizePartnerCode((parent as any).referredByPartnerCode);
    }
    return null;
  }

  private async resolveInventoryOwnerFromMember(
    member: any,
  ): Promise<string | null> {
    if (!member) return null;
    const role = member.role;
    const userId = member._id != null ? String(member._id) : '';

    if (role === UserRole.PARTNER || role === UserRole.DISTRIBUTOR) {
      return userId || null;
    }

    if (role === UserRole.CERTIFIED_SHOP) {
      const actingCode = await this.usersService.resolveActingParentForOrder({
        user: {
          hubPartnerCode: member.hubPartnerCode,
          country: member.country,
          parentLinkAssignedAt: member.parentLinkAssignedAt,
          previousParentPartnerCode: member.previousParentPartnerCode,
        },
      });
      if (actingCode) {
        const parent = await this.usersService.findByPartnerCode(actingCode);
        if (
          parent &&
          (parent.role === UserRole.PARTNER ||
            parent.role === UserRole.DISTRIBUTOR)
        ) {
          return String((parent as any)._id);
        }
      }
      return null;
    }

    // Representative / Promoter → parent Hub or Distributor inventory
    if (
      role === UserRole.MASTER_PARTNER ||
      role === UserRole.REGIONAL_PARTNER
    ) {
      return this.resolveHubOrDistributorAncestorId(member);
    }

    return null;
  }

  async resolveInventoryOwnerUserId(
    order: OrderLikeForInventory,
  ): Promise<string | null> {
    const userRef = order.user as any;
    const populated =
      userRef &&
      typeof userRef === 'object' &&
      (userRef.role != null ||
        userRef.hubPartnerCode != null ||
        userRef.referredByPartnerCode != null ||
        userRef.country != null ||
        userRef.email != null);

    const memberId = populated
      ? userRef._id != null
        ? String(userRef._id)
        : null
      : userRef != null
        ? String(userRef)
        : null;

    let memberDoc = populated ? userRef : null;
    if (memberId && (!memberDoc || memberDoc.role == null)) {
      memberDoc = await this.usersService.findOne(memberId);
    }

    // Shop orders: prefer locked acting Parent Link stamp
    if (
      memberDoc?.role === UserRole.CERTIFIED_SHOP ||
      order.actingParentPartnerCode
    ) {
      const actingCode = await this.usersService.resolveActingParentForOrder({
        actingParentPartnerCode: order.actingParentPartnerCode,
        createdAt: order.createdAt,
        user: memberDoc
          ? {
              hubPartnerCode: memberDoc.hubPartnerCode,
              country: memberDoc.country,
              parentLinkAssignedAt: memberDoc.parentLinkAssignedAt,
              previousParentPartnerCode: memberDoc.previousParentPartnerCode,
            }
          : undefined,
      });

      if (actingCode) {
        const parent = await this.usersService.findByPartnerCode(actingCode);
        if (
          parent &&
          (parent.role === UserRole.PARTNER ||
            parent.role === UserRole.DISTRIBUTOR)
        ) {
          return String((parent as any)._id);
        }
      }
    }

    return this.resolveInventoryOwnerFromMember(memberDoc);
  }

  /** Unit and Case quantities both count against the same stock. */
  private aggregateItemDeltas(
    items: Array<{
      product?: string;
      quantity?: number;
      orderType?: string | null;
    }>,
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const item of items) {
      const productId = String(item.product || '').trim();
      const qty = Math.trunc(Number(item.quantity) || 0);
      if (!productId || productId === 'registration_fee' || qty <= 0) continue;
      if (!Types.ObjectId.isValid(productId)) continue;
      map.set(productId, (map.get(productId) || 0) + qty);
    }
    return map;
  }

  private async ensureStockField(
    userId: Types.ObjectId,
    productId: Types.ObjectId,
  ): Promise<void> {
    const row = await this.productInventoryModel.findOne({ userId, productId }).lean();
    if (!row || typeof (row as any).stock === 'number') return;
    const stock = this.readStock(row as any);
    await this.productInventoryModel.updateOne(
      { _id: (row as any)._id },
      {
        $set: { stock },
        $unset: { unitQuantity: 1, caseQuantity: 1 },
      },
    );
  }

  private async applyDelta(
    userId: Types.ObjectId,
    productId: Types.ObjectId,
    delta: number,
  ): Promise<ProductInventoryDocument> {
    await this.ensureStockField(userId, productId);

    if (delta > 0) {
      const existing = await this.productInventoryModel.findOneAndUpdate(
        { userId, productId },
        {
          $inc: { stock: delta },
          $unset: { unitQuantity: 1, caseQuantity: 1 },
        },
        { new: true },
      );
      if (existing) {
        if (existing.stock > INVENTORY_MAX_QUANTITY) {
          existing.stock = INVENTORY_MAX_QUANTITY;
          await existing.save();
        }
        return existing;
      }

      try {
        return await this.productInventoryModel.create({
          userId,
          productId,
          stock: clampInventoryQuantity(DEFAULT_PRODUCT_STOCK + delta),
        });
      } catch (err) {
        if (!this.isDuplicateKey(err)) throw err;
        const retry = await this.productInventoryModel.findOneAndUpdate(
          { userId, productId },
          { $inc: { stock: delta } },
          { new: true },
        );
        if (retry) return retry;
        throw err;
      }
    }

    const decrease = Math.abs(delta);
    const updated = await this.productInventoryModel.findOneAndUpdate(
      { userId, productId, stock: { $gte: decrease } },
      {
        $inc: { stock: -decrease },
        $unset: { unitQuantity: 1, caseQuantity: 1 },
      },
      { new: true },
    );
    if (updated) return updated;

    const current = await this.productInventoryModel.findOne({
      userId,
      productId,
    });
    if (!current) {
      return this.productInventoryModel.create({
        userId,
        productId,
        stock: Math.max(0, DEFAULT_PRODUCT_STOCK - decrease),
      });
    }

    // Legacy docs may still store unit/case only.
    const currentStock = this.readStock(current as any);
    current.stock = Math.max(0, currentStock - decrease);
    (current as any).unitQuantity = undefined;
    (current as any).caseQuantity = undefined;
    current.markModified('stock');
    await current.save();
    await this.productInventoryModel.updateOne(
      { _id: current._id },
      { $unset: { unitQuantity: 1, caseQuantity: 1 } },
    );
    return current;
  }

  private async upsertStock(
    userId: Types.ObjectId,
    productId: Types.ObjectId,
    stock: number,
  ): Promise<ProductInventoryDocument> {
    try {
      const updated = await this.productInventoryModel.findOneAndUpdate(
        { userId, productId },
        {
          $set: { stock },
          $setOnInsert: { userId, productId },
          $unset: { unitQuantity: 1, caseQuantity: 1 },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      if (!updated) {
        throw new BadRequestException('Unable to save product inventory');
      }
      return updated;
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        const retry = await this.productInventoryModel.findOneAndUpdate(
          { userId, productId },
          {
            $set: { stock },
            $unset: { unitQuantity: 1, caseQuantity: 1 },
          },
          { new: true },
        );
        if (retry) return retry;
      }
      throw err;
    }
  }

  private readStock(row: LeanProductInventoryRow | ProductInventoryDocument): number {
    if (typeof (row as any).stock === 'number') {
      return clampInventoryQuantity((row as any).stock);
    }
    const unit = Number((row as any).unitQuantity ?? 0);
    const cases = Number((row as any).caseQuantity ?? 0);
    return clampInventoryQuantity(Math.max(unit, cases));
  }

  private resolveStockStatus(stock: number): ProductStockStatus {
    return stock > 0 ? 'available' : 'out_of_stock';
  }

  private async assertProductExists(productId: Types.ObjectId) {
    const product = await this.productsService.findOne(String(productId));
    if (!product) {
      throw new BadRequestException('Product not found');
    }
  }

  private async getProductMeta(productId: Types.ObjectId) {
    const product: any = await this.productsService.findOne(String(productId));
    return {
      name: product?.name || 'Product',
      image: product?.shopImages?.[0] || product?.images?.[0] || null,
    };
  }

  private toItemResponse(
    doc: ProductInventoryDocument,
    meta: { name: string; image?: string | null },
  ): ProductInventoryItemResponse {
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    const stock = this.readStock(obj as any);
    return {
      productId: String(obj.productId),
      name: meta.name,
      image: meta.image ?? null,
      stock,
      stockStatus: this.resolveStockStatus(stock),
      lastSavedAt: obj.updatedAt ?? null,
    };
  }

  private toUserId(userId: string): Types.ObjectId {
    const id = String(userId ?? '');
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user');
    }
    return new Types.ObjectId(id);
  }

  private toProductId(productId: string): Types.ObjectId {
    const id = String(productId ?? '');
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid product');
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
}
