import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './entities/product.entity';
import {
  ProductGroup,
  ProductGroupDocument,
} from '../product-groups/entities/product-group.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { User, UserRole } from '../users/entities/user.entity';
import { RedisCacheService } from '../redis/redis-cache.service';
import { CacheKeys, CacheTtl } from '../redis/redis.constants';
import {
  DEFAULT_PRODUCT_STOCK,
  ProductInventoryService,
} from '../inventory/product-inventory.service';
import {
  isUnpaidSelfRegisteredShop,
  resolveChargePriceForShop,
} from '../common/unpaid-shop-pricing';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../orders/entities/order.entity';
import {
  buildCertificationKitCatalogProduct,
  CERTIFICATION_KIT_PRODUCT_ID,
  isCertificationKitEligibleUser,
  isCertificationKitProductId,
  ResolvedKitComponent,
  resolveSavedCertificationKitComponents,
  SavedCertificationKitConfig,
} from '../common/certification-kit';
import { CertificationKitsService } from '../certification-kits/certification-kits.service';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(ProductGroup.name)
    private productGroupModel: Model<ProductGroupDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private readonly cache: RedisCacheService,
    @Inject(forwardRef(() => ProductInventoryService))
    private readonly productInventoryService: ProductInventoryService,
    @Inject(forwardRef(() => CertificationKitsService))
    private readonly certificationKitsService: CertificationKitsService,
  ) { }

  async create(createProductDto: CreateProductDto): Promise<ProductDocument> {
    console.log(
      '[ProductsService] Creating product with data:',
      JSON.stringify(createProductDto),
    );
    const createdProduct = new this.productModel(createProductDto);
    const saved = await createdProduct.save();
    await this.invalidateProductCaches();
    return saved;
  }

  async findAll(
    status?: string,
    targetAudience?: string,
    user?: User,
  ): Promise<any[]> {
    let groupToUse: any = null;

    // Admins manage the full catalog — never restrict to a product group.
    // (Admin accounts may still have productGroup set from user-create defaults.)
    const isAdmin = user?.role === UserRole.ADMIN;

    if (user && !isAdmin) {
      // Priority 1: Explicitly assigned product group by Admin or Registration
      if (user.productGroup) {
        groupToUse = await this.productGroupModel
          .findById(user.productGroup)
          .populate('products.productId')
          .exec();
      }
      // Priority 2: Dynamic matching by country (only if no explicit group)
      else if (
        [
          UserRole.CERTIFIED_SHOP,
          UserRole.MASTER_PARTNER,
          UserRole.REGIONAL_PARTNER,
          UserRole.PARTNER,
        ].includes(user.role)
      ) {
        if (user.country) {
          groupToUse = await this.productGroupModel
            .findOne({
              $or: [
                { countries: user.country },
                { country: user.country }
              ],
              isActive: true
            })
            .populate('products.productId')
            .exec();
        }

        if (!groupToUse) {
          groupToUse = await this.productGroupModel
            .findOne({ isDefault: true, isActive: true })
            .populate('products.productId')
            .exec();
        }
      }
    }

    // 1. If user has an applicable product group, STRICTLY restrict visibility and override prices
    if (groupToUse) {
      // Return only products in the group with group-specific prices
      const grouped = groupToUse.products
        .map((item) => {
          const product = item.productId as any;
          if (!product) return null;

          // Deep clone and override
          const productObj = product.toObject ? product.toObject() : product;

          return {
            ...productObj,
            ...this.withViewerSizePricing(
              this.withProductSizeWeights(item.sizes, productObj.sizes),
              user,
            ),
            currency: groupToUse.currency || 'USD',
            groupName: groupToUse.name,
          };
        })
        .filter((p) => p !== null);

      return this.attachViewerHubStock(
        await this.attachCertificationKitIfEligible(grouped, user),
        user,
      );
    }

    // 2. Fallback to standard fetching ONLY for users WITHOUT a product group or anonymous users
    // Cache this shared catalog path (not user-specific group pricing).
    const cacheKey = CacheKeys.productsList(status, targetAudience);
    const catalog = await this.cache.wrap(cacheKey, CacheTtl.productsList, async () => {
      const filter: any = {};
      if (status) filter.status = status;
      if (targetAudience)
        filter.targetAudience = { $in: [targetAudience, 'all'] };

      return this.productModel
        .find(filter)
        .sort({ displayOrder: 1, createdAt: -1 })
        .lean()
        .exec();
    });

    const pricedCatalog = catalog.map((product: any) => ({
      ...product,
      ...this.withViewerSizePricing(product.sizes || [], user),
    }));

    return this.attachViewerHubStock(
      await this.attachCertificationKitIfEligible(pricedCatalog, user),
      user,
    );
  }

  /** Slim published catalog for inventory screens (id/name/images only). */
  async findPublishedInventoryCatalog(): Promise<
    Array<{ _id: any; name?: string; images?: string[]; shopImages?: string[] }>
  > {
    return this.productModel
      .find({ status: 'published' })
      .select('_id name images shopImages')
      .sort({ displayOrder: 1, createdAt: -1 })
      .lean()
      .exec();
  }

  async findOne(id: string, user?: User): Promise<any> {
    console.log(
      `[ProductsService] findOne called for ID: ${id}. User:`,
      user ? (user as any)._id : 'Anonymous',
    );

    if (id === CERTIFICATION_KIT_PRODUCT_ID) {
      if (!isCertificationKitEligibleUser(user)) {
        throw new NotFoundException('Certification Kit is not available');
      }
      const catalog = await this.findAll('published', 'shop', user);
      const kit = catalog.find(
        (p) => String(p?._id) === CERTIFICATION_KIT_PRODUCT_ID,
      );
      if (!kit) {
        throw new NotFoundException('Certification Kit is not available');
      }
      return kit;
    }

    let groupToUse: any = null;

    const isAdmin = user?.role === UserRole.ADMIN;

    if (user && !isAdmin) {
      if (user.productGroup) {
        groupToUse = await this.productGroupModel
          .findById(user.productGroup)
          .populate('products.productId')
          .exec();
      } else if (
        [
          UserRole.CERTIFIED_SHOP,
          UserRole.MASTER_PARTNER,
          UserRole.REGIONAL_PARTNER,
          UserRole.PARTNER,
        ].includes(user.role)
      ) {
        if (user.country) {
          groupToUse = await this.productGroupModel
            .findOne({
              $or: [
                { countries: user.country },
                { country: user.country }
              ],
              isActive: true
            })
            .populate('products.productId')
            .exec();
        }
        if (!groupToUse) {
          groupToUse = await this.productGroupModel
            .findOne({ isDefault: true, isActive: true })
            .populate('products.productId')
            .exec();
        }
      }
    }

    // 1. Check if user has an applicable product group and if this product is in it
    if (groupToUse) {
      const groupItem = groupToUse.products.find(
        (item) =>
          (item.productId as any)?._id?.toString() === id ||
          (item.productId as any)?.id?.toString() === id,
      );

      if (groupItem) {
        const product = groupItem.productId as any;
        const productObj = product.toObject ? product.toObject() : product;
        return this.attachViewerHubStockToOne(
          {
            ...productObj,
            ...this.withViewerSizePricing(
              this.withProductSizeWeights(groupItem.sizes, productObj.sizes),
              user,
            ),
            currency: groupToUse.currency || 'USD',
            groupName: groupToUse.name,
          },
          user,
        );
      } else {
        console.warn(
          `[ProductsService] Product ${id} NOT found in group ${groupToUse.name}`,
        );
        throw new NotFoundException(
          `Product with ID ${id} not found in your assigned group`,
        );
      }
    }

    const product = await this.productModel.findById(id).exec();
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    const productObj =
      typeof (product as any).toObject === 'function'
        ? (product as any).toObject()
        : product;
    return this.attachViewerHubStockToOne(
      {
        ...productObj,
        ...this.withViewerSizePricing(productObj.sizes || [], user),
      },
      user,
    );
  }

  /** Group sizes carry prices only; take shipping weights from the catalog product. */
  private withProductSizeWeights(
    groupSizes: Array<{ size: string; price: number } | string>,
    productSizes?: Array<{ size: string; weight?: number } | string>,
  ): Array<{ size: string; price: number; weight?: number } | string> {
    const weights = new Map<string, number>();
    for (const s of productSizes || []) {
      if (typeof s !== 'string' && Number(s.weight) > 0) {
        weights.set(String(s.size), Number(s.weight));
      }
    }
    return (groupSizes || []).map((s) => {
      if (typeof s === 'string') return s;
      // Group sizes are Mongoose subdocs; spreading one copies internals, not size/price.
      const plain = { size: s.size, price: s.price };
      const weight = weights.get(String(s.size));
      return weight ? { ...plain, weight } : plain;
    });
  }

  /**
   * Per-unit shipping weights (LB) keyed by product id, then size.
   * Read from the catalog so group pricing never hides them.
   */
  async getSizeWeightsByProductIds(
    productIds: string[],
  ): Promise<Map<string, Map<string, number>>> {
    const ids = [...new Set(productIds.filter(Boolean).map(String))].filter(
      (id) => /^[a-f0-9]{24}$/i.test(id),
    );
    const result = new Map<string, Map<string, number>>();
    if (!ids.length) return result;
    const products = await this.productModel
      .find({ _id: { $in: ids } })
      .select('sizes')
      .lean()
      .exec();
    for (const product of products as any[]) {
      const bySize = new Map<string, number>();
      for (const s of product.sizes || []) {
        if (Number(s?.weight) > 0) bySize.set(String(s.size), Number(s.weight));
      }
      result.set(String(product._id), bySize);
    }
    return result;
  }

  /**
   * Map size prices for the viewing shop. Unpaid self-registered shops get +10%
   * on the Pricing Group / catalog price; groupPrice keeps the pre-markup amount
   * for strikethrough UI.
   */
  private withViewerSizePricing(
    sizes: Array<{ size: string; price: number; weight?: number } | string>,
    user?: User,
  ): {
    sizes: Array<{
      size: string;
      price: number;
      groupPrice?: number;
      weight?: number;
    }>;
    isUnpaidPricing?: boolean;
  } {
    const unpaid = isUnpaidSelfRegisteredShop(user);
    return {
      sizes: (sizes || []).map((s) => {
        if (typeof s === 'string') {
          return { size: s, price: 0 };
        }
        const groupPrice = Number(s.price) || 0;
        const weight =
          Number(s.weight) > 0 ? { weight: Number(s.weight) } : {};
        if (!unpaid) {
          return { size: s.size, price: groupPrice, ...weight };
        }
        return {
          size: s.size,
          price: resolveChargePriceForShop(groupPrice, user),
          groupPrice,
          ...weight,
        };
      }),
      ...(unpaid ? { isUnpaidPricing: true } : {}),
    };
  }

  /**
   * Unpaid self-registered shops see a one-time Certification Kit at the top
   * of the catalog. Hidden once purchased / reserved on an open order.
   */
  private async attachCertificationKitIfEligible(
    products: any[],
    user?: User,
  ): Promise<any[]> {
    if (!user || !isCertificationKitEligibleUser(user)) {
      return products;
    }

    const alreadyPurchased = await this.hasActiveCertificationKitOrder(
      (user as any)._id?.toString?.() || String((user as any)._id || ''),
    );
    if (alreadyPurchased) {
      return products;
    }

    const resolved = await this.resolveSavedCertificationKitForShop(
      user,
      products,
    );
    if (!resolved) {
      return products;
    }

    const kit = buildCertificationKitCatalogProduct({
      components: resolved.components,
      currency: resolved.currency,
      alreadyPurchased: false,
      config: resolved.config,
    });

    // Pin to top; strip any accidental duplicate virtual id.
    const withoutKit = products.filter(
      (p) => String(p?._id) !== String(kit._id),
    );
    return [kit, ...withoutKit];
  }

  /**
   * The Certification Kit saved by the shop's Hub/Distributor, priced with the
   * shop's own catalog (Pricing Group) and certification fee group.
   * Null when no kit is saved or a kit product is missing from the catalog.
   */
  async resolveSavedCertificationKitForShop(
    user: User,
    catalog: any[],
  ): Promise<{
    components: ResolvedKitComponent[];
    config: SavedCertificationKitConfig;
    currency: string;
  } | null> {
    const saved = await this.certificationKitsService.findSavedKitForShop(
      user as any,
    );
    if (!saved) return null;

    const realProducts = (catalog || []).filter(
      (p) => !isCertificationKitProductId(String(p?._id)),
    );
    const components = resolveSavedCertificationKitComponents(
      realProducts,
      saved.items,
    );
    if (!components) return null;

    const currency = String(
      realProducts.find((p) => p?.currency)?.currency || 'USD',
    ).toUpperCase();
    let certificationFee: number;
    let assignedFee: { amount: number; currency: string };
    try {
      assignedFee =
        await this.certificationKitsService.getCertificationFeeForCountry(
          user.country,
        );
      certificationFee =
        await this.certificationKitsService.getCertificationFeeInCurrency(
          user.country,
          currency,
        );
    } catch {
      // No exchange rate between fee and catalog currency: never show a wrong price.
      return null;
    }
    const converted =
      String(assignedFee.currency).toUpperCase() !== currency;

    return {
      components,
      currency,
      config: {
        ...saved,
        certificationFee,
        ...(converted ? { certificationFeeOriginal: assignedFee } : {}),
      },
    };
  }

  async hasActiveCertificationKitOrder(userId: string): Promise<boolean> {
    if (!userId) return false;
    const existing = await this.orderModel
      .findOne({
        user: userId as any,
        includesCertificationKit: true,
        status: {
          $in: [
            OrderStatus.PENDING,
            OrderStatus.PENDING_PAYMENT,
            OrderStatus.PAID,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
          ],
        },
      })
      .select('_id')
      .lean()
      .exec();
    return !!existing;
  }

  async update(
    id: string,
    updateProductDto: UpdateProductDto,
  ): Promise<ProductDocument> {
    const updatePayload = { ...updateProductDto };
    console.log(
      `[ProductsService] Updating product ${id} with data:`,
      JSON.stringify(updatePayload),
    );
    const updatedProduct = await this.productModel
      .findByIdAndUpdate(id, { $set: updatePayload }, { new: true })
      .exec();
    if (!updatedProduct) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    await this.invalidateProductCaches();
    return updatedProduct;
  }

  async remove(id: string): Promise<ProductDocument> {
    const deletedProduct = await this.productModel.findByIdAndDelete(id).exec();
    if (!deletedProduct) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    await this.invalidateProductCaches();
    return deletedProduct;
  }

  /**
   * Overlay Hub/Distributor product-inventory stock onto catalog products for:
   * - Shops → Parent Link (Hub/Distributor) inventory
   * - Representatives / Promoters → parent Hub/Distributor inventory (via referredBy)
   * - Hub / Distributor → own inventory
   */
  private async attachViewerHubStock(
    products: any[],
    user?: User,
  ): Promise<any[]> {
    if (!products?.length || !user) return products;

    try {
      const stockMap =
        await this.productInventoryService.getStockMapForViewer(user);
      if (!stockMap) return products;

      return products.map((product) => {
        const id = String(product._id || product.id || '');
        // Virtual Certification Kit keeps its own stock (1 / 0) — not hub inventory.
        if (
          product?.isCertificationKitBundle ||
          id === CERTIFICATION_KIT_PRODUCT_ID
        ) {
          return {
            ...product,
            stockStatus:
              Number(product.stock) > 0 ? 'available' : 'out_of_stock',
          };
        }
        const stock = stockMap.has(id)
          ? stockMap.get(id)!
          : DEFAULT_PRODUCT_STOCK;
        return {
          ...product,
          stock,
          stockStatus: stock > 0 ? 'available' : 'out_of_stock',
        };
      });
    } catch (err) {
      console.error('[ProductsService] Failed to attach hub stock', err);
      return products;
    }
  }

  private async attachViewerHubStockToOne(
    product: any,
    user?: User,
  ): Promise<any> {
    const [enriched] = await this.attachViewerHubStock(
      product ? [product] : [],
      user,
    );
    return enriched || product;
  }

  async migrateStatuses(): Promise<void> {
    // Update all products with 'active' or 'inactive' status to 'published'
    await this.productModel
      .updateMany(
        { status: { $in: ['active', 'inactive'] } },
        { $set: { status: 'published' } },
      )
      .exec();

    // Also update any products that don't have a status field yet
    await this.productModel
      .updateMany(
        { status: { $exists: false } },
        { $set: { status: 'published' } },
      )
      .exec();
    await this.invalidateProductCaches();
  }

  async migrateImagePaths(): Promise<void> {
    const products = await this.productModel.find().exec();
    for (const product of products) {
      let updated = false;

      // Update images
      const newImages = product.images.map((img) => {
        if (img.includes('Master_Distributor_Dashboard')) {
          updated = true;
          return img.replace(
            'Master_Distributor_Dashboard',
            'Master_Partner_Dashboard',
          );
        }
        return img;
      });

      // Update shopImages
      const newShopImages = product.shopImages.map((img) => {
        if (img.includes('Master_Distributor_Dashboard')) {
          updated = true;
          return img.replace(
            'Master_Distributor_Dashboard',
            'Master_Partner_Dashboard',
          );
        }
        return img;
      });

      if (updated) {
        product.images = newImages;
        product.shopImages = newShopImages;
        await product.save();
        console.log(`[ProductsService] Migrated image paths for product: ${product.name}`);
      }
    }
    await this.invalidateProductCaches();
  }

  private async invalidateProductCaches(): Promise<void> {
    await this.cache.delByPrefix(CacheKeys.productsPrefix);
  }
}
