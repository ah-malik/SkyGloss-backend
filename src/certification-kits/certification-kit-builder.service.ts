import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { CertificationKitsService } from './certification-kits.service';
import { ProductsService } from '../products/products.service';
import {
  SaveCertificationKitDto,
  CERTIFICATION_KIT_MAX_QUANTITY,
} from './dto/save-certification-kit.dto';
import {
  CERTIFICATION_KIT_STARTER_DISCOUNT_PERCENT,
  isCertificationKitProductId,
  resolveCertificationKitComponents,
  resolveComponentUnitPrice,
} from '../common/certification-kit';
import { UserDocument } from '../users/entities/user.entity';

export type CertificationKitCatalogEntry = {
  productId: string;
  name: string;
  size: string;
  unitPrice: number;
  image: string;
};

/** The kit builder for Hubs and Distributors, priced with the owner's own assigned prices. */
@Injectable()
export class CertificationKitBuilderService {
  constructor(
    private readonly kitsService: CertificationKitsService,
    private readonly productsService: ProductsService,
  ) {}

  private async ownerCatalog(owner: UserDocument): Promise<{
    catalog: CertificationKitCatalogEntry[];
    currency: string;
    raw: any[];
  }> {
    const raw = (
      await this.productsService.findAll('published', 'shop', owner as any)
    ).filter((p) => !isCertificationKitProductId(String(p?._id)));
    const catalog: CertificationKitCatalogEntry[] = [];
    for (const product of raw) {
      for (const size of product?.sizes || []) {
        if (!size?.size) continue;
        catalog.push({
          productId: String(product._id),
          name: String(product.name || ''),
          size: String(size.size),
          unitPrice: resolveComponentUnitPrice(size),
          image: product.shopImages?.[0] || product.images?.[0] || '',
        });
      }
    }
    const currency = String(raw.find((p) => p?.currency)?.currency || 'USD').toUpperCase();
    return { catalog, currency, raw };
  }

  async getMine(owner: UserDocument) {
    const [{ catalog, currency, raw }, saved] = await Promise.all([
      this.ownerCatalog(owner),
      this.kitsService.findByOwner(String(owner._id)),
    ]);
    const certificationFee = await this.kitsService.getCertificationFeeInCurrency(
      owner.country,
      currency,
    );

    // A new kit starts from Europe's kit, resolved in the owner's catalog.
    const starterComponents = resolveCertificationKitComponents(raw) || [];
    const starter = {
      items: starterComponents.map((c) => ({
        productId: c.productId,
        name: c.name,
        size: c.size,
        quantity: c.quantity,
      })),
      freeShipping: true,
      trainingIncluded: false,
      trainingPrice: 0,
      discountPercent: CERTIFICATION_KIT_STARTER_DISCOUNT_PERCENT,
    };

    const kit = saved
      ? {
          items: (saved.items || []).map((it) => ({
            productId: String(it.productId),
            name: it.name,
            size: it.size,
            quantity: it.quantity,
          })),
          freeShipping: saved.freeShipping !== false,
          trainingIncluded: !!saved.trainingIncluded,
          trainingPrice: Number(saved.trainingPrice) || 0,
          discountPercent: Number(saved.discountPercent) || 0,
        }
      : null;

    return {
      status: saved ? saved.status : 'new',
      savedAt: saved?.savedAt || null,
      kit,
      starter,
      currency,
      certificationFee,
      catalog,
    };
  }

  async saveMine(owner: UserDocument, dto: SaveCertificationKitDto) {
    const { catalog } = await this.ownerCatalog(owner);

    // Merge duplicate product/size lines and keep only products in the owner's catalog.
    const merged = new Map<string, { productId: Types.ObjectId; name: string; size: string; quantity: number }>();
    for (const item of dto.items) {
      const entry = catalog.find(
        (c) => c.productId === String(item.productId) && c.size === String(item.size),
      );
      if (!entry) {
        throw new BadRequestException(
          'One of the products in the kit is not in your catalog any more. Remove it and try again.',
        );
      }
      const key = `${entry.productId}::${entry.size}`;
      const prev = merged.get(key);
      merged.set(key, {
        productId: new Types.ObjectId(entry.productId),
        name: entry.name,
        size: entry.size,
        quantity: Math.min(
          CERTIFICATION_KIT_MAX_QUANTITY,
          (prev?.quantity || 0) + Number(item.quantity),
        ),
      });
    }

    await this.kitsService.saveForOwner(owner, {
      items: [...merged.values()],
      freeShipping: dto.freeShipping,
      trainingIncluded: dto.trainingIncluded,
      trainingPrice: dto.trainingIncluded ? Number(dto.trainingPrice) || 0 : 0,
      discountPercent: Number(dto.discountPercent) || 0,
    });

    return this.getMine(owner);
  }
}
