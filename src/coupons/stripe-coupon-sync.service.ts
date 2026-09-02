import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import {
  Coupon,
  CouponDiscountType,
  CouponDocument,
  CouponUsageType,
} from './entities/coupon.entity';
import { isCouponCurrentlyValid } from '../common/coupon-discount';
import { resolveStripeApiVersion } from '../payouts/stripe-wise-payouts.logic';

export type StripeAccountKey = 'global' | 'usa' | 'europe';

const REGISTRATION_PRODUCT_META = 'shop_registration_fee';

@Injectable()
export class StripeCouponSyncService {
  private readonly logger = new Logger(StripeCouponSyncService.name);
  private globalStripe?: Stripe;
  private usaStripe?: Stripe;
  private europeStripe?: Stripe;

  constructor(
    @InjectModel(Coupon.name)
    private couponModel: Model<CouponDocument>,
    private configService: ConfigService,
  ) {
    const getEnv = (key: string) => this.configService.get<string>(key);
    const globalKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const usaKey = this.configService.get<string>('USA_STRIPE_SECRET_KEY');
    const europeKey = this.configService.get<string>('EUROPE_STRIPE_SECRET_KEY');

    if (globalKey) {
      this.globalStripe = new Stripe(globalKey, {
        apiVersion: resolveStripeApiVersion('global', getEnv) as Stripe.LatestApiVersion,
      });
    }
    if (usaKey) {
      this.usaStripe = new Stripe(usaKey, {
        apiVersion: resolveStripeApiVersion('usa', getEnv) as Stripe.LatestApiVersion,
      });
    }
    if (europeKey) {
      this.europeStripe = new Stripe(europeKey, {
        apiVersion: resolveStripeApiVersion('europe', getEnv) as Stripe.LatestApiVersion,
      });
    }
  }

  getStripe(account: StripeAccountKey): Stripe | undefined {
    if (account === 'usa') return this.usaStripe;
    if (account === 'europe') return this.europeStripe;
    return this.globalStripe;
  }

  async syncShopRegistrationPromos(
    stripe: Stripe,
    account: StripeAccountKey,
    currency: string,
  ): Promise<string | undefined> {
    const productId = await this.getOrCreateRegistrationProduct(stripe);
    const coupons = await this.couponModel
      .find({ usageType: CouponUsageType.SHOP_REGISTRATION })
      .exec();

    for (const coupon of coupons) {
      try {
        await this.syncOneCoupon(stripe, account, coupon, currency, productId);
      } catch (err) {
        this.logger.warn(
          `Failed to sync shop registration coupon ${coupon.code} to Stripe (${account}): ${
            (err as Error)?.message || err
          }`,
        );
      }
    }

    return productId;
  }

  async syncCouponToAllAccounts(coupon: CouponDocument): Promise<void> {
    if ((coupon.usageType || CouponUsageType.ORDER) !== CouponUsageType.SHOP_REGISTRATION) {
      return;
    }
    for (const account of ['global', 'usa', 'europe'] as StripeAccountKey[]) {
      const stripe = this.getStripe(account);
      if (!stripe) continue;
      try {
        const productId = await this.getOrCreateRegistrationProduct(stripe);
        await this.syncOneCoupon(stripe, account, coupon, 'usd', productId);
      } catch (err) {
        this.logger.warn(
          `Failed to sync coupon ${coupon.code} to Stripe ${account}: ${
            (err as Error)?.message || err
          }`,
        );
      }
    }
  }

  async deactivateCouponPromos(code: string): Promise<void> {
    const coupon = await this.couponModel.findOne({
      code: String(code || '').trim().toUpperCase(),
    });
    if (!coupon?.stripeSync) return;

    for (const account of ['global', 'usa', 'europe'] as StripeAccountKey[]) {
      const stripe = this.getStripe(account);
      const promoId = coupon.stripeSync?.[account]?.promotionCodeId;
      if (!stripe || !promoId) continue;
      try {
        await stripe.promotionCodes.update(promoId, { active: false });
      } catch (err) {
        this.logger.warn(
          `Failed to deactivate Stripe promo ${promoId} (${account}): ${
            (err as Error)?.message || err
          }`,
        );
      }
    }
  }

