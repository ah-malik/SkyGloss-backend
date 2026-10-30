import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Inject,
  forwardRef,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  Order,
  OrderDocument,
  OrderStatus,
  CancellationRequestStatus,
} from './entities/order.entity';
import {
  DuplicateInvoice,
  DuplicateInvoiceDocument,
} from './entities/duplicate-invoice.entity';
import {
  OrderActivityLog,
  OrderActivityLogDocument,
} from './entities/order-activity-log.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { AddOrderItemsDto } from './dto/add-order-items.dto';
import { CreateDuplicateInvoiceDto } from './dto/create-duplicate-invoice.dto';
import { CreateAdminTestOrderDto } from './dto/create-admin-test-order.dto';
import { ProductsService } from '../products/products.service';
import { ProductInventoryService } from '../inventory/product-inventory.service';
import { FedexService, FedExAddressInput } from '../fedex/fedex.service';
import { GeoService } from '../geo/geo.service';
import {
  isFedexShippingDestination,
  isPuertoRicoDestination,
} from '../common/fedex-destinations';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationType } from '../notifications/entities/notification.entity';
import { UsersService } from '../users/users.service';
import { UserActivityService } from '../user-activity/user-activity.service';
import { UserActivityAction } from '../user-activity/entities/user-activity-log.entity';
import { MailService } from '../mail/mail.service';
import { UserDocument, UserRole, UserStatus } from '../users/entities/user.entity';
import { normalizePartnerCode } from '../common/partner-code';
import { ProductGroup, ProductGroupDocument } from '../product-groups/entities/product-group.entity';
import { RegistrationFeesService } from '../registration-fees/registration-fees.service';
import {
  calculateShippingFee,
  getShippingRegion,
  SHIPPING_FEE_AMOUNT,
  usdToLocalAmount,
} from '../common/shipping-config';
import {
  getItemsSubtotal,
  getOrderKitExtrasTotal,
  isRegistrationOrder,
  registrationOrderExclusionFilter,
  shouldHideShopRegistrationFromViewer,
} from '../common/order-totals';
import {
  calculateEuropeOrderVatAmount,
  getEuropeVatRatePercent,
  getOrderVatTaxableBase,
} from '../common/europe-vat';
import {
  applyRegistrationVatChoice,
  buildRegistrationFeeQuote,
  calculateRegistrationTotals,
  getRegistrationTaxPercent,
  RegistrationVatChoice,
  registrationRequiresVatChoice,
  splitPaidRegistrationAmount,
} from '../common/registration-pricing';
import {
  isOrderModifiable,
  getOrderAmountPaid,
  getOrderRemainingAmount,
  shouldMarkFailedOnCheckoutExpire,
  isOrderPaymentRecorded,
  isStripeCheckoutSessionPaid,
  paymentNotRecordedStatusFilter,
} from '../common/order-modifiable';
import {
  createOrderPaymentToken,
  verifyOrderPaymentToken,
} from '../common/order-payment-token';
import {
  formatRoleLabel,
  getRegistrationFeeDescription,
  getRegistrationFeeName,
} from '../common/role-labels';
import { PdfService } from '../pdf/pdf.service';
import {
  calculateHierarchyCommissionEntries,
  calculateRepresentativeCommissionEntries,
  CommissionRecipient,
  getDefaultFirstOrderCommissionRates,
  normalizePartnerDevelopmentRatePercent,
  normalizeShopIntroductionFirstOrderRatePercent,
  resolveCommissionOrderAmounts,
  resolveCommissionRatePercent,
  resolveFirstOrderPoolSplit,
  resolvePartnerDevelopmentAmountFromChildCommission,
  resolveShopCommissionChain,
  shouldUseFirstOrderNetworkCommission,
} from '../common/commission-distribution';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import {
  buildLockedMonetaryFields,
  recalculateBaseWithLockedRate,
  roundMoney,
  SALES_REPORT_STATUSES,
  SYSTEM_BASE_CURRENCY,
  EFFECTIVE_BASE_AMOUNT_EXPR,
  EFFECTIVE_ORIGINAL_AMOUNT_EXPR,
  EFFECTIVE_ORIGINAL_CURRENCY_EXPR,
} from '../common/order-monetary';
import {
  canViewerSeeOrderPlacerRole,
  filterCommissionsForViewerWithSplitContext,
  shouldIncludeViewerInNetworkOrders,
} from '../common/user-hierarchy';
import {
  formatRegistrationOrderNumber,
  formatShopOrderNumber,
  getNextRegistrationOrderSequence,
  getNextShopOrderSequenceForFlow,
  getShopOrderNumberRegex,
  isOrderRequest,
  ORDER_SEQUENCE_STEP,
  type ShopOrderFlow,
} from '../common/order-number';
import { applyPartnerAccountDiscount } from '../common/partner-order-discount';
import { normalizeCurrencyCode } from '../common/currency-codes';
import { normalizeOrderItemType } from '../common/order-type';
import {
  getUnitsPerCaseForProduct,
  resolveOrderLinePrice,
} from '../common/units-per-case';
import {
  applyCertificationKitDiscount,
  getCertificationKitExtras,
  isCertificationKitCartItem,
  isCertificationKitEligibleUser,
} from '../common/certification-kit';
import { CouponsService, ShopRegistrationCouponResult } from '../coupons/coupons.service';
import { StripeCouponSyncService } from '../coupons/stripe-coupon-sync.service';
import { CommissionsService } from '../payouts/services/commissions.service';
import {
  PartnerAssignmentEarningType,
  registerSelectiveShopCommissionLinkHandler,
  registerShopCommissionRecalculationHandler,
  SelectiveShopCommissionLinkParams,
} from '../common/shop-commission-recalculation';
import {
  softDeleteSetPayload,
  softDeleteUnsetPayload,
  SOFT_DELETE_RETENTION_DAYS,
} from '../common/soft-delete';
import { OrderCommissionTransferService } from '../payouts/services/order-commission-transfer.service';
import {
  isEuropeCountryName,
  isUsaShopOrder,
  requiresOnlinePaymentShopOrder,
  resolveShopOrderStripeAccountKey,
  resolveStripeApiVersion,
  StripeAccountKey,
} from '../payouts/stripe-wise-payouts.logic';
import {
  requiresEuropeanVat,
  resolveOrderDestinationCountry,
  validateEuropeanVatNumber,
} from '../common/vies-vat';
import { RedisCacheService } from '../redis/redis-cache.service';
import { CacheKeys, CacheTtl } from '../redis/redis.constants';

