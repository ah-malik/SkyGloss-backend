import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  CertificationKitsService,
  normalizeCertificationKitStatus,
} from './certification-kits.service';
import { CertificationKitDocument } from './entities/certification-kit.entity';
import { ProductsService } from '../products/products.service';
import {
  SaveCertificationKitDto,
  CERTIFICATION_KIT_MAX_QUANTITY,
} from './dto/save-certification-kit.dto';
import {
  applyCertificationKitDiscount,
  CERTIFICATION_KIT_STARTER_DISCOUNT_PERCENT,
  isCertificationKitProductId,
  roundMoney,
  resolveCertificationKitComponents,
  resolveComponentUnitPrice,
} from '../common/certification-kit';
import { UserDocument, UserRole } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { formatCertificationKitOwnerRole } from './certification-kits.service';

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
  private readonly logger = new Logger(CertificationKitBuilderService.name);

  constructor(
    private readonly kitsService: CertificationKitsService,
    private readonly productsService: ProductsService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Notifications never block the kit workflow. */
  private async notify(data: {
    type: NotificationType;
    title: string;
    message: string;
    user: string;
    triggeredBy?: string;
    link?: string;
  }) {
    try {
      await this.notificationsService.create(data);
    } catch (err) {
      this.logger.warn(`Certification Kit notification failed: ${(err as Error)?.message || err}`);
    }
  }

  private async notifyAdminsOfSubmission(owner: UserDocument) {
    try {
      const name =
        [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email;
      const admins = await this.usersService.findAdminUsers();
      for (const admin of admins) {
        await this.notify({
          type: NotificationType.CERTIFICATION_KIT_SUBMITTED,
          title: 'Certification Kit to approve',
          message: `${name} (${formatCertificationKitOwnerRole(owner.role)}) sent a Certification Kit for approval.`,
          user: String(admin._id),
          triggeredBy: String(owner._id),
          link: '/certification-kits',
        });
      }
    } catch (err) {
      this.logger.warn(`Could not notify admins of a Certification Kit: ${(err as Error)?.message || err}`);
    }
  }

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

  /**
   * The kit page: a HUB gets its own kit to edit; any other partner gets its
   * HUB's approved kit to view, priced with the partner's own assigned prices.
   */
  async getMine(user: UserDocument) {
    if (user.role !== UserRole.PARTNER) return this.viewForPartner(user);
    return { mode: 'edit' as const, hub: null, ...(await this.editForHub(user)) };
  }

  private async viewForPartner(viewer: UserDocument) {
    const [{ catalog, currency }, { hub, recipe }] = await Promise.all([
      this.ownerCatalog(viewer),
      this.kitsService.findHubKitForPartner(String(viewer._id)),
    ]);
    const certificationFee = await this.kitsService.getCertificationFeeInCurrency(
      viewer.country,
      currency,
    );
    // Same rule as shops: products this partner's Pricing Group does not have are left out.
    const items = (recipe?.items || []).filter((it) =>
      catalog.some((c) => c.productId === String(it.productId) && c.size === String(it.size)),
    );
    let trainingPrice = recipe?.trainingIncluded ? Number(recipe.trainingPrice) || 0 : 0;
    if (trainingPrice && recipe?.trainingCurrency) {
      trainingPrice = await this.kitsService.convertAmount(
        trainingPrice,
        recipe.trainingCurrency,
        currency,
      );
    }
    const kit =
      recipe && items.length
        ? {
            items: items.map((it) => ({
              productId: String(it.productId),
              name: it.name,
              size: it.size,
              quantity: it.quantity,
            })),
            freeShipping: recipe.freeShipping !== false,
            trainingIncluded: !!recipe.trainingIncluded,
            trainingPrice,
            discountPercent: Number(recipe.discountPercent) || 0,
          }
        : null;
    return {
      mode: 'view' as const,
      hub,
      status: kit ? 'approved' : 'none',
      savedAt: null,
      reviewNote: null,
      reviewedAt: null,
      liveApprovedAt: null,
      kit,
      starter: kit || {
        items: [],
        freeShipping: true,
        trainingIncluded: false,
        trainingPrice: 0,
        discountPercent: 0,
      },
      currency,
      certificationFee,
      catalog,
    };
  }

  private async editForHub(owner: UserDocument) {
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
      status: saved ? normalizeCertificationKitStatus(saved.status) : 'new',
      savedAt: saved?.savedAt || null,
      reviewNote: saved?.reviewNote || null,
      reviewedAt: saved?.reviewedAt || null,
      /** When the version shops see now was approved (null = none live yet). */
      liveApprovedAt: saved?.live?.items?.length ? saved.live.approvedAt || null : null,
      kit,
      starter,
      currency,
      certificationFee,
      catalog,
    };
  }

  /** What an Admin reviews: the latest sent version, priced the way its owner saw it. */
  async adminView(kit: CertificationKitDocument) {
    const owner = kit.owner as unknown as UserDocument | null;
    const ownerInfo =
      owner && typeof owner === 'object' && 'email' in owner
        ? {
            _id: String(owner._id),
            name:
              [owner.firstName, owner.lastName].filter(Boolean).join(' ') ||
              (owner as any).companyName ||
              owner.email,
            email: owner.email,
            role: owner.role,
            country: owner.country,
            partnerCode: owner.partnerCode,
          }
        : null;

    let currency = 'USD';
    let certificationFee = 0;
    let priced: Array<{ name: string; size: string; quantity: number; unitPrice: number | null; lineTotal: number | null }> =
      kit.items.map((it) => ({ name: it.name, size: it.size, quantity: it.quantity, unitPrice: null, lineTotal: null }));
    let pricingError: string | null = null;
    if (owner && ownerInfo) {
      try {
        const { catalog, currency: cur } = await this.ownerCatalog(owner);
        currency = cur;
        certificationFee = await this.kitsService.getCertificationFeeInCurrency(owner.country, cur);
        priced = kit.items.map((it) => {
          const entry = catalog.find(
            (c) => c.productId === String(it.productId) && c.size === String(it.size),
          );
          return {
            name: entry?.name || it.name,
            size: it.size,
            quantity: it.quantity,
            unitPrice: entry ? entry.unitPrice : null,
            lineTotal: entry ? roundMoney(entry.unitPrice * it.quantity) : null,
          };
        });
      } catch (err) {
        pricingError = (err as Error)?.message || 'Prices could not be loaded';
      }
    }
    const productsValue = roundMoney(
      priced.reduce((a, l) => a + (l.lineTotal || 0), 0),
    );
    const { discount, total: productsTotal } = applyCertificationKitDiscount(
      productsValue,
      kit.discountPercent,
    );
    const training = kit.trainingIncluded ? Number(kit.trainingPrice) || 0 : 0;

    return {
      _id: String(kit._id),
      status: normalizeCertificationKitStatus(kit.status),
      savedAt: kit.savedAt || null,
      reviewedAt: kit.reviewedAt || null,
      reviewNote: kit.reviewNote || null,
      owner: ownerInfo,
      currency,
      items: priced,
      freeShipping: kit.freeShipping !== false,
      trainingIncluded: !!kit.trainingIncluded,
      trainingPrice: training,
      discountPercent: Number(kit.discountPercent) || 0,
      pricing: {
        products: productsValue,
        discount,
        certificationFee,
        training,
        total: roundMoney(productsTotal + certificationFee + training),
        missingProducts: priced.some((l) => l.unitPrice == null),
        error: pricingError,
      },
      live: kit.live?.items?.length
        ? {
            approvedAt: kit.live.approvedAt || null,
            discountPercent: Number(kit.live.discountPercent) || 0,
            items: kit.live.items.map((it) => ({ name: it.name, size: it.size, quantity: it.quantity })),
            freeShipping: kit.live.freeShipping !== false,
            trainingIncluded: !!kit.live.trainingIncluded,
            trainingPrice: Number(kit.live.trainingPrice) || 0,
          }
        : null,
    };
  }

  async listForAdmin(status?: string) {
    const kits = await this.kitsService.listForAdmin(status);
    return Promise.all(kits.map((k) => this.adminView(k)));
  }

  async approve(id: string, adminId: string, savedAt?: string) {
    const kit = await this.kitsService.approve(id, adminId, savedAt);
    await this.notify({
      type: NotificationType.CERTIFICATION_KIT_APPROVED,
      title: 'Certification Kit approved',
      message: 'SkyGloss approved your Certification Kit. Shops on your link can see it now.',
      user: String(kit.owner),
      triggeredBy: adminId,
      link: '/dashboard/partner/certification-kit',
    });
    await kit.populate('owner', 'firstName lastName email role country countries partnerCode companyName productGroup');
    return this.adminView(kit);
  }

  async reject(id: string, adminId: string, note: string, savedAt?: string) {
    const kit = await this.kitsService.reject(id, adminId, note, savedAt);
    await this.notify({
      type: NotificationType.CERTIFICATION_KIT_REJECTED,
      title: 'Certification Kit not approved',
      message: `SkyGloss asked for changes to your Certification Kit: ${kit.reviewNote}`,
      user: String(kit.owner),
      triggeredBy: adminId,
      link: '/dashboard/partner/certification-kit',
    });
    await kit.populate('owner', 'firstName lastName email role country countries partnerCode companyName productGroup');
    return this.adminView(kit);
  }

  async saveMine(owner: UserDocument, dto: SaveCertificationKitDto) {
    if (owner.role !== UserRole.PARTNER) {
      throw new BadRequestException('Only a HUB can change the Certification Kit.');
    }
    const { catalog, currency } = await this.ownerCatalog(owner);

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
      currency,
    });

    await this.notifyAdminsOfSubmission(owner);
    return this.getMine(owner);
  }
}