  async resolveCodeFromCheckoutSession(
    stripe: Stripe,
    session: Stripe.Checkout.Session,
  ): Promise<string | undefined> {
    const discounts = session.discounts || [];
    for (const discount of discounts) {
      const promoRef =
        typeof discount === 'object' ? (discount as any).promotion_code : null;
      const promoId =
        typeof promoRef === 'string'
          ? promoRef
          : promoRef && typeof promoRef === 'object'
            ? promoRef.id
            : undefined;
      if (!promoId) continue;
      try {
        const promo = await stripe.promotionCodes.retrieve(promoId);
        if (promo?.code) {
          return String(promo.code).trim().toUpperCase();
        }
      } catch (err) {
        this.logger.warn(
          `Failed to retrieve Stripe promotion code ${promoId}: ${
            (err as Error)?.message || err
          }`,
        );
      }
    }
    return undefined;
  }

  async getOrCreateRegistrationProduct(stripe: Stripe): Promise<string> {
    const listed = await stripe.products.list({ limit: 100, active: true });
    const found = listed.data.find(
      (product) => product.metadata?.skygloss_type === REGISTRATION_PRODUCT_META,
    );
    if (found) return found.id;

    const created = await stripe.products.create({
      name: 'Shop Registration Fee',
      metadata: { skygloss_type: REGISTRATION_PRODUCT_META },
    });
    return created.id;
  }

  private fingerprint(coupon: CouponDocument, currency: string): string {
    const type = coupon.discountType;
    const value = coupon.discountValue;
    if (type === CouponDiscountType.PERCENTAGE) {
      return `percentage:${value}`;
    }
    return `fixed:${value}:${currency.toLowerCase()}`;
  }

  private async syncOneCoupon(
    stripe: Stripe,
    account: StripeAccountKey,
    coupon: CouponDocument,
    currency: string,
    productId: string,
  ): Promise<void> {
    const shouldBeActive = isCouponCurrentlyValid(coupon);
    const existingList = await stripe.promotionCodes.list({
      code: coupon.code,
      limit: 1,
    });
    const existingPromo = existingList.data[0];

    if (existingPromo) {
      if (existingPromo.active !== shouldBeActive) {
        await stripe.promotionCodes.update(existingPromo.id, {
          active: shouldBeActive,
        });
      }
      const stripeCouponId =
        typeof existingPromo.promotion?.coupon === 'string'
          ? existingPromo.promotion.coupon
          : existingPromo.promotion?.coupon?.id;
      coupon.stripeSync = {
        ...(coupon.stripeSync || {}),
        [account]: {
          couponId: stripeCouponId,
          promotionCodeId: existingPromo.id,
          productId,
          currency:
            coupon.discountType === CouponDiscountType.FIXED
              ? currency.toLowerCase()
              : undefined,
          fingerprint: this.fingerprint(coupon, currency),
        },
      };
      await coupon.save();
      return;
    }

    if (!shouldBeActive) {
      return;
    }

    const stripeCoupon = await stripe.coupons.create(
      this.buildStripeCouponParams(coupon, currency, productId),
    );

    const promoParams: Stripe.PromotionCodeCreateParams = {
      promotion: {
        type: 'coupon',
        coupon: stripeCoupon.id,
      },
      code: coupon.code,
      active: true,
      metadata: {
        skygloss_coupon: coupon.code,
        usageType: CouponUsageType.SHOP_REGISTRATION,
      },
    };
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() > Date.now()) {
      promoParams.expires_at = Math.floor(new Date(coupon.expiresAt).getTime() / 1000);
    }
    if (coupon.maxUses && coupon.maxUses > 0) {
      const remaining = Math.max(1, coupon.maxUses - (coupon.timesUsed || 0));
      promoParams.max_redemptions = remaining;
    }

    const promo = await stripe.promotionCodes.create(promoParams);
    coupon.stripeSync = {
      ...(coupon.stripeSync || {}),
      [account]: {
        couponId: stripeCoupon.id,
        promotionCodeId: promo.id,
        productId,
        currency:
          coupon.discountType === CouponDiscountType.FIXED
            ? currency.toLowerCase()
            : undefined,
        fingerprint: this.fingerprint(coupon, currency),
      },
    };
    await coupon.save();
  }

  private buildStripeCouponParams(
    coupon: CouponDocument,
    currency: string,
    productId: string,
  ): Stripe.CouponCreateParams {
    const params: Stripe.CouponCreateParams = {
      duration: 'once',
      name: coupon.code,
      metadata: {
        skygloss_coupon: coupon.code,
        usageType: CouponUsageType.SHOP_REGISTRATION,
      },
      applies_to: { products: [productId] },
    };

    if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
      params.percent_off = coupon.discountValue;
    } else {
      params.amount_off = Math.round(Number(coupon.discountValue) * 100);
      params.currency = currency.toLowerCase();
    }

    return params;
  }
}