const USA_COUNTRIES = ['united states', 'usa', 'us', 'united states of america'];
const PENDING_PAYMENT_CANCEL_DAYS = 3;
const PAYMENT_REMINDER_INTERVALS_MS = [
  24 * 60 * 60 * 1000,
  48 * 60 * 60 * 1000,
];

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);
  private stripe: Stripe;
  private usaStripe: Stripe;
  private europeStripe: Stripe;

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(DuplicateInvoice.name)
    private duplicateInvoiceModel: Model<DuplicateInvoiceDocument>,
    @InjectModel(OrderActivityLog.name)
    private orderActivityModel: Model<OrderActivityLogDocument>,
    @InjectModel(ProductGroup.name) private productGroupModel: Model<ProductGroupDocument>,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
    private usersService: UsersService,
    private mailService: MailService,
    private registrationFeesService: RegistrationFeesService,
    @Inject(forwardRef(() => PdfService))
    private pdfService: PdfService,
    private exchangeRatesService: ExchangeRatesService,
    private couponsService: CouponsService,
    private stripeCouponSync: StripeCouponSyncService,
    private commissionsService: CommissionsService,
    private orderCommissionTransferService: OrderCommissionTransferService,
    private productsService: ProductsService,
    private productInventoryService: ProductInventoryService,
    private readonly cache: RedisCacheService,
    private fedexService: FedexService,
    private userActivityService: UserActivityService,
    private geoService: GeoService,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const usaStripeSecretKey = this.configService.get<string>('USA_STRIPE_SECRET_KEY');
    const europeStripeSecretKey = this.configService.get<string>('EUROPE_STRIPE_SECRET_KEY');
    const getEnv = (key: string) => this.configService.get<string>(key);

    if (!stripeSecretKey) {
      console.warn('STRIPE_SECRET_KEY is not defined');
      this.stripe = undefined as any;
    } else {
      this.stripe = new Stripe(stripeSecretKey, {
        apiVersion: resolveStripeApiVersion('global', getEnv) as Stripe.LatestApiVersion,
      });
    }

    if (!usaStripeSecretKey) {
      console.warn('USA_STRIPE_SECRET_KEY is not defined');
      this.usaStripe = undefined as any;
    } else {
      this.usaStripe = new Stripe(usaStripeSecretKey, {
        apiVersion: resolveStripeApiVersion('usa', getEnv) as Stripe.LatestApiVersion,
      });
    }

    if (!europeStripeSecretKey) {
      console.warn('EUROPE_STRIPE_SECRET_KEY is not defined');
      this.europeStripe = undefined as any;
    } else {
      this.europeStripe = new Stripe(europeStripeSecretKey, {
        apiVersion: resolveStripeApiVersion('europe', getEnv) as Stripe.LatestApiVersion,
      });
    }
  }

  async onModuleInit() {
    registerShopCommissionRecalculationHandler((shopUserId) =>
      this.recalculateCommissionsForShop(shopUserId),
    );
    registerSelectiveShopCommissionLinkHandler((params) =>
      this.linkSelectedOrdersToPartnerEarning(params),
    );
    await this.exchangeRatesService.refreshRatesFromMarket();
    await this.repairBrokenFxOrders();
  }

  /** Fix orders where FX rate was rounded to 0 or non-USD was treated as 1:1 USD. */
  private async repairBrokenFxOrders(): Promise<void> {
    const candidates = await this.orderModel
      .find({
        $or: [
          { exchangeRateAtOrderTime: 0 },
          {
            exchangeRateAtOrderTime: 1,
            $expr: {
              $ne: [
                { $toUpper: { $ifNull: ['$originalCurrency', '$currency'] } },
                'USD',
              ],
            },
          },
          {
            baseCurrencyAmount: 0,
            totalAmount: { $gt: 0 },
            $expr: {
              $ne: [
                { $toUpper: { $ifNull: ['$originalCurrency', '$currency'] } },
                'USD',
              ],
            },
          },
          {
            totalAmount: { $gt: 0 },
            currency: { $nin: ['USD', 'usd'] },
            $or: [
              { originalCurrency: { $exists: false } },
              { exchangeRateAtOrderTime: { $exists: false } },
              { baseCurrencyAmount: { $exists: false } },
            ],
          },
        ],
      })
      .limit(1000)
      .exec();

    let repaired = 0;
    for (const order of candidates) {
      const currency = (
        order.originalCurrency ||
        order.currency ||
        ''
      ).toUpperCase();
      if (!currency || currency === SYSTEM_BASE_CURRENCY) continue;

      const amount = order.originalAmount ?? order.totalAmount;
      if (!amount || amount <= 0) continue;

      try {
        const createdAt = (order as OrderDocument & { createdAt?: Date }).createdAt;
        const orderDate = createdAt ? new Date(createdAt) : new Date();
        const rate = await this.exchangeRatesService.getRateToBaseForDate(
          currency,
          orderDate,
        );
        if (rate <= 0) continue;

        const fields = buildLockedMonetaryFields(amount, currency, rate);
        if (
          order.exchangeRateAtOrderTime === fields.exchangeRateAtOrderTime &&
          order.baseCurrencyAmount === fields.baseCurrencyAmount
        ) {
          continue;
        }

        await this.orderModel.updateOne({ _id: order._id }, { $set: fields });
        repaired++;
      } catch (err) {
        this.logger.warn(
          `Could not repair FX fields for order ${order.orderNumber}:`,
          err,
        );
      }
    }

    if (repaired > 0) {
      this.logger.log(`Repaired FX fields on ${repaired} order(s)`);
    }
  }

  async getCurrencyForUser(user: any): Promise<string> {
    const userCountry = (user?.country || '').toLowerCase().trim();
    let orderCurrency = 'usd';

    if (user && user.productGroup) {
      const explicitGroup = await this.productGroupModel.findById(user.productGroup);
      if (explicitGroup && explicitGroup.currency) {
        orderCurrency = explicitGroup.currency.toLowerCase();
      }
    } else {
      const groups = await this.productGroupModel.find({ isActive: { $ne: false } }).exec();
      const countryMatch = groups.find(
        g => (Array.isArray(g.countries) && g.countries.map(c => c.toLowerCase()).includes(userCountry)) || 
             (g.country && g.country.toLowerCase() === userCountry)
      );
      
      if (countryMatch && countryMatch.currency) {
        orderCurrency = countryMatch.currency.toLowerCase();
      } else {
        const defaultGroup = groups.find(g => g.isDefault);
        if (defaultGroup && defaultGroup.currency) {
          orderCurrency = defaultGroup.currency.toLowerCase();
        }
      }
    }
    return normalizeCurrencyCode(orderCurrency);
  }

  private async buildMonetaryFieldsForNewOrder(
    totalAmount: number,
    currency: string,
  ) {
    // Lock today's DB rate at checkout — becomes the permanent order-date FX.
    const rate = await this.exchangeRatesService.getRateToBase(currency);
    return buildLockedMonetaryFields(totalAmount, currency, rate);
  }

  private buildAmountUpdateWithLockedRate(
    existingOrder: OrderDocument | null | undefined,
    newTotal: number,
  ) {
    if (
      existingOrder?.exchangeRateAtOrderTime != null &&
      existingOrder.exchangeRateAtOrderTime > 0
    ) {
      return recalculateBaseWithLockedRate(
        newTotal,
        existingOrder.exchangeRateAtOrderTime,
      );
    }
    return {
      totalAmount: newTotal,
      originalAmount: newTotal,
    };
  }

  private async computeSalesReport(matchFilter: Record<string, unknown> = {}) {
    const statusMatch = {
      status: { $in: [...SALES_REPORT_STATUSES] },
      ...matchFilter,
    };

    const [totalRevenueResult, currencyGroups, dailySales] = await Promise.all([
      this.orderModel.aggregate([
        { $match: statusMatch },
        { $group: { _id: null, total: { $sum: EFFECTIVE_BASE_AMOUNT_EXPR } } },
      ]),
      this.orderModel.aggregate([
        { $match: statusMatch },
        {
          $group: {
            _id: EFFECTIVE_ORIGINAL_CURRENCY_EXPR,
            orderCount: { $sum: 1 },
            originalTotal: { $sum: EFFECTIVE_ORIGINAL_AMOUNT_EXPR },
            baseTotal: { $sum: EFFECTIVE_BASE_AMOUNT_EXPR },
          },
        },
      ]),
      this.orderModel.aggregate([
        {
          $match: {
            ...statusMatch,
            createdAt: {
              $gte: (() => {
                const d = new Date();
                d.setDate(d.getDate() - 7);
                d.setHours(0, 0, 0, 0);
                return d;
              })(),
            },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            sales: { $sum: EFFECTIVE_BASE_AMOUNT_EXPR },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const totalRevenue = totalRevenueResult[0]?.total || 0;

    const currencyBreakdown = currencyGroups
      .filter((group) => group.orderCount > 0 && group._id)
      .map((group) => ({
        currency: String(group._id).toUpperCase(),
        orderCount: group.orderCount,
        originalTotal: group.originalTotal,
        baseTotal: group.baseTotal,
      }))
      .sort(
        (a, b) =>
          b.originalTotal - a.originalTotal ||
          a.currency.localeCompare(b.currency),
      );

    const chartData: { date: string; sales: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const found = dailySales.find((day) => day._id === dateStr);
      chartData.push({
        date: dateStr,
        sales: found ? found.sales : 0,
      });
    }

    return {
      totalRevenue,
      baseCurrency: SYSTEM_BASE_CURRENCY,
      currencyBreakdown,
      chartData,
    };
  }

  async createDistributorFeeCheckoutSession(
    userId: string,
    email: string,
    additionalMetadata: any = {},
    vatOptions?: RegistrationVatChoice,
    couponCode?: string,
  ): Promise<{ url: string | null; id: string } | { paid: true; user: any }> {
    const user = await this.usersService.findOne(userId);
    if (user?.isPartnerPaid) {
      throw new BadRequestException(
        'The registration fee for this account has already been paid.',
      );
    }
    const type = additionalMetadata.type || 'partner_registration';
    const country =
      additionalMetadata.country || user?.country || '';
    const stripeAccountKey = resolveShopOrderStripeAccountKey(undefined, country);
    const stripeInstance = this.getStripeForAccountKey(stripeAccountKey);
    const baseUrl = this.getFrontendBaseUrl();
    const isShopRegistration = type === 'shop_registration';

    const keyMode = (this.getStripeSecretKeyForAccount(stripeAccountKey) || '').startsWith('sk_live')
      ? 'live'
      : 'test';
    console.log(
      `[Stripe Registration] Using ${stripeAccountKey.toUpperCase()} Stripe (${keyMode}) for country="${country}", frontend="${baseUrl}"`,
    );

    const success_path =
      additionalMetadata.successPath ||
      (type === 'shop_registration' ? '/login/shop?payment_success=true' : '/login/partner?payment_success=true');
    const cancel_path =
      additionalMetadata.cancelPath ||
      (type === 'shop_registration' ? '/register/shop?payment_canceled=true' : '/register/partner?payment_canceled=true');

    // PRICING LOGIC — coupon discounts apply to the fee only; tax/VAT is charged on the discounted fee.
    const feeGroup = await this.registrationFeesService.findByCountry(country);
    const feeQuote = buildRegistrationFeeQuote(feeGroup, country);
    const currency = feeQuote.currency.toLowerCase();
    const undiscountedTotals = calculateRegistrationTotals(feeQuote);
    let unit_amount = Math.round(undiscountedTotals.feeAmount * 100);
    let tax_amount = Math.round(undiscountedTotals.taxAmount * 100);
    if (feeGroup) {
      console.log(
        `[Stripe Registration] Fee group="${feeGroup.name}" currency=${currency} amount=${unit_amount} tax=${tax_amount} country="${country}" default=${!!feeGroup.isDefault}`,
      );
    } else {
      console.log(
        `[Stripe Registration] No fee group matched country="${country}"; using hardcoded USD $250 fallback`,
      );
    }

    let appliedShopCoupon: ShopRegistrationCouponResult | null = null;
    // Shop registration coupons are entered in the payment modal. Stripe Checkout
    // must not offer a second promotion-code field for this fee.
    let allowPromotionCodes = !isShopRegistration;
    let registrationProductId: string | undefined;

    if (isShopRegistration) {
      // Coupon may already be stored from the registration form, or entered now
      // in the payment modal. One code per account; Stripe promos are not used.
      const requestedCode = (couponCode || user?.couponCode || '').trim();
      if (requestedCode) {
        appliedShopCoupon = await this.couponsService.validateForShopRegistration(
          requestedCode,
          feeQuote,
          user?.couponCode,
        );
        additionalMetadata.couponCode = appliedShopCoupon.code;
        additionalMetadata.registrationDiscount = appliedShopCoupon.discountAmount;
        additionalMetadata.finalAmount = appliedShopCoupon.totalAfterDiscount;
      }
    }

    if (isShopRegistration && appliedShopCoupon?.isFullyCovered) {
      return this.completeShopRegistrationWithCoupon(userId, appliedShopCoupon);
    }

    // Shop registration VAT follows the shop order rule:
    // verified VAT ID → no VAT; "I don't have a VAT ID" → country VAT.
    let chargeQuote = feeQuote;
    if (isShopRegistration && registrationRequiresVatChoice(country)) {
      const vatChoice = await this.resolveRegistrationVatChoice(country, vatOptions);
      chargeQuote = applyRegistrationVatChoice(feeQuote, country, vatChoice);
      additionalMetadata.registrationTaxId = vatChoice.taxId;
      additionalMetadata.registrationNoVatId = vatChoice.noVatId ? 'true' : 'false';
      additionalMetadata.registrationVatExempt = chargeQuote.vatExempt ? 'true' : 'false';
    }

    const chargeTotals = calculateRegistrationTotals(
      chargeQuote,
      appliedShopCoupon?.discountAmount ?? 0,
    );
    unit_amount = Math.round(chargeTotals.taxableBase * 100);
    tax_amount = Math.round(chargeTotals.taxAmount * 100);
    const totalBeforeDiscount = Math.round(
      calculateRegistrationTotals(chargeQuote).total * 100,
    );
    if (appliedShopCoupon) {
      additionalMetadata.finalAmount = chargeTotals.total;
    }

    const feeName = user
      ? getRegistrationFeeName(user.role)
      : type === 'shop_registration'
        ? 'Shop Registration Fee'
        : 'Hub Registration Fee';
    const feeDescription = user
      ? getRegistrationFeeDescription(user.role)
      : type === 'shop_registration'
        ? 'One-time fee to activate FUSION certification and online training courses'
        : 'One-time fee to activate your SkyGloss Hub account.';

    const feePriceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
      currency,
      unit_amount,
      ...(isShopRegistration && allowPromotionCodes && registrationProductId
        ? { product: registrationProductId }
        : {
            product_data: {
              name: feeName,
              description: feeDescription,
            },
          }),
    };

    const usesStripePromoProduct =
      isShopRegistration && allowPromotionCodes && !!registrationProductId;
    let feeTaxRateId: string | undefined;

    if (usesStripePromoProduct && tax_amount > 0) {
      try {
        feeTaxRateId = await this.stripeCouponSync.getOrCreateRegistrationTaxRate(
          stripeInstance,
          getRegistrationTaxPercent(chargeQuote),
          feeQuote.vatRate != null ? 'VAT' : 'Tax',
        );
      } catch (taxRateErr) {
        this.logger.warn(
          `Failed to resolve Stripe registration tax rate; charging tax-inclusive fee: ${
            (taxRateErr as Error)?.message || taxRateErr
          }`,
        );
      }
    }

    if (usesStripePromoProduct && !feeTaxRateId) {
      feePriceData.unit_amount = totalBeforeDiscount;
    }

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: feePriceData,
        quantity: 1,
        ...(feeTaxRateId ? { tax_rates: [feeTaxRateId] } : {}),
      },
    ];

    if (tax_amount > 0 && !usesStripePromoProduct) {
      line_items.push({
        price_data: {
          currency,
          product_data: {
            name: feeQuote.vatRate != null ? `VAT (${feeQuote.vatRate}%)` : 'Tax',
          },
          unit_amount: tax_amount,
        },
        quantity: 1,
      });
    }

    const successJoiner = success_path.includes('?') ? '&' : '?';
    const cancelJoiner = cancel_path.includes('?') ? '&' : '?';

    try {
      const session = await stripeInstance.checkout.sessions.create({
        payment_method_types: ['card'],
        allow_promotion_codes: allowPromotionCodes,
        line_items,
        mode: 'payment',
        success_url: `${baseUrl}${success_path}${successJoiner}user_id=${userId}`,
        cancel_url: `${baseUrl}${cancel_path}${cancelJoiner}user_id=${userId}`,
        client_reference_id: userId,
        customer_email: email,
        metadata: {
          type,
          userId: userId,
          ...additionalMetadata,
        },
      });

      // Save session ID to user for verification fallback
      await this.usersService.update(userId, { stripeSessionId: session.id } as any, { role: UserRole.ADMIN } as any);

      return { url: session.url, id: session.id };
    } catch (error) {
      console.error('Stripe session creation error:', error);
      throw new BadRequestException(
        `Stripe session creation failed: ${error.message}`,
      );
    }
  }

  /** VAT ID must be verified via VIES (same as shop orders) unless the shop declares it has none. */
  private async resolveRegistrationVatChoice(
    country: string,
    vatOptions?: RegistrationVatChoice,
  ): Promise<{ taxId: string; noVatId: boolean }> {
    if (vatOptions?.noVatId === true) {
      return { taxId: '', noVatId: true };
    }
    if (!String(vatOptions?.taxId || '').trim()) {
      throw new BadRequestException(
        'Please enter your VAT ID, or select that you do not have a VAT ID, before paying the registration fee.',
      );
    }
    const result = await validateEuropeanVatNumber({
      country,
      taxId: vatOptions?.taxId,
    });
    if (!result.ok) {
      throw new BadRequestException(result.message);
    }
    return { taxId: result.normalizedVat, noVatId: false };
  }

  /** Amounts shown before the shop chooses whether it has a VAT ID. */
  async getShopRegistrationFeeQuote(userId: string, requestedCouponCode?: string) {
    const user = await this.usersService.findOne(userId);
    const country = user?.country || '';
    const feeGroup = await this.registrationFeesService.findByCountry(country);
    const feeQuote = buildRegistrationFeeQuote(feeGroup, country);

    let discount = 0;
    let couponCode: string | undefined;
    const explicitCode = String(requestedCouponCode || '').trim();
    const storedRegistrationCoupon = String(user?.couponCode || '').trim();
    // Prefer an explicit code from the payment modal; otherwise reuse the
    // coupon saved at Shop Registration (discount only — code is not re-shown).
    const codeToPrice = explicitCode || storedRegistrationCoupon;
    if (codeToPrice) {
      try {
        const coupon = await this.couponsService.validateForShopRegistration(
          codeToPrice,
          feeQuote,
          user?.couponCode,
        );
        discount = coupon.discountAmount;
        // Do not echo a registration-form coupon back to the Fusion enroll modal.
        // Checkout still applies it via user.couponCode on the activation-fee endpoint.
        if (explicitCode) {
          couponCode = coupon.code;
        }
      } catch (err) {
        if (explicitCode) throw err;
        discount = 0;
      }
    }

    const vatRequired = registrationRequiresVatChoice(country);
    const withTax = calculateRegistrationTotals(feeQuote, discount);
    const withValidVatId = vatRequired
      ? calculateRegistrationTotals({ ...feeQuote, vatExempt: true }, discount)
      : withTax;

    return {
      country,
      currency: feeQuote.currency,
      feeAmount: withTax.feeAmount,
      couponCode,
      discount: withTax.discount,
      vatRequired,
      vatRate: feeQuote.vatRate,
      taxAmount: withTax.taxAmount,
      total: withTax.total,
      totalWithValidVatId: withValidVatId.total,
      isFullyCovered: withTax.total <= 0,
      isPaid: !!user?.isPartnerPaid,
      registrationCouponAlreadyUsed: !!storedRegistrationCoupon,
    };
  }

  private async completeShopRegistrationWithCoupon(
    userId: string,
    coupon: ShopRegistrationCouponResult,
  ): Promise<{ paid: true; user: any }> {
    const existing = await this.usersService.findOne(userId);
    if (existing?.isPartnerPaid) {
      return {
        paid: true as const,
        user: existing,
      };
    }

    const updatedUser = await this.usersService.update(
      userId,
      {
        status: UserStatus.ACTIVE,
        isPartnerPaid: true,
        couponCode: coupon.code,
      } as any,
      { role: UserRole.ADMIN } as any,
    );

    if (!updatedUser) {
      throw new BadRequestException('Unable to complete registration with coupon.');
    }

    let invoiceBuffer: Buffer | undefined;
    let orderNumber: string | undefined;
    try {
      const regOrder = await this.createRegistrationOrder(updatedUser, undefined, {
        couponCode: coupon.code,
        discount: coupon.discountAmount,
      });
      invoiceBuffer = await this.generateInvoicePdf(regOrder);
      orderNumber = regOrder.orderNumber;
      await this.recordCouponUsageIfApplicable(coupon.code);
    } catch (orderErr) {
      console.error(
        '[Shop Registration Coupon] Failed to create registration order:',
        orderErr,
      );
    }

    try {
      await this.mailService.sendDistributorPaymentCompletedAdminNotification(
        [],
        updatedUser,
      );
      if (updatedUser.email) {
        const partnerContact =
          await this.usersService.getPartnerContactForShop(updatedUser);
        await this.mailService.sendDistributorPaymentConfirmation(
          updatedUser.email,
          updatedUser,
          invoiceBuffer,
          orderNumber,
          partnerContact,
        );
      }
    } catch (mailErr) {
      console.error(
        '[Shop Registration Coupon] Failed to send payment emails:',
        mailErr,
      );
    }

    return {
      paid: true,
      user: updatedUser,
    };
  }

  /**
   * A registration checkout completed for a user who is already paid. A Stripe retry of the
   * session that activated them is harmless; any other paid session is a second charge, so
   * tell admin to refund it instead of dropping it silently.
   */
  private async flagDuplicateRegistrationPayment(
    source: string,
    user: any,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const amount = (session.amount_total || 0) / 100;
    if (session.payment_status !== 'paid' || amount <= 0) return;

    const activatedBySession = await this.orderModel.exists({
      user: user._id,
      'items.product': 'registration_fee',
      stripeSessionId: session.id,
    });
    if (activatedBySession) return;

    const currency = (session.currency || 'usd').toUpperCase();
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || '';
    console.error(
      `[${source}] DUPLICATE registration payment: user ${user._id} paid ${amount.toFixed(2)} ${currency} again (session ${session.id}, payment ${paymentIntentId}). Refund required.`,
    );

    try {
      const notification = await this.notificationsService.create({
        type: NotificationType.ORDER_PAID,
        title: 'Duplicate Registration Payment',
        message: `${user.firstName} ${user.lastName} (${user.email}) paid the registration fee again (${amount.toFixed(2)} ${currency}). The account was already active, so no order was created. Refund payment ${paymentIntentId} in Stripe.`,
        metadata: {
          userId: user._id,
          stripeSessionId: session.id,
          paymentIntentId,
          amount,
          currency,
        },
      });
      this.notificationsGateway.broadcastNotification(notification);
    } catch (err) {
      console.error(`[${source}] Failed to create duplicate payment notification:`, err);
    }

    await this.mailService.sendDuplicateRegistrationPaymentAdminAlert(user, {
      amount,
      currency,
      paymentIntentId,
      stripeSessionId: session.id,
      paidAt: new Date((session.created || Date.now() / 1000) * 1000),
    });
  }

  private async resolvePaidShopRegistrationCoupon(
    stripeInstance: Stripe,
    session: Stripe.Checkout.Session,
    user: any,
  ): Promise<{ couponCode?: string; discount?: number }> {
    const stripeDiscount = (session.total_details?.amount_discount || 0) / 100;
    const promoCode = await this.stripeCouponSync
      .resolveCodeFromCheckoutSession(stripeInstance, session)
      .catch(() => undefined);
    const metadataCode = session.metadata?.couponCode;
    const couponCode = user?.couponCode || promoCode || metadataCode || undefined;
    const codeToPersist = !user?.couponCode
      ? promoCode || metadataCode
      : undefined;

    if (codeToPersist) {
      await this.usersService.update(
        String(user._id),
        { couponCode: codeToPersist } as any,
        { role: UserRole.ADMIN } as any,
      );
    }

    return {
      couponCode,
      discount: stripeDiscount > 0.01 ? stripeDiscount : undefined,
    };
  }

  async createCheckoutSession(
    userId: string,
    createOrderDto: CreateOrderDto,
    role?: string,
  ) {
    // Fetch the logged-in user's country from database
    const currentUser = await this.usersService.findOne(userId);
    const userCountry = (currentUser?.country || '').toLowerCase().trim();

    const { items: rawItems, shippingAddress, couponCode } = createOrderDto;
    const isPickup = createOrderDto.isPickup === true;
    const pickupHub = isPickup ? await this.getPickupHubForUser(userId) : null;
    if (isPickup && !pickupHub) {
      throw new BadRequestException(
        'Pickup is not available for your account. Please enter a shipping address.',
      );
    }
    if (!isPickup) {
      this.assertShippingAddressComplete(shippingAddress);
      await this.assertValidShippingPostcode(shippingAddress);
    }
    await this.assertAndNormalizeEuropeanVat(
      shippingAddress,
      currentUser?.country,
    );
    const shippingCountry =
      shippingAddress?.country || currentUser?.country || '';
    const requiresOnlinePayment = this.requiresOnlinePaymentDestinationOrder(
      shippingAddress?.country,
      currentUser?.country,
    );
    const stripeAccountKey = this.resolveOrderStripeAccountKey(
      shippingAddress?.country,
      currentUser?.country,
    );

    // Route to appropriate Stripe based on order destination (shipping country).
    const stripeInstance = this.getStripeForAccountKey(stripeAccountKey);

    if (!stripeInstance) {
      throw new BadRequestException('Stripe is not configured on the server.');
    }
    console.log(
      `[Stripe] Using ${stripeAccountKey.toUpperCase()} Stripe for shipping="${shippingCountry}", user="${currentUser?.country}"`,
    );

    // DETERMINE CURRENCY
    const orderCurrency = await this.getCurrencyForUser(currentUser);

    const items = await this.repriceOrderItemsForUser(
      currentUser,
      rawItems.map((item) => ({
        ...item,
        orderType: normalizeOrderItemType(item.orderType),
      })),
    );

    const kitResolved = await this.resolveCertificationKitOrderItems(
      currentUser as any,
      items,
    );
    const resolvedItems = kitResolved.items;
    const includesCertificationKit = kitResolved.includesCertificationKit;
    const kitExtras = kitResolved.extras;
    const kitExtrasTotal = getOrderKitExtrasTotal(kitExtras);

    // Calculate total amount from items
    // Note: In a real app, we should fetch product prices from DB to secure against client-side manipulation.
    // For this implementation, we'll use the prices sent from frontend but ensure strict types.
    // Certification Kit prices are always server-resolved from catalog components.
    const itemsSubtotal = getItemsSubtotal(resolvedItems);
    const rateToUsd = await this.exchangeRatesService.getRateToBase(orderCurrency);
    const shippingQuote = await this.quoteCheckoutShipping({
      user: currentUser,
      items: resolvedItems,
      shippingAddress,
      // Kit: the free-shipping threshold uses the kit price, as checkout shows it.
      itemsSubtotal: includesCertificationKit
        ? itemsSubtotal - kitResolved.kitDiscount + kitExtrasTotal
        : itemsSubtotal,
      orderCurrency,
      rateToUsd,
      isPickup,
      includesCertificationKit:
        includesCertificationKit && kitResolved.freeShipping,
    });
    const shippingFee = shippingQuote.shippingFee;

    if (includesCertificationKit && couponCode?.trim()) {
      throw new BadRequestException(
        'Coupons cannot be used with the Certification Kit. Its price is set by SkyGloss.',
      );
    }
    let discount = 0;
    let appliedCouponCode: string | undefined;
    if (couponCode?.trim()) {
      const validation = await this.couponsService.validateForCheckout(
        couponCode,
        itemsSubtotal,
      );
      discount = validation.discountAmount;
      appliedCouponCode = validation.code;
    }
    if (includesCertificationKit) {
      discount = Math.max(discount, kitResolved.kitDiscount);
    }
    const accountDiscount = applyPartnerAccountDiscount(
      currentUser,
      itemsSubtotal,
      discount,
    );
    discount = accountDiscount.discount;

    const { rate: vatRate, amount: vatAmount } = calculateEuropeOrderVatAmount(
      getOrderVatTaxableBase(itemsSubtotal + kitExtrasTotal, discount),
      {
        country: shippingCountry,
        taxId: shippingAddress?.taxId,
        noVatId: shippingAddress?.noVatId,
      },
    );
    const orderTotal = Math.max(
      0,
      itemsSubtotal - discount + vatAmount + shippingFee + kitExtrasTotal,
    );

    // Pickup orders keep the buyer's contact details but use the Hub's address,
    // so invoices and emails show where the order will be collected.
    const orderShippingAddress = pickupHub
      ? this.buildPickupShippingAddress(shippingAddress, pickupHub, shippingCountry)
      : shippingAddress;

    await this.productInventoryService.assertStockAvailableForOrder({
      items: resolvedItems,
      user: currentUser as any,
      actingParentPartnerCode: (
        await this.actingParentStampForUser(userId)
      ).actingParentPartnerCode,
    });

    let order: any;
    let retries = 3;
    while (retries > 0) {
      try {
        const orderNumber = await this.generateShopOrderNumber(
          shippingCountry,
          'purchase',
        );
        const monetary = await this.buildMonetaryFieldsForNewOrder(
          orderTotal,
          orderCurrency,
        );
        order = new this.orderModel({
          user: userId,
          items: resolvedItems,
          shippingFee,
          vatAmount,
          vatRate,
          shippingAddress: orderShippingAddress,
          ...(pickupHub
            ? { isPickup: true, pickupHubPhone: pickupHub.phoneNumber || undefined }
            : {}),
          status: requiresOnlinePayment
            ? OrderStatus.PENDING_PAYMENT
            : OrderStatus.PENDING,
          orderNumber,
          orderFlow: 'purchase',
          paymentReminderCount: 0,
          discount,
          ...(accountDiscount.partnerDiscountPercent
            ? { partnerDiscountPercent: accountDiscount.partnerDiscountPercent }
            : {}),
          couponCode: appliedCouponCode,
          includesCertificationKit: includesCertificationKit || undefined,
          ...(includesCertificationKit ? kitExtras : {}),
          ...(await this.actingParentStampForUser(userId)),
          ...monetary,
        });
        await order.save();
        if (includesCertificationKit) {
          await this.assertSingleActiveCertificationKitOrder(
            userId,
            order._id.toString(),
          );
        }
        break;
      } catch (saveError: any) {
        if (saveError.code === 11000 && retries > 1) {
          retries--;
          continue;
        }
        console.error('Order save error:', saveError);
        throw new BadRequestException(
          `Failed to create order: ${saveError.message}`,
        );
      }
    }

    // Stamp commissions at checkout create (PENDING or PENDING_PAYMENT) so OSP/SI
    // are locked to order-time partners — not whoever is assigned when payment clears.
    if (
      order?.status === OrderStatus.PENDING ||
      order?.status === OrderStatus.PENDING_PAYMENT
    ) {
      await this.applyOrderCommissions(
        order._id.toString(),
        order.status as OrderStatus,
      );
      if (order.status === OrderStatus.PENDING) {
        await this.deductProductInventoryForOrder(order._id);
      }
    }

    try {
      const session = await this.createStripeCheckoutForOrder(
        order,
        currentUser,
        role,
        stripeInstance,
        orderCurrency,
      );

      if (requiresOnlinePayment) {
        const payUrl = this.getOrderDirectPayUrl(order._id.toString());
        await this.mailService
          .sendPendingPaymentReminder(order, currentUser, payUrl, false)
          .catch((err) =>
            console.error('Failed to send initial pending payment email', err),
          );
      }

      if (!session.url) {
        throw new BadRequestException('Failed to create Stripe checkout session.');
      }

      return { url: session.url };
    } catch (error) {
      console.error('Stripe session creation error:', error);
      throw new BadRequestException(
        `Stripe session creation failed: ${error.message}`,
      );
    }
  }

  async getMyOrders(userId: string): Promise<Order[]> {
    return this.cache.wrap(
      CacheKeys.ordersMy(userId),
      CacheTtl.ordersMy,
      async () =>
        this.orderModel
          .find({ user: userId as any })
          .sort({ createdAt: -1 })
          .lean()
          .exec() as Promise<Order[]>,
    );
  }

  /** Clears all order read caches (my / network / admin / dashboard). */
  async invalidateOrderReadCaches(): Promise<void> {
    await this.cache.delByPrefix(CacheKeys.ordersPrefix);
  }

  async getOrderById(id: string, viewer?: UserDocument): Promise<Order> {
    const order = await this.orderModel
      .findById(id)
      .populate('user', 'firstName lastName email role country shopName companyName hubPartnerCode parentLinkAssignedAt previousParentPartnerCode dValueInvoiceEnabled')
      .lean();
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!viewer) {
      return order;
    }

    const orderUserId = String((order as any).user?._id || (order as any).user);

    if (viewer.role === UserRole.ADMIN) {
      return this.enrichOrderDetails(order as any);
    }

    if (orderUserId === viewer._id.toString()) {
      return this.enrichOrderDetails(order as any);
    }

    const networkRoles = [
      UserRole.PARTNER,
      UserRole.DISTRIBUTOR,
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      // UserRole.SUB_PROMOTER, // removed
    ];
    if (networkRoles.includes(viewer.role as UserRole)) {
      if (shouldHideShopRegistrationFromViewer(order as any, viewer)) {
        throw new ForbiddenException(
          'Shop registration invoices are not available to partners',
        );
      }

      const inNetwork = await this.usersService.isUserInViewerNetwork(
        viewer,
        orderUserId,
      );
      if (inNetwork) {
        const enriched = await this.enrichOrderDetails(order as any);
        return this.withOrderManagementFlag(enriched, viewer);
      }
    }

    throw new ForbiddenException('You do not have access to this order');
  }

  private async enrichOrderDetails(order: Record<string, any>): Promise<any> {
    const amountPaid = getOrderAmountPaid(order);
    const remainingAmount = getOrderRemainingAmount(order);
    return {
      ...order,
      isModifiable: isOrderModifiable(order),
      amountPaid,
      remainingAmount,
    };
  }

  private async withOrderManagementFlag(
    order: Record<string, any>,
    viewer: UserDocument,
  ): Promise<any> {
    const shop = (order.user || {}) as {
      hubPartnerCode?: string;
      country?: string;
      role?: string;
      parentLinkAssignedAt?: Date;
      previousParentPartnerCode?: string;
    };
    const actingCode = await this.usersService.resolveActingParentForOrder({
      actingParentPartnerCode: order.actingParentPartnerCode,
      createdAt: order.createdAt,
      user: shop,
    });
    const parentRoles = await this.usersService.getShopParentLinkRolesByCode([
      actingCode,
    ]);
    return {
      ...order,
      canManageOrderStatus: this.usersService.canViewerManageShopOrder(
        viewer,
        {
          actingParentPartnerCode: actingCode,
          hubPartnerCode: shop.hubPartnerCode,
        },
        actingCode ? parentRoles.get(actingCode) : undefined,
        shop.role,
      ),
    };
  }

  private async actingParentStampForUser(
    userId: string,
  ): Promise<{ actingParentPartnerCode?: string }> {
    const shop = await this.usersService.findOne(String(userId));
    if (!shop || shop.role !== UserRole.CERTIFIED_SHOP) return {};
    const code = await this.usersService.resolveActingParentPartnerCodeForShop({
      hubPartnerCode: shop.hubPartnerCode,
      country: shop.country,
    });
    return code ? { actingParentPartnerCode: code } : {};
  }

  /**
   * Hub/Distributor a Shop can collect a pickup order from (its acting parent).
   * Returns null for non-shop accounts, when the shop's Hub / Distributor has not
   * allowed pickup, or when no active parent can be resolved.
   */
  async getPickupHubForUser(userId: string): Promise<{
    partnerCode: string;
    name: string;
    address: string;
    address2: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    phoneNumber: string;
  } | null> {
    const shop = await this.usersService.findOne(String(userId));
    if (!shop || shop.role !== UserRole.CERTIFIED_SHOP || !shop.pickupEnabled) {
      return null;
    }
    // Pickup is offered only in the FedEx regions (Canada, Hawaii, Alaska, Puerto Rico).
    if (!isFedexShippingDestination(shop.country, shop.state)) return null;
    const actingParentPartnerCode =
      await this.usersService.resolveActingParentPartnerCodeForShop({
        hubPartnerCode: shop.hubPartnerCode,
        country: shop.country,
      });
    if (!actingParentPartnerCode) return null;
    const hub = await this.usersService.findByPartnerCode(actingParentPartnerCode);
    if (!hub) return null;

    const clean = (value: unknown) => String(value ?? '').trim();
    const street = clean(hub.address) || clean(hub.streetAddress);
    const extraStreet =
      clean(hub.streetAddress) && clean(hub.streetAddress) !== street
        ? clean(hub.streetAddress)
        : '';
    // Mongoose rejects empty required strings on the order's shippingAddress.
    const orNA = (value: string) => value || 'N/A';
    return {
      partnerCode: actingParentPartnerCode,
      name:
        clean(hub.companyName) ||
        clean(hub.shopName) ||
        [clean(hub.firstName), clean(hub.lastName)].filter(Boolean).join(' ') ||
        actingParentPartnerCode,
      address: orNA(street),
      address2: extraStreet,
      city: orNA(clean(hub.city)),
      state: orNA(clean(hub.state)),
      zipCode: orNA(clean(hub.zipCode)),
      country: clean(hub.country),
      phoneNumber: clean(hub.phoneNumber),
    };
  }

  /**
   * Pickup orders keep the buyer's contact details but use the Hub's address,
   * so invoices and emails show where the order will be collected.
   */
  private buildPickupShippingAddress(
    shippingAddress: CreateOrderDto['shippingAddress'],
    hub: NonNullable<Awaited<ReturnType<OrdersService['getPickupHubForUser']>>>,
    fallbackCountry: string,
  ) {
    return {
      ...shippingAddress,
      companyName: hub.name,
      address: hub.address,
      address2: hub.address2,
      city: hub.city,
      state: hub.state,
      zipCode: hub.zipCode,
      country: hub.country || fallbackCountry,
    };
  }

  /** Street, city/state and ZIP are required for orders that are shipped. */
  private async assertValidShippingPostcode(
    shippingAddress?: CreateOrderDto['shippingAddress'],
  ): Promise<void> {
    const check = await this.geoService.validatePostcode(
      shippingAddress?.zipCode || '',
      shippingAddress?.country,
      shippingAddress?.state,
    );
    if (!check.valid) {
      throw new BadRequestException(
        check.message || 'Invalid ZIP / Postal code.',
      );
    }
  }

  private assertShippingAddressComplete(
    shippingAddress?: CreateOrderDto['shippingAddress'],
  ): void {
    const missing = (value?: string) => !String(value ?? '').trim();
    if (
      missing(shippingAddress?.address) ||
      missing(shippingAddress?.city) ||
      missing(shippingAddress?.state) ||
      missing(shippingAddress?.zipCode)
    ) {
      throw new BadRequestException(
        'Shipping address, city, state and ZIP code are required.',
      );
    }
  }

  /**
   * Deduct product inventory for the order's acting Hub/Distributor once.
   * Idempotent via inventoryDeductedAt. Skips registration fees.
   */
  private async deductProductInventoryForOrder(
    orderId: string | Types.ObjectId,
  ): Promise<void> {
    try {
      const claimed = await this.orderModel
        .findOneAndUpdate(
          {
            _id: orderId,
            $or: [
              { inventoryDeductedAt: null },
              { inventoryDeductedAt: { $exists: false } },
            ],
            'items.product': { $ne: 'registration_fee' },
          },
          { $set: { inventoryDeductedAt: new Date() } },
          { new: true },
        )
        .populate(
          'user',
          'hubPartnerCode country parentLinkAssignedAt previousParentPartnerCode role',
        );

      if (!claimed) return;
      if (isRegistrationOrder(claimed)) {
        await this.orderModel.findByIdAndUpdate(claimed._id, {
          $unset: { inventoryDeductedAt: 1 },
        });
        return;
      }

      await this.productInventoryService.deductForOrder(claimed as any);
    } catch (err) {
      this.logger.error(
        `Failed to deduct product inventory for order ${orderId}`,
        err as Error,
      );
      await this.orderModel
        .findByIdAndUpdate(orderId, { $unset: { inventoryDeductedAt: 1 } })
        .catch(() => undefined);
    }
  }

  /** Restore product inventory if it was previously deducted for this order. */
  private async restoreProductInventoryForOrder(
    orderId: string | Types.ObjectId,
  ): Promise<void> {
    try {
      const order = await this.orderModel
        .findById(orderId)
        .populate(
          'user',
          'hubPartnerCode country parentLinkAssignedAt previousParentPartnerCode role',
        );
      if (!order?.inventoryDeductedAt) return;
      if (isRegistrationOrder(order)) {
        await this.orderModel.findByIdAndUpdate(order._id, {
          $unset: { inventoryDeductedAt: 1 },
        });
        return;
      }

      await this.productInventoryService.restoreForOrder(order as any);
      await this.orderModel.findByIdAndUpdate(order._id, {
        $unset: { inventoryDeductedAt: 1 },
      });
    } catch (err) {
      this.logger.error(
        `Failed to restore product inventory for order ${orderId}`,
        err as Error,
      );
    }
  }

  async createPaymentSessionForOrder(
    orderId: string,
    userId: string,
    role?: string,
  ): Promise<{ url: string }> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (String(order.user) !== String(userId)) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const currentUser = await this.usersService.findOne(userId);
    const url = await this.buildPaymentCheckoutUrlForOrder(
      order,
      currentUser,
      role,
    );
    return { url };
  }

  async createPaymentCheckoutRedirect(
    orderId: string,
    token?: string,
  ): Promise<string> {
    if (!verifyOrderPaymentToken(orderId, token, this.getOrderPayTokenSecret())) {
      throw new ForbiddenException('Invalid or expired payment link.');
    }

    const order = await this.orderModel.findById(orderId).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    const userDoc =
      typeof order.user === 'object' && order.user !== null
        ? (order.user as any)
        : await this.usersService.findOne(String(order.user));

    return this.buildPaymentCheckoutUrlForOrder(order, userDoc, userDoc?.role);
  }

  private getOrderPayTokenSecret(): string {
    return (
      this.configService.get<string>('ORDER_PAY_TOKEN_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      'skygloss-order-pay'
    );
  }

  private assertOrderCanAcceptOnlinePayment(order: OrderDocument): number {
    const remaining = getOrderRemainingAmount(order);
    if (remaining <= 0.01) {
      throw new BadRequestException('This order has no outstanding balance.');
    }

    const status = String(order.status || '').toUpperCase();
    const payableStatuses = [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PENDING,
      OrderStatus.PAID,
    ];
    if (!payableStatuses.includes(status as OrderStatus)) {
      throw new BadRequestException('This order is not awaiting payment.');
    }

    return remaining;
  }

  private async buildPaymentCheckoutUrlForOrder(
    order: OrderDocument,
    currentUser: any,
    role?: string,
  ): Promise<string> {
    const remaining = this.assertOrderCanAcceptOnlinePayment(order);
    const shippingCountry = order.shippingAddress?.country;
    const userCountry = currentUser?.country;
    const stripeAccountKey = this.resolveOrderStripeAccountKey(
      shippingCountry,
      userCountry,
    );
    const stripeInstance = this.getStripeForAccountKey(stripeAccountKey);
    const orderCurrency = (order.currency || 'USD').toLowerCase();

    this.logger.log(
      `[Stripe] Pay existing order ${order.orderNumber}: account=${stripeAccountKey}, shipping="${shippingCountry}", user="${userCountry}", remaining=${remaining} ${orderCurrency.toUpperCase()}`,
    );

    const session = await this.createStripeCheckoutForOrder(
      order,
      currentUser,
      role,
      stripeInstance,
      orderCurrency,
    );

    if (!session.url) {
      throw new BadRequestException('Failed to create Stripe checkout session.');
    }

    return session.url;
  }

  async cancelExpiredPendingPaymentOrders(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PENDING_PAYMENT_CANCEL_DAYS);

    const expiredOrders = await this.orderModel
      .find({
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: { $lte: cutoff },
      })
      .populate(
        'user',
        'firstName lastName email country role hubPartnerCode referredByPartnerCode additionalEmail',
      );

    let cancelled = 0;
    for (const order of expiredOrders) {
      const reason =
        'Payment was not completed within 3 days. The order was automatically cancelled.';
      order.status = OrderStatus.CANCELLED;
      order.cancellationReason = reason;
      if (order.cancellationRequest?.status === CancellationRequestStatus.PENDING) {
        order.cancellationRequest = {
          status: CancellationRequestStatus.APPROVED,
          reason: order.cancellationRequest.reason,
          requestedAt: order.cancellationRequest.requestedAt,
          resolvedAt: new Date(),
        };
        order.markModified('cancellationRequest');
      }
      await order.save();

      if (order.user) {
        await this.mailService
          .sendOrderCancelledCustomerNotification(order, order.user, {
            wasPaid: false,
            cancellationReason: reason,
          })
          .catch((err) =>
            console.error('Failed to send auto-cancel email to customer', err),
          );
      }
      cancelled++;
    }
    return cancelled;
  }

  async sendPendingPaymentReminders(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PENDING_PAYMENT_CANCEL_DAYS);

    const pendingOrders = await this.orderModel
      .find({
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: { $gt: cutoff },
      })
      .populate(
        'user',
        'firstName lastName email role country hubPartnerCode referredByPartnerCode additionalEmail',
      );

    let sent = 0;
    const now = Date.now();

    for (const order of pendingOrders) {
      const reminderIndex = order.paymentReminderCount ?? 0;
      if (reminderIndex >= PAYMENT_REMINDER_INTERVALS_MS.length) {
        continue;
      }

      const ageMs = now - new Date((order as any).createdAt).getTime();
      if (ageMs < PAYMENT_REMINDER_INTERVALS_MS[reminderIndex]) {
        continue;
      }

      const user = order.user as any;
      if (!user?.email) continue;

      const payUrl = this.getOrderDirectPayUrl(order._id.toString());
      await this.mailService
        .sendPendingPaymentReminder(order, user, payUrl, true)
        .catch((err) =>
          console.error(
            `Failed to send payment reminder for ${order.orderNumber}`,
            err,
          ),
        );

      order.paymentReminderCount = reminderIndex + 1;
      await order.save();
      sent++;
    }

    return sent;
  }

  // Webhook handler will reuse logic or be separate.
  // For now, let's implement a verify endpoint for manual success check if webhook fails/delays
  async verifyPayment(orderId: string): Promise<Order> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    if (!order.stripeSessionId) return order;

    // Determine which Stripe to use based on the order's user country
    const orderUser = await this.usersService.findOne(String((order as any).user));
    const isUsaOrder = this.isUsaDestinationOrder(
      order.shippingAddress?.country,
      orderUser?.country,
    );
    const stripeInstance = this.getStripeForAccountKey(
      this.resolveOrderStripeAccountKey(
        order.shippingAddress?.country,
        orderUser?.country,
      ),
    );

    const session = await stripeInstance.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    if (session.payment_status === 'paid') {
      if (
        order.status !== OrderStatus.PAID &&
        [OrderStatus.PENDING_PAYMENT, OrderStatus.PENDING, OrderStatus.FAILED].includes(
          order.status,
        )
      ) {
        // Atomic claim: a webhook or admin Mark Paid may record this payment concurrently.
        const claimed = await this.orderModel.updateOne(
          { _id: order._id, status: order.status },
          {
            $set: { status: OrderStatus.PAID, amountPaid: order.totalAmount },
            $unset: { cancellationReason: 1 },
          },
        );
        if (!claimed.modifiedCount) {
          return (await this.orderModel.findById(order._id)) ?? order;
        }

        await this.sendPaidOrderNotificationsIfNeeded(order._id.toString());

        await this.applyOrderCommissions(
          order._id.toString(),
          OrderStatus.PAID,
        );
        const stripeAccountKey = this.resolveOrderStripeAccountKey(
          order.shippingAddress?.country,
          orderUser?.country,
        );
        this.queuePaidOrderCommissionTransfer(order._id.toString(), {
          stripeAccountKey,
        });
        await this.deductProductInventoryForOrder(order._id);

        const refreshed = await this.orderModel
          .findById(order._id)
          .populate('user', 'firstName lastName email');
        if (!refreshed) {
          throw new NotFoundException('Order not found after payment verification');
        }
        return refreshed;
      }

      if (order.status === OrderStatus.PAID) {
        await this.sendPaidOrderNotificationsIfNeeded(order._id.toString());
      }
    }
    return order;
  }

  async createRegistrationOrder(
    user: any,
    stripeSessionOrId?: any,
    couponOptions?: { couponCode?: string; discount?: number },
  ): Promise<Order> {
    // Check if registration order already exists for this user to avoid duplicates
    const existingOrder = await this.orderModel.findOne({
      user: user._id,
      'items.product': 'registration_fee',
    });
    if (existingOrder) {
      console.log(`[Registration Order] Found existing registration order: ${existingOrder.orderNumber}`);
      return existingOrder as any;
    }

    // Determine the registration fee and tax for user's country
    let feeQuote = buildRegistrationFeeQuote(null, user.country);
    try {
      const feeGroup = await this.registrationFeesService.findByCountry(user.country || '');
      feeQuote = buildRegistrationFeeQuote(feeGroup, user.country);
    } catch (err) {
      console.error('[Registration Order] Failed to fetch fee group:', err);
    }

    const currency = feeQuote.currency;
    // Coupon discount applies to the fee only; tax/VAT is charged on the discounted fee.
    let totals = calculateRegistrationTotals(feeQuote, couponOptions?.discount ?? 0);
    let couponCode = couponOptions?.couponCode;
    let stripeSessionId: string | undefined = undefined;
    let registrationTaxId = '';
    let registrationNoVatId: boolean | undefined;

    const applyPaidSession = (session: Stripe.Checkout.Session, resolvedPromo?: string) => {
      const metadata = session.metadata || {};
      if (metadata.registrationVatExempt != null) {
        registrationTaxId = String(metadata.registrationTaxId || '');
        registrationNoVatId = metadata.registrationNoVatId === 'true';
        feeQuote = applyRegistrationVatChoice(feeQuote, user.country, {
          taxId: registrationTaxId,
          noVatId: registrationNoVatId,
        });
      }
      const totalPaid = (session.amount_total || 0) / 100;
      const stripeDiscount = (session.total_details?.amount_discount || 0) / 100;
      const stripeTax = (session.total_details?.amount_tax || 0) / 100;
      const metadataDiscount = Number(session.metadata?.registrationDiscount);
      const fromMetadata = Number.isFinite(metadataDiscount)
        ? calculateRegistrationTotals(feeQuote, metadataDiscount)
        : null;
      totals =
        fromMetadata && Math.abs(fromMetadata.total - totalPaid) < 0.01
          ? fromMetadata
          : splitPaidRegistrationAmount(feeQuote, totalPaid, stripeTax);
      if (stripeDiscount > 0.01) {
        couponCode =
          couponOptions?.couponCode || resolvedPromo || couponCode || 'STRIPECOUPON';
      } else if (couponOptions?.couponCode) {
        couponCode = couponOptions.couponCode;
      }
    };

    if (stripeSessionOrId) {
      if (typeof stripeSessionOrId === 'string') {
        stripeSessionId = stripeSessionOrId;
        if (this.stripe) {
          try {
            const stripeInstance =
              this.getStripeForAccountKey(
                resolveShopOrderStripeAccountKey(undefined, user.country),
              ) || this.stripe;
            const session = await stripeInstance.checkout.sessions.retrieve(stripeSessionId);
            if (session) {
              const resolvedPromo = await this.stripeCouponSync
                .resolveCodeFromCheckoutSession(stripeInstance, session)
                .catch(() => undefined);
              applyPaidSession(session, resolvedPromo);
            }
          } catch (stripeErr) {
            console.error('[Registration Order] Failed to retrieve stripe session details:', stripeErr);
          }
        }
      } else {
        stripeSessionId = stripeSessionOrId.id;
        applyPaidSession(stripeSessionOrId);
      }
    }

    const { feeAmount, discount, taxAmount, total: totalAmount } = totals;
    const vatRate = taxAmount > 0 && feeQuote.vatRate != null ? feeQuote.vatRate : 0;

    // Prefill shippingAddress using user's details
    const shippingAddress = {
      email: user.email || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      companyName: user.companyName || '',
      address: user.address || 'N/A',
      address2: '',
      city: user.city || 'N/A',
      state: user.state || 'N/A',
      zipCode: user.zipCode || 'N/A',
      country: user.country || 'N/A',
      phoneNumber: user.phoneNumber || 'N/A',
      ...(registrationTaxId ? { taxId: registrationTaxId } : {}),
      ...(registrationNoVatId != null ? { noVatId: registrationNoVatId } : {}),
    };

    const orderNumber = await this.generateRegistrationOrderNumber();
    const monetary = await this.buildMonetaryFieldsForNewOrder(totalAmount, currency);

    const order = new this.orderModel({
      user: user._id,
      items: [
        {
          product: 'registration_fee',
          name: getRegistrationFeeName(user.role),
          size: 'N/A',
          quantity: 1,
          price: feeAmount,
        }
      ],
      discount,
      vatAmount: taxAmount,
      vatRate,
      couponCode,
      shippingAddress,
      status: OrderStatus.PAID,
      orderNumber,
      stripeSessionId,
      ...(await this.actingParentStampForUser(String(user._id))),
      ...monetary,
    });

    console.log(`[Registration Order] Creating registration order ${orderNumber} for user ${user._id}`);
    return await order.save();
  }

  async generateInvoicePdf(order: any): Promise<Buffer> {
    return this.pdfService.generateOrderDetails(
      await this.ensureOrderUserForInvoice(order),
    );
  }

  /**
   * Invoice Business Name needs shopName/companyName. Many Stripe webhook
   * paths only populate firstName/lastName/email — reload those fields.
   */
  private async ensureOrderUserForInvoice(order: any): Promise<any> {
    if (!order) return order;
    const user = order.user;
    const populated =
      user &&
      typeof user === 'object' &&
      (user.shopName !== undefined || user.companyName !== undefined);
    if (populated) return order;

    const userId =
      user && typeof user === 'object' && user._id != null
        ? String(user._id)
        : user
          ? String(user)
          : '';
    if (!userId) return order;

    try {
      const fullUser = await this.usersService.findOne(userId);
      if (!fullUser) return order;
      if (typeof order.toObject === 'function') {
        return { ...order.toObject(), user: fullUser };
      }
      return { ...order, user: fullUser };
    } catch {
      return order;
    }
  }

  private async retrieveRegistrationCheckoutSession(
    stripeSessionId: string,
    country?: string,
  ): Promise<Stripe.Checkout.Session> {
    const primaryKey = resolveShopOrderStripeAccountKey(undefined, country);
    const candidates = this.getConfiguredStripeClients(primaryKey);
    let lastError: unknown;
    for (const stripeInstance of candidates) {
      try {
        return await stripeInstance.checkout.sessions.retrieve(stripeSessionId);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  /**
   * If the user created another checkout after paying, stripeSessionId may
   * point at an unpaid/expired session. Search recent sessions for a paid
   * shop/partner registration checkout belonging to this user.
   */
  private async findPaidRegistrationCheckoutSession(
    userId: string,
    country?: string,
  ): Promise<Stripe.Checkout.Session | null> {
    const primaryKey = resolveShopOrderStripeAccountKey(undefined, country);
    const candidates = this.getConfiguredStripeClients(primaryKey);

    for (const stripeInstance of candidates) {
      try {
        const listed = await stripeInstance.checkout.sessions.list({
          limit: 100,
        });

        const paid = listed.data
          .filter((session) => {
            const meta = session.metadata || {};
            const matchesUser =
              session.client_reference_id === userId ||
              meta.userId === userId;
            const isRegistration =
              meta.type === 'shop_registration' ||
              meta.type === 'partner_registration' ||
              meta.type === 'distributor_registration';
            return (
              matchesUser &&
              isRegistration &&
              session.payment_status === 'paid'
            );
          })
          .sort((a, b) => (b.created || 0) - (a.created || 0));

        if (paid[0]) {
          console.log(
            `[Manual Verify] Found paid registration session ${paid[0].id} for user ${userId}`,
          );
          return paid[0];
        }
      } catch (err) {
        console.error(
          `[Manual Verify] Failed listing checkout sessions while searching paid registration:`,
          (err as Error)?.message || err,
        );
      }
    }

    return null;
  }

  async verifyRegistrationPayment(userId: string): Promise<any> {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.isPartnerPaid) {
      return {
        status: 'already_paid',
        user: {
          ...(user.toObject?.() ?? user),
          _id: user._id?.toString?.() ?? user._id,
          isPartnerPaid: true,
        },
      };
    }

    if (!user.stripeSessionId) {
      throw new BadRequestException('No registration payment session found for this user.');
    }

    let session = await this.retrieveRegistrationCheckoutSession(
      user.stripeSessionId,
      user.country,
    );

    if (session.payment_status !== 'paid') {
      const paidSession = await this.findPaidRegistrationCheckoutSession(
        userId,
        user.country,
      );
      if (paidSession) {
        session = paidSession;
        // Keep the paid session id so future verifies hit the correct checkout.
        await this.usersService.update(
          userId,
          { stripeSessionId: paidSession.id } as any,
          { role: UserRole.ADMIN } as any,
        );
      }
    }

    if (session.payment_status === 'paid') {
      console.log(`[Manual Verify] Payment confirmed for user ${userId}. Activating...`);

      const couponInfo = await this.resolvePaidShopRegistrationCoupon(
        this.getStripeForAccountKey(
          resolveShopOrderStripeAccountKey(undefined, user.country || ''),
        ),
        session,
        user,
      );

      const updatedUser = await this.usersService.update(userId, {
        isPartnerPaid: true,
        status: UserStatus.ACTIVE,
      } as any, { role: UserRole.ADMIN } as any);

      // Trigger Notifications (Same logic as webhook)
      if (updatedUser) {
        // Create paid registration order
        let invoiceBuffer: Buffer | undefined;
        let orderNumber: string | undefined;
        try {
          const couponCode = couponInfo.couponCode || updatedUser.couponCode;
          const regOrder = await this.createRegistrationOrder(
            updatedUser,
            session,
            couponCode
              ? { couponCode, discount: couponInfo.discount }
              : undefined,
          );
          invoiceBuffer = await this.generateInvoicePdf(regOrder);
          orderNumber = regOrder.orderNumber;
          await this.recordCouponUsageIfApplicable(couponCode);
        } catch (orderErr) {
          console.error('[Manual Verify] Failed to create registration order:', orderErr);
        }

        // 1. Notify Admin
        // Admin notification is now handled internally by MailService for sales@skygloss.com
        await this.mailService.sendDistributorPaymentCompletedAdminNotification(
          [],
          updatedUser,
        );

        // 2. Notify User
        if (updatedUser.email) {
          const partnerContact = await this.usersService.getPartnerContactForShop(updatedUser);
          await this.mailService.sendDistributorPaymentConfirmation(
            updatedUser.email,
            updatedUser,
            invoiceBuffer,
            orderNumber,
            partnerContact,
          );
        }

        // 3. Notify Referring Partner
        const metadata: any = session.metadata || {};
        const partnerCode = metadata.referredByPartnerCode || updatedUser.referredByPartnerCode;

        if (partnerCode) {
          const partner = await (this.usersService as any).userModel.findOne({ partnerCode });
          if (partner) {
            const partnerNotification = await this.notificationsService.create({
              type: NotificationType.ORDER_PAID,
              title: 'New Shop Referral Active (Verified)',
              message: `Shop "${updatedUser.firstName} ${updatedUser.lastName}" has completed registration and is now part of your network.`,
              metadata: { shopId: updatedUser._id, shopName: `${updatedUser.firstName} ${updatedUser.lastName}` },
              user: partner._id,
              triggeredBy: userId,
              link: `/dashboard/partner/shops/${updatedUser._id}`,
            });
            this.notificationsGateway.broadcastNotification(partnerNotification);
          }
        }

        return {
          status: 'success',
          user: {
            ...(updatedUser.toObject?.() ?? updatedUser),
            _id: updatedUser._id?.toString?.() ?? updatedUser._id,
            isPartnerPaid: true,
          },
        };
      }
    }

    return { status: 'pending', user };
  }

  async handleUsaWebhook(sig: string, payload: Buffer) {
    const endpointSecret = this.configService.get<string>('USA_STRIPE_WEBHOOK_SECRET');
    if (!endpointSecret)
      throw new BadRequestException('USA Webhook secret not configured');

    if (!this.usaStripe)
      throw new BadRequestException('USA Stripe is not configured on the server.');

    let event: Stripe.Event;
    try {
      event = this.usaStripe.webhooks.constructEvent(payload, sig, endpointSecret);
    } catch (err) {
      console.error(`[USA Stripe Webhook] Verification Failed: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object as Stripe.Checkout.Session;
    console.log(`[USA Stripe Webhook] Received event: ${event.type}`);
    const metadata = session.metadata;

    if (event.type === 'checkout.session.completed' && metadata?.type === 'shop_order') {
      const orderId = metadata.orderId;
      console.log(`[USA Stripe Webhook] Processing shop_order for orderId: ${orderId}`);

      if (!orderId) {
        console.error('[USA Stripe Webhook] No orderId found in metadata.');
        return { received: true };
      }

      if (!isStripeCheckoutSessionPaid(session)) {
        console.warn(
          `[USA Stripe Webhook] Session ${session.id} for order ${orderId} is not paid (payment_status=${session.payment_status}). Order left unpaid.`,
        );
        return { received: true };
      }

      const existingOrder = await this.orderModel.findById(orderId);
      if (existingOrder && isOrderPaymentRecorded(existingOrder.status)) {
        console.log(`[USA Stripe Webhook] Order ${existingOrder.orderNumber} is already ${existingOrder.status}. Skipping duplicate notifications/emails.`);
        if (existingOrder.includesCertificationKit) {
          await this.applyCertificationKitPurchaseBenefits(existingOrder);
        }
        await this.sendPaidOrderNotificationsIfNeeded(orderId);
        this.queuePaidOrderCommissionTransfer(orderId, {
          stripeAccountKey: 'usa',
          stripePaymentId:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id || session.id,
        });
        return { received: true };
      }

      const actualTotal = (session.amount_total || 0) / 100;
      const stripeDiscount = (session.total_details?.amount_discount || 0) / 100;
      let discount = existingOrder?.discount ?? 0;
      let couponCode = existingOrder?.couponCode;
      if (stripeDiscount > 0.01 && !couponCode) {
        couponCode = 'STRIPECOUPON';
        discount = stripeDiscount;
      }

      const priorPaid = getOrderAmountPaid(existingOrder || {});
      // Remaining-balance checkouts must not overwrite the full order total.
      const amountUpdate =
        priorPaid > 0.01
          ? {
              amountPaid:
                Number(existingOrder?.totalAmount) ||
                priorPaid + actualTotal,
            }
          : {
              ...this.buildAmountUpdateWithLockedRate(existingOrder, actualTotal),
              amountPaid: actualTotal,
            };

      const updatedOrder = await this.orderModel
        .findOneAndUpdate(
          // Atomic: concurrent/duplicate webhooks or an admin Mark Paid cannot both process payment.
          { _id: orderId, status: paymentNotRecordedStatusFilter() },
          {
            status: OrderStatus.PAID,
            discount,
            couponCode,
            ...amountUpdate,
          },
          { new: true },
        )
        .populate('user', 'firstName lastName email');

      if (updatedOrder) {
        console.log(`[USA Stripe Webhook] Order ${updatedOrder.orderNumber} marked as PAID.`);

        await this.recordCouponUsageIfApplicable(updatedOrder.couponCode);

        await this.sendPaidOrderNotificationsIfNeeded(updatedOrder._id.toString());

        await this.applyOrderCommissions(
          updatedOrder._id.toString(),
          OrderStatus.PAID,
        );
        this.queuePaidOrderCommissionTransfer(updatedOrder._id.toString(), {
          stripeAccountKey: 'usa',
          stripePaymentId:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id || session.id,
        });
        await this.deductProductInventoryForOrder(updatedOrder._id);
        if (updatedOrder.includesCertificationKit) {
          await this.applyCertificationKitPurchaseBenefits(updatedOrder);
        }
      } else {
        console.log(`[USA Stripe Webhook] Order ${orderId} not found or payment already recorded; nothing to do.`);
      }
      return { received: true };
    }

    // Handle payment failure / expiration
    if (
      event.type === 'checkout.session.async_payment_failed' ||
      event.type === 'checkout.session.expired'
    ) {
      const orderId = metadata?.orderId;
      if (orderId) {
        const existing = await this.orderModel.findById(orderId);
        if (shouldMarkFailedOnCheckoutExpire(existing?.status)) {
          console.log(
            `[USA Stripe Webhook] Marking order ${orderId} as FAILED due to: ${event.type}`,
          );
          await this.orderModel.findByIdAndUpdate(orderId, {
            status: OrderStatus.FAILED,
          });
        } else {
          console.log(
            `[USA Stripe Webhook] Ignoring ${event.type} for ${orderId}; status is ${existing?.status || 'missing'}.`,
          );
        }
      }
    }

    // USA shops also pay registration fees on the USA Stripe account.
    if (
      event.type === 'checkout.session.completed' &&
      metadata?.type === 'shop_registration'
    ) {
      const userId = session.client_reference_id || metadata.userId;
      const partnerCode = metadata.referredByPartnerCode;
      console.log(
        `[USA Stripe Webhook] Processing shop_registration for userId: ${userId}, referredBy: ${partnerCode}`,
      );

      const existingShop = await this.usersService.findOne(userId).catch(() => null);
      if (existingShop?.isPartnerPaid) {
        console.log(
          `[USA Stripe Webhook] Shop ${userId} already paid. Skipping duplicate activation/emails.`,
        );
        await this.flagDuplicateRegistrationPayment('USA Stripe Webhook', existingShop, session);
        return { received: true };
      }

      const couponInfo = await this.resolvePaidShopRegistrationCoupon(
        this.usaStripe || this.stripe,
        session,
        existingShop,
      );

      const updatedUser = await this.usersService.update(
        userId,
        {
          status: UserStatus.ACTIVE,
          isPartnerPaid: true,
        } as any,
        { role: UserRole.ADMIN } as any,
      );

      if (updatedUser) {
        console.log(`[USA Stripe Webhook] Shop ${userId} activated.`);

        let invoiceBuffer: Buffer | undefined;
        let orderNumber: string | undefined;
        try {
          const couponCode = couponInfo.couponCode || updatedUser.couponCode;
          const regOrder = await this.createRegistrationOrder(
            updatedUser,
            session,
            couponCode
              ? { couponCode, discount: couponInfo.discount }
              : undefined,
          );
          invoiceBuffer = await this.generateInvoicePdf(regOrder);
          orderNumber = regOrder.orderNumber;
          await this.recordCouponUsageIfApplicable(couponCode);
        } catch (orderErr) {
          console.error(
            '[USA Stripe Webhook] Failed to create registration order:',
            orderErr,
          );
        }

        await this.mailService.sendDistributorPaymentCompletedAdminNotification(
          [],
          updatedUser,
        );

        if (updatedUser.email) {
          const partnerContact =
            await this.usersService.getPartnerContactForShop(updatedUser);
          await this.mailService.sendDistributorPaymentConfirmation(
            updatedUser.email,
            updatedUser,
            invoiceBuffer,
            orderNumber,
            partnerContact,
          );
        }

        if (partnerCode) {
          const partner = await (this.usersService as any).userModel.findOne({
            partnerCode,
          });
          if (partner) {
            const partnerNotification = await this.notificationsService.create({
              type: NotificationType.ORDER_PAID,
              title: 'New Shop Referral Active',
              message: `Shop "${updatedUser.firstName} ${updatedUser.lastName}" has completed registration and is now part of your network.`,
              metadata: {
                shopId: updatedUser._id,
                shopName: `${updatedUser.firstName} ${updatedUser.lastName}`,
              },
              user: partner._id,
              triggeredBy: updatedUser._id as any,
              link: `/dashboard/partner/shops/${updatedUser._id}`,
            });
            this.notificationsGateway.broadcastNotification(partnerNotification);
          }
        }

        const notification = await this.notificationsService.create({
          type: NotificationType.ORDER_PAID,
          title: 'Shop Registration Paid',
          message: `Shop ${updatedUser.firstName} ${updatedUser.lastName} has paid the registration fee and is now active.`,
          metadata: { userId: updatedUser._id },
          user: updatedUser._id as any,
          triggeredBy: updatedUser._id as any,
          link: `/dashboard/shop`,
        });
        this.notificationsGateway.broadcastNotification(notification);
      } else {
        console.error(
          `[USA Stripe Webhook] CRITICAL: Could not find/update shop ${userId} for shop_registration type.`,
        );
      }
      return { received: true };
    }

    return { received: true };
  }

  async handleEuropeWebhook(sig: string, payload: Buffer) {
    const endpointSecret = this.configService.get<string>(
      'EUROPE_STRIPE_WEBHOOK_SECRET',
    );
    if (!endpointSecret)
      throw new BadRequestException('Europe Webhook secret not configured');

    if (!this.europeStripe)
      throw new BadRequestException('Europe Stripe is not configured on the server.');

    let event: Stripe.Event;
    try {
      event = this.europeStripe.webhooks.constructEvent(payload, sig, endpointSecret);
    } catch (err) {
      console.error(`[Europe Stripe Webhook] Verification Failed: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object as Stripe.Checkout.Session;
    console.log(`[Europe Stripe Webhook] Received event: ${event.type}`);
    const metadata = session.metadata;

    if (event.type === 'checkout.session.completed' && metadata?.type === 'shop_order') {
      const orderId = metadata.orderId;
      console.log(`[Europe Stripe Webhook] Processing shop_order for orderId: ${orderId}`);

      if (!orderId) {
        console.error('[Europe Stripe Webhook] No orderId found in metadata.');
        return { received: true };
      }

      if (!isStripeCheckoutSessionPaid(session)) {
        console.warn(
          `[Europe Stripe Webhook] Session ${session.id} for order ${orderId} is not paid (payment_status=${session.payment_status}). Order left unpaid.`,
        );
        return { received: true };
      }

      const existingOrder = await this.orderModel.findById(orderId);
      if (existingOrder && isOrderPaymentRecorded(existingOrder.status)) {
        console.log(`[Europe Stripe Webhook] Order ${existingOrder.orderNumber} is already ${existingOrder.status}. Skipping duplicate notifications/emails.`);
        if (existingOrder.includesCertificationKit) {
          await this.applyCertificationKitPurchaseBenefits(existingOrder);
        }
        await this.sendPaidOrderNotificationsIfNeeded(orderId);
        this.queuePaidOrderCommissionTransfer(orderId, {
          stripeAccountKey: 'europe',
          stripePaymentId:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id || session.id,
        });
        return { received: true };
      }

      const actualTotal = (session.amount_total || 0) / 100;
      const stripeDiscount = (session.total_details?.amount_discount || 0) / 100;
      let discount = existingOrder?.discount ?? 0;
      let couponCode = existingOrder?.couponCode;
      if (stripeDiscount > 0.01 && !couponCode) {
        couponCode = 'STRIPECOUPON';
        discount = stripeDiscount;
      }

      const priorPaid = getOrderAmountPaid(existingOrder || {});
      const amountUpdate =
        priorPaid > 0.01
          ? {
              amountPaid:
                Number(existingOrder?.totalAmount) ||
                priorPaid + actualTotal,
            }
          : {
              ...this.buildAmountUpdateWithLockedRate(existingOrder, actualTotal),
              amountPaid: actualTotal,
            };

      const updatedOrder = await this.orderModel
        .findOneAndUpdate(
          // Atomic: concurrent/duplicate webhooks or an admin Mark Paid cannot both process payment.
          { _id: orderId, status: paymentNotRecordedStatusFilter() },
          {
            status: OrderStatus.PAID,
            discount,
            couponCode,
            ...amountUpdate,
          },
          { new: true },
        )
        .populate('user', 'firstName lastName email');

      if (updatedOrder) {
        console.log(`[Europe Stripe Webhook] Order ${updatedOrder.orderNumber} marked as PAID.`);

        await this.recordCouponUsageIfApplicable(updatedOrder.couponCode);

        await this.sendPaidOrderNotificationsIfNeeded(updatedOrder._id.toString());

        await this.applyOrderCommissions(
          updatedOrder._id.toString(),
          OrderStatus.PAID,
        );
        this.queuePaidOrderCommissionTransfer(updatedOrder._id.toString(), {
          stripeAccountKey: 'europe',
          stripePaymentId:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id || session.id,
        });
        await this.deductProductInventoryForOrder(updatedOrder._id);
        if (updatedOrder.includesCertificationKit) {
          await this.applyCertificationKitPurchaseBenefits(updatedOrder);
        }
      } else {
        console.log(`[Europe Stripe Webhook] Order ${orderId} not found or payment already recorded; nothing to do.`);
      }
      return { received: true };
    }

    if (
      event.type === 'checkout.session.async_payment_failed' ||
      event.type === 'checkout.session.expired'
    ) {
      const orderId = metadata?.orderId;
      if (orderId) {
        const existing = await this.orderModel.findById(orderId);
        if (shouldMarkFailedOnCheckoutExpire(existing?.status)) {
          console.log(
            `[Europe Stripe Webhook] Marking order ${orderId} as FAILED due to: ${event.type}`,
          );
          await this.orderModel.findByIdAndUpdate(orderId, {
            status: OrderStatus.FAILED,
          });
        } else {
          console.log(
            `[Europe Stripe Webhook] Ignoring ${event.type} for ${orderId}; status is ${existing?.status || 'missing'}.`,
          );
        }
      }
    }

    if (
      event.type === 'checkout.session.completed' &&
      metadata?.type === 'shop_registration'
    ) {
      const userId = session.client_reference_id || metadata.userId;
      const partnerCode = metadata.referredByPartnerCode;
      console.log(
        `[Europe Stripe Webhook] Processing shop_registration for userId: ${userId}, referredBy: ${partnerCode}`,
      );

      const existingShop = await this.usersService.findOne(userId).catch(() => null);
      if (existingShop?.isPartnerPaid) {
        console.log(
          `[Europe Stripe Webhook] Shop ${userId} already paid. Skipping duplicate activation/emails.`,
        );
        await this.flagDuplicateRegistrationPayment('Europe Stripe Webhook', existingShop, session);
        return { received: true };
      }

      const couponInfo = await this.resolvePaidShopRegistrationCoupon(
        this.europeStripe || this.stripe,
        session,
        existingShop,
      );

      const updatedUser = await this.usersService.update(
        userId,
        {
          status: UserStatus.ACTIVE,
          isPartnerPaid: true,
        } as any,
        { role: UserRole.ADMIN } as any,
      );

      if (updatedUser) {
        console.log(`[Europe Stripe Webhook] Shop ${userId} activated.`);

        let invoiceBuffer: Buffer | undefined;
        let orderNumber: string | undefined;
        try {
          const couponCode = couponInfo.couponCode || updatedUser.couponCode;
          const regOrder = await this.createRegistrationOrder(
            updatedUser,
            session,
            couponCode
              ? { couponCode, discount: couponInfo.discount }
              : undefined,
          );
          invoiceBuffer = await this.generateInvoicePdf(regOrder);
          orderNumber = regOrder.orderNumber;
          await this.recordCouponUsageIfApplicable(couponCode);
        } catch (orderErr) {
          console.error(
            '[Europe Stripe Webhook] Failed to create registration order:',
            orderErr,
          );
        }

        await this.mailService.sendDistributorPaymentCompletedAdminNotification(
          [],
          updatedUser,
        );

        if (updatedUser.email) {
          const partnerContact =
            await this.usersService.getPartnerContactForShop(updatedUser);
          await this.mailService.sendDistributorPaymentConfirmation(
            updatedUser.email,
            updatedUser,
            invoiceBuffer,
            orderNumber,
            partnerContact,
          );
        }

        if (partnerCode) {
          const partner = await (this.usersService as any).userModel.findOne({
            partnerCode,
          });
          if (partner) {
            const partnerNotification = await this.notificationsService.create({
              type: NotificationType.ORDER_PAID,
              title: 'New Shop Referral Active',
              message: `Shop "${updatedUser.firstName} ${updatedUser.lastName}" has completed registration and is now part of your network.`,
              metadata: {
                shopId: updatedUser._id,
                shopName: `${updatedUser.firstName} ${updatedUser.lastName}`,
              },
              user: partner._id,
              triggeredBy: updatedUser._id as any,
              link: `/dashboard/partner/shops/${updatedUser._id}`,
            });
            this.notificationsGateway.broadcastNotification(partnerNotification);
          }
        }

        const notification = await this.notificationsService.create({
          type: NotificationType.ORDER_PAID,
          title: 'Shop Registration Paid',
          message: `Shop ${updatedUser.firstName} ${updatedUser.lastName} has paid the registration fee and is now active.`,
          metadata: { userId: updatedUser._id },
          user: updatedUser._id as any,
          triggeredBy: updatedUser._id as any,
          link: `/dashboard/shop`,
        });
        this.notificationsGateway.broadcastNotification(notification);
      } else {
        console.error(
          `[Europe Stripe Webhook] CRITICAL: Could not find/update shop ${userId} for shop_registration type.`,
        );
      }
      return { received: true };
    }

    return { received: true };
  }

  async handleWebhook(sig: string, payload: Buffer) {
    const endpointSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    if (!endpointSecret)
      throw new BadRequestException('Webhook secret not configured');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, sig, endpointSecret);
    } catch (err) {
      console.error(`[Stripe Webhook] Verification Failed: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object as Stripe.Checkout.Session;
    console.log(`[Stripe Webhook] Received event: ${event.type}`);
    const metadata = session.metadata;
    console.log(`[Stripe Webhook] Event ID: ${event.id}`);
    console.log(`[Stripe Webhook] Metadata: ${JSON.stringify(metadata)}`);
    console.log(`[Stripe Webhook] Payment Status: ${session.payment_status}`);

    if (event.type === 'checkout.session.completed') {

      // Handle Partner Registration Payment
      if (metadata && (metadata.type === 'partner_registration' || metadata.type === 'distributor_registration')) {
        const userId = session.client_reference_id || metadata.userId;
        console.log(`[Stripe Webhook] Processing partner_registration for userId: ${userId}`);

        const existingPartner = await this.usersService.findOne(userId).catch(() => null);
        if (existingPartner?.isPartnerPaid) {
          console.log(
            `[Stripe Webhook] Partner ${userId} already paid. Skipping duplicate activation/emails.`,
          );
          await this.flagDuplicateRegistrationPayment('Stripe Webhook', existingPartner, session);
          return { received: true };
        }

        const updatedUser = await this.usersService.update(userId, {
          status: UserStatus.ACTIVE,
          isPartnerPaid: true,
        } as any, { role: UserRole.ADMIN } as any);

        if (updatedUser) {
          console.log(`[Stripe Webhook] User ${userId} activated as partner.`);

          let invoiceBuffer: Buffer | undefined;
          let orderNumber: string | undefined;
          try {
            const regOrder = await this.createRegistrationOrder(
            updatedUser,
            session,
            updatedUser.couponCode
              ? { couponCode: updatedUser.couponCode }
              : undefined,
          );
            invoiceBuffer = await this.generateInvoicePdf(regOrder);
            orderNumber = regOrder.orderNumber;
          } catch (orderErr) {
            console.error('[Stripe Webhook] Failed to create registration order:', orderErr);
          }

          // Admin notification is now handled internally by MailService for sales@skygloss.com
          await this.mailService.sendDistributorPaymentCompletedAdminNotification(
            [],
            updatedUser,
          );

          // Send User Confirmation Email
          if (updatedUser.email) {
            const partnerContact = await this.usersService.getPartnerContactForShop(updatedUser);
            await this.mailService.sendDistributorPaymentConfirmation(
              updatedUser.email,
              updatedUser,
              invoiceBuffer,
              orderNumber,
              partnerContact,
            );
          }

          const notification = await this.notificationsService.create({
            type: NotificationType.ORDER_PAID,
            title: `${formatRoleLabel(updatedUser.role)} Registration Paid`,
            message: `User ${updatedUser.firstName} ${updatedUser.lastName} has paid the registration fee and is now active.`,
            metadata: { userId: updatedUser._id },
            user: updatedUser._id as any,
            triggeredBy: updatedUser._id as any,
            link: `/dashboard/partner`,
          });
          this.notificationsGateway.broadcastNotification(notification);
        } else {
          console.error(`[Stripe Webhook] Could not find/update user ${userId} for partner_registration.`);
        }
        return { received: true };
      }

      // Handle Shop Registration Payment
      if (metadata && metadata.type === 'shop_registration') {
        const userId = session.client_reference_id || metadata.userId;
        const partnerCode = metadata.referredByPartnerCode;
        console.log(`[Stripe Webhook] Processing shop_registration for userId: ${userId}, referredBy: ${partnerCode}`);

        const existingShop = await this.usersService.findOne(userId).catch(() => null);
        if (existingShop?.isPartnerPaid) {
          console.log(
            `[Stripe Webhook] Shop ${userId} already paid. Skipping duplicate activation/emails.`,
          );
          await this.flagDuplicateRegistrationPayment('Stripe Webhook', existingShop, session);
          return { received: true };
        }

        const couponInfo = await this.resolvePaidShopRegistrationCoupon(
          this.stripe,
          session,
          existingShop,
        );

        const updatedUser = await this.usersService.update(userId, {
          status: UserStatus.ACTIVE,
          isPartnerPaid: true,
        } as any, { role: UserRole.ADMIN } as any);

        if (updatedUser) {
          console.log(`[Stripe Webhook] Shop ${userId} activated.`);

          let invoiceBuffer: Buffer | undefined;
          let orderNumber: string | undefined;
          try {
            const couponCode = couponInfo.couponCode || updatedUser.couponCode;
            const regOrder = await this.createRegistrationOrder(
            updatedUser,
            session,
            couponCode
              ? { couponCode, discount: couponInfo.discount }
              : undefined,
          );
            invoiceBuffer = await this.generateInvoicePdf(regOrder);
            orderNumber = regOrder.orderNumber;
            await this.recordCouponUsageIfApplicable(couponCode);
          } catch (orderErr) {
            console.error('[Stripe Webhook] Failed to create registration order:', orderErr);
          }

          // 1. Notify Admin (Sales Dept)
          await this.mailService.sendDistributorPaymentCompletedAdminNotification(
            [],
            updatedUser,
          );

          // Send User Confirmation Email
          if (updatedUser.email) {
            const partnerContact = await this.usersService.getPartnerContactForShop(updatedUser);
            await this.mailService.sendDistributorPaymentConfirmation(
              updatedUser.email,
              updatedUser,
              invoiceBuffer,
              orderNumber,
              partnerContact,
            );
          }

          // 2. Notify Referring Partner
          if (partnerCode) {
            const partner = await (this.usersService as any).userModel.findOne({ partnerCode });
            if (partner) {
              const partnerNotification = await this.notificationsService.create({
                type: NotificationType.ORDER_PAID,
                title: 'New Shop Referral Active',
                message: `Shop "${updatedUser.firstName} ${updatedUser.lastName}" has completed registration and is now part of your network.`,
                metadata: { shopId: updatedUser._id, shopName: `${updatedUser.firstName} ${updatedUser.lastName}` },
                user: partner._id,
                triggeredBy: updatedUser._id as any,
                link: `/dashboard/partner/shops/${updatedUser._id}`,
              });
              this.notificationsGateway.broadcastNotification(partnerNotification);
            }
          }

          const notification = await this.notificationsService.create({
            type: NotificationType.ORDER_PAID,
            title: 'Shop Registration Paid',
            message: `Shop ${updatedUser.firstName} ${updatedUser.lastName} has paid the registration fee and is now active.`,
            metadata: { userId: updatedUser._id },
            user: updatedUser._id as any,
            triggeredBy: updatedUser._id as any,
            link: `/dashboard/shop`,
          });
          this.notificationsGateway.broadcastNotification(notification);
        } else {
          console.error(`[Stripe Webhook] CRITICAL: Could not find/update shop ${userId} for shop_registration type.`);
        }
        return { received: true };
      }

      // Handle Shop Order Payment
      if (metadata && metadata.type === 'shop_order') {
        // IMPORTANT: client_reference_id = userId, NOT orderId.
        // The orderId is stored in metadata.orderId.
        const orderId = metadata.orderId;
        console.log(`[Stripe Webhook] Processing shop_order for orderId: ${orderId}`);

        if (!orderId) {
          console.error('[Stripe Webhook] No orderId found in metadata for shop_order event.');
          return { received: true };
        }

        if (!isStripeCheckoutSessionPaid(session)) {
          console.warn(
            `[Stripe Webhook] Session ${session.id} for order ${orderId} is not paid (payment_status=${session.payment_status}). Order left unpaid.`,
          );
          return { received: true };
        }

        const existingOrder = await this.orderModel.findById(orderId);
        if (existingOrder && isOrderPaymentRecorded(existingOrder.status)) {
          console.log(`[Stripe Webhook] Order ${existingOrder.orderNumber} is already ${existingOrder.status}. Skipping duplicate notifications/emails.`);
          if (existingOrder.includesCertificationKit) {
            await this.applyCertificationKitPurchaseBenefits(existingOrder);
          }
          await this.sendPaidOrderNotificationsIfNeeded(orderId);
          this.queuePaidOrderCommissionTransfer(orderId, {
            stripeAccountKey: 'global',
            stripePaymentId:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id || session.id,
          });
          return { received: true };
        }

        const actualTotal = (session.amount_total || 0) / 100;
        const stripeDiscount = (session.total_details?.amount_discount || 0) / 100;
        let discount = existingOrder?.discount ?? 0;
        let couponCode = existingOrder?.couponCode;
        if (stripeDiscount > 0.01 && !couponCode) {
          couponCode = 'STRIPECOUPON';
          discount = stripeDiscount;
        }

        const priorPaid = getOrderAmountPaid(existingOrder || {});
        const amountUpdate =
          priorPaid > 0.01
            ? {
                amountPaid:
                  Number(existingOrder?.totalAmount) ||
                  priorPaid + actualTotal,
              }
            : {
                ...this.buildAmountUpdateWithLockedRate(existingOrder, actualTotal),
                amountPaid: actualTotal,
              };

        const updatedOrder = await this.orderModel
          .findOneAndUpdate(
            // Atomic: concurrent/duplicate webhooks or an admin Mark Paid cannot both process payment.
            { _id: orderId, status: paymentNotRecordedStatusFilter() },
            {
              status: OrderStatus.PAID,
              discount,
              couponCode,
              ...amountUpdate,
            },
            { new: true },
          )
          .populate('user', 'firstName lastName email');

        if (updatedOrder) {
          console.log(`[Stripe Webhook] Order ${updatedOrder.orderNumber} status updated to PAID.`);

          await this.recordCouponUsageIfApplicable(updatedOrder.couponCode);

          await this.sendPaidOrderNotificationsIfNeeded(updatedOrder._id.toString());

          await this.applyOrderCommissions(
            updatedOrder._id.toString(),
            OrderStatus.PAID,
          );
          this.queuePaidOrderCommissionTransfer(updatedOrder._id.toString(), {
            stripeAccountKey: 'global',
            stripePaymentId:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id || session.id,
          });
          await this.deductProductInventoryForOrder(updatedOrder._id);
          if (updatedOrder.includesCertificationKit) {
            await this.applyCertificationKitPurchaseBenefits(updatedOrder);
          }
        } else {
          console.log(`[Stripe Webhook] Order ${orderId} not found or payment already recorded; nothing to do.`);
        }
        return { received: true };
      }

      console.warn('[Stripe Webhook] checkout.session.completed received but no matching type in metadata:', metadata);

    } else if (
      event.type === 'checkout.session.async_payment_failed' ||
      event.type === 'checkout.session.expired'
    ) {
      const orderId = metadata?.orderId;
      if (orderId) {
        const existing = await this.orderModel.findById(orderId);
        if (shouldMarkFailedOnCheckoutExpire(existing?.status)) {
          console.log(
            `[Stripe Webhook] Marking order ${orderId} as FAILED due to event: ${event.type}`,
          );
          await this.orderModel.findByIdAndUpdate(orderId, {
            status: OrderStatus.FAILED,
          });
        } else {
          console.log(
            `[Stripe Webhook] Ignoring ${event.type} for ${orderId}; status is ${existing?.status || 'missing'}.`,
          );
        }
      }
    }
    return { received: true };
  }



  async getAllOrders(): Promise<Order[]> {
    return this.cache.wrap(
      CacheKeys.ordersAdminAll,
      CacheTtl.ordersAdminAll,
      () => this.getAllOrdersFresh(),
    );
  }

  private async getAllOrdersFresh(): Promise<Order[]> {
    const orders = await this.orderModel
      .find()
      .select(
        'orderNumber status totalAmount amountPaid paidConfirmationEmailSentAt inventoryDeductedAt currency shippingFee discount partnerDiscountPercent couponCode items shippingAddress trackingId shippingCompany orderFlow createdAt updatedAt user commissions originalCurrency originalAmount baseCurrencyAmount actingParentPartnerCode cancellationRequest',
      )
      .populate(
        'user',
        'firstName lastName email shopName role couponCode partnerCode referredByPartnerCode country hubPartnerCode parentLinkAssignedAt previousParentPartnerCode',
      )
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const actingCodes = await Promise.all(
      orders.map((order) => {
        const role = (order.user as { role?: string } | null)?.role;
        if (role && role !== UserRole.CERTIFIED_SHOP) {
          return Promise.resolve(
            String((order as any).actingParentPartnerCode || ''),
          );
        }
        return this.usersService.resolveActingParentForOrder({
          actingParentPartnerCode: (order as any).actingParentPartnerCode,
          createdAt: (order as any).createdAt,
          user: order.user as {
            hubPartnerCode?: string;
            country?: string;
            parentLinkAssignedAt?: Date;
            previousParentPartnerCode?: string;
          },
        });
      }),
    );

    return orders.map((order, index) => {
      const actingCode = actingCodes[index];
      return {
        ...(order as any),
        actingParentPartnerCode:
          actingCode || (order as any).actingParentPartnerCode,
      };
    });
  }

  async getNetworkOrders(viewer: UserDocument): Promise<Order[]> {
    return this.cache.wrap(
      CacheKeys.ordersNetwork(String(viewer._id)),
      CacheTtl.ordersNetwork,
      () => this.getNetworkOrdersFresh(viewer),
    );
  }

  private async getNetworkOrdersFresh(viewer: UserDocument): Promise<Order[]> {
    const userIds = await this.getNetworkOrderUserIds(viewer);
    if (userIds.length === 0) {
      return [];
    }

    const orders = await this.orderModel
      .find({ user: { $in: userIds } } as any)
      .populate(
        'user',
        'firstName lastName email shopName role couponCode partnerCode referredByPartnerCode shopIntroductionRepresentativeCode city country hubPartnerCode parentLinkAssignedAt previousParentPartnerCode',
      )
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const visible = orders.filter((order) => {
        const orderUser = order.user as {
          _id?: unknown;
          role?: string;
          hubPartnerCode?: string;
        } | null;
        if (!orderUser) return false;

        const orderUserId =
          typeof orderUser === 'object' && orderUser !== null && '_id' in orderUser
            ? String((orderUser as any)._id)
            : String(order.user);

        if (
          shouldIncludeViewerInNetworkOrders(viewer.role) &&
          orderUserId === String(viewer._id)
        ) {
          return true;
        }

        if (shouldHideShopRegistrationFromViewer(order, viewer)) {
          return false;
        }

        return canViewerSeeOrderPlacerRole(viewer.role, orderUser.role);
      });

    const actingCodes = await Promise.all(
      visible.map((order) =>
        this.usersService.resolveActingParentForOrder({
          actingParentPartnerCode: (order as any).actingParentPartnerCode,
          createdAt: (order as any).createdAt,
          user: order.user as {
            hubPartnerCode?: string;
            country?: string;
            parentLinkAssignedAt?: Date;
            previousParentPartnerCode?: string;
          },
        }),
      ),
    );
    const parentRoles = await this.usersService.getShopParentLinkRolesByCode(
      actingCodes,
    );

    return visible.map((order, index) => {
        const plain = { ...(order as any) };
        type CommissionEntry = NonNullable<Order['commissions']>[number];
        plain.commissions = filterCommissionsForViewerWithSplitContext<CommissionEntry>(
          plain.commissions,
          viewer.role,
          viewer.partnerCode,
        );
        const shop = (order.user || {}) as { hubPartnerCode?: string; role?: string };
        const actingCode = actingCodes[index];
        if (actingCode) {
          plain.actingParentPartnerCode = actingCode;
        }
        plain.canManageOrderStatus = this.usersService.canViewerManageShopOrder(
          viewer,
          {
            actingParentPartnerCode: actingCode,
            hubPartnerCode: shop.hubPartnerCode,
          },
          actingCode ? parentRoles.get(actingCode) : undefined,
          shop.role,
        );
        return plain;
      });
  }

  async getNetworkSalesStats(viewer: UserDocument) {
    return this.cache.wrap(
      CacheKeys.ordersNetworkStats(String(viewer._id)),
      CacheTtl.ordersNetworkStats,
      async () => {
        const userIds = await this.getNetworkOrderUserIds(viewer);
        if (userIds.length === 0) {
          return {
            totalRevenue: 0,
            baseCurrency: SYSTEM_BASE_CURRENCY,
            currencyBreakdown: [],
          };
        }
        return this.computeSalesReport({
          user: { $in: userIds },
          ...registrationOrderExclusionFilter(),
        });
      },
    );
  }

  private async getNetworkOrderUserIds(
    viewer: UserDocument,
  ): Promise<string[]> {
    const network = await this.usersService.findNetworkUsersForViewer(viewer);
    const idSet = new Set<string>();

    const addUser = (u?: { _id?: unknown }) => {
      if (u?._id) {
        idSet.add(String(u._id));
      }
    };

    network.shops.forEach(addUser);
    network.promoters.forEach(addUser);
    network.subPromoters?.forEach(addUser);
    network.representatives.forEach(addUser);
    network.represented?.forEach(addUser);
    network.distributors.forEach(addUser);
    network.partners?.forEach(addUser);

    if (shouldIncludeViewerInNetworkOrders(viewer.role)) {
      addUser(viewer);
    }

    // Include shops where this Representative is Operational Support Partner
    // so they can view those shops' orders (commission UI already covers earnings).
    const osShopIds =
      await this.usersService.findOperationalSupportShopIds(viewer);
    for (const id of osShopIds) {
      idSet.add(id);
    }

    return Array.from(idSet);
  }

  /** Resolve a Representative partner code into a commission recipient. */
  private async resolveCommissionRecipient(
    partnerCode?: string,
  ): Promise<CommissionRecipient | null> {
    if (!partnerCode) return null;
    const user = await this.usersService.findByPartnerCode(partnerCode);
    if (!user?.partnerCode) return null;
    return {
      _id: user._id.toString(),
      partnerCode: user.partnerCode,
      role: user.role,
    };
  }

  /** True when `orderId` is the shop's earliest commissionable order
   *  (PENDING / PAID / SHIPPED / DELIVERED — so FO rates apply while still pending). */
  private async isFirstSuccessfulShopOrder(
    shopUserId: string,
    orderId: string,
  ): Promise<boolean> {
    const earliest = await this.orderModel
      .find({
        user: shopUserId,
        status: {
          $in: [
            OrderStatus.PENDING,
            OrderStatus.PAID,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
          ],
        },
        ...registrationOrderExclusionFilter(),
      } as any)
      .sort({ createdAt: 1 })
      .limit(1)
      .select('_id')
      .lean();

    return earliest.length > 0 && String(earliest[0]._id) === String(orderId);
  }

  async applyOrderCommissions(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<void> {
    if (
      newStatus !== OrderStatus.PENDING &&
      newStatus !== OrderStatus.PENDING_PAYMENT &&
      newStatus !== OrderStatus.PAID &&
      newStatus !== OrderStatus.SHIPPED &&
      newStatus !== OrderStatus.DELIVERED
    ) {
      return;
    }

    const order = await this.orderModel.findById(orderId);
    if (!order) return;
    if (isRegistrationOrder(order)) return;

    const shopUserId =
      typeof order.user === 'object' && order.user !== null && '_id' in (order.user as object)
        ? String((order.user as any)._id)
        : String(order.user);

    if (!shopUserId) return;

    let shopUser = await this.usersService.findOne(shopUserId);
    if (!shopUser || shopUser.role !== UserRole.CERTIFIED_SHOP) return;

    // SNAPSHOT LOCK (early): once commission lines exist on the order, never
    // rebuild recipients from the live shop. Admin OSP/SI changes must not move
    // past commissions. Amounts for SI/OS may refresh from the locked % when the
    // order USD base changes (e.g. items appended); Partner Intro amounts stay.
    if (order.commissions && order.commissions.length > 0) {
      const monetary = resolveCommissionOrderAmounts(order);
      let changed = this.normalizeLegacyShopIntroRateOnOrder(
        order,
        monetary,
        shopUser,
      );

      for (const entry of order.commissions) {
        const type = String(entry.earningType || '')
          .replace(/\s*\(partial[^)]*\)\s*$/i, '')
          .trim();
        if (type === 'Partner Development') continue;
        const pct = Number(entry.percentage);
        if (!Number.isFinite(pct) || pct <= 0) continue;
        const nextAmount = roundMoney(
          monetary.convertedUsdAmount * (pct / 100),
        );
        if (Math.abs(Number(entry.amount || 0) - nextAmount) >= 0.02) {
          entry.amount = nextAmount;
          changed = true;
        }
      }

      const commissionStatus = 'pending' as const;
      const statusChanged = order.commissions.some(
        (entry) => entry.status !== commissionStatus,
      );
      if (statusChanged) {
        order.commissions = order.commissions.map((entry) => ({
          ...entry,
          status: commissionStatus,
        }));
        changed = true;
      }

      if (changed) {
        order.markModified('commissions');
        await order.save();
      }
      return;
    }

    // Promoter Network FO first (same stamp shape as Rep FO: SI=P2, PD=P1).
    // Must run before Rep re-assignment so we don't keep an upstream-Rep SI
    // when the shop sits under an Add-to-Network linked Promoter.
    shopUser = await this.usersService.assignShopPromoterNetworkEarnings(shopUser);

    const promoterFoReady =
      shopUser.partnerDevelopmentPromoterEligible === true &&
      normalizePartnerCode(shopUser.shopIntroductionRepresentativeCode) ===
        normalizePartnerCode(shopUser.referredByPartnerCode);

    if (!promoterFoReady) {
      if (!shopUser.shopIntroductionRepresentativeCode) {
        shopUser = await this.usersService.assignShopEarningRepresentatives(shopUser);
      } else if (
        shopUser.partnerDevelopmentEligible !== true ||
        !shopUser.partnerDevelopmentRepresentativeCode
      ) {
        // Re-evaluate Rep FO eligibility (fixes shops blocked by old default=false bug).
        shopUser = await this.usersService.assignShopEarningRepresentatives(shopUser);
      }
      shopUser = await this.usersService.ensureShopPartnerDevelopmentAssignment(
        shopUser,
      );
      // Re-apply promoter FO in case Rep assign ran first on a linked-promoter shop.
      shopUser = await this.usersService.assignShopPromoterNetworkEarnings(shopUser);
    }

    // Admin may have edited Child/Parent FO % after shop assignment — use live rates
    // until Partner Development is locked on first paid/fulfilled order.
    shopUser = await this.usersService.refreshShopFirstOrderRatesIfUnpaid(
      shopUser,
    );

    const isFirstSuccessfulOrder = await this.isFirstSuccessfulShopOrder(
      shopUserId,
      orderId,
    );

    // Partner Development is a ONE-TIME earning per SHOP — paid only on that
    // shop's first successful (non-registration) order, tracked via the
    // shop-level partnerDevelopmentCommissionPaid flag.
    const partnerDevelopmentAlreadyPaid =
      shopUser.partnerDevelopmentCommissionPaid === true;

    const shopIntroUserForMode = shopUser.shopIntroductionRepresentativeCode
      ? await this.usersService.findByPartnerCode(
          shopUser.shopIntroductionRepresentativeCode,
        )
      : null;

    // Partner Intro: prefer live assignment on Shop Intro user, else shop stamp.
    let livePartnerIntroCode = normalizePartnerCode(
      shopUser.partnerDevelopmentRepresentativeCode,
    );
    if (shopIntroUserForMode) {
      const fromSiUser =
        normalizePartnerCode(
          shopIntroUserForMode.partnerDevelopmentRepresentativeCode,
        ) ||
        normalizePartnerCode(
          shopIntroUserForMode.partnerDevelopmentPromoterCode,
        );
      if (fromSiUser) {
        livePartnerIntroCode = fromSiUser;
      } else if (shopIntroUserForMode.role === UserRole.REGIONAL_PARTNER) {
        const parentCode = normalizePartnerCode(
          shopIntroUserForMode.referredByPartnerCode,
        );
        const parent = parentCode
          ? await this.usersService.findByPartnerCode(parentCode)
          : null;
        if (parent?.role === UserRole.MASTER_PARTNER && parentCode) {
          livePartnerIntroCode = parentCode;
        }
      }
    }
    if (
      livePartnerIntroCode &&
      livePartnerIntroCode ===
        normalizePartnerCode(shopUser.shopIntroductionRepresentativeCode)
    ) {
      livePartnerIntroCode = '';
    }

    const networkLookup = async (partnerCode: string) => {
      const user = await this.usersService.findByPartnerCode(partnerCode);
      if (!user?.partnerCode) return null;
      return {
        _id: user._id,
        partnerCode: user.partnerCode,
        role: user.role as string,
        referredByPartnerCode: user.referredByPartnerCode,
        customCommissionRate: user.customCommissionRate,
      };
    };

    const hierarchyChain = await resolveShopCommissionChain(
      shopUser,
      networkLookup,
    );

    const useFoNetwork = shouldUseFirstOrderNetworkCommission({
      partnerDevelopmentEligible:
        shopUser.partnerDevelopmentEligible === true || !!livePartnerIntroCode,
      partnerDevelopmentPromoterEligible:
        shopUser.partnerDevelopmentPromoterEligible === true,
      shopIntroductionRole: shopIntroUserForMode?.role,
      hasOperationalSupport: !!normalizePartnerCode(
        shopUser.operationalSupportRepresentativeCode,
      ),
    });

    // Prefer stamped earning-type commissions; hierarchy is legacy fallback only.
    const useHierarchyCommission =
      !useFoNetwork &&
      !shopUser.shopIntroductionRepresentativeCode &&
      !!hierarchyChain.promoter;

    const hasIntroPartner = !!normalizePartnerCode(
      shopUser.shopIntroductionRepresentativeCode,
    );
    const hasOsPartner = !!normalizePartnerCode(
      shopUser.operationalSupportRepresentativeCode,
    );

    if (!hasIntroPartner && !hasOsPartner && !useHierarchyCommission) {
      return;
    }

    // commissions is empty here (existing lines returned early via snapshot lock).
    const monetary = resolveCommissionOrderAmounts(order);

    const introPartnerCode = normalizePartnerCode(
      shopUser.shopIntroductionRepresentativeCode,
    );
    const shopIntroduction = introPartnerCode
      ? await this.resolveCommissionRecipient(introPartnerCode)
      : null;

    const partnerDevelopment = livePartnerIntroCode
      ? await this.resolveCommissionRecipient(livePartnerIntroCode)
      : null;

    // Operational Support whenever Admin has assigned a REP on the shop.
    const operationalSupportUser = shopUser.operationalSupportRepresentativeCode
      ? await this.usersService.findByPartnerCode(
          shopUser.operationalSupportRepresentativeCode,
        )
      : null;
    const operationalSupport =
      operationalSupportUser?.partnerCode &&
      operationalSupportUser.role === UserRole.MASTER_PARTNER
        ? {
            _id: operationalSupportUser._id.toString(),
            partnerCode: operationalSupportUser.partnerCode,
            role: operationalSupportUser.role,
          }
        : null;

    // Defaults: Shop Intro 10%, Partner Intro 5%, OS 10%.
    // Admin may override per shop (stamps) or per Shop Intro user (custom rates).
    const foRates = this.resolveCommissionRatesForShop(
      shopUser,
      shopIntroUserForMode,
    );
    const operationalSupportRatePercent =
      shopUser.operationalSupportRatePercent != null &&
      !Number.isNaN(Number(shopUser.operationalSupportRatePercent))
        ? Math.max(
            0,
            Math.min(100, Number(shopUser.operationalSupportRatePercent)),
          )
        : 10;

    let entries;
    if (useHierarchyCommission) {
      const repUser = await this.usersService.findByPartnerCode(
        hierarchyChain.represented!.partnerCode,
      );
      const promUser = await this.usersService.findByPartnerCode(
        hierarchyChain.promoter!.partnerCode,
      );
      entries = calculateHierarchyCommissionEntries({
        shopId: shopUserId,
        chain: hierarchyChain,
        monetary,
        representativeRatePercent: resolveCommissionRatePercent(
          hierarchyChain.represented!.role,
          repUser?.customCommissionRate,
        ),
        promoterRatePercent: resolveCommissionRatePercent(
          hierarchyChain.promoter!.role,
          promUser?.customCommissionRate,
        ),
      });
    } else {
      // Promoter Network FO / Rep Add-to-Network FO uses the earning-type model.
      entries = calculateRepresentativeCommissionEntries({
        shopId: shopUserId,
        assignments: {
          shopIntroductionRepresentativeCode:
            shopUser.shopIntroductionRepresentativeCode,
          partnerDevelopmentRepresentativeCode: livePartnerIntroCode,
          partnerDevelopmentCommissionPaid: false, // Partner Intro pays every order
          partnerDevelopmentEligible: !!partnerDevelopment,
          partnerDevelopmentRatePercent: foRates.partnerDevelopmentRate,
          shopIntroductionFirstOrderRatePercent:
            foRates.shopIntroductionRate,
        },
        recipients: {
          shopIntroduction,
          partnerDevelopment,
          operationalSupport,
        },
        monetary,
        isFirstSuccessfulOrder,
        defaultShopIntroductionRatePercent: foRates.shopIntroductionRate,
        operationalSupportRatePercent,
      });
    }

    const commissionStatus = 'pending' as const;

    order.commissions = entries.map((entry) => ({
      ...entry,
      status: commissionStatus,
    }));
    await order.save();
    await this.invalidateOrderReadCaches();

    // Partner Intro is recurring — do not lock via partnerDevelopmentCommissionPaid.

    if (entries.length > 0) {
      console.log(
        `[Commission] Order ${order.orderNumber}: ${entries.length} recipient(s), status=${commissionStatus}, base=${monetary.orderAmount} ${monetary.orderCurrency} @ ${monetary.exchangeRateToUsd} → USD`,
      );
    }
  }

  /**
   * After Admin updates shop earning assignments (OSP / SI / rates), stamp
   * commissions only on orders that still have an empty commissions array.
   *
   * Orders that already have commission lines keep their order-time snapshot —
   * changing OSP/SI must never move past commissions to a new recipient.
   */
  async recalculateCommissionsForShop(shopUserId: string): Promise<{
    processed: number;
    updated: number;
  }> {
    const shop = await this.usersService.findOne(shopUserId);
    if (!shop || shop.role !== UserRole.CERTIFIED_SHOP) {
      return { processed: 0, updated: 0 };
    }

    const orders = await this.orderModel
      .find({
        user: shopUserId,
        status: {
          $in: [
            OrderStatus.PENDING,
            OrderStatus.PENDING_PAYMENT,
            OrderStatus.PAID,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
          ],
        },
        ...registrationOrderExclusionFilter(),
      } as any)
      .exec();

    let updated = 0;
    let processed = 0;
    for (const order of orders) {
      // Snapshot lock: never clear or rebuild existing commission recipients.
      if (order.commissions?.length) {
        continue;
      }

      processed += 1;
      const before = JSON.stringify(order.commissions || []);

      await this.applyOrderCommissions(
        order._id.toString(),
        order.status as OrderStatus,
      );

      const refreshed = await this.orderModel.findById(order._id).exec();
      if (!refreshed) continue;

      const after = JSON.stringify(refreshed.commissions || []);
      if (before !== after) {
        updated += 1;
      }

      if (
        refreshed.status === OrderStatus.SHIPPED ||
        refreshed.status === OrderStatus.DELIVERED
      ) {
        const shippedAt =
          refreshed.shippedAt ||
          (refreshed as Order & { updatedAt?: Date }).updatedAt ||
          new Date();
        await this.commissionsService
          .syncFromShippedOrder(refreshed._id.toString(), shippedAt)
          .catch((err) =>
            this.logger.error(
              `Failed to sync commission records after shop recalc for order ${refreshed.orderNumber}`,
              err,
            ),
          );
      }
    }

    if (orders.length > 0) {
      this.logger.log(
        `[Commission] Shop ${shopUserId}: snapshot-safe recalc — ${processed} unstamped order(s) processed, ${updated} stamped (${orders.length - processed} already locked)`,
      );
    }

    return { processed, updated };
  }

  /**
   * Admin preview: list shop orders with eligibility + role-specific commission
   * for a proposed OSP or Shop Introduction Partner assignment.
   *
   * Does not mutate orders or shop assignments. Commission amounts follow the
   * same base/rate rules as applyOrderCommissions for that earning type only.
   */
  async previewPartnerAssignmentOrders(
    shopUserId: string,
    opts: {
      earningType: PartnerAssignmentEarningType;
      partnerCode: string;
      ratePercent?: number | null;
    },
  ): Promise<{
    earningType: PartnerAssignmentEarningType;
    partnerCode: string;
    partnerName: string;
    ratePercent: number;
    orders: Array<{
      orderId: string;
      orderNumber: string;
      orderDate: string | null;
      orderAmount: number;
      currency: string;
      convertedUsdAmount: number;
      status: string;
      partnerRole: PartnerAssignmentEarningType;
      commissionAmount: number;
      commissionPercent: number;
      eligible: boolean;
      eligibilityStatus: 'eligible' | 'pending' | 'not_eligible';
      ineligibleReason: string | null;
      alreadyAssigned: boolean;
      shippedAt: string | null;
    }>;
    summary: {
      totalOrders: number;
      eligibleCount: number;
      pendingCount: number;
      notEligibleCount: number;
      totalEligibleOrderAmountUsd: number;
      totalEligibleCommissionUsd: number;
    };
  }> {
    const shop = await this.usersService.findOne(shopUserId);
    if (!shop || shop.role !== UserRole.CERTIFIED_SHOP) {
      throw new BadRequestException('Shop not found');
    }

    const partnerCode = normalizePartnerCode(opts.partnerCode);
    if (!partnerCode) {
      throw new BadRequestException('Partner code is required');
    }

    const partnerUser = await this.usersService.findByPartnerCode(partnerCode);
    if (!partnerUser?.partnerCode) {
      throw new BadRequestException('Partner not found');
    }

    if (opts.earningType === 'Operational Support') {
      if (partnerUser.role !== UserRole.MASTER_PARTNER) {
        throw new BadRequestException(
          'Operational Support must be a Representative.',
        );
      }
    } else if (
      partnerUser.role !== UserRole.MASTER_PARTNER &&
      partnerUser.role !== UserRole.REGIONAL_PARTNER
    ) {
      throw new BadRequestException(
        'Shop Introduction Partner must be a Representative or Promoter.',
      );
    }

    const ratePercent = this.resolvePreviewRatePercent(
      opts.earningType,
      shop,
      partnerUser,
      opts.ratePercent,
    );

    const partnerName = [partnerUser.firstName, partnerUser.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || partnerUser.partnerCode;

    const orders = await this.orderModel
      .find({
        user: shopUserId,
        status: {
          $in: [
            OrderStatus.PENDING,
            OrderStatus.PENDING_PAYMENT,
            OrderStatus.PAID,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
            OrderStatus.CANCELLED,
          ],
        },
      } as any)
      .sort({ createdAt: -1 })
      .exec();

    type PreviewOrderRow = {
      orderId: string;
      orderNumber: string;
      orderDate: string | null;
      orderAmount: number;
      currency: string;
      convertedUsdAmount: number;
      status: string;
      partnerRole: PartnerAssignmentEarningType;
      commissionAmount: number;
      commissionPercent: number;
      eligible: boolean;
      eligibilityStatus: 'eligible' | 'pending' | 'not_eligible';
      ineligibleReason: string | null;
      alreadyAssigned: boolean;
      shippedAt: string | null;
    };

    const rows: PreviewOrderRow[] = [];
    for (const order of orders) {
      const monetary = resolveCommissionOrderAmounts(order);
      const createdAt =
        (order as Order & { createdAt?: Date }).createdAt || null;
      const shippedAt = order.shippedAt || null;
      const existing = (order.commissions || []).find(
        (c) =>
          String(c.earningType || '')
            .replace(/\s*\(partial[^)]*\)\s*$/i, '')
            .trim() === opts.earningType,
      );
      const alreadyAssigned = !!existing;
      const commissionAmount = roundMoney(
        monetary.convertedUsdAmount * (ratePercent / 100),
      );

      let eligible = false;
      let eligibilityStatus: 'eligible' | 'pending' | 'not_eligible' =
        'not_eligible';
      let ineligibleReason: string | null = null;

      if (isRegistrationOrder(order)) {
        ineligibleReason = 'Registration orders are not commissionable';
      } else if (order.status === OrderStatus.CANCELLED) {
        ineligibleReason = 'Order is cancelled';
      } else if (alreadyAssigned) {
        ineligibleReason = `${opts.earningType} commission already assigned on this order`;
      } else if (
        order.status !== OrderStatus.PENDING &&
        order.status !== OrderStatus.PENDING_PAYMENT &&
        order.status !== OrderStatus.PAID &&
        order.status !== OrderStatus.SHIPPED &&
        order.status !== OrderStatus.DELIVERED
      ) {
        ineligibleReason = `Order status ${order.status} is not commissionable`;
      } else if (monetary.convertedUsdAmount <= 0) {
        ineligibleReason = 'Order has no commissionable amount';
      } else {
        eligible = true;
        // Payable / available still follow shipping + holding period after link.
        if (
          order.status === OrderStatus.SHIPPED ||
          order.status === OrderStatus.DELIVERED
        ) {
          eligibilityStatus = 'eligible';
        } else {
          eligibilityStatus = 'pending';
        }
      }

      rows.push({
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        orderDate: createdAt ? new Date(createdAt).toISOString() : null,
        orderAmount: roundMoney(
          Number(order.originalAmount ?? order.totalAmount) || 0,
        ),
        currency: String(
          order.originalCurrency || order.currency || SYSTEM_BASE_CURRENCY,
        ).toUpperCase(),
        convertedUsdAmount: monetary.convertedUsdAmount,
        status: String(order.status),
        partnerRole: opts.earningType,
        commissionAmount: eligible ? commissionAmount : 0,
        commissionPercent: ratePercent,
        eligible,
        eligibilityStatus,
        ineligibleReason,
        alreadyAssigned,
        shippedAt: shippedAt ? new Date(shippedAt).toISOString() : null,
      });
    }

    const eligibleRows = rows.filter((r) => r.eligible);
    const summary = {
      totalOrders: rows.length,
      eligibleCount: eligibleRows.length,
      pendingCount: rows.filter((r) => r.eligibilityStatus === 'pending')
        .length,
      notEligibleCount: rows.filter(
        (r) => r.eligibilityStatus === 'not_eligible',
      ).length,
      totalEligibleOrderAmountUsd: roundMoney(
        eligibleRows.reduce((sum, r) => sum + r.convertedUsdAmount, 0),
      ),
      totalEligibleCommissionUsd: roundMoney(
        eligibleRows.reduce((sum, r) => sum + r.commissionAmount, 0),
      ),
    };

    return {
      earningType: opts.earningType,
      partnerCode,
      partnerName,
      ratePercent,
      orders: rows,
      summary,
    };
  }

  private resolvePreviewRatePercent(
    earningType: PartnerAssignmentEarningType,
    shop: {
      shopIntroductionFirstOrderRatePercent?: number | null;
      operationalSupportRatePercent?: number | null;
    },
    partnerUser: {
      role?: string;
      customCommissionRate?: number | null;
    },
    explicitRate?: number | null,
  ): number {
    if (
      explicitRate != null &&
      !Number.isNaN(Number(explicitRate))
    ) {
      return Math.max(0, Math.min(100, Number(explicitRate)));
    }

    if (earningType === 'Operational Support') {
      const shopOs = shop.operationalSupportRatePercent;
      if (shopOs != null && !Number.isNaN(Number(shopOs))) {
        return Math.max(0, Math.min(100, Number(shopOs)));
      }
      return 10;
    }

    const foRates = this.resolveCommissionRatesForShop(
      {
        shopIntroductionFirstOrderRatePercent:
          shop.shopIntroductionFirstOrderRatePercent ?? undefined,
      },
      partnerUser,
    );
    return foRates.shopIntroductionRate;
  }

  /**
   * After Admin assigns OSP or Shop Intro and selects existing orders, link
   * only those orders to the new earning type. Never rewrites an earning type
   * that already exists on the order (snapshot / duplicate protection).
   */
  async linkSelectedOrdersToPartnerEarning(
    params: SelectiveShopCommissionLinkParams,
  ): Promise<{ linked: number; skipped: number }> {
    const { shopUserId, earningType, orderIds } = params;
    const uniqueIds = [
      ...new Set(
        (orderIds || [])
          .map((id) => String(id || '').trim())
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    if (!uniqueIds.length) {
      return { linked: 0, skipped: 0 };
    }

    const shop = await this.usersService.findOne(shopUserId);
    if (!shop || shop.role !== UserRole.CERTIFIED_SHOP) {
      return { linked: 0, skipped: uniqueIds.length };
    }

    let linked = 0;
    let skipped = 0;

    for (const orderId of uniqueIds) {
      const order = await this.orderModel.findById(orderId).exec();
      if (!order) {
        skipped += 1;
        continue;
      }

      const orderShopId =
        typeof order.user === 'object' &&
        order.user !== null &&
        '_id' in (order.user as object)
          ? String((order.user as any)._id)
          : String(order.user);
      if (orderShopId !== String(shopUserId)) {
        skipped += 1;
        continue;
      }

      if (isRegistrationOrder(order)) {
        skipped += 1;
        continue;
      }

      if (
        order.status !== OrderStatus.PENDING &&
        order.status !== OrderStatus.PENDING_PAYMENT &&
        order.status !== OrderStatus.PAID &&
        order.status !== OrderStatus.SHIPPED &&
        order.status !== OrderStatus.DELIVERED
      ) {
        skipped += 1;
        continue;
      }

      const hasEarningType = (order.commissions || []).some(
        (c) =>
          String(c.earningType || '')
            .replace(/\s*\(partial[^)]*\)\s*$/i, '')
            .trim() === earningType,
      );
      if (hasEarningType) {
        skipped += 1;
        continue;
      }

      // Always append only the requested earning type (and Partner Development
      // when linking Shop Introduction). Do not call full applyOrderCommissions
      // — that would also stamp the other role if both were just assigned.
      const appended = await this.appendMissingEarningTypeToOrder(
        order._id.toString(),
        earningType,
        { allowEmptyCommissions: true },
      );
      if (!appended) {
        skipped += 1;
        continue;
      }

      const refreshed = await this.orderModel.findById(order._id).exec();
      if (!refreshed) {
        skipped += 1;
        continue;
      }

      const nowHasType = (refreshed.commissions || []).some(
        (c) =>
          String(c.earningType || '')
            .replace(/\s*\(partial[^)]*\)\s*$/i, '')
            .trim() === earningType,
      );
      if (!nowHasType) {
        skipped += 1;
        continue;
      }

      linked += 1;

      if (
        refreshed.status === OrderStatus.SHIPPED ||
        refreshed.status === OrderStatus.DELIVERED
      ) {
        const shippedAt =
          refreshed.shippedAt ||
          (refreshed as Order & { updatedAt?: Date }).updatedAt ||
          new Date();
        await this.commissionsService
          .syncFromShippedOrder(refreshed._id.toString(), shippedAt)
          .catch((err) =>
            this.logger.error(
              `Failed to sync commission records after selective link for order ${refreshed.orderNumber}`,
              err,
            ),
          );
      }
    }

    this.logger.log(
      `[Commission] Shop ${shopUserId}: selective ${earningType} link — ${linked} linked, ${skipped} skipped`,
    );

    return { linked, skipped };
  }

  /**
   * Append a missing earning type onto an order without changing existing
   * recipients. When allowEmptyCommissions is true, also works for orders
   * that never received a commission snapshot (selective late assignment).
   */
  private async appendMissingEarningTypeToOrder(
    orderId: string,
    earningType: PartnerAssignmentEarningType,
    options?: { allowEmptyCommissions?: boolean },
  ): Promise<boolean> {
    const order = await this.orderModel.findById(orderId);
    if (!order || isRegistrationOrder(order)) return false;
    if (!order.commissions?.length && !options?.allowEmptyCommissions) {
      return false;
    }

    const already = (order.commissions || []).some(
      (c) =>
        String(c.earningType || '')
          .replace(/\s*\(partial[^)]*\)\s*$/i, '')
          .trim() === earningType,
    );
    if (already) return false;

    const shopUserId =
      typeof order.user === 'object' &&
      order.user !== null &&
      '_id' in (order.user as object)
        ? String((order.user as any)._id)
        : String(order.user);

    let shopUser = await this.usersService.findOne(shopUserId);
    if (!shopUser || shopUser.role !== UserRole.CERTIFIED_SHOP) return false;

    shopUser = await this.usersService.assignShopPromoterNetworkEarnings(shopUser);
    const promoterFoReady =
      shopUser.partnerDevelopmentPromoterEligible === true &&
      normalizePartnerCode(shopUser.shopIntroductionRepresentativeCode) ===
        normalizePartnerCode(shopUser.referredByPartnerCode);
    if (!promoterFoReady) {
      if (!shopUser.shopIntroductionRepresentativeCode) {
        shopUser = await this.usersService.assignShopEarningRepresentatives(shopUser);
      } else if (
        shopUser.partnerDevelopmentEligible !== true ||
        !shopUser.partnerDevelopmentRepresentativeCode
      ) {
        shopUser = await this.usersService.assignShopEarningRepresentatives(shopUser);
      }
      shopUser = await this.usersService.ensureShopPartnerDevelopmentAssignment(
        shopUser,
      );
      shopUser = await this.usersService.assignShopPromoterNetworkEarnings(shopUser);
    }

    const monetary = resolveCommissionOrderAmounts(order);
    if (monetary.convertedUsdAmount <= 0) return false;

    const shopIntroUserForMode = shopUser.shopIntroductionRepresentativeCode
      ? await this.usersService.findByPartnerCode(
          shopUser.shopIntroductionRepresentativeCode,
        )
      : null;

    let livePartnerIntroCode = normalizePartnerCode(
      shopUser.partnerDevelopmentRepresentativeCode,
    );
    if (shopIntroUserForMode) {
      const fromSiUser =
        normalizePartnerCode(
          shopIntroUserForMode.partnerDevelopmentRepresentativeCode,
        ) ||
        normalizePartnerCode(
          shopIntroUserForMode.partnerDevelopmentPromoterCode,
        );
      if (fromSiUser) {
        livePartnerIntroCode = fromSiUser;
      } else if (shopIntroUserForMode.role === UserRole.REGIONAL_PARTNER) {
        const parentCode = normalizePartnerCode(
          shopIntroUserForMode.referredByPartnerCode,
        );
        const parent = parentCode
          ? await this.usersService.findByPartnerCode(parentCode)
          : null;
        if (parent?.role === UserRole.MASTER_PARTNER && parentCode) {
          livePartnerIntroCode = parentCode;
        }
      }
    }
    if (
      livePartnerIntroCode &&
      livePartnerIntroCode ===
        normalizePartnerCode(shopUser.shopIntroductionRepresentativeCode)
    ) {
      livePartnerIntroCode = '';
    }

    const introPartnerCode = normalizePartnerCode(
      shopUser.shopIntroductionRepresentativeCode,
    );
    const shopIntroduction = introPartnerCode
      ? await this.resolveCommissionRecipient(introPartnerCode)
      : null;
    const partnerDevelopment = livePartnerIntroCode
      ? await this.resolveCommissionRecipient(livePartnerIntroCode)
      : null;

    const operationalSupportUser = shopUser.operationalSupportRepresentativeCode
      ? await this.usersService.findByPartnerCode(
          shopUser.operationalSupportRepresentativeCode,
        )
      : null;
    const operationalSupport =
      operationalSupportUser?.partnerCode &&
      operationalSupportUser.role === UserRole.MASTER_PARTNER
        ? {
            _id: operationalSupportUser._id.toString(),
            partnerCode: operationalSupportUser.partnerCode,
            role: operationalSupportUser.role,
          }
        : null;

    const foRates = this.resolveCommissionRatesForShop(
      shopUser,
      shopIntroUserForMode,
    );
    const operationalSupportRatePercent =
      shopUser.operationalSupportRatePercent != null &&
      !Number.isNaN(Number(shopUser.operationalSupportRatePercent))
        ? Math.max(
            0,
            Math.min(100, Number(shopUser.operationalSupportRatePercent)),
          )
        : 10;

    const allEntries = calculateRepresentativeCommissionEntries({
      shopId: shopUserId,
      assignments: {
        shopIntroductionRepresentativeCode:
          shopUser.shopIntroductionRepresentativeCode,
        partnerDevelopmentRepresentativeCode: livePartnerIntroCode,
        partnerDevelopmentCommissionPaid: false,
        partnerDevelopmentEligible: !!partnerDevelopment,
        partnerDevelopmentRatePercent: foRates.partnerDevelopmentRate,
        shopIntroductionFirstOrderRatePercent: foRates.shopIntroductionRate,
      },
      recipients: {
        shopIntroduction,
        partnerDevelopment,
        operationalSupport,
      },
      monetary,
      isFirstSuccessfulOrder: false,
      defaultShopIntroductionRatePercent: foRates.shopIntroductionRate,
      operationalSupportRatePercent,
    });

    const existingTypes = new Set(
      (order.commissions || []).map((c) =>
        String(c.earningType || '')
          .replace(/\s*\(partial[^)]*\)\s*$/i, '')
          .trim(),
      ),
    );

    const toAppend = allEntries.filter((entry) => {
      const type = String(entry.earningType || '').trim();
      if (existingTypes.has(type)) return false;
      if (earningType === 'Operational Support') {
        return type === 'Operational Support';
      }
      // Shop Introduction assignment may also add Partner Development under
      // existing rules when that type is not already on the order.
      return type === 'Shop Introduction' || type === 'Partner Development';
    });

    if (!toAppend.length) return false;

    order.commissions = [
      ...(order.commissions || []),
      ...toAppend.map((entry) => ({
        ...entry,
        status: 'pending' as const,
      })),
    ];
    order.markModified('commissions');
    await order.save();
    await this.invalidateOrderReadCaches();
    return true;
  }

  /** Queue Stripe→Wise transfer using commissions already saved on the order. */
  private queuePaidOrderCommissionTransfer(
    orderId: string,
    context?: {
      stripeAccountKey?: StripeAccountKey;
      stripePaymentId?: string;
    },
  ): void {
    void this.orderCommissionTransferService
      .enqueueFromPaidOrder(orderId, context)
      .catch((err) =>
        this.logger.error(
          `Failed to queue Stripe→Wise commission transfer for order ${orderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
  }

  /**
   * Idempotent paid-order emails + in-app notification.
   * Customer email: shop user account email, falling back to shipping address email.
   */
  async sendPaidOrderNotificationsIfNeeded(
    orderId: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    const order = await this.orderModel
      .findById(orderId)
      .populate(
        'user',
        'firstName lastName email role partnerCode country hubPartnerCode referredByPartnerCode additionalEmail shopName companyName',
      )
      .exec();
    if (!order || order.status !== OrderStatus.PAID) return false;
    if (order.paidConfirmationEmailSentAt && !options?.force) return false;

    const userDoc =
      typeof order.user === 'object' && order.user !== null && '_id' in (order.user as object)
        ? (order.user as any)
        : await this.usersService.findOne(String(order.user));

    const customerEmail = this.mailService.resolveCustomerEmail(order, userDoc);
    if (!customerEmail) {
      this.logger.warn(
        `Paid order notifications skipped for ${order.orderNumber}: no customer email.`,
      );
      return false;
    }

    try {
      const notification = await this.notificationsService.create({
        type: NotificationType.ORDER_PAID,
        title: 'Order Paid',
        message: `Order ${order.orderNumber} has been paid by ${userDoc?.firstName || 'a customer'}.`,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
        },
        user: userDoc?._id,
        triggeredBy: userDoc?._id,
        link: `/orders/${order._id}`,
      });
      this.notificationsGateway.broadcastNotification(notification);
    } catch (notifErr) {
      this.logger.error(
        `Failed to create/broadcast notification for order ${order.orderNumber}`,
        notifErr,
      );
    }

    if (userDoc?.role === UserRole.CERTIFIED_SHOP) {
      await this.notifyShopOrderAlertRecipients(
        order,
        NotificationType.ORDER_PAID,
        'Shop Order Paid',
        (shopName) => `Shop "${shopName}" paid order ${order.orderNumber}.`,
      );
    }

    let invoiceBuffer: Buffer | undefined;
    try {
      invoiceBuffer = await this.generateInvoicePdf(order);
    } catch (pdfErr) {
      this.logger.error(
        `Failed to generate invoice PDF for paid order ${order.orderNumber}`,
        pdfErr,
      );
    }

    await this.mailService
      .sendNewOrderNotification(order, userDoc, invoiceBuffer)
      .catch((err) =>
        this.logger.error(
          `Failed to send sales notification for order ${order.orderNumber}`,
          err,
        ),
      );

    const customerSent = await this.mailService.sendOrderPaidCustomerConfirmation(
      order,
      userDoc,
      invoiceBuffer,
    );

    if (customerSent) {
      order.paidConfirmationEmailSentAt = new Date();
      await order.save();
      this.logger.log(
        `Paid order confirmation sent to ${customerEmail} for ${order.orderNumber}`,
      );
      return true;
    }

    return false;
  }

  /** Orders where `viewer` (Representative or Promoter) is a commission recipient. */
  async getCommissionOrders(viewer: UserDocument): Promise<Order[]> {
    return this.cache.wrap(
      CacheKeys.ordersCommission(String(viewer._id)),
      CacheTtl.ordersCommission,
      () => this.getCommissionOrdersFresh(viewer),
    );
  }

  private async getCommissionOrdersFresh(
    viewer: UserDocument,
  ): Promise<Order[]> {
    const partnerCode = viewer.partnerCode?.trim();
    if (
      !partnerCode ||
      (viewer.role !== UserRole.MASTER_PARTNER &&
        viewer.role !== UserRole.REGIONAL_PARTNER)
    ) {
      return [];
    }

    // Exact match variants (avoids slow case-insensitive regex on every load).
    const codeVariants = Array.from(
      new Set([partnerCode, partnerCode.toUpperCase(), partnerCode.toLowerCase()]),
    );

    const orders = await this.orderModel
      .find({
        'commissions.recipientPartnerCode': { $in: codeVariants },
        ...registrationOrderExclusionFilter(),
      } as any)
      .populate(
        'user',
        'firstName lastName email shopName role couponCode partnerCode referredByPartnerCode shopIntroductionRepresentativeCode city country',
      )
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return orders.map((order: any) => ({
      ...order,
      // Keep the full commission split so viewers can see sibling First Order lines
      // (e.g. Shop Intro 5% + Partner Dev 5%).
      commissions: order.commissions || [],
    }));
  }

  /**
   * Repair: for each shop that still owes `parentCode` a Partner Development
   * commission (as PD parent), OR shops introduced by `parentCode` that still
   * need the first-order split — pay / split on that shop's earliest
   * successful (non-registration) order.
   * Works for both Representative and Promoter FO parents (shared stamp fields).
   */
  private async repairPartnerDevelopmentCommissionsForNetworkParent(
    parentCode: string,
    parentRole: UserRole,
  ): Promise<void> {
    if (parentRole === UserRole.MASTER_PARTNER) {
      await this.usersService.ensurePartnerDevelopmentNetworkForRepresentative(
        parentCode,
      );
    } else if (parentRole === UserRole.REGIONAL_PARTNER) {
      await this.usersService.ensurePartnerDevelopmentNetworkForPromoter(
        parentCode,
      );
    } else {
      return;
    }

    const pendingShops =
      await this.usersService.findShopsPendingPartnerDevelopment(parentCode);

    const shopIds = new Set(pendingShops.map((shop) => String(shop._id)));

    // Also include shops introduced by this parent that still need PD split
    // (covers child loading commissions and triggering parent PD repair).
    const introShops =
      await this.usersService.findShopsByIntroductionRep(parentCode);
    for (const shop of introShops) {
      if (shop.partnerDevelopmentCommissionPaid === true) continue;
      shopIds.add(String(shop._id));
    }

    for (const shopId of shopIds) {
      const shop = await this.usersService.findOne(shopId);
      // Pre-Add-to-Network shops are not FO Partner Development eligible.
      if (!shop || shop.partnerDevelopmentEligible !== true) {
        continue;
      }

      const earliestOrder = await this.orderModel
        .findOne({
          user: shopId,
          status: {
            $in: [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED],
          },
          ...registrationOrderExclusionFilter(),
        } as any)
        .sort({ createdAt: 1 })
        .select('_id')
        .lean();

      if (earliestOrder) {
        await this.repairPartnerDevelopmentCommission(
          String(earliestOrder._id),
          shopId,
        );
      }
    }
  }
  /**
   * When Partner Development exists, Shop Introduction must not remain at the
   * unlinked default (20%). FO pool model: child keeps (pool − parent).
   * Legacy repair without shop rates: defaults to 10% pool / 5% parent → child 5%.
   */
  private async normalizeFirstOrderSplitOnOrder(order: any): Promise<boolean> {
    if (!order?.commissions?.length) return false;

    const hasPartnerDevelopment = order.commissions.some(
      (entry: { earningType?: string }) =>
        entry.earningType === 'Partner Development',
    );
    if (!hasPartnerDevelopment) return false;

    const monetary = resolveCommissionOrderAmounts(order);
    const twentyPercent = roundMoney(monetary.convertedUsdAmount * 0.2);
    const defaultSplit = resolveFirstOrderPoolSplit();
    const foSiPercent = defaultSplit.childKeepPercent;
    const foSiAmount = roundMoney(
      monetary.convertedUsdAmount * (foSiPercent / 100),
    );
    if (!(foSiAmount >= 0)) return false;

    let changed = false;
    for (const entry of order.commissions) {
      if (entry.earningType === 'Partner Development') continue;

      const pct = Number(entry.percentage);
      const amt = Number(entry.amount) || 0;
      const isShopIntro =
        entry.earningType === 'Shop Introduction' ||
        (!entry.earningType &&
          entry.recipientRole === UserRole.MASTER_PARTNER &&
          (pct === 20 || Math.abs(amt - twentyPercent) < 0.05));

      if (!isShopIntro) continue;
      // Only rewrite clearly-wrong unlinked 20% SI when PD is already present.
      if (!(pct === 20 || Math.abs(amt - twentyPercent) < 0.05)) continue;

      entry.earningType = 'Shop Introduction';
      entry.percentage = foSiPercent;
      entry.amount = foSiAmount;
      changed = true;
    }

    if (!changed) return false;

    order.markModified('commissions');
    await order.save();

    console.log(
      `[Commission] Normalized FO split on ${order.orderNumber || order._id}: Shop Intro → ${foSiPercent}% ($${foSiAmount}) with Partner Development present`,
    );
    return true;
  }

  private shrinkShopIntroToFivePercent(order: any, monetary: {
    convertedUsdAmount: number;
  }): void {
    this.shrinkShopIntroToPercent(order, monetary, 5);
  }

  private shrinkShopIntroToPercent(
    order: any,
    monetary: { convertedUsdAmount: number },
    shopIntroPercent: number,
  ): void {
    // Child Rep FO can be any admin-configured % (e.g. 50), not capped at 10.
    const introPercent = normalizeShopIntroductionFirstOrderRatePercent(
      shopIntroPercent,
    );
    const introAmount = roundMoney(
      monetary.convertedUsdAmount * (introPercent / 100),
    );
    const tenPercent = roundMoney(monetary.convertedUsdAmount * 0.1);

    for (const entry of order.commissions || []) {
      if (entry.earningType === 'Partner Development') continue;

      const pct = Number(entry.percentage);
      const amt = Number(entry.amount) || 0;
      const isShopIntro =
        entry.earningType === 'Shop Introduction' ||
        (!entry.earningType &&
          (pct === 10 || Math.abs(amt - tenPercent) < 0.05));

      if (!isShopIntro) continue;
      if (
        pct === introPercent &&
        Math.abs(amt - introAmount) < 0.02
      ) {
        continue;
      }

      entry.earningType = 'Shop Introduction';
      entry.percentage = introPercent;
      entry.amount = introAmount;
    }

    if (typeof order.markModified === 'function') {
      order.markModified('commissions');
    }
  }

  /**
   * Resolve Shop Intro / Partner Intro % for a shop order.
   *
   * Shop Intro: shop stamp → Shop Intro user customCommissionRate → default 10%
   * Partner Intro: Shop Intro user partnerIntroRatePercent → default 5%
   *   (never use Shop Intro % for Partner Intro — that caused 10% PI bugs)
   */
  private resolveCommissionRatesForShop(
    shopUser: {
      shopIntroductionFirstOrderRatePercent?: number;
      partnerDevelopmentRatePercent?: number;
    },
    shopIntroUser?: {
      role?: string;
      customCommissionRate?: number | null;
      partnerIntroRatePercent?: number | null;
    } | null,
  ): { shopIntroductionRate: number; partnerDevelopmentRate: number } {
    const defaults = getDefaultFirstOrderCommissionRates(shopIntroUser?.role);

    const userSi =
      shopIntroUser != null
        ? resolveCommissionRatePercent(
            shopIntroUser.role || 'master_partner',
            shopIntroUser.customCommissionRate,
          )
        : defaults.shopIntroductionRate;

    // Partner Intro rate ONLY from Shop Intro user's partnerIntroRatePercent (or 5%).
    // Do not use shop.partnerDevelopmentRatePercent stamps that may have been
    // wrongly copied from Shop Intro 10%.
    const partnerDevelopmentRate =
      shopIntroUser?.partnerIntroRatePercent != null &&
      !Number.isNaN(Number(shopIntroUser.partnerIntroRatePercent))
        ? Math.max(
            0,
            Math.min(100, Number(shopIntroUser.partnerIntroRatePercent)),
          )
        : defaults.partnerDevelopmentRate;

    const shopSi = shopUser.shopIntroductionFirstOrderRatePercent;

    // Honor explicit per-shop Introduction Partner % (including 20% admin overrides).
    const shopIntroductionRate =
      shopSi != null && !Number.isNaN(Number(shopSi))
        ? Math.max(0, Math.min(100, Number(shopSi)))
        : userSi;

    return { shopIntroductionRate, partnerDevelopmentRate };
  }

  /** @deprecated Alias — prefer resolveCommissionRatesForShop. */
  private resolveLockedFirstOrderRates(
    shopUser: {
      shopIntroductionFirstOrderRatePercent?: number;
      partnerDevelopmentRatePercent?: number;
    },
    role?: string,
  ): { shopIntroductionRate: number; partnerDevelopmentRate: number } {
    return this.resolveCommissionRatesForShop(shopUser, { role });
  }

  /**
   * Repair commission lines already written at the legacy 20% Shop Intro rate
   * back to the current FO default (10%), without pulling live shop stamps.
   */
  private normalizeLegacyShopIntroRateOnOrder(
    order: any,
    monetary: { convertedUsdAmount: number },
    shopUser?: { shopIntroductionFirstOrderRatePercent?: number | null },
  ): boolean {
    if (!order?.commissions?.length) return false;

    // When Admin set a per-shop Introduction Partner %, never auto-downgrade 20→10.
    if (
      shopUser?.shopIntroductionFirstOrderRatePercent != null &&
      !Number.isNaN(Number(shopUser.shopIntroductionFirstOrderRatePercent))
    ) {
      return false;
    }

    const foSiPercent = getDefaultFirstOrderCommissionRates().shopIntroductionRate;
    const foSiAmount = roundMoney(
      monetary.convertedUsdAmount * (foSiPercent / 100),
    );
    const twentyPercent = roundMoney(monetary.convertedUsdAmount * 0.2);

    let changed = false;
    for (const entry of order.commissions) {
      if (entry.earningType === 'Partner Development') continue;
      if (entry.earningType === 'Operational Support') continue;

      const pct = Number(entry.percentage);
      const amt = Number(entry.amount) || 0;
      const isShopIntro =
        entry.earningType === 'Shop Introduction' ||
        (!entry.earningType &&
          (pct === 20 || Math.abs(amt - twentyPercent) < 0.05));

      if (!isShopIntro) continue;
      if (!(pct === 20 || Math.abs(amt - twentyPercent) < 0.05)) continue;

      entry.earningType = 'Shop Introduction';
      entry.percentage = foSiPercent;
      entry.amount = foSiAmount;
      changed = true;
    }

    if (changed && typeof order.markModified === 'function') {
      order.markModified('commissions');
      console.log(
        `[Commission] Repaired legacy 20% Shop Intro on ${order.orderNumber || order._id} → ${foSiPercent}%`,
      );
    }
    return changed;
  }

  /**
   * Sync commission lines to live Shop Intro / Partner Intro rates (% of order $).
   * Used only by explicit repair flows — not on normal SHIPPED status updates
   * (those must keep rates locked at order creation).
   */
  private syncFirstOrderCommissionRatesOnOrder(
    order: any,
    shopUser: {
      partnerDevelopmentEligible?: boolean;
      partnerDevelopmentCommissionPaid?: boolean;
      shopIntroductionFirstOrderRatePercent?: number;
      partnerDevelopmentRatePercent?: number;
      operationalSupportRatePercent?: number;
    },
    monetary: { convertedUsdAmount: number },
  ): boolean {
    if (!order?.commissions?.length) return false;

    const foRates = this.resolveLockedFirstOrderRates(shopUser);
    const split = {
      childKeepPercent: foRates.shopIntroductionRate,
      parentPercent: foRates.partnerDevelopmentRate,
    };

    const shopIntroAmount = roundMoney(
      monetary.convertedUsdAmount * (split.childKeepPercent / 100),
    );
    const pdAmount = roundMoney(
      resolvePartnerDevelopmentAmountFromChildCommission({
        orderUsdAmount: monetary.convertedUsdAmount,
        parentPartnerDevelopmentPercent: split.parentPercent,
      }),
    );

    let changed = false;
    for (const entry of order.commissions) {
      if (entry.earningType === 'Partner Development') {
        if (
          Number(entry.percentage) !== split.parentPercent ||
          Math.abs(Number(entry.amount) - pdAmount) >= 0.02
        ) {
          entry.percentage = split.parentPercent;
          entry.amount = pdAmount;
          changed = true;
        }
        continue;
      }

      if (entry.earningType === 'Operational Support') {
        const osPct =
          shopUser.operationalSupportRatePercent != null &&
          !Number.isNaN(Number(shopUser.operationalSupportRatePercent))
            ? Math.max(
                0,
                Math.min(100, Number(shopUser.operationalSupportRatePercent)),
              )
            : 10;
        const osAmount = roundMoney(
          monetary.convertedUsdAmount * (osPct / 100),
        );
        if (
          Number(entry.percentage) !== osPct ||
          Math.abs(Number(entry.amount) - osAmount) >= 0.02
        ) {
          entry.percentage = osPct;
          entry.amount = osAmount;
          changed = true;
        }
        continue;
      }

      const pct = Number(entry.percentage);
      const amt = Number(entry.amount) || 0;
      const isShopIntro =
        entry.earningType === 'Shop Introduction' ||
        (!entry.earningType && entry.recipientRole === UserRole.MASTER_PARTNER);

      if (!isShopIntro) continue;
      if (
        pct === split.childKeepPercent &&
        Math.abs(amt - shopIntroAmount) < 0.02
      ) {
        continue;
      }

      entry.earningType = 'Shop Introduction';
      entry.percentage = split.childKeepPercent;
      entry.amount = shopIntroAmount;
      changed = true;
    }

    if (changed && typeof order.markModified === 'function') {
      order.markModified('commissions');
    }
    return changed;
  }

  private async repairPartnerDevelopmentCommission(
    orderId: string,
    shopUserId: string,
  ): Promise<void> {
    let shopUser = await this.usersService.findOne(shopUserId);
    if (!shopUser || shopUser.role !== UserRole.CERTIFIED_SHOP) return;

    // Only shops created after Add-to-Network get FO Partner Development.
    if (shopUser.partnerDevelopmentEligible !== true) {
      return;
    }

    shopUser = await this.usersService.refreshShopFirstOrderRatesIfUnpaid(
      shopUser,
    );

    const order = await this.orderModel.findById(orderId);
    if (!order) return;

    // Empty commissions (e.g. wiped by a prior bug) — rebuild full FO split.
    if (!order.commissions?.length) {
      await this.applyOrderCommissions(orderId, order.status as OrderStatus);
      return;
    }

    const hasPartnerDevelopment = order.commissions.some(
      (entry) => entry.earningType === 'Partner Development',
    );

    // Already split — sync to live FO rates (or legacy 20% → FO repair).
    if (hasPartnerDevelopment) {
      const monetary = resolveCommissionOrderAmounts(order);
      const ratesSynced = this.syncFirstOrderCommissionRatesOnOrder(
        order,
        shopUser,
        monetary,
      );
      if (ratesSynced) {
        await order.save();
      } else {
        await this.normalizeFirstOrderSplitOnOrder(order);
      }
      return;
    }

    // Rebuild full stamp-based commission split (Partner Intro every order).
    await this.applyOrderCommissions(orderId, order.status as OrderStatus);
  }

  /**
   * Scan commission orders for this Rep/Promoter and shrink any FO Shop Intro
   * still inflated when Partner Development is already present on the same order.
   */
  private async repairInflatedShopIntroSplitsForRep(
    repCode: string,
  ): Promise<void> {
    const code = repCode?.trim();
    if (!code) return;

    // Any order involving this Rep that already has a PD line (including
    // sibling PD when this Rep is Shop Intro) — normalize SI to 5%.
    const orders = await this.orderModel
      .find({
        $and: [
          registrationOrderExclusionFilter(),
          {
            commissions: {
              $elemMatch: { earningType: 'Partner Development' },
            },
          },
          {
            'commissions.recipientPartnerCode': code,
          },
        ],
      } as any)
      .exec();

    for (const order of orders) {
      await this.normalizeFirstOrderSplitOnOrder(order);
    }
  }

  async getOrderActivity(orderId: string) {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new NotFoundException('Order not found');
    }
    const exists = await this.orderModel.exists({ _id: orderId });
    if (!exists) throw new NotFoundException('Order not found');
    return this.orderActivityModel
      .find({ orderId: new Types.ObjectId(orderId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();
  }

  /**
   * Records who changed an order. Logging failures must not affect the order.
   */
  private async recordOrderActorActivity(input: {
    order: { _id: unknown; orderNumber?: string };
    actor?: UserDocument;
    action: 'status_change' | 'delete';
    previousStatus?: string;
    newStatus?: string;
    trackingId?: string;
    shippingCompany?: string;
  }): Promise<void> {
    try {
      const actorId = input.actor?._id?.toString?.();
      if (!actorId) return;

      const actorName = [input.actor?.firstName, input.actor?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      const orderId = String(input.order._id);
      const portal =
        input.actor?.role === UserRole.ADMIN
          ? 'admin'
          : input.actor?.role === UserRole.CERTIFIED_SHOP
            ? 'shop'
            : 'partner';

      await this.orderActivityModel.create({
        orderId: new Types.ObjectId(orderId),
        orderNumber: input.order.orderNumber,
        action: input.action,
        actorId: new Types.ObjectId(actorId),
        actorName: actorName || undefined,
        actorEmail: input.actor?.email,
        actorRole: input.actor?.role,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        trackingId: input.trackingId || undefined,
        shippingCompany: input.shippingCompany || undefined,
      });

      await this.userActivityService.log({
        userId: actorId,
        actorId,
        action: UserActivityAction.ORDER_UPDATE,
        portal,
        country: input.actor?.country,
        metadata: {
          method: input.action === 'delete' ? 'order_delete' : 'order_status',
          orderId,
          orderNumber: input.order.orderNumber,
          previousStatus: input.previousStatus,
          newStatus: input.newStatus,
          trackingId: input.trackingId || undefined,
          shippingCompany: input.shippingCompany || undefined,
          actorEmail: input.actor?.email,
          actorRole: input.actor?.role,
          actorName: actorName || undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write order activity log: ${(err as Error)?.message}`,
      );
    }
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    trackingId?: string,
    shippingCompany?: string,
    actor?: UserDocument,
  ): Promise<Order> {
    const order = await this.orderModel.findById(id).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    // Hub and acting-Hub Distributor may update status only for orders in
    // their network (Distributor: Parent Link shops only). Representative is view-only.
    if (
      actor?.role === UserRole.PARTNER ||
      actor?.role === UserRole.DISTRIBUTOR
    ) {
      const orderUserId =
        typeof order.user === 'object' && order.user !== null && '_id' in (order.user as object)
          ? String((order.user as any)._id)
          : String(order.user);
      const inNetwork = await this.usersService.isUserInViewerNetwork(
        actor,
        orderUserId,
      );
      if (!inNetwork) {
        throw new ForbiddenException(
          'You can only update orders from users in your network',
        );
      }

      const shop = (order.user || {}) as {
        hubPartnerCode?: string;
        country?: string;
        role?: string;
        parentLinkAssignedAt?: Date;
        previousParentPartnerCode?: string;
      };
      const actingCode = await this.usersService.resolveActingParentForOrder({
        actingParentPartnerCode: (order as any).actingParentPartnerCode,
        createdAt: (order as any).createdAt,
        user: shop,
      });
      const parentRoles = await this.usersService.getShopParentLinkRolesByCode([
        actingCode,
      ]);
      const canManage = this.usersService.canViewerManageShopOrder(
        actor,
        {
          actingParentPartnerCode: actingCode,
          hubPartnerCode: shop.hubPartnerCode,
        },
        actingCode ? parentRoles.get(actingCode) : undefined,
        shop.role,
      );
      if (!canManage) {
        const actingRole = actingCode ? parentRoles.get(actingCode) : undefined;
        throw new ForbiddenException(
          actor.role === UserRole.PARTNER
            ? actingRole === UserRole.DISTRIBUTOR
              ? 'This order was created after Parent Link moved to a Distributor. Hub access is view-only.'
              : 'You can only update orders created under your Hub.'
            : 'You can only update orders created after this shop was assigned to you as Parent Link.',
        );
      }
    }

    if (status === OrderStatus.SHIPPED) {
      if (!trackingId?.trim()) {
        throw new BadRequestException(
          'Tracking ID is required when marking an order as shipped',
        );
      }
    }

    const oldStatus = order.status;
    order.status = status;
    if (trackingId) {
      order.trackingId = trackingId;
    }
    if (shippingCompany) {
      order.shippingCompany = shippingCompany;
    }

    if (status === OrderStatus.SHIPPED && oldStatus !== OrderStatus.SHIPPED) {
      order.shippedAt = new Date();
    }

    if (status === OrderStatus.CANCELLED && oldStatus !== OrderStatus.CANCELLED) {
      if (oldStatus === OrderStatus.PAID && order.stripeSessionId) {
        try {
          const stripeInstance = this.getStripeForAccountKey(
            this.resolveOrderStripeAccountKey(
              order.shippingAddress?.country,
              (order.user as any)?.country,
            ),
          );

          const session = await stripeInstance.checkout.sessions.retrieve(order.stripeSessionId);
          if (session.payment_intent) {
            await stripeInstance.refunds.create({
              payment_intent: session.payment_intent as string,
            });
            console.log(`[Order Cancelled] Refund issued for order ${order.orderNumber}`);
          } else {
            console.warn(`[Order Cancelled] No payment_intent found for session ${order.stripeSessionId}`);
          }
        } catch (error) {
          console.error(`[Order Cancelled] Refund failed for order ${order.orderNumber}:`, error);
        }
      }

      // Send cancellation emails
      if (order.user) {
        if (!order.cancellationReason) {
          order.cancellationReason =
            'This order was cancelled by an administrator.';
        }
        await this.mailService
          .sendOrderCancelledCustomerNotification(order, order.user, {
            wasPaid: oldStatus === OrderStatus.PAID,
            cancellationReason: order.cancellationReason,
          })
          .catch((err) => {
            console.error('Failed to send order cancelled email to customer', err);
          });
        await this.mailService.sendOrderCancelledAdminNotification(order, order.user).catch(err => {
          console.error('Failed to send order cancelled email to admin', err);
        });
      }
    }

    if (status === OrderStatus.PAID && oldStatus !== OrderStatus.PAID) {
      // Claim the PAID transition atomically so a Stripe webhook arriving at the
      // same time cannot also process this payment (coupon usage, inventory, emails).
      const claimed = await this.orderModel.updateOne(
        { _id: order._id, status: oldStatus },
        { $set: { status: OrderStatus.PAID } },
      );
      if (!claimed.modifiedCount) {
        throw new ConflictException(
          'Order status changed meanwhile (it may have just been paid via Stripe). Please refresh and try again.',
        );
      }
    }

    const updatedOrder = await order.save();

    if (
      status === OrderStatus.SHIPPED &&
      oldStatus !== OrderStatus.SHIPPED &&
      order.user
    ) {
      await this.mailService
        .sendOrderShippedCustomerNotification(updatedOrder, order.user)
        .catch((err) => {
          console.error('Failed to send order shipped email to customer', err);
        });
    }

    if (
      status === OrderStatus.PENDING ||
      status === OrderStatus.PENDING_PAYMENT ||
      status === OrderStatus.PAID ||
      status === OrderStatus.SHIPPED ||
      status === OrderStatus.DELIVERED
    ) {
      await this.applyOrderCommissions(updatedOrder._id.toString(), status);
    }

    if (
      status === OrderStatus.PAID &&
      oldStatus !== OrderStatus.PAID &&
      updatedOrder.stripeSessionId
    ) {
      void this.sendPaidOrderNotificationsIfNeeded(updatedOrder._id.toString());
      this.queuePaidOrderCommissionTransfer(updatedOrder._id.toString());
    }

    if (status === OrderStatus.SHIPPED) {
      // Always re-sync on SHIPPED so legacy rate repairs (e.g. 20% → 10%)
      // also update existing PENDING_HOLD commission records.
      const shippedAt = updatedOrder.shippedAt || new Date();
      await this.commissionsService
        .syncFromShippedOrder(updatedOrder._id.toString(), shippedAt)
        .catch((err) =>
          this.logger.error('Failed to sync commission records on ship', err),
        );
    }

    if (status === OrderStatus.CANCELLED && oldStatus !== OrderStatus.CANCELLED) {
      await this.commissionsService
        .cancelCommissionsForOrder(updatedOrder._id.toString())
        .catch((err) =>
          this.logger.error('Failed to cancel commission records', err),
        );
      await this.restoreProductInventoryForOrder(updatedOrder._id);
    }

    if (status === OrderStatus.FAILED && oldStatus !== OrderStatus.FAILED) {
      await this.restoreProductInventoryForOrder(updatedOrder._id);
    }

    if (status === OrderStatus.PAID && oldStatus !== OrderStatus.PAID) {
      await this.recordCouponUsageIfApplicable(updatedOrder.couponCode);
      await this.deductProductInventoryForOrder(updatedOrder._id);
      // Full payment received — clear remaining balance tracking.
      updatedOrder.amountPaid = updatedOrder.totalAmount;
      await updatedOrder.save();
      if (updatedOrder.includesCertificationKit) {
        await this.applyCertificationKitPurchaseBenefits(updatedOrder);
      }
    }

    if (actor && oldStatus !== status) {
      await this.recordOrderActorActivity({
        order: updatedOrder,
        actor,
        action: 'status_change',
        previousStatus: oldStatus,
        newStatus: status,
        trackingId: updatedOrder.trackingId,
        shippingCompany: updatedOrder.shippingCompany,
      });
    }

    await this.invalidateOrderReadCaches();

    return actor
      ? this.withOrderManagementFlag(
          (updatedOrder as any).toObject
            ? (updatedOrder as any).toObject()
            : updatedOrder,
          actor,
        )
      : updatedOrder;
  }

  private isUnpaidOrderRequestStatus(status?: string): boolean {
    const value = (status || '').toUpperCase();
    return (
      value === OrderStatus.PENDING || value === OrderStatus.PENDING_PAYMENT
    );
  }

  /**
   * Hub (partner) may manage only orders they already own via Parent Link.
   * Admin is always allowed. Distributor and other network roles are not.
   */
  private async assertHubOrAdminCanManageOrderRequest(
    order: OrderDocument,
    actor: UserDocument,
  ): Promise<void> {
    if (!actor) {
      throw new ForbiddenException('Not authorized');
    }
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    if (actor.role !== UserRole.PARTNER) {
      throw new ForbiddenException(
        'Only Hub and Admin can manage shipping, invoices, and item updates for orders',
      );
    }

    const orderUserId =
      typeof order.user === 'object' &&
      order.user !== null &&
      '_id' in (order.user as object)
        ? String((order.user as any)._id)
        : String(order.user);
    const inNetwork = await this.usersService.isUserInViewerNetwork(
      actor,
      orderUserId,
    );
    if (!inNetwork) {
      throw new ForbiddenException(
        'You can only update orders from users in your network',
      );
    }

    const shop = (order.user || {}) as {
      hubPartnerCode?: string;
      country?: string;
      role?: string;
      parentLinkAssignedAt?: Date;
      previousParentPartnerCode?: string;
    };
    const actingCode = await this.usersService.resolveActingParentForOrder({
      actingParentPartnerCode: (order as any).actingParentPartnerCode,
      createdAt: (order as any).createdAt,
      user: shop,
    });
    const parentRoles = await this.usersService.getShopParentLinkRolesByCode([
      actingCode,
    ]);
    const canManage = this.usersService.canViewerManageShopOrder(
      actor,
      {
        actingParentPartnerCode: actingCode,
        hubPartnerCode: shop.hubPartnerCode,
      },
      actingCode ? parentRoles.get(actingCode) : undefined,
      shop.role,
    );
    if (!canManage) {
      throw new ForbiddenException(
        'You can only add shipping and send invoices for orders created under your Hub.',
      );
    }
  }

  private async returnManagedOrder(
    order: OrderDocument,
    actor: UserDocument,
  ) {
    const plain = (order as any).toObject ? (order as any).toObject() : order;
    const enriched = await this.enrichOrderDetails(plain);
    return this.withOrderManagementFlag(enriched, actor);
  }

  /**
   * Quote FedEx rates from the order user's Hub address → order shipping address.
   */
  /** FedEx origin for a shop: its territory Hub's address. */
  private async resolveFedexHubOrigin(
    shop: UserDocument,
    originZipCode?: string,
  ): Promise<{ hub: UserDocument; shipper: FedExAddressInput }> {
    const hubCode =
      await this.usersService.resolveTerritoryHubPartnerCodeForShop({
        hubPartnerCode: (shop as any).hubPartnerCode,
        country: shop.country,
      });
    const hub = await this.usersService.findByPartnerCode(hubCode);
    if (!hub) {
      throw new BadRequestException(
        `Hub account not found for partner code ${hubCode}.`,
      );
    }

    const zipCode = originZipCode || hub.zipCode;
    // Hubs often have only a ZIP; FedEx needs the US/CA state, so look it up.
    let state = hub.state;
    if (!state && zipCode) {
      const lookup = await this.geoService.validatePostcode(
        zipCode,
        hub.country,
      );
      state = lookup.stateCode || lookup.state;
    }

    const shipper = this.fedexService.buildAddress(
      {
        streetAddress: hub.streetAddress,
        address: hub.address,
        city: hub.city,
        state,
        zipCode,
        country: hub.country,
      },
      `Hub origin (${hub.partnerCode || hubCode})`,
    );
    return { hub, shipper };
  }

  /** Total cart weight in LB from per-size catalog weights (default per unit when unset). */
  private async getCartShippingWeightLb(
    items: Array<{
      product: string;
      name?: string;
      size: string;
      quantity: number;
      orderType?: string;
    }>,
  ): Promise<number> {
    const defaultUnitWeight =
      Number(process.env.FEDEX_DEFAULT_UNIT_WEIGHT_LB) || 1;
    const weights = await this.productsService.getSizeWeightsByProductIds(
      items.map((item) => String(item.product)),
    );
    let total = 0;
    for (const item of items) {
      const unitWeight =
        weights.get(String(item.product))?.get(String(item.size)) ||
        defaultUnitWeight;
      const units =
        normalizeOrderItemType(item.orderType) === 'case'
          ? getUnitsPerCaseForProduct(item.name)
          : 1;
      total += unitWeight * units * Math.max(1, Number(item.quantity) || 1);
    }
    return Math.min(150, Math.max(0.1, Number(total.toFixed(2))));
  }

  /**
   * Checkout shipping. FedEx destinations (Canada, Hawaii, Alaska, Puerto Rico)
   * pay the cheapest FedEx rate from the shop's Hub with no free-shipping
   * threshold, falling back to the flat fee if FedEx cannot quote. Everywhere
   * else keeps the flat rule (free at 500).
   */
  async quoteCheckoutShipping(params: {
    user: UserDocument | null | undefined;
    items: Array<{
      product: string;
      name: string;
      size: string;
      quantity: number;
      orderType?: string;
      price: number;
    }>;
    shippingAddress?: Partial<CreateOrderDto['shippingAddress']>;
    itemsSubtotal: number;
    orderCurrency: string;
    rateToUsd: number;
    isPickup?: boolean;
    includesCertificationKit?: boolean;
  }): Promise<{
    shippingFee: number;
    currency: string;
    source: 'free' | 'flat' | 'fedex';
    serviceName?: string;
    transitDays?: number | null;
    error?: string;
  }> {
    const currency = String(params.orderCurrency || 'USD').toUpperCase();
    const shippingCountry =
      params.shippingAddress?.country || params.user?.country || '';
    const shippingState =
      params.shippingAddress?.state ??
      (params.shippingAddress?.country ? '' : params.user?.state);

    if (params.includesCertificationKit || params.isPickup) {
      return { shippingFee: 0, currency, source: 'free' };
    }

    const fedexDestination = isFedexShippingDestination(
      shippingCountry,
      shippingState,
    );
    // FedEx destinations have no free-shipping threshold; their fallback is the flat fee.
    const flatFee = calculateShippingFee(
      shippingCountry,
      fedexDestination ? 0 : params.itemsSubtotal,
      { rateToUsd: params.rateToUsd, currency },
    );
    if (!fedexDestination || !params.user) {
      return flatFee > 0
        ? { shippingFee: flatFee, currency, source: 'flat' }
        : { shippingFee: 0, currency, source: 'free' };
    }

    try {
      const shipTo = params.shippingAddress;
      if (!shipTo) {
        throw new BadRequestException('Shipping address is required.');
      }
      const { shipper } = await this.resolveFedexHubOrigin(params.user);
      // FedEx rates Puerto Rico as its own country, also when entered as a US state.
      const toPuertoRico = isPuertoRicoDestination(
        shipTo.country,
        shipTo.state,
      );
      const recipient = this.fedexService.buildAddress(
        {
          address: shipTo.address,
          address2: shipTo.address2,
          city: shipTo.city,
          state: toPuertoRico ? undefined : shipTo.state,
          zipCode: shipTo.zipCode,
          country: toPuertoRico ? 'PR' : shipTo.country,
          residential: true,
        },
        'Shipping address',
      );

      const weight = await this.getCartShippingWeightLb(params.items);
      const commodities = params.items.map((item) => ({
        description: String(item.name || 'Product').slice(0, 450),
        quantity: Math.max(1, Number(item.quantity) || 1),
        unitPrice: Math.max(0.01, Number(item.price) || 0.01),
        countryOfManufacture: shipper.countryCode,
      }));

      const rates = await this.fedexService.getRateQuotes({
        shipper,
        recipient,
        weight,
        weightUnits: 'LB',
        preferredCurrency: currency,
        customsValue: Math.max(1, params.itemsSubtotal),
        commodities,
      });
      const cheapest = rates[0];
      if (!cheapest) {
        throw new BadRequestException('FedEx returned no rates for this route.');
      }

      let fee = Number(cheapest.totalNetCharge) || 0;
      const quoteCurrency = String(cheapest.currency || currency).toUpperCase();
      if (quoteCurrency !== currency) {
        const quoteRateToUsd =
          await this.exchangeRatesService.getRateToBase(quoteCurrency);
        fee = usdToLocalAmount(fee * quoteRateToUsd, params.rateToUsd);
      }

      return {
        shippingFee: Math.round(fee * 100) / 100,
        currency,
        source: 'fedex',
        serviceName: cheapest.serviceName,
        transitDays: cheapest.transitDays ?? null,
      };
    } catch (err: any) {
      this.logger.warn(
        `[FedEx checkout] Falling back to flat shipping for user ${params.user?._id}: ${err?.message || err}`,
      );
      return {
        shippingFee: flatFee,
        currency,
        source: 'flat',
        error: err?.message ? String(err.message) : undefined,
      };
    }
  }

  /**
   * Checkout preview: same server-side shipping the checkout session will charge.
   */
  async previewCheckoutShipping(
    userId: string,
    dto: {
      items: CreateOrderDto['items'];
      shippingAddress?: Partial<CreateOrderDto['shippingAddress']>;
      isPickup?: boolean;
    },
  ) {
    const currentUser = await this.usersService.findOne(userId);
    const orderCurrency = await this.getCurrencyForUser(currentUser);
    const items = await this.repriceOrderItemsForUser(
      currentUser,
      (dto.items || []).map((item) => ({
        ...item,
        orderType: normalizeOrderItemType(item.orderType),
      })),
    );
    const kitResolved = await this.resolveCertificationKitOrderItems(
      currentUser as any,
      items,
    );
    // Kit: the free-shipping threshold uses the kit price, as checkout shows it.
    const itemsSubtotal = kitResolved.includesCertificationKit
      ? getItemsSubtotal(kitResolved.items) -
        kitResolved.kitDiscount +
        getOrderKitExtrasTotal(kitResolved.extras)
      : getItemsSubtotal(kitResolved.items);
    const rateToUsd = await this.exchangeRatesService.getRateToBase(orderCurrency);
    const quote = await this.quoteCheckoutShipping({
      user: currentUser,
      items: kitResolved.items,
      shippingAddress: dto.shippingAddress,
      itemsSubtotal,
      orderCurrency,
      rateToUsd,
      // Free pickup shipping only when the shop is allowed to pick up.
      isPickup:
        dto.isPickup === true && !!(await this.getPickupHubForUser(userId)),
      includesCertificationKit:
        kitResolved.includesCertificationKit && kitResolved.freeShipping,
    });
    // Internal FedEx errors stay in server logs.
    const { error: _error, ...publicQuote } = quote;
    return publicQuote;
  }

  async calculateFedexShippingRates(
    orderId: string,
    actor: UserDocument,
    weight: number,
    weightUnits: 'LB' | 'KG' = 'LB',
    originZipCode?: string,
    destinationZipCode?: string,
  ) {
    const order = await this.orderModel.findById(orderId).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    await this.assertHubOrAdminCanManageOrderRequest(order, actor);

    const shop = order.user as UserDocument | undefined;
    if (!shop) {
      throw new BadRequestException('Order has no associated user.');
    }

    const { hub, shipper } = await this.resolveFedexHubOrigin(
      shop,
      originZipCode,
    );

    const shipTo = order.shippingAddress;
    if (!shipTo) {
      throw new BadRequestException('Order has no shipping address.');
    }

    const recipient = this.fedexService.buildAddress(
      {
        address: shipTo.address,
        address2: shipTo.address2,
        city: shipTo.city,
        state: shipTo.state,
        zipCode: destinationZipCode || shipTo.zipCode,
        country: shipTo.country,
        residential: true,
      },
      'Order shipping address',
    );

    const preferredCurrency = String(
      order.originalCurrency || order.currency || 'USD',
    ).toUpperCase();

    const items = Array.isArray(order.items) ? order.items : [];
    const customsValue = Math.max(
      1,
      getItemsSubtotal(items) || Number(order.totalAmount) || 1,
    );
    const itemCount = Math.max(
      1,
      items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0),
    );
    const commodities = items.length
      ? items.map((item) => {
          const quantity = Math.max(1, Number(item.quantity) || 1);
          return {
            description: String(item.name || 'Product').slice(0, 450),
            quantity,
            unitPrice: Math.max(0.01, Number(item.price) || 0.01),
            weight: Math.max(0.1, weight / itemCount) * quantity,
            countryOfManufacture: shipper.countryCode,
          };
        })
      : undefined;

    const rates = await this.fedexService.getRateQuotes({
      shipper,
      recipient,
      weight,
      weightUnits,
      preferredCurrency,
      customsValue,
      commodities,
    });

    return {
      hub: {
        partnerCode: hub.partnerCode,
        name:
          [hub.firstName, hub.lastName].filter(Boolean).join(' ').trim() ||
          hub.shopName ||
          hub.companyName ||
          hub.partnerCode,
        address: {
          streetLines: shipper.streetLines,
          city: shipper.city,
          stateOrProvinceCode: shipper.stateOrProvinceCode,
          postalCode: shipper.postalCode,
          countryCode: shipper.countryCode,
        },
      },
      destination: {
        name: [shipTo.firstName, shipTo.lastName].filter(Boolean).join(' ').trim(),
        address: {
          streetLines: recipient.streetLines,
          city: recipient.city,
          stateOrProvinceCode: recipient.stateOrProvinceCode,
          postalCode: recipient.postalCode,
          countryCode: recipient.countryCode,
        },
      },
      weight,
      weightUnits,
      rates,
    };
  }

  async setOrderRequestShipping(
    orderId: string,
    shippingFeeInput: number,
    actor: UserDocument,
  ) {
    const order = await this.orderModel.findById(orderId).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    await this.assertHubOrAdminCanManageOrderRequest(order, actor);

    const shopUser =
      typeof order.user === 'object' && order.user !== null
        ? (order.user as any)
        : null;
    // Order requests + USA purchase orders: admin may edit shipping until shipped.
    const isUsaOrder = this.isUsaDestinationOrder(
      order.shippingAddress?.country,
      shopUser?.country,
    );
    if (!isOrderRequest(order) && !isUsaOrder) {
      throw new BadRequestException(
        'Shipping can only be added on order requests',
      );
    }
    if (!isOrderModifiable(order)) {
      throw new BadRequestException(
        'Shipping cannot be updated after the order is marked as shipped',
      );
    }

    const shippingFee = roundMoney(Number(shippingFeeInput));
    if (!Number.isFinite(shippingFee) || shippingFee < 0) {
      throw new BadRequestException('Enter a valid shipping amount');
    }
    if ((order as any).isPickup && shippingFee > 0) {
      throw new BadRequestException(
        'This is a pickup order — shipping charges cannot be added.',
      );
    }

    const previousTotal = Number(order.totalAmount) || 0;
    const wasPaid = String(order.status).toUpperCase() === OrderStatus.PAID;
    const existingPaid = getOrderAmountPaid(order);

    // Lock already-collected amount when amending a paid order.
    if (wasPaid && existingPaid <= 0) {
      order.amountPaid = previousTotal;
    } else if (existingPaid > 0) {
      order.amountPaid = existingPaid;
    }

    const itemsSubtotal = getItemsSubtotal(order.items);
    const discount = order.discount ?? 0;
    const kitExtrasTotal = getOrderKitExtrasTotal(order);
    const { rate: vatRate, amount: vatAmount } = calculateEuropeOrderVatAmount(
      getOrderVatTaxableBase(itemsSubtotal + kitExtrasTotal, discount),
      {
        country: order.shippingAddress?.country,
        taxId: order.shippingAddress?.taxId,
        noVatId: (order.shippingAddress as any)?.noVatId,
      },
    );
    const newTotal = Math.max(
      0,
      itemsSubtotal - discount + vatAmount + shippingFee + kitExtrasTotal,
    );
    Object.assign(order, this.buildAmountUpdateWithLockedRate(order, newTotal));
    order.shippingFee = shippingFee;
    order.vatAmount = vatAmount;
    order.vatRate = vatRate;
    order.shippingSetAt = new Date();
    order.invoiceUpdatedAt = new Date();

    const remaining = getOrderRemainingAmount(order);
    if (remaining > 0.01 && wasPaid) {
      const requiresOnlinePayment = this.requiresOnlinePaymentDestinationOrder(
        order.shippingAddress?.country,
        shopUser?.country,
      );
      order.status = requiresOnlinePayment
        ? OrderStatus.PENDING_PAYMENT
        : OrderStatus.PENDING;
    }

    const updatedOrder = await this.saveOrderWithDValueSplit(
      order,
      shopUser,
      actor._id,
    );
    return this.returnManagedOrder(updatedOrder, actor);
  }

  async sendOrderRequestInvoice(orderId: string, actor: UserDocument) {
    const order = await this.orderModel.findById(orderId).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    await this.assertHubOrAdminCanManageOrderRequest(order, actor);

    if (isRegistrationOrder(order)) {
      throw new BadRequestException('Cannot send invoice for registration orders');
    }

    const status = String(order.status || '').toUpperCase();
    if (
      status === OrderStatus.SHIPPED ||
      status === OrderStatus.DELIVERED ||
      status === OrderStatus.CANCELLED ||
      status === OrderStatus.FAILED
    ) {
      throw new BadRequestException(
        'Invoices cannot be sent for shipped, delivered, cancelled, or failed orders',
      );
    }

    const amountPaid = getOrderAmountPaid(order);
    const remaining = getOrderRemainingAmount(order);
    const isUnpaidRequest =
      isOrderRequest(order) && this.isUnpaidOrderRequestStatus(order.status);

    // Original unpaid request flow still requires shipping to be set first.
    if (isUnpaidRequest && amountPaid <= 0 && !order.shippingSetAt) {
      throw new BadRequestException(
        'Add shipping charges before sending the invoice',
      );
    }

    const userDoc =
      typeof order.user === 'object' && order.user !== null
        ? (order.user as any)
        : await this.usersService.findOne(String(order.user));

    const to = this.mailService.resolveCustomerEmail(order, userDoc);
    if (!to) {
      throw new BadRequestException(
        'This order has no customer email to send the invoice to',
      );
    }

    let invoiceBuffer: Buffer;
    try {
      invoiceBuffer = await this.generateInvoicePdf(order);
    } catch (err) {
      this.logger.error(
        `Failed to generate invoice PDF for ${order.orderNumber}`,
        (err as Error)?.stack || err,
      );
      throw new BadRequestException(
        'Failed to generate the invoice PDF. Please try again.',
      );
    }

    const payUrl =
      remaining > 0.01
        ? this.getOrderDirectPayUrl(String(order._id))
        : this.getOrderPayUrl(String(order._id), userDoc?.role);

    const dValueAttachments = await this.buildDValueSplitPdfAttachments(order);

    try {
      await this.mailService.sendOrderInvoiceEmail(
        to,
        order,
        userDoc,
        invoiceBuffer,
        {
          payUrl,
          amountPaid,
          remainingAmount: remaining,
          extraAttachments: dValueAttachments,
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to send order invoice email for ${order.orderNumber}`,
        (err as Error)?.stack || err,
      );
      throw new BadRequestException(
        'Failed to send the invoice email. Please try again.',
      );
    }

    order.invoiceSentAt = new Date();
    const updatedOrder = await order.save();
    return this.returnManagedOrder(updatedOrder, actor);
  }

  /**
   * Hub/Admin appends additional items onto the same existing order/invoice.
   * Does not create a new order. Shipping fee is unchanged.
   */
  async appendItemsToExistingOrder(
    orderId: string,
    dto: AddOrderItemsDto,
    actor: UserDocument,
  ) {
    const order = await this.orderModel.findById(orderId).populate('user');
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.assertHubOrAdminCanManageOrderRequest(order, actor);

    if (!isOrderModifiable(order)) {
      throw new BadRequestException(
        'This order cannot be modified. Items can only be added before the order is marked as shipped.',
      );
    }

    const { items: rawItems } = dto;
    if (!rawItems?.length) {
      throw new BadRequestException('At least one item is required');
    }

    if (rawItems.some((item) => isCertificationKitCartItem(item as any))) {
      throw new BadRequestException(
        'The Certification Kit Bundle cannot be added to an existing order. It must be purchased as its own checkout.',
      );
    }

    const shopUser =
      typeof order.user === 'object' && order.user !== null
        ? (order.user as any)
        : await this.usersService.findOne(String(order.user));

    // Resolve each line against the order customer's Pricing Group (not the
    // Hub/Admin catalog). Unpaid self-registered shops also get +10%.
    const newItems: Array<{
      product: string;
      name: string;
      size: string;
      quantity: number;
      orderType: ReturnType<typeof normalizeOrderItemType>;
      price: number;
      image: string;
    }> = [];
    for (const item of rawItems) {
      const quantity = Math.max(1, Number(item.quantity) || 1);
      // Shop customers only buy units. Unit/Case is for partner-network orders.
      const shopOnlyUnit =
        String(shopUser?.role || '') === UserRole.CERTIFIED_SHOP ||
        String(shopUser?.role || '') === 'certified_shop';
      const orderType = shopOnlyUnit
        ? normalizeOrderItemType('unit')
        : normalizeOrderItemType(item.orderType);
      let price = Number(item.price) || 0;
      let name = item.name;
      let image = item.image || '';
      try {
        const pricedProduct = await this.productsService.findOne(
          String(item.product),
          shopUser,
        );
        const sizeEntry = (pricedProduct?.sizes || []).find(
          (s: { size: string; price: number }) =>
            String(s.size) === String(item.size),
        );
        if (sizeEntry?.price != null) {
          // Pricing Group unit price (already includes unpaid markup when applicable).
          // Case lines use unit × units-per-case (partner network only).
          price = resolveOrderLinePrice(
            Number(sizeEntry.price) || 0,
            orderType,
            pricedProduct?.name || item.name,
          );
        }
        if (pricedProduct?.name) name = pricedProduct.name;
        if (!image) {
          image =
            pricedProduct?.shopImages?.[0] || pricedProduct?.images?.[0] || '';
        }
      } catch (err) {
        this.logger.warn(
          `Could not resolve Pricing Group price for product ${item.product} on order ${orderId}; using client price`,
          (err as Error)?.message || err,
        );
      }

      newItems.push({
        product: item.product,
        name,
        size: item.size,
        quantity,
        orderType,
        price,
        image,
      });
    }

    await this.productInventoryService.assertStockAvailableForOrder({
      items: newItems,
      user: shopUser as any,
      actingParentPartnerCode: order.actingParentPartnerCode,
    });

    const previousTotal = Number(order.totalAmount) || 0;
    const wasPaid = String(order.status).toUpperCase() === OrderStatus.PAID;
    const existingPaid = getOrderAmountPaid(order);

    // Lock already-collected amount when amending a paid order.
    if (wasPaid && existingPaid <= 0) {
      order.amountPaid = previousTotal;
    } else if (existingPaid > 0) {
      order.amountPaid = existingPaid;
    }

    // Merge into same invoice items (increase qty when product+size+type match).
    const mergedItems = [...(order.items || [])];
    for (const incoming of newItems) {
      const matchIdx = mergedItems.findIndex(
        (existing) =>
          String(existing.product) === String(incoming.product) &&
          String(existing.size) === String(incoming.size) &&
          normalizeOrderItemType(existing.orderType) === incoming.orderType,
      );
      if (matchIdx >= 0) {
        mergedItems[matchIdx].quantity =
          Number(mergedItems[matchIdx].quantity || 0) + incoming.quantity;
      } else {
        mergedItems.push(incoming as any);
      }
    }
    order.items = mergedItems as any;

    const itemsSubtotal = getItemsSubtotal(order.items);
    const shippingFee = Number(order.shippingFee) || 0;
    const discount = Number(order.discount) || 0;
    const kitExtrasTotal = getOrderKitExtrasTotal(order);
    const { rate: vatRate, amount: vatAmount } = calculateEuropeOrderVatAmount(
      getOrderVatTaxableBase(itemsSubtotal + kitExtrasTotal, discount),
      {
        country: order.shippingAddress?.country || shopUser?.country,
        taxId: order.shippingAddress?.taxId,
        noVatId: (order.shippingAddress as any)?.noVatId,
      },
    );
    const newTotal = Math.max(
      0,
      itemsSubtotal - discount + vatAmount + shippingFee + kitExtrasTotal,
    );
    Object.assign(order, this.buildAmountUpdateWithLockedRate(order, newTotal));
    order.vatAmount = vatAmount;
    order.vatRate = vatRate;
    order.invoiceUpdatedAt = new Date();

    const remaining = getOrderRemainingAmount(order);
    if (remaining > 0.01 && wasPaid) {
      const requiresOnlinePayment = this.requiresOnlinePaymentDestinationOrder(
        order.shippingAddress?.country,
        shopUser?.country,
      );
      order.status = requiresOnlinePayment
        ? OrderStatus.PENDING_PAYMENT
        : OrderStatus.PENDING;
    }

    const updatedOrder = await this.saveOrderWithDValueSplit(
      order,
      shopUser,
      actor._id,
    );

    try {
      await this.productInventoryService.deductForOrder({
        ...((updatedOrder as any).toObject
          ? (updatedOrder as any).toObject()
          : updatedOrder),
        items: newItems,
        user: shopUser,
      } as any);
    } catch (err) {
      this.logger.error(
        `Failed to deduct inventory for appended items on order ${orderId}`,
        err as Error,
      );
    }

    await this.applyOrderCommissions(
      updatedOrder._id.toString(),
      updatedOrder.status as OrderStatus,
    ).catch((err) =>
      this.logger.error(
        `Failed to refresh commissions after append on ${orderId}`,
        err as Error,
      ),
    );

    try {
      const notification = await this.notificationsService.create({
        type: NotificationType.ORDER_PLACED,
        title: 'Order Updated – Items Added',
        message: `Additional items were added to order ${updatedOrder.orderNumber}.`,
        metadata: {
          orderId: updatedOrder._id,
          orderNumber: updatedOrder.orderNumber,
        },
        user: String(shopUser?._id || order.user),
        triggeredBy: String(actor._id),
        link: `/orders/${updatedOrder._id}`,
      });
      this.notificationsGateway.broadcastNotification(notification);
    } catch (notifErr) {
      console.error('Failed to create notification for order append:', notifErr);
    }

    const latest = await this.orderModel.findById(updatedOrder._id).populate('user');
    return this.returnManagedOrder(latest as OrderDocument, actor);
  }

  async createOrderRequest(userId: string, createOrderDto: CreateOrderDto) {
    try {
      const currentUser = await this.usersService.findOne(userId);
      if (!currentUser) {
        throw new NotFoundException('User not found');
      }
      
      const orderCurrency = await this.getCurrencyForUser(currentUser);

      const { items: rawItems, shippingAddress, couponCode } = createOrderDto;
      const wantsDValue = createOrderDto.dValueInvoice === true;
      if (wantsDValue) {
        this.assertShopCanRequestDValueSplit(currentUser);
      }
      const isPickup = createOrderDto.isPickup === true;
      const pickupHub = isPickup ? await this.getPickupHubForUser(userId) : null;
      if (isPickup && !pickupHub) {
        throw new BadRequestException(
          'Pickup is not available for your account. Please enter a shipping address.',
        );
      }
      if (!isPickup) {
        this.assertShippingAddressComplete(shippingAddress);
      await this.assertValidShippingPostcode(shippingAddress);
      }
      await this.assertAndNormalizeEuropeanVat(
        shippingAddress,
        currentUser?.country,
      );
      if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        throw new BadRequestException('Order items are required');
      }

      const items = await this.repriceOrderItemsForUser(
        currentUser,
        rawItems.map((item) => ({
          ...item,
          orderType: normalizeOrderItemType(item.orderType),
        })),
      );

      const kitResolved = await this.resolveCertificationKitOrderItems(
        currentUser as any,
        items,
      );
      const resolvedItems = kitResolved.items;
      const includesCertificationKit = kitResolved.includesCertificationKit;
      const kitExtras = kitResolved.extras;
      const kitExtrasTotal = getOrderKitExtrasTotal(kitExtras);
      if (wantsDValue && includesCertificationKit) {
        throw new BadRequestException(
          'D-Value invoices are not available for the Certification Kit Bundle.',
        );
      }

      await this.productInventoryService.assertStockAvailableForOrder({
        items: resolvedItems,
        user: currentUser as any,
        actingParentPartnerCode: (
          await this.actingParentStampForUser(userId)
        ).actingParentPartnerCode,
      });

      const itemsSubtotal = getItemsSubtotal(resolvedItems);
      const shippingCountry =
        shippingAddress?.country || currentUser?.country || '';
      // D-Value orders always go through the order request flow (admin sends
      // the payment link later), even in online-payment regions.
      if (
        !wantsDValue &&
        this.requiresOnlinePaymentDestinationOrder(
          shippingAddress?.country,
          currentUser?.country,
        )
      ) {
        throw new BadRequestException(
          'Online payment is required for orders in your region. Please complete checkout instead of submitting an order request.',
        );
      }

      const requestRateToUsd =
        await this.exchangeRatesService.getRateToBase(orderCurrency);
      // Kit: the free-shipping threshold uses the kit price, as checkout shows it.
      const shippingBase = includesCertificationKit
        ? itemsSubtotal - kitResolved.kitDiscount + kitExtrasTotal
        : itemsSubtotal;
      let shippingFee = calculateShippingFee(shippingCountry, shippingBase, {
        rateToUsd: requestRateToUsd,
        currency: orderCurrency,
      });
      // FedEx destinations (e.g. Puerto Rico) are quoted like checkout; D-Value keeps the flat rule.
      if (
        !wantsDValue &&
        isFedexShippingDestination(shippingCountry, shippingAddress?.state)
      ) {
        shippingFee = (
          await this.quoteCheckoutShipping({
            user: currentUser,
            items: resolvedItems,
            shippingAddress,
            itemsSubtotal: shippingBase,
            orderCurrency,
            rateToUsd: requestRateToUsd,
            isPickup,
            includesCertificationKit:
              includesCertificationKit && kitResolved.freeShipping,
          })
        ).shippingFee;
      }
      if ((includesCertificationKit && kitResolved.freeShipping) || isPickup) {
        shippingFee = 0;
      }

      if (includesCertificationKit && couponCode?.trim()) {
        throw new BadRequestException(
          'Coupons cannot be used with the Certification Kit. Its price is set by SkyGloss.',
        );
      }
      let discount = 0;
      let appliedCouponCode: string | undefined;
      if (couponCode?.trim()) {
        const validation = await this.couponsService.validateForCheckout(
          couponCode,
          itemsSubtotal,
        );
        discount = validation.discountAmount;
        appliedCouponCode = validation.code;
      }
      if (includesCertificationKit) {
        discount = Math.max(discount, kitResolved.kitDiscount);
      }
      const accountDiscount = applyPartnerAccountDiscount(
        currentUser,
        itemsSubtotal,
        discount,
      );
      discount = accountDiscount.discount;

      const { rate: vatRate, amount: vatAmount } = calculateEuropeOrderVatAmount(
        getOrderVatTaxableBase(itemsSubtotal + kitExtrasTotal, discount),
        {
          country: shippingCountry,
          taxId: shippingAddress?.taxId,
          noVatId: shippingAddress?.noVatId,
        },
      );
      const finalAmount = Math.max(
        0,
        itemsSubtotal - discount + vatAmount + shippingFee + kitExtrasTotal,
      );

      // Validate the D-Value split before anything is saved.
      if (wantsDValue) {
        await this.computeDValueSplitInvoices(currentUser, {
          items: resolvedItems,
          shippingFee,
          discount,
          vatAmount,
          vatRate,
          totalAmount: finalAmount,
          shippingAddress: { ...(shippingAddress || {}), country: shippingCountry },
        });
      }

      let savedOrder;
      let retries = 3;
      while (retries > 0) {
        try {
          const orderNumber = await this.generateShopOrderNumber(
            shippingCountry,
            'request',
          );
          const monetary = await this.buildMonetaryFieldsForNewOrder(
            finalAmount,
            orderCurrency || 'usd',
          );
          const order = new this.orderModel({
            user: userId,
            items: resolvedItems,
            shippingFee,
            vatAmount,
            vatRate,
            shippingAddress: pickupHub
              ? this.buildPickupShippingAddress(
                  shippingAddress,
                  pickupHub,
                  shippingCountry,
                )
              : shippingAddress,
            ...(pickupHub
              ? { isPickup: true, pickupHubPhone: pickupHub.phoneNumber || undefined }
              : {}),
            status: OrderStatus.PENDING,
            orderNumber,
            orderFlow: 'request',
            discount,
            ...(accountDiscount.partnerDiscountPercent
              ? { partnerDiscountPercent: accountDiscount.partnerDiscountPercent }
              : {}),
            couponCode: appliedCouponCode,
            includesCertificationKit: includesCertificationKit || undefined,
            ...(includesCertificationKit ? kitExtras : {}),
            ...(wantsDValue ? { isDValueOrder: true } : {}),
            ...(await this.actingParentStampForUser(userId)),
            ...monetary,
          });
          savedOrder = await order.save();
          if (includesCertificationKit) {
            await this.assertSingleActiveCertificationKitOrder(
              userId,
              savedOrder._id.toString(),
            );
          }
          break;
        } catch (saveError: any) {
          if (saveError.code === 11000 && retries > 1) {
            retries--;
            continue;
          }
          throw saveError;
        }
      }

      // Invoice A + Invoice B. On failure remove the order so no half-split
      // order request is left behind (nothing else has been written yet).
      if (savedOrder && wantsDValue) {
        try {
          const split = await this.computeDValueSplitInvoices(
            currentUser,
            savedOrder,
          );
          await this.saveDValueSplitInvoices(savedOrder, split, currentUser._id);
        } catch (splitErr) {
          await this.duplicateInvoiceModel
            .deleteMany({ orderId: savedOrder._id })
            .catch(() => undefined);
          await this.orderModel
            .deleteOne({ _id: savedOrder._id })
            .catch(() => undefined);
          if (splitErr instanceof BadRequestException) throw splitErr;
          throw new BadRequestException(
            'Failed to create the D-Value invoices. Please try again.',
          );
        }
      }

      if (savedOrder) {
        await this.applyOrderCommissions(
          savedOrder._id.toString(),
          OrderStatus.PENDING,
        );
        await this.deductProductInventoryForOrder(savedOrder._id);
        await this.invalidateOrderReadCaches();
      }

      // Create notification for admin
      try {
        const notification = await this.notificationsService.create({
          type: NotificationType.ORDER_PLACED,
          title: 'New Order Request',
          message: `A new order request ${savedOrder.orderNumber} has been submitted.`,
          metadata: {
            orderId: savedOrder._id,
            orderNumber: savedOrder.orderNumber,
          },
          user: userId,
          triggeredBy: userId,
          link: `/orders/${savedOrder._id}`,
        });
        this.notificationsGateway.broadcastNotification(notification);
      } catch (notifErr) {
        console.error('Failed to create/broadcast notification for order request:', notifErr);
      }

      await this.notifyShopOrderAlertRecipients(
        {
          _id: savedOrder._id,
          orderNumber: savedOrder.orderNumber,
          user: userId,
        },
        NotificationType.ORDER_PLACED,
        'New Shop Order Request',
        (shopName) =>
          `Shop "${shopName}" submitted order request ${savedOrder.orderNumber}.`,
      );

      // Send Email to sales@skygloss.com
      if (currentUser) {
        let invoiceBuffer: Buffer | undefined;
        try {
          invoiceBuffer = await this.generateInvoicePdf(savedOrder);
        } catch (pdfErr) {
          console.error(
            `Failed to generate invoice PDF for order request ${savedOrder.orderNumber}:`,
            pdfErr,
          );
        }

        const dValueAttachments =
          await this.buildDValueSplitPdfAttachments(savedOrder);

        await this.mailService
          .sendNewOrderRequestNotification(
            savedOrder,
            currentUser,
            invoiceBuffer,
            dValueAttachments,
          )
          .catch((err) => {
            console.error('Failed to send order request email to sales', err);
          });

        // Send Confirmation Email to the Customer
        await this.mailService
          .sendOrderRequestCustomerConfirmation(
            savedOrder,
            currentUser,
            invoiceBuffer,
            dValueAttachments,
          )
          .catch((err) => {
            console.error(
              'Failed to send order request confirmation email to customer',
              err,
            );
          });
      }

      return savedOrder;
    } catch (error) {
      console.error('[OrdersService] createOrderRequest error:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to create order request: ${error.message}`);
    }
  }

  private assertTestOrdersAllowed(): void {
    const allow =
      process.env.NODE_ENV !== 'production' ||
      process.env.ALLOW_TEST_ORDERS === 'true';
    if (!allow) {
      throw new ForbiddenException(
        'Test order creation is disabled in production',
      );
    }
  }

  private buildDummyShippingForShop(shop: UserDocument) {
    return {
      email: shop.email || 'test-shop@skygloss.dev',
      firstName: shop.firstName || 'Test',
      lastName: shop.lastName || 'Shop',
      companyName: shop.companyName || 'SkyGloss Test Shop',
      address: shop.address || '123 Test Street',
      address2: 'Suite 100',
      city: shop.city || 'Los Angeles',
      state: 'CA',
      zipCode: shop.zipCode || '90001',
      country: shop.country || 'United States',
      phoneNumber: shop.phoneNumber || '+1 555 0100',
      taxId: 'TEST-TAX-001',
    };
  }

  async createAdminTestOrder(dto: CreateAdminTestOrderDto) {
    this.assertTestOrdersAllowed();

    const shop = await this.usersService.findOne(dto.shopUserId);
    if (!shop) {
      throw new NotFoundException('Shop user not found');
    }
    if (shop.role !== UserRole.CERTIFIED_SHOP) {
      throw new BadRequestException(
        'Test orders must be placed for a Shop user',
      );
    }

    if (!dto.items?.length) {
      throw new BadRequestException('Select at least one product');
    }

    const orderItems: CreateOrderDto['items'] = [];
    for (const line of dto.items) {
      const product = await this.productsService.findOne(line.productId, shop);
      if (!product) {
        throw new NotFoundException(`Product not found: ${line.productId}`);
      }
      const sizeEntry = (product.sizes || []).find(
        (s: { size: string; price: number }) => s.size === line.size,
      );
      if (!sizeEntry) {
        throw new BadRequestException(
          `Size "${line.size}" not found for product ${product.name}`,
        );
      }
      orderItems.push({
        product: String(product._id || product.id),
        name: product.name,
        size: line.size,
        quantity: line.quantity,
        orderType: normalizeOrderItemType(line.orderType),
        price: sizeEntry.price,
        image: product.images?.[0] || product.shopImages?.[0] || '',
      });
    }

    const shippingAddress = this.buildDummyShippingForShop(shop);
    const orderCurrency = await this.getCurrencyForUser(shop);
    const itemsSubtotal = getItemsSubtotal(orderItems);
    const shippingCountry = shippingAddress.country || shop.country || '';
    const shippingFee = calculateShippingFee(shippingCountry, itemsSubtotal, {
      rateToUsd: await this.exchangeRatesService.getRateToBase(
        orderCurrency || 'usd',
      ),
      currency: orderCurrency || 'usd',
    });
    const { rate: vatRate, amount: vatAmount } = calculateEuropeOrderVatAmount(
      getOrderVatTaxableBase(itemsSubtotal, 0),
      {
        country: shippingCountry,
        taxId: shippingAddress?.taxId,
        noVatId: (shippingAddress as any)?.noVatId,
      },
    );
    const finalAmount = Math.max(0, itemsSubtotal + vatAmount + shippingFee);

    const initialStatus = dto.initialStatus || OrderStatus.PAID;

    let savedOrder: OrderDocument | undefined;
    let retries = 3;
    while (retries > 0) {
      try {
        const orderNumber = await this.generateShopOrderNumber(
          shippingCountry,
          'request',
        );
        const monetary = await this.buildMonetaryFieldsForNewOrder(
          finalAmount,
          orderCurrency || 'usd',
        );
        const order = new this.orderModel({
          user: shop._id,
          items: orderItems,
          shippingFee,
          vatAmount,
          vatRate,
          shippingAddress,
          status: initialStatus,
          orderNumber,
          orderFlow: 'request',
          discount: 0,
          ...(await this.actingParentStampForUser(String(shop._id))),
          ...monetary,
        });
        savedOrder = await order.save();
        break;
      } catch (saveError: any) {
        if (saveError.code === 11000 && retries > 1) {
          retries--;
          continue;
        }
        throw saveError;
      }
    }

    if (!savedOrder) {
      throw new BadRequestException('Failed to create test order');
    }

    await this.applyOrderCommissions(
      savedOrder._id.toString(),
      initialStatus,
    );

    if (
      initialStatus === OrderStatus.PENDING ||
      initialStatus === OrderStatus.PAID ||
      initialStatus === OrderStatus.SHIPPED ||
      initialStatus === OrderStatus.DELIVERED
    ) {
      await this.deductProductInventoryForOrder(savedOrder._id);
    }

    if (dto.markShippedImmediately) {
      await this.updateStatus(
        savedOrder._id.toString(),
        OrderStatus.SHIPPED,
        dto.trackingId || 'TEST-TRACK-001',
        dto.shippingCompany || 'SkyGloss Test Courier',
      );
    }

    this.logger.log(
      `[Dev] Test order ${savedOrder.orderNumber} created for shop ${shop.email}`,
    );

    return this.orderModel
      .findById(savedOrder._id)
      .populate('user', 'firstName lastName email partnerCode role');
  }

  async getDashboardStats() {
    return this.cache.wrap(
      CacheKeys.ordersDashboardStats,
      CacheTtl.ordersDashboardStats,
      async () => {
        const [recentOrders, salesReport] = await Promise.all([
          this.orderModel
            .find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('user', 'firstName lastName email')
            .lean()
            .exec(),
          this.computeSalesReport(),
        ]);

        return {
          recentOrders,
          totalRevenue: salesReport.totalRevenue,
          baseCurrency: salesReport.baseCurrency,
          currencyBreakdown: salesReport.currencyBreakdown,
          chartData: salesReport.chartData,
        };
      },
    );
  }

  async getExchangeRates() {
    return this.exchangeRatesService.getAllRates();
  }

  async getExchangeRatesMap() {
    return this.exchangeRatesService.getRatesMap();
  }

  async refreshExchangeRatesFromMarket() {
    const updated = await this.exchangeRatesService.refreshRatesFromMarket();
    await this.repairBrokenFxOrders();
    return {
      updated,
      rates: await this.exchangeRatesService.getRatesMap(),
    };
  }

  async updateExchangeRate(currency: string, rateToBase: number) {
    if (!currency || typeof rateToBase !== 'number' || rateToBase <= 0) {
      throw new BadRequestException('Valid currency and rateToBase are required');
    }
    return this.exchangeRatesService.updateRate(currency, rateToBase);
  }

  async deleteOrder(id: string, actor?: UserDocument): Promise<{
    success: boolean;
    purgeAt: Date;
    retentionDays: number;
  }> {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    if ((order as any).deletedAt) {
      throw new BadRequestException('Order is already soft-deleted');
    }

    // Delete only removes the order. Refunds and cancellation emails belong to cancelOrder.
    const payload = softDeleteSetPayload();
    await this.orderModel.findByIdAndUpdate(id, { $set: payload }).exec();
    await this.recordOrderActorActivity({
      order,
      actor,
      action: 'delete',
      previousStatus: order.status,
      newStatus: 'DELETED',
    });
    await this.invalidateOrderReadCaches();
    return {
      success: true,
      purgeAt: payload.purgeAt,
      retentionDays: SOFT_DELETE_RETENTION_DAYS,
    };
  }

  /**
   * Cancel keeps the order in history with CANCELLED status.
   * Does not delete the record or send a cancellation-request notification.
   */
  async cancelOrder(id: string, actor?: UserDocument): Promise<Order> {
    const order = await this.orderModel.findById(id).populate('user');
    if (!order) throw new NotFoundException('Order not found');
    if ((order as any).deletedAt) {
      throw new BadRequestException('Order is already deleted');
    }
    if (order.status === OrderStatus.CANCELLED) {
      if (order.cancellationRequest?.status === CancellationRequestStatus.PENDING) {
        order.cancellationRequest = {
          status: CancellationRequestStatus.APPROVED,
          reason: order.cancellationRequest.reason,
          requestedAt: order.cancellationRequest.requestedAt,
          resolvedAt: new Date(),
        };
        order.markModified('cancellationRequest');
        await order.save();
      }
      return this.getOrderById(id, actor);
    }

    const hadPendingRequest =
      order.cancellationRequest?.status === CancellationRequestStatus.PENDING;
    if (hadPendingRequest && order.cancellationRequest) {
      order.cancellationRequest = {
        status: CancellationRequestStatus.APPROVED,
        reason: order.cancellationRequest.reason,
        requestedAt: order.cancellationRequest.requestedAt,
        resolvedAt: new Date(),
        rejectionReason: order.cancellationRequest.rejectionReason,
      };
      order.markModified('cancellationRequest');
    }
    if (!order.cancellationReason) {
      const requestReason = order.cancellationRequest?.reason?.trim();
      order.cancellationReason =
        requestReason || 'This order was cancelled by an administrator.';
    }
    await order.save();

    await this.updateStatus(
      id,
      OrderStatus.CANCELLED,
      undefined,
      undefined,
      actor,
    );

    if (hadPendingRequest) {
      await this.notifyOrderCustomer(
        order,
        NotificationType.ORDER_CANCELLATION_APPROVED,
        'Cancellation Approved',
        `Your cancellation request for order ${order.orderNumber} was approved. The order is now cancelled.`,
        actor?._id?.toString(),
      );
    }

    return this.getOrderById(id, actor);
  }

  /**
   * Customer asks to cancel. The order stays in its current status until an admin approves.
   */
  async requestOrderCancellation(
    id: string,
    userId: string,
    reason?: string,
  ): Promise<Order> {
    const order = await this.orderModel.findById(id).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    const orderUserId = this.resolveOrderUserId(order.user);
    if (orderUserId !== String(userId)) {
      throw new ForbiddenException('You can only request cancellation for your own orders');
    }

    this.assertCustomerCanRequestCancellation(order);

    const trimmedReason = (reason || '').trim().slice(0, 500);
    order.cancellationRequest = {
      status: CancellationRequestStatus.PENDING,
      reason: trimmedReason || undefined,
      requestedAt: new Date(),
    };
    order.markModified('cancellationRequest');
    await order.save();

    await this.notifyAdminsOfCancellationRequest(order);

    const requester = await this.usersService.findOne(userId);
    return this.getOrderById(id, requester || undefined);
  }

  async approveCancellationRequest(
    id: string,
    actor: UserDocument,
  ): Promise<Order> {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.cancellationRequest?.status !== CancellationRequestStatus.PENDING) {
      throw new BadRequestException('There is no pending cancellation request for this order');
    }
    return this.cancelOrder(id, actor);
  }

  async rejectCancellationRequest(
    id: string,
    actor: UserDocument,
    rejectionReason?: string,
  ): Promise<Order> {
    const order = await this.orderModel.findById(id).populate('user');
    if (!order) throw new NotFoundException('Order not found');
    if (order.cancellationRequest?.status !== CancellationRequestStatus.PENDING) {
      throw new BadRequestException('There is no pending cancellation request for this order');
    }

    const note = (rejectionReason || '').trim().slice(0, 500);
    order.cancellationRequest = {
      status: CancellationRequestStatus.REJECTED,
      reason: order.cancellationRequest.reason,
      requestedAt: order.cancellationRequest.requestedAt,
      resolvedAt: new Date(),
      rejectionReason: note || undefined,
    };
    order.markModified('cancellationRequest');
    await order.save();

    await this.notifyOrderCustomer(
      order,
      NotificationType.ORDER_CANCELLATION_REJECTED,
      'Cancellation Request Declined',
      note
        ? `Your cancellation request for order ${order.orderNumber} was declined. ${note}`
        : `Your cancellation request for order ${order.orderNumber} was declined. The order is unchanged.`,
      actor?._id?.toString(),
    );

    return this.getOrderById(id, actor);
  }

  private assertCustomerCanRequestCancellation(order: OrderDocument): void {
    if (isRegistrationOrder(order)) {
      throw new BadRequestException('This order cannot be cancelled');
    }
    if (
      order.status === OrderStatus.SHIPPED ||
      order.status === OrderStatus.DELIVERED ||
      order.shippedAt
    ) {
      throw new BadRequestException(
        'This order can no longer be cancelled because it has already been shipped.',
      );
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('This order is already cancelled');
    }
    if (order.status === OrderStatus.FAILED) {
      throw new BadRequestException('This order cannot be cancelled');
    }
    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.PENDING_PAYMENT &&
      order.status !== OrderStatus.PAID
    ) {
      throw new BadRequestException('This order cannot be cancelled');
    }
    if (order.cancellationRequest?.status === CancellationRequestStatus.PENDING) {
      throw new BadRequestException(
        'A cancellation request is already waiting for admin review',
      );
    }
  }

  private resolveOrderUserId(user: unknown): string {
    if (user && typeof user === 'object' && '_id' in (user as object)) {
      return String((user as { _id: unknown })._id);
    }
    return String(user || '');
  }

  private async notifyAdminsOfCancellationRequest(order: OrderDocument): Promise<void> {
    const admins = await this.usersService.findAdminUsers();
    const customer = order.user as { firstName?: string; lastName?: string; _id?: unknown };
    const customerName = [customer?.firstName, customer?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const requesterId = this.resolveOrderUserId(order.user);
    const message = `${customerName || 'A customer'} requested cancellation for order ${order.orderNumber}.`;

    if (!admins.length) {
      this.logger.warn(
        `No admin users found to notify about cancellation request ${order.orderNumber}`,
      );
      return;
    }

    for (const admin of admins) {
      try {
        const notification = await this.notificationsService.create({
          type: NotificationType.ORDER_CANCELLATION_REQUESTED,
          title: 'Order Cancellation Request',
          message,
          metadata: {
            orderId: order._id,
            orderNumber: order.orderNumber,
          },
          user: admin._id.toString(),
          triggeredBy: requesterId,
          link: `/orders/${order._id}`,
        });
        this.notificationsGateway.broadcastNotification(notification);
      } catch (err) {
        this.logger.error(
          `Failed to notify admin ${admin._id} about cancellation request ${order.orderNumber}`,
          err,
        );
      }
    }
  }

  private async notifyOrderCustomer(
    order: { _id: unknown; orderNumber?: string; user?: unknown },
    type: NotificationType,
    title: string,
    message: string,
    triggeredBy?: string,
  ): Promise<void> {
    const customer = order.user as { _id?: unknown; role?: string } | string | undefined;
    const customerId = this.resolveOrderUserId(customer);
    if (!customerId) return;

    const role =
      customer && typeof customer === 'object' ? customer.role : undefined;
    const link =
      role === UserRole.CERTIFIED_SHOP
        ? `/dashboard/shop/receipt/${order._id}`
        : `/dashboard/partner/receipt/${order._id}`;

    try {
      const notification = await this.notificationsService.create({
        type,
        title,
        message,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
        },
        user: customerId,
        triggeredBy,
        link,
      });
      this.notificationsGateway.broadcastNotification(notification);
    } catch (err) {
      this.logger.error(
        `Failed to notify customer about ${type} for order ${order.orderNumber}`,
        err,
      );
    }
  }

  /** Shop orders: in-app alert for the Shop's Operational Support Partner + Hub. */
  private async notifyShopOrderAlertRecipients(
    order: { _id: unknown; orderNumber?: string; user?: unknown },
    type: NotificationType,
    title: string,
    buildMessage: (shopName: string) => string,
  ): Promise<void> {
    const shopId = this.resolveOrderUserId(order.user);
    if (!shopId) return;

    try {
      const shop = await this.usersService.findOne(shopId);
      if (!shop || shop.role !== UserRole.CERTIFIED_SHOP) return;

      const recipients =
        await this.usersService.resolveShopOrderAlertRecipients(shop);
      const shopName =
        shop.shopName?.trim() ||
        [shop.firstName, shop.lastName].filter(Boolean).join(' ').trim() ||
        'A shop';

      for (const recipient of recipients) {
        try {
          const notification = await this.notificationsService.create({
            type,
            title,
            message: buildMessage(shopName),
            metadata: {
              orderId: order._id,
              orderNumber: order.orderNumber,
              shopId,
              shopName,
            },
            user: String(recipient._id),
            triggeredBy: shopId,
            link: '/dashboard/partner/earnings?tab=orders',
          });
          this.notificationsGateway.broadcastNotification(notification);
        } catch (err) {
          this.logger.error(
            `Failed to notify ${recipient.partnerCode || String(recipient._id)} about ${type} for order ${order.orderNumber}`,
            err,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to resolve OSP / Hub alert recipients for order ${order.orderNumber}`,
        err,
      );
    }
  }

  async restoreOrder(id: string): Promise<{ success: boolean; order: OrderDocument }> {
    const order = await this.orderModel
      .findOne({ _id: id })
      .setOptions({ withDeleted: true })
      .exec();
    if (!order) throw new NotFoundException('Order not found');
    if (!(order as any).deletedAt) {
      throw new BadRequestException('Order is not soft-deleted');
    }

    const restored = await this.orderModel
      .findOneAndUpdate({ _id: id }, softDeleteUnsetPayload(), {
        new: true,
        withDeleted: true,
      })
      .exec();
    if (!restored) throw new NotFoundException('Order not found');
    await this.invalidateOrderReadCaches();
    return { success: true, order: restored };
  }

  private isUsaCountry(country: string): boolean {
    return USA_COUNTRIES.includes((country || '').toLowerCase().trim());
  }

  /**
   * European destinations require a VAT number verified via VIES — unless the
   * buyer declares they have no VAT ID (noVatId), in which case country VAT is charged.
   */
  private async assertAndNormalizeEuropeanVat(
    shippingAddress?: CreateOrderDto['shippingAddress'] | null,
    userCountry?: string | null,
  ): Promise<void> {
    if (
      !requiresEuropeanVat(shippingAddress?.country, userCountry) ||
      !shippingAddress
    ) {
      return;
    }

    if (shippingAddress.noVatId === true) {
      shippingAddress.taxId = '';
      return;
    }

    const destinationCountry = resolveOrderDestinationCountry(
      shippingAddress.country,
      userCountry,
    );
    const result = await validateEuropeanVatNumber({
      country: destinationCountry,
      taxId: shippingAddress.taxId,
    });

    if (!result.ok) {
      throw new BadRequestException(result.message);
    }

    shippingAddress.taxId = result.normalizedVat;
  }

  async validateOrderVatNumber(params: {
    country?: string;
    taxId?: string;
    userCountry?: string;
  }) {
    const destinationCountry = resolveOrderDestinationCountry(
      params.country,
      params.userCountry,
    );
    if (!isEuropeCountryName(destinationCountry)) {
      return {
        required: false,
        valid: true,
        message: 'VAT Number is not required for this country.',
      };
    }

    const result = await validateEuropeanVatNumber({
      country: destinationCountry,
      taxId: params.taxId,
    });

    if (!result.ok) {
      return {
        required: true,
        valid: false,
        reason: result.reason,
        message: result.message,
      };
    }

    return {
      required: true,
      valid: true,
      normalizedVat: result.normalizedVat,
      message: 'VAT Number verified successfully.',
    };
  }

  private isUsaDestinationOrder(
    shippingCountry?: string | null,
    userCountry?: string | null,
  ): boolean {
    return isUsaShopOrder(shippingCountry, userCountry);
  }

  private requiresOnlinePaymentDestinationOrder(
    shippingCountry?: string | null,
    userCountry?: string | null,
  ): boolean {
    return requiresOnlinePaymentShopOrder(shippingCountry, userCountry);
  }

  private resolveOrderStripeAccountKey(
    shippingCountry?: string | null,
    userCountry?: string | null,
  ): StripeAccountKey {
    return resolveShopOrderStripeAccountKey(shippingCountry, userCountry);
  }

  private getStripeSecretKeyForAccount(key: StripeAccountKey): string | undefined {
    if (key === 'usa') {
      return this.configService.get<string>('USA_STRIPE_SECRET_KEY');
    }
    if (key === 'europe') {
      return this.configService.get<string>('EUROPE_STRIPE_SECRET_KEY');
    }
    return this.configService.get<string>('STRIPE_SECRET_KEY');
  }

  private getStripeClientOrNull(key: StripeAccountKey): Stripe | null {
    if (key === 'usa') return this.usaStripe || null;
    if (key === 'europe') return this.europeStripe || null;
    return this.stripe || null;
  }

  private getConfiguredStripeClients(primaryKey?: StripeAccountKey): Stripe[] {
    const orderedKeys: StripeAccountKey[] = primaryKey
      ? [
          primaryKey,
          ...(['global', 'usa', 'europe'] as StripeAccountKey[]).filter(
            (key) => key !== primaryKey,
          ),
        ]
      : (['global', 'usa', 'europe'] as StripeAccountKey[]);
    const instances: Stripe[] = [];
    for (const key of orderedKeys) {
      const client = this.getStripeClientOrNull(key);
      if (client && !instances.includes(client)) {
        instances.push(client);
      }
    }
    return instances;
  }

  private getStripeForAccountKey(key: StripeAccountKey): Stripe {
    const stripeInstance = this.getStripeClientOrNull(key) || this.stripe;
    if (!stripeInstance) {
      throw new BadRequestException('Stripe is not configured on the server.');
    }
    return stripeInstance;
  }

  private getStripeForOrder(
    shippingCountry?: string | null,
    userCountry?: string | null,
  ): Stripe {
    return this.getStripeForAccountKey(
      this.resolveOrderStripeAccountKey(shippingCountry, userCountry),
    );
  }

  private getFrontendBaseUrl(): string {
    let baseUrl = (this.configService.get<string>('FRONTEND_URL') || '').replace(
      /\/+$/,
      '',
    );
    if (!baseUrl) {
      baseUrl =
        process.env.NODE_ENV === 'production'
          ? 'https://portal.skygloss.com'
          : 'http://localhost:5173';
    }
    return baseUrl;
  }

  private getDashboardPath(role?: string): string {
    const isPartner = ['master_partner', 'regional_partner', 'distributor', 'partner'].includes(
      role || '',
    );
    return isPartner ? '/dashboard/partner' : '/dashboard/shop';
  }

  private getApiBaseUrl(): string {
    let baseUrl = (
      this.configService.get<string>('BACKEND_URL') ||
      this.configService.get<string>('API_URL') ||
      ''
    ).replace(/\/+$/, '');

    if (!baseUrl && process.env.RAILWAY_PUBLIC_DOMAIN) {
      baseUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }

    if (!baseUrl) {
      const port = this.configService.get<string>('PORT') || '3001';
      baseUrl =
        process.env.NODE_ENV === 'production'
          ? ''
          : `http://localhost:${port}`;
    }

    if (!baseUrl) {
      throw new BadRequestException(
        'BACKEND_URL is not configured for payment links.',
      );
    }
    return baseUrl;
  }

  getOrderPayUrl(orderId: string, role?: string): string {
    const baseUrl = this.getFrontendBaseUrl();
    const dashboardPath = this.getDashboardPath(role);
    return `${baseUrl}${dashboardPath}/receipt/${orderId}`;
  }

  /** Signed one-click link for invoice emails — redirects straight to Stripe Checkout. */
  getOrderDirectPayUrl(orderId: string): string {
    const token = createOrderPaymentToken(orderId, this.getOrderPayTokenSecret());
    return `${this.getApiBaseUrl()}/orders/${orderId}/pay-now?token=${encodeURIComponent(token)}`;
  }

  private async createStripeCheckoutForOrder(
    order: OrderDocument,
    currentUser: any,
    role: string | undefined,
    stripeInstance: Stripe,
    orderCurrency: string,
  ): Promise<Stripe.Checkout.Session> {
    const amountPaid = getOrderAmountPaid(order);
    const remaining = getOrderRemainingAmount(order);
    const chargeRemainingOnly = amountPaid > 0.01 && remaining > 0.01;

    let line_items: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (chargeRemainingOnly) {
      // Amended paid order — charge only the outstanding balance.
      line_items = [
        {
          price_data: {
            currency: orderCurrency,
            product_data: {
              name: `Balance due – Order ${order.orderNumber}`,
              description: `Additional items (already paid: ${amountPaid.toFixed(2)})`,
            },
            unit_amount: Math.round(remaining * 100),
          },
          quantity: 1,
        },
      ];
    } else {
      const items = order.items;
      const itemsSubtotal = getItemsSubtotal(items);
      const discount = order.discount ?? 0;
      const discountedSubtotal = Math.max(0, itemsSubtotal - discount);
      const priceRatio =
        itemsSubtotal > 0 ? discountedSubtotal / itemsSubtotal : 1;
      const kitExtrasTotal = getOrderKitExtrasTotal(order);
      const shippingFee =
        order.shippingFee != null && order.shippingFee >= 0
          ? order.shippingFee
          : Math.max(0, order.totalAmount - itemsSubtotal + discount - kitExtrasTotal);
      const shippingCountry =
        order.shippingAddress?.country || currentUser?.country || '';

      line_items = items.map((item) => {
        const images: string[] = [];
        if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) {
          images.push(item.image);
        }

        return {
          price_data: {
            currency: orderCurrency,
            product_data: {
              name: String(item.name || 'Product'),
              images,
              metadata: {
                size: String(item.size || ''),
                productId: String(item.product || ''),
              },
            },
            unit_amount: Math.round(
              Number(item.price || 0) * priceRatio * 100,
            ),
          },
          quantity: Math.max(1, Number(item.quantity || 1)),
        };
      });

      const kitFee = Math.max(0, Number(order.certificationKitFee) || 0);
      if (order.includesCertificationKit && kitFee > 0.001) {
        line_items.push({
          price_data: {
            currency: orderCurrency,
            product_data: {
              name: 'Certification fee',
              description: 'FUSION certification, included in the Certification Kit',
            },
            unit_amount: Math.round(kitFee * 100),
          },
          quantity: 1,
        });
      }
      const kitTraining = Math.max(0, Number(order.certificationKitTraining) || 0);
      if (order.includesCertificationKit && kitTraining > 0.001) {
        line_items.push({
          price_data: {
            currency: orderCurrency,
            product_data: {
              name: 'Hands-on training',
              description: 'Included in the Certification Kit',
            },
            unit_amount: Math.round(kitTraining * 100),
          },
          quantity: 1,
        });
      }

      if (shippingFee > 0) {
        const shippingRegion = getShippingRegion(
          shippingCountry.toLowerCase().trim(),
        );
        line_items.push({
          price_data: {
            currency: orderCurrency,
            product_data: {
              name: 'Shipping',
              description: isFedexShippingDestination(
                shippingCountry,
                order.shippingAddress?.state,
              )
                ? 'FedEx shipping'
                : `Standard shipping for orders under ${shippingRegion === 'EU' ? '€' : '$'}500`,
            },
            unit_amount: Math.round(shippingFee * 100),
          },
          quantity: 1,
        });
      }

      const vatAmount = Number(order.vatAmount) || 0;
      const vatRate = Number(order.vatRate) || 0;
      if (vatAmount > 0.001) {
        line_items.push({
          price_data: {
            currency: orderCurrency,
            product_data: {
              name: vatRate > 0 ? `VAT (${vatRate}%)` : 'VAT',
              description: 'Value Added Tax on order (excludes shipping)',
            },
            unit_amount: Math.round(vatAmount * 100),
          },
          quantity: 1,
        });
      }
    }

    const baseUrl = this.getFrontendBaseUrl();
    const dashboardPath = this.getDashboardPath(currentUser?.role || role);
    const sessionMetadata = {
      orderId: String(order._id),
      type: 'shop_order',
    };

    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      // Kit pricing is fixed server-side (saved kit); block Stripe promo stacking.
      // D-Value orders: Invoice A + B must keep matching the order total.
      allow_promotion_codes:
        !chargeRemainingOnly &&
        !order.includesCertificationKit &&
        !(order as any).isDValueOrder,
      line_items,
      mode: 'payment',
      success_url: `${baseUrl}${dashboardPath}?success=true&order_id=${order._id}`,
      cancel_url: `${baseUrl}${dashboardPath}/receipt/${order._id}?canceled=true`,
      client_reference_id: String(currentUser?._id || order.user),
      customer_email: String(
        currentUser?.email || order.shippingAddress?.email || '',
      ),
      metadata: sessionMetadata,
    });

    order.stripeSessionId = session.id;
    await order.save();

    return session;
  }

  private async recordCouponUsageIfApplicable(
    couponCode?: string,
  ): Promise<void> {
    if (!couponCode || couponCode === 'STRIPECOUPON') {
      return;
    }
    await this.couponsService.recordUsage(couponCode).catch((err) => {
      this.logger.warn(`Failed to record coupon usage for ${couponCode}:`, err);
    });
  }

  private async generateShopOrderNumber(
    country: string,
    flow: ShopOrderFlow,
  ): Promise<string> {
    let sequence = await this.getNextShopOrderSequence(flow);
    for (let attempt = 0; attempt < 25; attempt++) {
      const orderNumber = formatShopOrderNumber(flow, sequence, country);
      const taken = await this.orderModel
        .findOne({ orderNumber })
        .select('_id')
        .setOptions({ withDeleted: true })
        .lean()
        .exec();
      if (!taken) return orderNumber;
      sequence += ORDER_SEQUENCE_STEP;
    }
    throw new BadRequestException('Could not allocate a unique order number');
  }

  private async getNextShopOrderSequence(
    flow: ShopOrderFlow,
  ): Promise<number> {
    // Include soft-deleted orders. Their orderNumber is still unique, so a
    // deleted SGCHN0397 must not be issued again.
    const matchingOrders = await this.orderModel
      .find({
        orderNumber: { $regex: getShopOrderNumberRegex(flow) },
      })
      .select('orderNumber')
      .setOptions({ withDeleted: true })
      .lean()
      .exec();

    return getNextShopOrderSequenceForFlow(
      matchingOrders.map((order) => ({
        orderNumber: (order as { orderNumber?: string }).orderNumber,
        orderFlow: flow,
      })),
      flow,
    );
  }

  private async generateRegistrationOrderNumber(): Promise<string> {
    const matchingOrders = await this.orderModel
      .find({ orderNumber: { $regex: /^SGREG\d+$/i } })
      .select('orderNumber')
      .setOptions({ withDeleted: true })
      .lean()
      .exec();

    let sequence = getNextRegistrationOrderSequence(
      matchingOrders.map(
        (order) => (order as { orderNumber?: string }).orderNumber,
      ),
    );
    for (let attempt = 0; attempt < 25; attempt++) {
      const orderNumber = formatRegistrationOrderNumber(sequence);
      const taken = await this.orderModel
        .findOne({ orderNumber })
        .select('_id')
        .setOptions({ withDeleted: true })
        .lean()
        .exec();
      if (!taken) return orderNumber;
      sequence += ORDER_SEQUENCE_STEP;
    }
    throw new BadRequestException('Could not allocate a unique order number');
  }

  private itemLineKey(item: {
    product?: string;
    size?: string;
    orderType?: string;
  }): string {
    return `${String(item.product || '')}|${String(item.size || '')}|${normalizeOrderItemType(item.orderType)}`;
  }

  private validateDuplicateInvoiceItems(
    orderItems: { product: string; size: string; quantity: number; orderType?: string }[],
    dtoItems: CreateDuplicateInvoiceDto['items'],
  ) {
    if (!dtoItems?.length) {
      throw new BadRequestException('At least one item is required');
    }
    if (dtoItems.length !== orderItems.length) {
      throw new BadRequestException(
        'D-Value invoice must include the same items as the original order',
      );
    }

    dtoItems.forEach((item, index) => {
      const original = orderItems[index];
      if (!original) {
        throw new BadRequestException('Item mismatch with original order');
      }
      if (this.itemLineKey(item) !== this.itemLineKey(original)) {
        throw new BadRequestException(
          'Items must match the original order (only prices may be changed)',
        );
      }
      if (Number(item.quantity) !== Number(original.quantity)) {
        throw new BadRequestException(
          'Item quantities must match the original order',
        );
      }
      const price = Number(item.price);
      if (!Number.isFinite(price) || price < 0) {
        throw new BadRequestException('Enter a valid price for each item');
      }
    });
  }

  private buildDuplicateInvoiceSnapshot(
    order: OrderDocument,
    duplicate: DuplicateInvoiceDocument,
  ) {
    const orderPlain = order.toObject
      ? order.toObject({ virtuals: true })
      : { ...(order as any) };
    const duplicatePlain = duplicate.toObject
      ? duplicate.toObject()
      : { ...(duplicate as any) };

    return {
      ...orderPlain,
      user: orderPlain.user || (order as any).user,
      status: orderPlain.status || order.status || OrderStatus.PENDING,
      items: duplicatePlain.items || duplicate.items,
      totalAmount: duplicatePlain.totalAmount ?? duplicate.totalAmount,
      shippingFee: duplicatePlain.shippingFee ?? duplicate.shippingFee,
      shippingFeeIsFinal: true,
      discount: duplicatePlain.discount ?? duplicate.discount,
      vatAmount: duplicatePlain.vatAmount ?? duplicate.vatAmount,
      vatRate: duplicatePlain.vatRate ?? duplicate.vatRate,
      amountPaid: 0,
      orderNumber: duplicatePlain.invoiceNumber || duplicate.invoiceNumber,
    };
  }

  async getDuplicateInvoicesForOrder(
    orderId: string,
    actor: UserDocument,
  ) {
    const order = await this.orderModel
      .findById(orderId)
      .populate(
        'user',
        'role country hubPartnerCode parentLinkAssignedAt previousParentPartnerCode dValueInvoiceEnabled',
      );
    if (!order) throw new NotFoundException('Order not found');
    if (actor?.role === UserRole.CERTIFIED_SHOP) {
      this.assertShopCanUseDValueInvoice(order, actor);
    } else {
      await this.assertParentCanUseDValueInvoice(order, actor, false);
    }

    return this.duplicateInvoiceModel
      .find({ orderId: order._id })
      .sort({ sequence: 1 })
      .lean()
      .exec();
  }

  async getDuplicateInvoiceById(invoiceId: string, actor?: UserDocument) {
    const duplicate = await this.duplicateInvoiceModel
      .findById(invoiceId)
      .populate({
        path: 'orderId',
        populate: { path: 'user' },
      })
      .exec();
    if (!duplicate) {
      throw new NotFoundException('D-Value invoice not found');
    }
    if (actor?.role === UserRole.CERTIFIED_SHOP) {
      const order = duplicate.orderId as unknown as OrderDocument;
      if (!order) throw new NotFoundException('Order not found');
      this.assertShopCanUseDValueInvoice(order, actor);
    } else if (
      actor?.role === UserRole.PARTNER ||
      actor?.role === UserRole.DISTRIBUTOR
    ) {
      const order = duplicate.orderId as unknown as OrderDocument;
      if (!order) throw new NotFoundException('Order not found');
      await this.assertParentCanUseDValueInvoice(order, actor, false);
    }
    return duplicate;
  }

  /** Totals (subtotal − discount + VAT + shipping) and persist a D-Value invoice. */
  private async createDuplicateInvoiceRecord(
    order: OrderDocument,
    items: {
      product: string;
      name: string;
      size: string;
      quantity: number;
      orderType: 'unit' | 'case';
      price: number;
      image: string;
    }[],
    shippingFee: number,
    actor: UserDocument,
  ): Promise<DuplicateInvoiceDocument> {
    const discount = roundMoney(order.discount ?? 0);
    const subtotal = getItemsSubtotal(items);
    const { amount: vatAmount, rate: vatRate } = calculateEuropeOrderVatAmount(
      getOrderVatTaxableBase(subtotal, discount),
      {
        country: order.shippingAddress?.country,
        taxId: order.shippingAddress?.taxId,
        noVatId: (order.shippingAddress as any)?.noVatId,
      },
    );
    const totalAmount = roundMoney(
      Math.max(0, subtotal - discount + vatAmount + shippingFee),
    );

    const existingCount = await this.duplicateInvoiceModel.countDocuments({
      orderId: order._id,
      invoiceType: { $ne: 'original' },
    });
    const sequence = existingCount + 1;
    const invoiceNumber = `${order.orderNumber}-D${sequence}`;

    return this.duplicateInvoiceModel.create({
      orderId: order._id as Types.ObjectId,
      invoiceNumber,
      sequence,
      items,
      totalAmount,
      shippingFee,
      vatAmount,
      vatRate,
      discount,
      currency: order.currency || 'USD',
      shippingAddress: order.shippingAddress,
      createdBy: actor._id as Types.ObjectId,
    });
  }

  /** Same resolution order as product pricing: explicit group → country → default. */
  private async resolvePricingGroupForUser(
    user: UserDocument,
  ): Promise<ProductGroupDocument | null> {
    if (user.productGroup) {
      return this.productGroupModel.findById(user.productGroup).exec();
    }
    if (user.country) {
      const byCountry = await this.productGroupModel
        .findOne({
          $or: [{ countries: user.country }, { country: user.country }],
          isActive: true,
        })
        .exec();
      if (byCountry) return byCountry;
    }
    return this.productGroupModel
      .findOne({ isDefault: true, isActive: true })
      .exec();
  }

  /**
   * Hub / Distributor may use D-Value invoices only on orders they manage via
   * Parent Link. Creating one also needs the shop's D-Value toggle to be on.
   * Admin is always allowed.
   */
  private async assertParentCanUseDValueInvoice(
    order: OrderDocument,
    actor: UserDocument,
    requireEnabled: boolean,
  ): Promise<void> {
    if (!actor) {
      throw new ForbiddenException('Not authorized');
    }
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    if (
      actor.role !== UserRole.PARTNER &&
      actor.role !== UserRole.DISTRIBUTOR
    ) {
      throw new ForbiddenException(
        'Only Hub, Distributor and Admin can manage D-Value invoices',
      );
    }

    const orderUserId =
      typeof order.user === 'object' &&
      order.user !== null &&
      '_id' in (order.user as object)
        ? String((order.user as any)._id)
        : String(order.user);
    const inNetwork = await this.usersService.isUserInViewerNetwork(
      actor,
      orderUserId,
    );
    if (!inNetwork) {
      throw new ForbiddenException(
        'You can only manage orders from users in your network',
      );
    }

    const shop = (order.user || {}) as {
      hubPartnerCode?: string;
      country?: string;
      role?: string;
      parentLinkAssignedAt?: Date;
      previousParentPartnerCode?: string;
      dValueInvoiceEnabled?: boolean;
    };
    const actingCode = await this.usersService.resolveActingParentForOrder({
      actingParentPartnerCode: (order as any).actingParentPartnerCode,
      createdAt: (order as any).createdAt,
      user: shop,
    });
    const parentRoles = await this.usersService.getShopParentLinkRolesByCode([
      actingCode,
    ]);
    const canManage = this.usersService.canViewerManageShopOrder(
      actor,
      {
        actingParentPartnerCode: actingCode,
        hubPartnerCode: shop.hubPartnerCode,
      },
      actingCode ? parentRoles.get(actingCode) : undefined,
      shop.role,
    );
    if (!canManage) {
      throw new ForbiddenException(
        'You can only manage D-Value invoices for orders created under you.',
      );
    }
    if (requireEnabled && !shop.dValueInvoiceEnabled) {
      throw new ForbiddenException(
        'D-Value Invoice is not enabled for this shop. Turn it on from the shop settings.',
      );
    }
  }

  /** Shop D-Value checkout needs the D-Value toggle (Hub / Distributor / Admin). */
  private assertShopCanRequestDValueSplit(shop: UserDocument | null): void {
    if (shop?.role !== UserRole.CERTIFIED_SHOP) {
      throw new BadRequestException(
        'D-Value invoices are only available for shop orders.',
      );
    }
    if (!shop.dValueInvoiceEnabled) {
      throw new BadRequestException(
        'D-Value invoices are not enabled for your shop. Please contact your Hub.',
      );
    }
  }

  private dValueLineKey(item: {
    product: unknown;
    size?: unknown;
    orderType?: unknown;
  }): string {
    return `${String(item.product)}|${String(item.size)}|${normalizeOrderItemType(item.orderType as any)}`;
  }

  /**
   * Shop D-Value order request split:
   *  Invoice B (D-Value)  — Pricing Group D-Value prices, VAT on its own base.
   *  Invoice A (Original) — per line Original − D-Value, plus shipping,
   *                         discount and the remaining VAT.
   * A + B always equals the order total. Prices already on Invoice B stay
   * locked (lockedDValueLines); only new lines read the Pricing Group.
   */
  private async computeDValueSplitInvoices(
    shop: UserDocument,
    order: {
      items: Array<{
        product: unknown;
        name: string;
        size: string;
        quantity: number;
        orderType?: unknown;
        price: number;
        image?: string;
      }>;
      shippingFee?: number;
      discount?: number;
      vatAmount?: number;
      vatRate?: number;
      totalAmount: number;
      shippingAddress?: any;
    },
    lockedDValueLines?: Map<string, number>,
  ) {
    const group = await this.resolvePricingGroupForUser(shop);
    const dValueByKey = new Map<string, number>();
    for (const entry of group?.dValuePrices || []) {
      dValueByKey.set(
        `${String(entry.productId)}|${String(entry.size)}`,
        Number(entry.price),
      );
    }

    const missing: string[] = [];
    const notLower: string[] = [];
    const originalItems: Array<Record<string, any>> = [];
    const dValueItems: Array<Record<string, any>> = [];
    for (const item of order.items || []) {
      const label = `${item.name} (${item.size})`;
      const orderType = normalizeOrderItemType(item.orderType as any);
      let dValueLine = lockedDValueLines?.get(this.dValueLineKey(item));
      if (dValueLine == null) {
        const unit = dValueByKey.get(
          `${String(item.product)}|${String(item.size)}`,
        );
        if (unit == null || !Number.isFinite(unit)) {
          missing.push(label);
          continue;
        }
        dValueLine = roundMoney(
          resolveOrderLinePrice(unit, orderType, item.name),
        );
      }
      const originalLine = roundMoney(Number(item.price) || 0);
      if (dValueLine >= originalLine) {
        notLower.push(label);
        continue;
      }
      const line = {
        product: String(item.product),
        name: item.name,
        size: item.size,
        quantity: Math.max(1, Number(item.quantity) || 1),
        orderType,
        image: item.image || '',
      };
      dValueItems.push({ ...line, price: dValueLine });
      originalItems.push({
        ...line,
        price: roundMoney(originalLine - dValueLine),
      });
    }
    if (missing.length) {
      throw new BadRequestException(
        `D-Value price is not set for: ${missing.join(', ')}. Please contact Admin.`,
      );
    }
    if (notLower.length) {
      throw new BadRequestException(
        `D-Value price must be lower than the original price for: ${notLower.join(', ')}. Please contact Admin.`,
      );
    }

    const address = order.shippingAddress || {};
    const dValueSubtotal = roundMoney(getItemsSubtotal(dValueItems as any));
    const dValueVat = calculateEuropeOrderVatAmount(
      getOrderVatTaxableBase(dValueSubtotal, 0),
      {
        country: address.country || shop?.country,
        taxId: address.taxId,
        noVatId: address.noVatId,
      },
    );
    const dValueTotal = roundMoney(dValueSubtotal + dValueVat.amount);

    const discount = roundMoney(Number(order.discount) || 0);
    const originalSubtotal = roundMoney(getItemsSubtotal(originalItems as any));
    const originalTotal = roundMoney(
      (Number(order.totalAmount) || 0) - dValueTotal,
    );
    if (discount - originalSubtotal > 0.01 || originalTotal < 0) {
      throw new BadRequestException(
        'The order discount is larger than the Original invoice amount, so this order cannot be split into D-Value invoices.',
      );
    }

    return {
      original: {
        items: originalItems,
        totalAmount: originalTotal,
        shippingFee: roundMoney(Number(order.shippingFee) || 0),
        vatAmount: roundMoney(
          Math.max(0, (Number(order.vatAmount) || 0) - dValueVat.amount),
        ),
        vatRate: Number(order.vatRate) || 0,
        discount,
      },
      dValue: {
        items: dValueItems,
        totalAmount: dValueTotal,
        shippingFee: 0,
        vatAmount: dValueVat.amount,
        vatRate: dValueVat.rate,
        discount: 0,
      },
    };
  }

  /**
   * Save an edited order. D-Value orders: Invoice A/B are written first; if the
   * order save then fails they are re-synced to the stored order.
   */
  private async saveOrderWithDValueSplit(
    order: OrderDocument,
    shopUser: UserDocument | null | undefined,
    actorId: unknown,
  ): Promise<OrderDocument> {
    const split = await this.computeDValueSplitForExistingOrder(order, shopUser);
    if (!split) return order.save();

    await this.saveDValueSplitInvoices(order, split, actorId);
    try {
      return await order.save();
    } catch (err) {
      try {
        const stored = await this.orderModel.findById(order._id);
        if (stored) {
          const restored = await this.computeDValueSplitForExistingOrder(
            stored,
            shopUser,
          );
          if (restored) {
            await this.saveDValueSplitInvoices(stored, restored, actorId);
          }
        }
      } catch (restoreErr) {
        this.logger.error(
          `Failed to re-sync D-Value invoices for order ${order.orderNumber}`,
          (restoreErr as Error)?.stack || restoreErr,
        );
      }
      throw err;
    }
  }

  /** Re-split a D-Value order after shipping / items change; null for other orders. */
  private async computeDValueSplitForExistingOrder(
    order: OrderDocument,
    shopUser?: UserDocument | null,
  ) {
    if (!(order as any).isDValueOrder) return null;
    const shop =
      shopUser && (shopUser as any).role
        ? shopUser
        : await this.usersService.findOne(
            String((order.user as any)?._id || order.user),
          );
    if (!shop) throw new NotFoundException('Shop not found');

    const existing = await this.duplicateInvoiceModel
      .findOne({
        invoiceNumber: this.dValueSplitInvoiceNumbers(order.orderNumber).dValue,
      })
      .lean()
      .exec();
    const locked = new Map<string, number>();
    for (const line of existing?.items || []) {
      locked.set(this.dValueLineKey(line as any), Number(line.price));
    }
    return this.computeDValueSplitInvoices(shop, order as any, locked);
  }

  /**
   * Email attachments for a D-Value order: Invoice A (Original) and Invoice B
   * (D-Value) PDFs. Empty for other orders. A PDF failure never blocks the email.
   */
  private async buildDValueSplitPdfAttachments(
    order: OrderDocument,
  ): Promise<{ filename: string; content: Buffer }[]> {
    if (!(order as any)?.isDValueOrder) return [];
    try {
      const numbers = this.dValueSplitInvoiceNumbers(order.orderNumber);
      const [orderWithUser, invoices] = await Promise.all([
        this.orderModel.findById(order._id).populate('user'),
        this.duplicateInvoiceModel
          .find({
            orderId: order._id,
            invoiceNumber: { $in: [numbers.original, numbers.dValue] },
          })
          .exec(),
      ]);
      const source = (orderWithUser || order) as OrderDocument;
      const ordered = [numbers.original, numbers.dValue]
        .map((n) => invoices.find((i) => i.invoiceNumber === n))
        .filter(Boolean) as DuplicateInvoiceDocument[];
      const attachments: { filename: string; content: Buffer }[] = [];
      for (const invoice of ordered) {
        const content = await this.pdfService.generateOrderDetails(
          this.buildDuplicateInvoiceSnapshot(source, invoice) as any,
          {
            headerTitle: 'Invoice',
            displayOrderNumber: invoice.invoiceNumber,
          },
        );
        const label =
          (invoice as any).invoiceType === 'original' ? 'Original' : 'D-Value';
        attachments.push({
          filename: `Invoice_${invoice.invoiceNumber}_${label}.pdf`,
          content,
        });
      }
      return attachments;
    } catch (err) {
      this.logger.error(
        `Failed to build D-Value invoice PDFs for ${order?.orderNumber}`,
        (err as Error)?.stack || err,
      );
      return [];
    }
  }

  private dValueSplitInvoiceNumbers(orderNumber: string) {
    return { original: `${orderNumber}-A`, dValue: `${orderNumber}-D1` };
  }

  /** Upsert Invoice A + Invoice B by invoice number (never duplicates). */
  private async saveDValueSplitInvoices(
    order: OrderDocument,
    split: Awaited<ReturnType<OrdersService['computeDValueSplitInvoices']>>,
    actorId: unknown,
  ): Promise<void> {
    const numbers = this.dValueSplitInvoiceNumbers(order.orderNumber);
    const common = {
      orderId: order._id as Types.ObjectId,
      currency: order.currency || 'USD',
      shippingAddress: order.shippingAddress,
    };
    const entries = [
      {
        invoiceNumber: numbers.original,
        invoiceType: 'original',
        sequence: 0,
        ...split.original,
      },
      {
        invoiceNumber: numbers.dValue,
        invoiceType: 'd_value',
        sequence: 1,
        ...split.dValue,
      },
    ];
    for (const entry of entries) {
      await this.duplicateInvoiceModel
        .findOneAndUpdate(
          { invoiceNumber: entry.invoiceNumber, orderId: common.orderId },
          {
            $set: { ...common, ...entry },
            $setOnInsert: { createdBy: actorId as Types.ObjectId },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
    }
  }

  /** Shop may use D-Value invoices only on its own orders, when its Hub enabled them. */
  private assertShopCanUseDValueInvoice(
    order: OrderDocument,
    actor: UserDocument,
  ): void {
    if (actor?.role !== UserRole.CERTIFIED_SHOP) {
      throw new ForbiddenException('Not authorized');
    }
    if (!actor.dValueInvoiceEnabled) {
      throw new ForbiddenException(
        'D-Value invoices are not enabled for your shop. Please contact your Hub.',
      );
    }
    const owner = order.user as any;
    const ownerId =
      owner && typeof owner === 'object' && '_id' in owner
        ? String(owner._id)
        : String(owner);
    if (ownerId !== String(actor._id)) {
      throw new ForbiddenException('You can only access your own orders');
    }
  }

  getShopDValueInvoiceStatus(actor: UserDocument) {
    return {
      enabled:
        actor?.role === UserRole.CERTIFIED_SHOP && !!actor.dValueInvoiceEnabled,
    };
  }

  /**
   * Shop-generated D-Value invoice: same items / quantities as the order, priced
   * with the Admin-defined D-Value prices of the shop's Pricing Group.
   * The original order is never modified.
   */
  async generateShopDValueInvoice(orderId: string, actor: UserDocument) {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new NotFoundException('Order not found');
    }
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    this.assertShopCanUseDValueInvoice(order, actor);

    if ((order as any).isDValueOrder) {
      throw new BadRequestException(
        'This order already has its Original and D-Value invoices.',
      );
    }
    if (isRegistrationOrder(order)) {
      throw new BadRequestException(
        'Cannot create D-Value invoice for registration orders',
      );
    }
    if (order.includesCertificationKit) {
      throw new BadRequestException(
        'D-Value invoices are not available for the Certification Kit Bundle.',
      );
    }
    const status = String(order.status || '').toUpperCase();
    if (status === OrderStatus.CANCELLED || status === OrderStatus.FAILED) {
      throw new BadRequestException(
        'D-Value invoices cannot be created for cancelled or failed orders',
      );
    }
    if (!order.items?.length) {
      throw new BadRequestException('This order has no items');
    }

    // D-Value price per assigned product size: Admin override, else the group price.
    const group = await this.resolvePricingGroupForUser(actor);
    const dValueByKey = new Map<string, number>();
    for (const groupItem of group?.products || []) {
      for (const s of groupItem.sizes || []) {
        dValueByKey.set(
          `${String(groupItem.productId)}|${String(s.size)}`,
          Number(s.price),
        );
      }
    }
    for (const entry of group?.dValuePrices || []) {
      const key = `${String(entry.productId)}|${String(entry.size)}`;
      if (dValueByKey.has(key)) dValueByKey.set(key, Number(entry.price));
    }

    const missing: string[] = [];
    const items = order.items.map((item) => {
      const unit = dValueByKey.get(
        `${String(item.product)}|${String(item.size)}`,
      );
      if (unit == null || !Number.isFinite(unit)) {
        missing.push(`${item.name} (${item.size})`);
      }
      return {
        product: String(item.product),
        name: item.name,
        size: item.size,
        quantity: Math.max(1, Number(item.quantity) || 1),
        orderType: normalizeOrderItemType(item.orderType),
        price: roundMoney(
          resolveOrderLinePrice(unit ?? 0, item.orderType, item.name),
        ),
        image: (item as any).image || '',
      };
    });
    if (missing.length) {
      throw new BadRequestException(
        `D-Value price is not set for: ${missing.join(', ')}. Please contact Admin.`,
      );
    }

    const shippingFee = roundMoney(order.shippingFee ?? 0);

    // Re-use the shop's latest D-Value invoice while nothing has changed.
    const latest = await this.duplicateInvoiceModel
      .findOne({
        orderId: order._id,
        createdBy: actor._id,
        invoiceType: { $ne: 'original' },
      })
      .sort({ sequence: -1 })
      .exec();
    const unchanged =
      !!latest &&
      roundMoney(latest.shippingFee ?? 0) === shippingFee &&
      roundMoney(latest.discount ?? 0) === roundMoney(order.discount ?? 0) &&
      latest.items.length === items.length &&
      latest.items.every(
        (prev: any, i) =>
          this.itemLineKey(prev) === this.itemLineKey(items[i]) &&
          Number(prev.quantity) === items[i].quantity &&
          roundMoney(Number(prev.price)) === items[i].price,
      );
    if (latest && unchanged) {
      return { duplicateInvoice: latest.toObject() };
    }

    const duplicate = await this.createDuplicateInvoiceRecord(
      order,
      items,
      shippingFee,
      actor,
    );
    return { duplicateInvoice: duplicate.toObject() };
  }

  async createAndSendDuplicateInvoice(
    orderId: string,
    dto: CreateDuplicateInvoiceDto,
    actor: UserDocument,
  ) {
    const order = await this.orderModel.findById(orderId).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    await this.assertParentCanUseDValueInvoice(order, actor, true);

    if (isRegistrationOrder(order)) {
      throw new BadRequestException(
        'Cannot create D-Value invoice for registration orders',
      );
    }
    if (order.includesCertificationKit) {
      throw new BadRequestException(
        'D-Value invoices are not available for the Certification Kit Bundle.',
      );
    }

    const status = String(order.status || '').toUpperCase();
    if (
      status === OrderStatus.SHIPPED ||
      status === OrderStatus.DELIVERED ||
      status === OrderStatus.CANCELLED ||
      status === OrderStatus.FAILED
    ) {
      throw new BadRequestException(
        'D-Value invoices cannot be created for shipped, delivered, cancelled, or failed orders',
      );
    }

    this.validateDuplicateInvoiceItems(order.items, dto.items);

    const items = dto.items.map((item) => ({
      product: item.product,
      name: item.name,
      size: item.size,
      quantity: Math.max(1, Number(item.quantity) || 1),
      orderType: normalizeOrderItemType(item.orderType),
      price: roundMoney(Number(item.price) || 0),
      image: item.image || '',
    }));

    const shippingFee =
      dto.shippingFee != null
        ? roundMoney(Number(dto.shippingFee))
        : roundMoney(order.shippingFee ?? 0);

    if (!Number.isFinite(shippingFee) || shippingFee < 0) {
      throw new BadRequestException('Enter a valid shipping amount');
    }

    const duplicate = await this.createDuplicateInvoiceRecord(
      order,
      items,
      shippingFee,
      actor,
    );

    const userDoc =
      typeof order.user === 'object' && order.user !== null
        ? (order.user as any)
        : await this.usersService.findOne(String(order.user));

    const to = this.mailService.resolveCustomerEmail(order, userDoc);
    if (!to) {
      await this.duplicateInvoiceModel.deleteOne({ _id: duplicate._id });
      throw new BadRequestException(
        'This order has no customer email to send the invoice to',
      );
    }

    try {
      const originalBuffer = await this.generateInvoicePdf(order);
      const duplicateSnapshot = this.buildDuplicateInvoiceSnapshot(
        order,
        duplicate,
      );
      const duplicateBuffer = await this.pdfService.generateOrderDetails(
        duplicateSnapshot as any,
        {
          headerTitle: 'Invoice',
          displayOrderNumber: duplicate.invoiceNumber,
        },
      );

      const amountPaid = getOrderAmountPaid(order);
      const remaining = getOrderRemainingAmount(order);
      const originalPayUrl =
        remaining > 0.01
          ? this.getOrderDirectPayUrl(String(order._id))
          : this.getOrderPayUrl(String(order._id), userDoc?.role);
      const viewUrl = this.getOrderPayUrl(String(order._id), userDoc?.role);

      await this.mailService.sendOrderInvoiceEmail(
        to,
        order,
        userDoc,
        originalBuffer,
        {
          payUrl: originalPayUrl,
          amountPaid,
          remainingAmount: remaining,
        },
      );

      await this.mailService.sendOrderInvoiceEmail(
        to,
        duplicateSnapshot,
        userDoc,
        duplicateBuffer,
        {
          payUrl: viewUrl,
          amountPaid: 0,
          dValue: { originalOrderNumber: order.orderNumber },
        },
      );
    } catch (err) {
      await this.duplicateInvoiceModel.deleteOne({ _id: duplicate._id });
      this.logger.error(
        `Failed to create and send D-Value invoice for order ${orderId}`,
        (err as Error)?.stack || err,
      );
      throw new BadRequestException(
        'Failed to generate or email the D-Value invoice. Please try again.',
      );
    }

    duplicate.sentAt = new Date();
    await duplicate.save();

    return {
      duplicateInvoice: duplicate.toObject(),
      order: await this.returnManagedOrder(order, actor),
    };
  }

  /**
   * Expand Certification Kit cart line into real component order items,
   * enforce one-time / qty=1 rules, and return the kit discount amount.
   */
  /**
   * Replace client-sent line prices with the buyer's Pricing Group price so a
   * stale cart (e.g. saved before a group/country change) can never charge the
   * wrong region's price. Certification Kit lines are priced separately.
   */
  private async repriceOrderItemsForUser<
    T extends {
      product: string;
      name: string;
      size: string;
      orderType?: 'unit' | 'case';
      price: number;
    },
  >(user: UserDocument | null | undefined, items: T[]): Promise<T[]> {
    if (!user || String(user.role) === UserRole.ADMIN) return items;

    const repriced: T[] = [];
    for (const item of items) {
      if (isCertificationKitCartItem(item as any)) {
        repriced.push(item);
        continue;
      }
      try {
        const pricedProduct = await this.productsService.findOne(
          String(item.product),
          user as any,
        );
        const sizeEntry = (pricedProduct?.sizes || []).find(
          (s: { size: string; price: number }) =>
            String(s.size) === String(item.size),
        );
        if (sizeEntry?.price == null) {
          repriced.push(item);
          continue;
        }
        const price = resolveOrderLinePrice(
          Number(sizeEntry.price) || 0,
          item.orderType,
          pricedProduct?.name || item.name,
        );
        if (Math.abs(price - (Number(item.price) || 0)) > 0.009) {
          this.logger.warn(
            `[Pricing] Corrected ${item.name} (${item.size}) for user ${user._id}: client=${item.price} group=${price} (${pricedProduct?.groupName || 'catalog'})`,
          );
        }
        repriced.push({ ...item, price });
      } catch (err) {
        this.logger.warn(
          `Could not resolve Pricing Group price for product ${item.product}; using client price`,
          (err as Error)?.message || err,
        );
        repriced.push(item);
      }
    }
    return repriced;
  }

  private async resolveCertificationKitOrderItems(
    user: UserDocument,
    items: Array<{
      product: string;
      name: string;
      size: string;
      quantity: number;
      orderType?: 'unit' | 'case';
      price: number;
      image?: string;
    }>,
  ): Promise<{
    items: typeof items;
    includesCertificationKit: boolean;
    kitDiscount: number;
    freeShipping: boolean;
    extras: { certificationKitFee?: number; certificationKitTraining?: number };
  }> {
    const kitIndexes = items
      .map((item, index) => (isCertificationKitCartItem(item) ? index : -1))
      .filter((index) => index >= 0);

    if (kitIndexes.length === 0) {
      return {
        items,
        includesCertificationKit: false,
        kitDiscount: 0,
        freeShipping: false,
        extras: {},
      };
    }

    if (!isCertificationKitEligibleUser(user)) {
      throw new BadRequestException(
        'The Certification Kit is only available to shops that have not paid their certification fee yet.',
      );
    }

    if (kitIndexes.length > 1) {
      throw new BadRequestException(
        'Only one Certification Kit Bundle can be purchased.',
      );
    }

    const kitItem = items[kitIndexes[0]];
    if (Number(kitItem.quantity) !== 1) {
      throw new BadRequestException(
        'Certification Kit Bundle quantity must be 1.',
      );
    }

    const alreadyOrdered = await this.productsService.hasActiveCertificationKitOrder(
      user._id.toString(),
    );
    if (alreadyOrdered) {
      throw new BadRequestException(
        'You have already purchased or reserved the Certification Kit Bundle.',
      );
    }

    const catalog = await this.productsService.findAll(
      'published',
      'shop',
      user as any,
    );
    // The kit saved by the shop's Hub/Distributor, priced from the shop's own catalog.
    const resolved = await this.productsService.resolveSavedCertificationKitForShop(
      user as any,
      catalog,
    );
    if (!resolved) {
      throw new BadRequestException(
        'The Certification Kit is not available for your shop right now.',
      );
    }
    const { components, config } = resolved;

    const componentsSubtotal = components.reduce(
      (sum, c) => sum + c.unitPrice * c.quantity,
      0,
    );
    const { discount: kitDiscount } = applyCertificationKitDiscount(
      componentsSubtotal,
      config.discountPercent,
    );
    const kitExtras = getCertificationKitExtras(config);

    const expanded = components.map((c) => ({
      product: c.productId,
      name: c.name,
      size: c.size,
      quantity: c.quantity,
      orderType: 'unit' as const,
      price: c.unitPrice,
      image: c.image || '',
    }));

    const withoutKit = items.filter((_, index) => index !== kitIndexes[0]);
    return {
      items: [...withoutKit, ...expanded],
      includesCertificationKit: true,
      kitDiscount,
      freeShipping: kitExtras.freeShipping,
      extras: {
        certificationKitFee: kitExtras.certificationFee,
        certificationKitTraining: kitExtras.trainingPrice,
      },
    };
  }

  /** Waive activation: mark shop paid after a successful kit purchase. */
  private async applyCertificationKitPurchaseBenefits(
    order: OrderDocument,
  ): Promise<void> {
    const userId = String((order as any).user?._id || (order as any).user || '');
    if (!userId) return;

    try {
      const existing = await this.usersService.findOne(userId);
      if (existing?.isPartnerPaid) {
        return;
      }
      await this.usersService.update(
        userId,
        {
          isPartnerPaid: true,
          status: UserStatus.ACTIVE,
        } as any,
        { role: UserRole.ADMIN } as any,
      );
      this.logger.log(
        `Certification Kit purchase unlocked shop ${userId} (order ${order.orderNumber})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to unlock shop after Certification Kit purchase for order ${order.orderNumber}`,
        err,
      );
    }
  }

  /**
   * After save: if a concurrent request also created an active kit order,
   * cancel this one and reject so only one reservation remains.
   */
  private async assertSingleActiveCertificationKitOrder(
    userId: string,
    orderId: string,
  ): Promise<void> {
    const siblings = await this.orderModel
      .find({
        user: userId as any,
        includesCertificationKit: true,
        _id: { $ne: orderId },
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

    if (!siblings.length) return;

    await this.orderModel.findByIdAndUpdate(orderId, {
      status: OrderStatus.CANCELLED,
      cancellationReason: 'Duplicate Certification Kit Bundle order',
    });
    throw new BadRequestException(
      'You have already purchased or reserved the Certification Kit Bundle.',
    );
  }
}
