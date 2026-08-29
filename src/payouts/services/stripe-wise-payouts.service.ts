import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import {
  StripeWiseDestination,
  StripeWiseDestinationDocument,
} from '../entities/stripe-wise-destination.entity';
import {
  StripeWisePayout,
  StripeWisePayoutDocument,
} from '../entities/stripe-wise-payout.entity';
import {
  StripePaymentsToFa,
  StripePaymentsToFaDocument,
} from '../entities/stripe-payments-to-fa.entity';
import { CreatePaymentsToFaDto } from '../dto/create-payments-to-fa.dto';
import { CreateStripeWisePayoutDto } from '../dto/create-stripe-wise-payout.dto';
import { UpdateStripeWiseDestinationDto } from '../dto/update-stripe-wise-destination.dto';
import { StripeAccountService } from './stripe-account.service';
import { StripeMoneyManagementService } from './stripe-money-management.service';
import { StripePaymentBreakdownService } from './stripe-payment-breakdown.service';
import { WiseService } from './wise.service';
import {
  hasReceivingBankDetails,
  pickWiseReceivingAccount,
} from '../wise-receiving-details';
import {
  assertAmountWithinBalance,
  computeSettlement,
  DUPLICATE_WINDOW_MS,
  formatMoney,
  isStripeAccountKey,
  isValidCurrency,
  mapStripePayoutStatus,
  maskSecret,
  normalizeCurrency,
  parsePositiveAmount,
  shouldApplyWiseReceipt,
  shouldStartWiseReceiptWatch,
  StripeAccountKey,
  stripeStatusLabel,
  StripeWisePayoutStatus,
  toStripeAmount,
  userFacingStripeError,
  wiseStatusLabel,
  WiseReceiptStatus,
} from '../stripe-wise-payouts.logic';

const DEST_KEY = 'default';

export type AutomatedPayoutResult = {
  id: string;
  status: StripeWisePayoutStatus;
  wiseStatus: WiseReceiptStatus;
  stripePayoutId: string | null;
  stripeOutboundPaymentId: string | null;
  wiseTransactionId: string | null;
  wiseMatchedAt: Date | null;
  failureMessage: string | null;
};

@Injectable()
export class StripeWisePayoutsService implements OnModuleInit {
  private readonly logger = new Logger(StripeWisePayoutsService.name);
  private syncing = false;

  constructor(
    @InjectModel(StripeWiseDestination.name)
    private readonly destinationModel: Model<StripeWiseDestinationDocument>,
    @InjectModel(StripeWisePayout.name)
    private readonly payoutModel: Model<StripeWisePayoutDocument>,
    @InjectModel(StripePaymentsToFa.name)
    private readonly paymentsToFaModel: Model<StripePaymentsToFaDocument>,
    private readonly stripeAccounts: StripeAccountService,
    private readonly moneyManagement: StripeMoneyManagementService,
    private readonly paymentBreakdown: StripePaymentBreakdownService,
    private readonly wiseService: WiseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    void this.syncOpenPayouts();
  }

  @Cron('*/2 * * * *')
  async syncOpenPayouts(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const open = await this.payoutModel
        .find({
          $or: [
            { status: { $in: ['creating', 'pending', 'in_transit'] } },
            {
              status: 'paid',
              wiseStatus: { $in: ['not_started', 'awaiting_receipt'] },
            },
          ],
        })
        .limit(50)
        .exec();
      for (const item of open) {
        try {
          await this.refreshPayout(item);
        } catch (err) {
          this.logger.warn(
            `Stripe→Wise payout sync failed for ${item._id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      const openFaFunding = await this.paymentsToFaModel
        .find({ status: { $in: ['creating', 'pending', 'in_transit'] } })
        .limit(50)
        .exec();
      for (const item of openFaFunding) {
        try {
          await this.refreshPaymentsToFa(item);
        } catch (err) {
          this.logger.warn(
            `Payments→FA sync failed for ${item._id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } catch (err) {
      this.logger.error('Stripe→Wise payout sync cron failed', err);
    } finally {
      this.syncing = false;
    }
  }

  async getOverview() {
    const destination = await this.ensureDestination();
    const selectedKey: StripeAccountKey = isStripeAccountKey(
      destination.stripeAccountKey,
    )
      ? destination.stripeAccountKey
      : 'global';
    const destCurrency = normalizeCurrency(destination.currency) || 'USD';
    const currency = isValidCurrency(destCurrency) ? destCurrency : 'USD';

    const [global, usa, wise, globalFa, usaFa, globalOutbound, usaOutbound, paymentBreakdown] =
      await Promise.all([
      this.stripeAccounts.inspect('global'),
      this.stripeAccounts.inspect('usa'),
      this.safeWiseSummary(currency),
      this.moneyManagement.listFinancialAccounts('global'),
      this.moneyManagement.listFinancialAccounts('usa'),
      this.moneyManagement.resolveWiseOutboundTarget('global', destination),
      this.moneyManagement.resolveWiseOutboundTarget('usa', destination),
      this.paymentBreakdown.getBreakdown(currency),
    ]);
    const selected = selectedKey === 'usa' ? usa : global;
    const selectedOutbound =
      selectedKey === 'usa' ? usaOutbound : globalOutbound;
    let destResolution = selected.configured
      ? this.stripeAccounts.resolveDestination(selected, destination)
      : { ok: false as const, error: selected.error || 'Stripe is not configured.' };

    // Persist default-bank mode when Stripe bank list is unavailable so Send works.
    if (
      destResolution.ok &&
      'usedDefault' in destResolution &&
      destResolution.usedDefault &&
      !destination.payoutToDefaultStripeBank &&
      (selected.externalAccountsUnavailable ||
        selected.externalAccounts.length === 0) &&
      (destination.iban || destination.accountNumber)
    ) {
      destination.payoutToDefaultStripeBank = true;
      destination.lastVerifyError = undefined;
      await destination.save();
      destResolution = this.stripeAccounts.resolveDestination(
        selected,
        destination,
      );
    }

    if (selectedOutbound.ok) {
      let dirty = false;
      if (destination.stripeRecipientId !== selectedOutbound.recipientId) {
        destination.stripeRecipientId = selectedOutbound.recipientId;
        dirty = true;
      }
      if (destination.stripePayoutMethodId !== selectedOutbound.payoutMethodId) {
        destination.stripePayoutMethodId = selectedOutbound.payoutMethodId;
        dirty = true;
      }
      if (dirty) {
        destination.lastVerifyError = undefined;
        await destination.save();
      }
    }

    const financialAccounts = [
      ...(globalFa.accounts || []).map((account) => ({
        ...account,
        stripeAccountKey: 'global' as const,
        availableForCurrency: this.moneyManagement.availableOnAccount(
          account,
          currency,
        ),
      })),
      ...(usaFa.accounts || []).map((account) => ({
        ...account,
        stripeAccountKey: 'usa' as const,
        availableForCurrency: this.moneyManagement.availableOnAccount(
          account,
          currency,
        ),
      })),
    ];

    const preferredFa =
      financialAccounts.find(
        (account) => account.id === destination.stripeFinancialAccountId,
      ) ||
      financialAccounts.find(
        (account) =>
          account.stripeAccountKey === selectedKey &&
          account.status === 'open' &&
          account.availableForCurrency > 0,
      ) ||
      financialAccounts.find(
        (account) =>
          account.stripeAccountKey === selectedKey && account.status === 'open',
      ) ||
      null;

    const buildAccountSummary = (
      account: typeof global,
      outbound: typeof globalOutbound,
    ) => {
      const destResolution = account.configured
        ? this.stripeAccounts.resolveDestination(account, destination)
        : {
            ok: false as const,
            error: account.error || 'Stripe is not configured.',
          };
      return {
        key: account.key,
        configured: account.configured,
        payoutsEnabled: account.payoutsEnabled,
        defaultCurrency: account.defaultCurrency,
        country: account.country,
        error: account.error || null,
        available: account.available,
        destinationReady: destResolution.ok || outbound.ok,
        destinationError: destResolution.ok
          ? null
          : outbound.ok
            ? null
            : destResolution.error,
        wiseOutboundReady: outbound.ok,
        wiseOutboundError: outbound.ok ? null : outbound.error,
        wiseOutboundSummary: outbound.ok ? outbound.summary : null,
      };
    };
    const stripeAvailable = this.stripeAccounts.availableForCurrency(
      selected,
      currency,
    );

    const latestReceived = await this.payoutModel
      .findOne({ wiseStatus: 'received' })
      .sort({ wiseMatchedAt: -1, createdAt: -1 })
      .lean()
      .exec();

    return {
      destination: {
        ...this.toPublicDestination(destination, destResolution),
        wiseOutboundReady: selectedOutbound.ok,
        wiseOutboundError: selectedOutbound.ok ? null : selectedOutbound.error,
        wiseOutboundSummary: selectedOutbound.ok ? selectedOutbound.summary : null,
        preferredFinancialAccountId: preferredFa?.id || null,
      },
      stripe: {
        selectedAccountKey: selectedKey,
        accounts: [
          buildAccountSummary(global, globalOutbound),
          buildAccountSummary(usa, usaOutbound),
        ],
        available: stripeAvailable,
        availableBalances: selected.available || [],
        currency,
        payoutsEnabled: selected.payoutsEnabled,
        destinationReady: destResolution.ok || selectedOutbound.ok,
        destinationError: destResolution.ok
          ? null
          : selectedOutbound.ok
            ? null
            : destResolution.error ||
              (selectedOutbound.ok ? null : selectedOutbound.error),
        financialAccounts,
        financialAccountsError:
          globalFa.error || usaFa.error || null,
      },
      wise,
      paymentBreakdown,
      lastSettlement: latestReceived
        ? {
            payoutId: String(latestReceived._id),
            stripePayoutId: latestReceived.stripePayoutId || null,
            estimatedAmount: latestReceived.estimatedAmount ?? latestReceived.amount,
            actualReceivedAmount: latestReceived.actualReceivedAmount ?? null,
            previousBalance: latestReceived.wisePreviousBalance ?? null,
            receivedAmount: latestReceived.actualReceivedAmount ?? null,
            newBalance: latestReceived.wiseNewBalance ?? null,
            currency: normalizeCurrency(latestReceived.currency) || currency,
            matchedAt: latestReceived.wiseMatchedAt || null,
          }
        : null,
    };
  }

  async getDestination() {
    const destination = await this.ensureDestination();
    const overview = await this.stripeAccounts.inspect(
      isStripeAccountKey(destination.stripeAccountKey)
        ? destination.stripeAccountKey
        : 'global',
    );
    const resolution = overview.configured
      ? this.stripeAccounts.resolveDestination(overview, destination)
      : { ok: false as const, error: overview.error || 'Stripe is not configured.' };
    return this.toPublicDestination(destination, resolution);
  }

  async updateDestination(dto: UpdateStripeWiseDestinationDto) {
    const current = await this.ensureDestination();
    const currency = dto.currency
      ? normalizeCurrency(dto.currency)
      : normalizeCurrency(current.currency) || 'USD';
    if (dto.currency && !isValidCurrency(currency)) {
      throw new BadRequestException('Currency must be a 3-letter ISO code.');
    }

    const nextIban = this.keepOrReplace(current.iban, dto.iban);
    const nextAccount = this.keepOrReplace(current.accountNumber, dto.accountNumber);
    const nextRouting = this.keepOrReplace(current.routingNumber, dto.routingNumber);
    const nextSort = this.keepOrReplace(current.sortCode, dto.sortCode);
    const nextSwift = this.keepOrReplace(current.swiftBic, dto.swiftBic);

    if (
      dto.payoutToDefaultStripeBank !== true &&
      !nextIban &&
      !nextAccount
    ) {
      throw new BadRequestException(
        'Enter Wise IBAN or account number, or enable payout to the Stripe default bank if that bank is already Wise.',
      );
    }

    current.accountName = dto.accountName?.trim() || current.accountName;
    current.currency = currency;
    if (dto.country !== undefined) current.country = dto.country.trim();
    if (dto.accountHolderName !== undefined) {
      current.accountHolderName = dto.accountHolderName.trim();
    }
    if (dto.bankName !== undefined) current.bankName = dto.bankName.trim();
    current.iban = nextIban;
    current.accountNumber = nextAccount;
    current.routingNumber = nextRouting;
    current.sortCode = nextSort;
    current.swiftBic = nextSwift;
    if (dto.stripeAccountKey) current.stripeAccountKey = dto.stripeAccountKey;
    if (dto.payoutToDefaultStripeBank !== undefined) {
      current.payoutToDefaultStripeBank = dto.payoutToDefaultStripeBank;
    }
    current.stripeExternalAccountId = undefined;
    current.lastVerifyError = undefined;
    await current.save();

    const overview = await this.stripeAccounts.inspect(current.stripeAccountKey);
    const resolution = this.stripeAccounts.resolveDestination(overview, current);
    if (resolution.ok && resolution.destinationId) {
      current.stripeExternalAccountId = resolution.destinationId;
      current.lastVerifiedAt = new Date();
      current.lastVerifyError = undefined;
    } else if (!resolution.ok) {
      current.lastVerifyError = resolution.error;
    }
    await current.save();

    this.logger.log(
      `Stripe→Wise destination updated (currency=${current.currency}, stripe=${current.stripeAccountKey}, ready=${resolution.ok})`,
    );
    return this.toPublicDestination(current, resolution);
  }

  async importDestinationFromWise() {
    if (!this.wiseService.isConfigured()) {
      throw new BadRequestException(
        'Wise API is not configured. Set WISE_API_TOKEN to load receiving details, or enter them manually.',
      );
    }
    const current = await this.ensureDestination();
    const details = await this.wiseService.getReceivingAccountDetails(
      normalizeCurrency(current.currency) || 'USD',
    );
    const match = pickWiseReceivingAccount(
      details.accounts,
      normalizeCurrency(current.currency) || 'USD',
    );
    if (!match) {
      throw new BadRequestException(
        details.error ||
          'Wise did not return receiving account details for this profile. Enter bank details manually.',
      );
    }
    if (!hasReceivingBankDetails(match)) {
      throw new BadRequestException(
        `Wise ${match.currency} receiving details are not issued yet (preview only). Request local account details in Wise, or enter IBAN/account number manually.`,
      );
    }

    current.accountName =
      match.accountName || current.accountName || `Wise ${match.currency} account`;
    current.currency = match.currency;
    current.country = match.country || current.country;
    current.accountHolderName =
      match.accountHolderName || current.accountHolderName;
    current.bankName = match.bankName || current.bankName;
    current.iban = match.iban || current.iban;
    current.accountNumber = match.accountNumber || current.accountNumber;
    current.routingNumber = match.routingNumber || current.routingNumber;
    current.sortCode = match.sortCode || current.sortCode;
    current.swiftBic = match.swiftBic || current.swiftBic;

    const overview = await this.stripeAccounts.inspect(current.stripeAccountKey);
    const resolution = overview.configured
      ? this.stripeAccounts.resolveDestination(overview, current)
      : { ok: false as const, error: overview.error || 'Stripe is not configured.' };

    // Platform Stripe keys often cannot list payout banks. Persist default-bank
    // mode so Send to Wise stays enabled after refresh.
    if (
      resolution.ok &&
      'usedDefault' in resolution &&
      resolution.usedDefault &&
      (overview.externalAccountsUnavailable ||
        overview.externalAccounts.length === 0)
    ) {
      current.payoutToDefaultStripeBank = true;
    }
    if (resolution.ok && 'destinationId' in resolution && resolution.destinationId) {
      current.stripeExternalAccountId = resolution.destinationId;
      current.lastVerifiedAt = new Date();
      current.lastVerifyError = undefined;
    } else if (!resolution.ok) {
      current.lastVerifyError = resolution.error;
    }

    await current.save();
    return this.toPublicDestination(current, resolution);
  }

  async createPayout(adminId: string, dto: CreateStripeWisePayoutDto) {
    if (dto.confirmed !== true) {
      throw new BadRequestException(
        'Confirm the payout in the admin panel before sending funds.',
      );
    }

    let amount: number;
    try {
      amount = parsePositiveAmount(dto.amount);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid amount.',
      );
    }

    const currency = normalizeCurrency(dto.currency);
    if (!isValidCurrency(currency)) {
      throw new BadRequestException('Currency must be a 3-letter ISO code.');
    }

    const stripeAccountKey: StripeAccountKey = isStripeAccountKey(
      dto.stripeAccountKey,
    )
      ? dto.stripeAccountKey
      : 'global';

    const destination = await this.ensureDestination();
    if (normalizeCurrency(destination.currency) !== currency) {
      throw new BadRequestException(
        `Currency must match the configured Wise receiving account (${destination.currency}).`,
      );
    }

    const existing = await this.payoutModel
      .findOne({ idempotencyKey: dto.idempotencyKey })
      .exec();
    if (existing) {
      this.logger.warn(
        `Duplicate Stripe→Wise payout ignored (idempotencyKey=${dto.idempotencyKey})`,
      );
      return this.toPublicPayout(existing);
    }

    const recent = await this.payoutModel
      .findOne({
        createdBy: new Types.ObjectId(adminId),
        amount,
        currency,
        stripeAccountKey,
        status: { $in: ['creating', 'pending', 'in_transit'] },
        createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      })
      .exec();
    if (recent) {
      throw new BadRequestException(
        'A matching payout is already in progress. Wait for it to finish before sending another.',
      );
    }

    const sourceType =
      dto.sourceType === 'financial_account'
        ? 'financial_account'
        : 'payments_balance';

    if (sourceType === 'financial_account') {
      return this.createFinancialAccountPayout({
        adminId,
        dto,
        amount,
        currency,
        stripeAccountKey,
        destination,
      });
    }

    const overview = await this.stripeAccounts.inspect(stripeAccountKey);
    if (!overview.configured || overview.error) {
      throw new BadRequestException(
        overview.error || 'Stripe is not configured.',
      );
    }
    if (!overview.payoutsEnabled) {
      throw new BadRequestException(
        'Stripe payouts are not enabled for this account.',
      );
    }

    const available = this.stripeAccounts.availableForCurrency(
      overview,
      currency,
    );
    try {
      assertAmountWithinBalance(amount, available, currency);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Insufficient Stripe balance.',
      );
    }

    const resolution = this.stripeAccounts.resolveDestination(
      overview,
      destination,
    );
    if (!resolution.ok) {
      throw new BadRequestException(resolution.error);
    }

    const wiseBefore = await this.safeWiseBalance(currency);

    let record: StripeWisePayoutDocument;
    try {
      record = await this.payoutModel.create({
        idempotencyKey: dto.idempotencyKey,
        createdBy: new Types.ObjectId(adminId),
        amount,
        currency,
        stripeAccountKey,
        sourceType: 'payments_balance',
        stripeDestinationId: resolution.destinationId,
        status: 'creating',
        wiseStatus: 'not_started',
        estimatedAmount: amount,
        destinationName: destination.accountName,
        destinationSummary: resolution.summary,
        wisePreviousBalance: wiseBefore?.amount ?? undefined,
        snapshot: {
          stripeAvailableBefore: available,
          wiseBalanceBefore: wiseBefore,
          destinationReady: true,
          sourceType: 'payments_balance',
        },
      });
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        const dup = await this.payoutModel
          .findOne({ idempotencyKey: dto.idempotencyKey })
          .exec();
        if (dup) return this.toPublicPayout(dup);
      }
      throw err;
    }

    this.logger.log(
      `Stripe→Wise payout attempt ${record._id} amount=${amount} ${currency} stripe=${stripeAccountKey} admin=${adminId}`,
    );

    try {
      const payout = await this.stripeAccounts.createPayout({
        key: stripeAccountKey,
        amount: toStripeAmount(amount, currency),
        currency,
        destinationId: resolution.usedDefault
          ? undefined
          : resolution.destinationId,
        sourceType: this.stripeAccounts.preferredSourceType(overview, currency),
        idempotencyKey: dto.idempotencyKey,
        metadata: {
          skygloss_kind: 'stripe_to_wise',
          skygloss_payout_id: String(record._id),
        },
      });
      this.applyStripePayout(record, payout);
      if (shouldStartWiseReceiptWatch(record.status)) {
        record.wiseStatus = 'awaiting_receipt';
      }
      await record.save();
      this.logger.log(
        `Stripe→Wise payout created ${record.stripePayoutId} status=${record.status}`,
      );
      if (record.status === 'paid') {
        await this.tryMatchWiseReceipt(record);
      }
      return this.toPublicPayout(record);
    } catch (err) {
      record.status = 'failed';
      record.failureMessage = userFacingStripeError(err);
      record.stripeFailedAt = new Date();
      await record.save();
      this.logger.warn(
        `Stripe→Wise payout ${record._id} failed: ${record.failureMessage}`,
      );
      throw new BadRequestException(record.failureMessage);
    }
  }

  async listPaymentsToFaHistory(page = 1, limit = 30) {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 30;
    const skip = (safePage - 1) * safeLimit;
    const [items, total] = await Promise.all([
      this.paymentsToFaModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.paymentsToFaModel.countDocuments().exec(),
    ]);
    return {
      items: items.map((item) => this.toPublicPaymentsToFa(item as any)),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async fundFinancialAccount(adminId: string, dto: CreatePaymentsToFaDto) {
    if (dto.confirmed !== true) {
      throw new BadRequestException(
        'Confirm the transfer in the admin panel before sending funds.',
      );
    }

    let amount: number;
    try {
      amount = parsePositiveAmount(dto.amount);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid amount.',
      );
    }

    const currency = normalizeCurrency(dto.currency);
    if (!isValidCurrency(currency)) {
      throw new BadRequestException('Currency must be a 3-letter ISO code.');
    }

    const stripeAccountKey: StripeAccountKey = isStripeAccountKey(
      dto.stripeAccountKey,
    )
      ? dto.stripeAccountKey
      : 'global';

    const financialAccountId = String(dto.financialAccountId || '').trim();
    if (!financialAccountId) {
      throw new BadRequestException('Financial Account is required.');
    }

    const existing = await this.paymentsToFaModel
      .findOne({ idempotencyKey: dto.idempotencyKey })
      .exec();
    if (existing) {
      return this.toPublicPaymentsToFa(existing);
    }

    const recent = await this.paymentsToFaModel
      .findOne({
        createdBy: new Types.ObjectId(adminId),
        amount,
        currency,
        stripeAccountKey,
        stripeFinancialAccountId: financialAccountId,
        status: { $in: ['creating', 'pending', 'in_transit'] },
        createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      })
      .exec();
    if (recent) {
      throw new BadRequestException(
        'A matching transfer is already in progress. Wait for it to finish before sending another.',
      );
    }

    const overview = await this.stripeAccounts.inspect(stripeAccountKey);
    if (!overview.configured || overview.error) {
      throw new BadRequestException(
        overview.error || 'Stripe is not configured.',
      );
    }
    if (!overview.payoutsEnabled) {
      throw new BadRequestException(
        'Stripe payouts are not enabled for this account.',
      );
    }

    const available = this.stripeAccounts.availableForCurrency(
      overview,
      currency,
    );
    try {
      assertAmountWithinBalance(amount, available, currency);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Insufficient Stripe payments balance.',
      );
    }

    const faList = await this.moneyManagement.listFinancialAccounts(
      stripeAccountKey,
    );
    if (faList.error && !faList.accounts.length) {
      throw new BadRequestException(faList.error);
    }
    const account = faList.accounts.find((row) => row.id === financialAccountId);
    if (!account) {
      throw new BadRequestException(
        'Financial Account not found on this Stripe account.',
      );
    }
    if (account.status !== 'open') {
      throw new BadRequestException(
        `Financial Account is not open (status: ${account.status}).`,
      );
    }

    let record: StripePaymentsToFaDocument;
    try {
      record = await this.paymentsToFaModel.create({
        idempotencyKey: dto.idempotencyKey,
        createdBy: new Types.ObjectId(adminId),
        amount,
        currency,
        stripeAccountKey,
        stripeFinancialAccountId: financialAccountId,
        financialAccountName: account.displayName || account.id,
        status: 'creating',
        snapshot: {
          financialAccountType: account.type,
          financialAccountStatus: account.status,
        },
      });
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        const dup = await this.paymentsToFaModel
          .findOne({ idempotencyKey: dto.idempotencyKey })
          .exec();
        if (dup) return this.toPublicPaymentsToFa(dup);
      }
      throw err;
    }

    this.logger.log(
      `Payments→FA attempt ${record._id} amount=${amount} ${currency} stripe=${stripeAccountKey} fa=${financialAccountId}`,
    );

    try {
      const payout = await this.stripeAccounts.createPayoutToFinancialAccount({
        key: stripeAccountKey,
        amount: toStripeAmount(amount, currency),
        currency,
        financialAccountId,
        idempotencyKey: dto.idempotencyKey,
        metadata: {
          skygloss_kind: 'payments_to_fa',
          skygloss_transfer_id: String(record._id),
        },
      });
      this.applyPaymentsToFaPayout(record, payout);
      await record.save();
      this.logger.log(
        `Payments→FA created ${record.stripePayoutId} status=${record.status}`,
      );
      return this.toPublicPaymentsToFa(record);
    } catch (err) {
      record.status = 'failed';
      record.failureMessage = userFacingStripeError(err);
      record.stripeFailedAt = new Date();
      await record.save();
      this.logger.warn(
        `Payments→FA ${record._id} failed: ${record.failureMessage}`,
      );
      throw new BadRequestException(record.failureMessage);
    }
  }

  private async refreshPaymentsToFa(
    record: StripePaymentsToFaDocument,
  ): Promise<void> {
    if (!record.stripePayoutId) return;
    const payout = await this.stripeAccounts.retrievePayout(
      record.stripeAccountKey,
      record.stripePayoutId,
    );
    if (!payout) return;
    this.applyPaymentsToFaPayout(record, payout);
    await record.save();
  }

  private applyPaymentsToFaPayout(
    record: StripePaymentsToFaDocument,
    payout: {
      id: string;
      status?: string | null;
      arrival_date?: number | null;
      failure_code?: string | null;
      failure_message?: string | null;
    },
  ): void {
    record.stripePayoutId = payout.id;
    record.status = mapStripePayoutStatus(payout.status);
    if (payout.arrival_date) {
      record.arrivalDate = new Date(payout.arrival_date * 1000);
    }
    if (payout.failure_code) record.failureCode = payout.failure_code;
    if (payout.failure_message) record.failureMessage = payout.failure_message;
    if (record.status === 'paid' && !record.stripePaidAt) {
      record.stripePaidAt = new Date();
    }
    if (record.status === 'failed' && !record.stripeFailedAt) {
      record.stripeFailedAt = new Date();
    }
  }

  private toPublicPaymentsToFa(item: StripePaymentsToFaDocument | Record<string, any>) {
    return {
      id: String(item._id),
      date: item.createdAt || null,
      amount: item.amount,
      currency: item.currency,
      stripeAccountKey: item.stripeAccountKey,
      stripeFinancialAccountId: item.stripeFinancialAccountId,
      financialAccountName: item.financialAccountName || null,
      stripePayoutId: item.stripePayoutId || null,
      status: item.status,
      statusLabel: stripeStatusLabel(item.status),
      failureMessage: item.failureMessage || null,
      arrivalDate: item.arrivalDate || null,
    };
  }

  private async createFinancialAccountPayout(params: {
    adminId: string;
    dto: CreateStripeWisePayoutDto;
    amount: number;
    currency: string;
    stripeAccountKey: StripeAccountKey;
    destination: StripeWiseDestinationDocument;
    stripeMetadata?: Record<string, string>;
  }) {
    const { adminId, dto, amount, currency, stripeAccountKey, destination, stripeMetadata } =
      params;

    const faList = await this.moneyManagement.listFinancialAccounts(
      stripeAccountKey,
    );
    if (faList.error && !faList.accounts.length) {
      throw new BadRequestException(faList.error);
    }
    const financialAccountId =
      dto.financialAccountId ||
      destination.stripeFinancialAccountId ||
      faList.accounts.find((account) => account.status === 'open')?.id;
    if (!financialAccountId) {
      throw new BadRequestException(
        'No Stripe Financial Account found. Create one in Stripe Dashboard first.',
      );
    }
    const account = faList.accounts.find((row) => row.id === financialAccountId);
    if (!account) {
      throw new BadRequestException(
        'Selected Financial Account was not found on this Stripe account.',
      );
    }
    const available = this.moneyManagement.availableOnAccount(account, currency);
    try {
      assertAmountWithinBalance(amount, available, currency);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'Insufficient Financial Account balance.',
      );
    }

    const outboundTarget =
      await this.moneyManagement.resolveWiseOutboundTarget(
        stripeAccountKey,
        destination,
      );
    if (!outboundTarget.ok) {
      throw new BadRequestException(outboundTarget.error);
    }

    destination.stripeRecipientId = outboundTarget.recipientId;
    destination.stripePayoutMethodId = outboundTarget.payoutMethodId;
    destination.stripeFinancialAccountId = financialAccountId;
    await destination.save();

    const wiseBefore = await this.safeWiseBalance(currency);
    let record: StripeWisePayoutDocument;
    try {
      record = await this.payoutModel.create({
        idempotencyKey: dto.idempotencyKey,
        createdBy: new Types.ObjectId(adminId),
        amount,
        currency,
        stripeAccountKey,
        sourceType: 'financial_account',
        stripeFinancialAccountId: financialAccountId,
        stripeDestinationId: outboundTarget.payoutMethodId,
        status: 'creating',
        wiseStatus: 'not_started',
        estimatedAmount: amount,
        destinationName: destination.accountName,
        destinationSummary: outboundTarget.summary,
        wisePreviousBalance: wiseBefore?.amount ?? undefined,
        snapshot: {
          financialAccountAvailableBefore: available,
          wiseBalanceBefore: wiseBefore,
          sourceType: 'financial_account',
          financialAccountId,
          recipientId: outboundTarget.recipientId,
          payoutMethodId: outboundTarget.payoutMethodId,
          automated: Boolean(stripeMetadata),
        },
      });
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        const dup = await this.payoutModel
          .findOne({ idempotencyKey: dto.idempotencyKey })
          .exec();
        if (dup) {
          return stripeMetadata
            ? this.toAutomatedPayoutResult(dup)
            : this.toPublicPayout(dup);
        }
      }
      throw err;
    }

    this.logger.log(
      `Stripe FA→Wise payout attempt ${record._id} amount=${amount} ${currency} fa=${financialAccountId} admin=${adminId}`,
    );

    try {
      const outbound = await this.moneyManagement.createOutboundPayment({
        key: stripeAccountKey,
        financialAccountId,
        recipientId: outboundTarget.recipientId,
        payoutMethodId: outboundTarget.payoutMethodId,
        amount,
        currency,
        idempotencyKey: dto.idempotencyKey,
        description: `SkyGloss FA→Wise ${record._id}`,
      });
      this.applyOutboundPayment(record, outbound);
      if (shouldStartWiseReceiptWatch(record.status)) {
        record.wiseStatus = 'awaiting_receipt';
      }
      await record.save();
      this.logger.log(
        `Stripe FA→Wise outbound created ${record.stripeOutboundPaymentId} status=${record.status}`,
      );
      if (record.status === 'paid') {
        await this.tryMatchWiseReceipt(record);
      }
      return stripeMetadata
        ? this.toAutomatedPayoutResult(record)
        : this.toPublicPayout(record);
    } catch (err) {
      record.status = 'failed';
      record.failureMessage = userFacingStripeError(err);
      record.stripeFailedAt = new Date();
      await record.save();
      this.logger.warn(
        `Stripe FA→Wise payout ${record._id} failed: ${record.failureMessage}`,
      );
      throw new BadRequestException(record.failureMessage);
    }
  }

  async createAutomatedPayout(params: {
    adminId: string;
    amount: number;
    currency: string;
    stripeAccountKey: StripeAccountKey;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<AutomatedPayoutResult> {
    const amount = parsePositiveAmount(params.amount);
    const currency = normalizeCurrency(params.currency);
    if (!isValidCurrency(currency)) {
      throw new BadRequestException('Currency must be a 3-letter ISO code.');
    }
    const stripeAccountKey = isStripeAccountKey(params.stripeAccountKey)
      ? params.stripeAccountKey
      : 'global';

    const existing = await this.payoutModel
      .findOne({ idempotencyKey: params.idempotencyKey })
      .exec();
    if (existing) {
      await this.refreshPayout(existing);
      return this.toAutomatedPayoutResult(existing);
    }

    const preferredSource = this.automatedSourceType();
    const dto: CreateStripeWisePayoutDto = {
      amount,
      currency,
      stripeAccountKey,
      idempotencyKey: params.idempotencyKey,
      confirmed: true,
      sourceType: preferredSource,
    };

    try {
      if (preferredSource === 'financial_account') {
        return (await this.createFinancialAccountPayout({
          adminId: params.adminId,
          dto,
          amount,
          currency,
          stripeAccountKey,
          destination: await this.ensureDestination(),
          stripeMetadata: params.metadata,
        })) as AutomatedPayoutResult;
      }
      return await this.createPaymentsBalancePayout({
        adminId: params.adminId,
        dto,
        amount,
        currency,
        stripeAccountKey,
        destination: await this.ensureDestination(),
        stripeMetadata: params.metadata,
      });
    } catch (err) {
      const message =
        err instanceof BadRequestException
          ? String(err.message)
          : err instanceof Error
            ? err.message
            : 'Transfer failed.';
      if (
        preferredSource === 'financial_account' &&
        /insufficient|exceeds.*balance/i.test(message)
      ) {
        this.logger.warn(
          `Automated FA transfer failed for balance; retrying payments balance (${params.idempotencyKey})`,
        );
        return this.createPaymentsBalancePayout({
          adminId: params.adminId,
          dto: { ...dto, sourceType: 'payments_balance' },
          amount,
          currency,
          stripeAccountKey,
          destination: await this.ensureDestination(),
          stripeMetadata: params.metadata,
        });
      }
      throw err;
    }
  }

  async refreshPayoutForAutomation(
    record: StripeWisePayoutDocument,
  ): Promise<void> {
    await this.refreshPayout(record);
  }

  private automatedSourceType(): 'financial_account' | 'payments_balance' {
    const raw = this.config.get<string>('AUTO_COMMISSION_SOURCE_TYPE');
    if (raw && raw.trim().toLowerCase() === 'payments_balance') {
      return 'payments_balance';
    }
    return 'financial_account';
  }

  private toAutomatedPayoutResult(
    item: StripeWisePayoutDocument,
  ): AutomatedPayoutResult {
    return {
      id: String(item._id),
      status: item.status,
      wiseStatus: item.wiseStatus,
      stripePayoutId: item.stripePayoutId || null,
      stripeOutboundPaymentId: item.stripeOutboundPaymentId || null,
      wiseTransactionId: item.wiseTransactionId || null,
      wiseMatchedAt: item.wiseMatchedAt || null,
      failureMessage: item.failureMessage || null,
    };
  }

  private async createPaymentsBalancePayout(params: {
    adminId: string;
    dto: CreateStripeWisePayoutDto;
    amount: number;
    currency: string;
    stripeAccountKey: StripeAccountKey;
    destination: StripeWiseDestinationDocument;
    stripeMetadata?: Record<string, string>;
  }): Promise<AutomatedPayoutResult> {
    const {
      adminId,
      dto,
      amount,
      currency,
      stripeAccountKey,
      destination,
      stripeMetadata,
    } = params;

    const overview = await this.stripeAccounts.inspect(stripeAccountKey);
    if (!overview.configured || overview.error) {
      throw new BadRequestException(
        overview.error || 'Stripe is not configured.',
      );
    }
    if (!overview.payoutsEnabled) {
      throw new BadRequestException(
        'Stripe payouts are not enabled for this account.',
      );
    }

    const available = this.stripeAccounts.availableForCurrency(
      overview,
      currency,
    );
    assertAmountWithinBalance(amount, available, currency);

    const resolution = this.stripeAccounts.resolveDestination(
      overview,
      destination,
    );
    if (!resolution.ok) {
      throw new BadRequestException(resolution.error);
    }

    const wiseBefore = await this.safeWiseBalance(currency);
    let record: StripeWisePayoutDocument;
    try {
      record = await this.payoutModel.create({
        idempotencyKey: dto.idempotencyKey,
        createdBy: new Types.ObjectId(adminId),
        amount,
        currency,
        stripeAccountKey,
        sourceType: 'payments_balance',
        stripeDestinationId: resolution.destinationId,
        status: 'creating',
        wiseStatus: 'not_started',
        estimatedAmount: amount,
        destinationName: destination.accountName,
        destinationSummary: resolution.summary,
        wisePreviousBalance: wiseBefore?.amount ?? undefined,
        snapshot: {
          automated: true,
          stripeAvailableBefore: available,
          wiseBalanceBefore: wiseBefore,
          destinationReady: true,
          sourceType: 'payments_balance',
        },
      });
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        const dup = await this.payoutModel
          .findOne({ idempotencyKey: dto.idempotencyKey })
          .exec();
        if (dup) return this.toAutomatedPayoutResult(dup);
      }
      throw err;
    }

    try {
      const payout = await this.stripeAccounts.createPayout({
        key: stripeAccountKey,
        amount: toStripeAmount(amount, currency),
        currency,
        destinationId: resolution.usedDefault
          ? undefined
          : resolution.destinationId,
        sourceType: this.stripeAccounts.preferredSourceType(overview, currency),
        idempotencyKey: dto.idempotencyKey,
        metadata: {
          skygloss_kind: 'stripe_to_wise',
          skygloss_payout_id: String(record._id),
          ...stripeMetadata,
        },
      });
      this.applyStripePayout(record, payout);
      if (shouldStartWiseReceiptWatch(record.status)) {
        record.wiseStatus = 'awaiting_receipt';
      }
      await record.save();
      if (record.status === 'paid') {
        await this.tryMatchWiseReceipt(record);
      }
      return this.toAutomatedPayoutResult(record);
    } catch (err) {
      record.status = 'failed';
      record.failureMessage = userFacingStripeError(err);
      record.stripeFailedAt = new Date();
      await record.save();
      throw new BadRequestException(record.failureMessage);
    }
  }

  async listHistory(page = 1, limit = 30) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const [items, total] = await Promise.all([
      this.payoutModel
        .find()
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .exec(),
      this.payoutModel.countDocuments().exec(),
    ]);
    return {
      items: items.map((item) => this.toPublicPayout(item)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  async getPayout(id: string) {
    const item = await this.payoutModel.findById(id).exec();
    if (!item) {
      throw new BadRequestException('Payout not found.');
    }
    await this.refreshPayout(item);
    return this.toPublicPayout(item);
  }

  async handleStripeEvent(event: {
    id?: string;
    type?: string;
    data?: { object?: Record<string, any> };
  }) {
    const type = String(event?.type || '');
    if (!type.startsWith('payout.')) {
      return { received: true, ignored: true };
    }
    const obj = event.data?.object;
    const payoutId = obj?.id;
    if (!payoutId || obj?.object !== 'payout') {
      return { received: true, ignored: true };
    }

    const localId = obj.metadata?.skygloss_payout_id;
    const record = localId
      ? await this.payoutModel.findById(localId).exec()
      : await this.payoutModel.findOne({ stripePayoutId: payoutId }).exec();
    if (!record) {
      return { received: true, unmatched: true };
    }
    if (!record.stripePayoutId && payoutId) {
      record.stripePayoutId = String(payoutId);
    }
    await this.refreshPayout(record);
    return { received: true, payoutId: String(record._id) };
  }

  private async refreshPayout(record: StripeWisePayoutDocument) {
    if (record.stripeOutboundPaymentId) {
      const outbound = await this.moneyManagement.retrieveOutboundPayment(
        record.stripeAccountKey,
        record.stripeOutboundPaymentId,
      );
      if (outbound) {
        this.applyOutboundPayment(record, outbound);
      }
    } else if (record.stripePayoutId) {
      const payout = await this.stripeAccounts.retrievePayout(
        record.stripeAccountKey,
        record.stripePayoutId,
      );
      if (payout) {
        this.applyStripePayout(record, payout);
      }
    }
    if (shouldStartWiseReceiptWatch(record.status) && record.wiseStatus === 'not_started') {
      record.wiseStatus = 'awaiting_receipt';
    }
    if (record.status === 'failed' || record.status === 'canceled') {
      if (record.wiseStatus === 'awaiting_receipt' || record.wiseStatus === 'not_started') {
        record.wiseStatus = 'not_started';
      }
    }
    await record.save();
    if (shouldApplyWiseReceipt(record.status, record.wiseStatus)) {
      await this.tryMatchWiseReceipt(record);
    }
  }

  private applyOutboundPayment(
    record: StripeWisePayoutDocument,
    outbound: {
      id: string;
      status: string;
      expectedArrivalDate?: string | null;
      failureMessage?: string | null;
    },
  ) {
    record.stripeOutboundPaymentId = outbound.id;
    record.sourceType = 'financial_account';
    record.status = this.moneyManagement.mapOutboundStatus(outbound.status);
    if (outbound.expectedArrivalDate) {
      record.arrivalDate = new Date(outbound.expectedArrivalDate);
    }
    if (record.status === 'paid') {
      record.stripePaidAt = record.stripePaidAt || new Date();
      record.failureCode = undefined;
      record.failureMessage = undefined;
    }
    if (record.status === 'failed' || record.status === 'canceled') {
      record.stripeFailedAt = record.stripeFailedAt || new Date();
      record.failureMessage =
        outbound.failureMessage || record.failureMessage || 'Outbound payment failed';
    }
  }

  private applyStripePayout(
    record: StripeWisePayoutDocument,
    payout: {
      id: string;
      status?: string | null;
      arrival_date?: number | null;
      balance_transaction?: string | { id?: string } | null;
      failure_code?: string | null;
      failure_message?: string | null;
      destination?: string | { id?: string } | null;
    },
  ) {
    record.stripePayoutId = payout.id;
    record.status = mapStripePayoutStatus(payout.status);
    if (payout.arrival_date) {
      record.arrivalDate = new Date(payout.arrival_date * 1000);
    }
    const dest =
      typeof payout.destination === 'string'
        ? payout.destination
        : payout.destination?.id;
    if (dest) record.stripeDestinationId = dest;
    const txn =
      typeof payout.balance_transaction === 'string'
        ? payout.balance_transaction
        : payout.balance_transaction?.id;
    if (txn) record.stripeBalanceTransactionId = txn;
    if (payout.failure_code) record.failureCode = payout.failure_code;
    if (payout.failure_message) record.failureMessage = payout.failure_message;
    if (record.status === 'paid' && !record.stripePaidAt) {
      record.stripePaidAt = new Date();
    }
    if (record.status === 'failed' && !record.stripeFailedAt) {
      record.stripeFailedAt = new Date();
    }
  }

  private async tryMatchWiseReceipt(record: StripeWisePayoutDocument) {
    if (record.wiseStatus === 'received') return;
    if (!this.wiseService.isConfigured()) {
      record.wiseStatus = 'unavailable';
      await record.save();
      return;
    }

    const since = new Date(
      (record.createdAt as Date)?.getTime?.() || Date.now() - 86400000,
    );
    since.setHours(since.getHours() - 12);

    const alreadyLinked = new Set(
      (
        await this.payoutModel
          .find({
            wiseTransactionId: { $exists: true, $ne: null },
            _id: { $ne: record._id },
          })
          .select('wiseTransactionId')
          .lean()
          .exec()
      )
        .map((row) => row.wiseTransactionId)
        .filter(Boolean),
    );

    const match = await this.wiseService.findIncomingCredit({
      currency: record.currency,
      amount: record.estimatedAmount || record.amount,
      since,
      excludeIds: [...alreadyLinked] as string[],
    });

    if (!match.available) {
      record.wiseStatus = 'unavailable';
      await record.save();
      return;
    }
    if (!match.credit) {
      record.wiseStatus = 'awaiting_receipt';
      await record.save();
      return;
    }

    const previous =
      typeof record.wisePreviousBalance === 'number'
        ? record.wisePreviousBalance
        : (await this.safeWiseBalance(record.currency))?.amount ?? 0;
    const received = match.credit.amount;
    const current = (await this.safeWiseBalance(record.currency))?.amount;
    const settlement = computeSettlement(previous, received);

    record.wiseStatus = 'received';
    record.actualReceivedAmount = received;
    record.wisePreviousBalance = settlement.previousBalance;
    record.wiseNewBalance = current ?? settlement.newBalance;
    record.wiseTransactionId = match.credit.id;
    record.wiseMatchedAt = new Date();
    await record.save();
    this.logger.log(
      `Stripe→Wise payout ${record.stripePayoutId} matched Wise credit ${match.credit.id} actual=${received}`,
    );
  }

  private async safeWiseSummary(currency: string) {
    if (!this.wiseService.isConfigured()) {
      return {
        configured: false,
        available: false,
        currency,
        balance: null,
        error: 'Wise API is not configured.',
      };
    }
    try {
      const summary = await this.wiseService.getAccountSummary();
      const row = (summary.balances || []).find(
        (item: { currency?: string }) =>
          normalizeCurrency(item.currency) === normalizeCurrency(currency),
      );
      return {
        configured: true,
        available: true,
        currency,
        balance: row
          ? {
              currency: row.currency,
              amount: Number(row.amount || 0),
              reserved: Number(row.reserved || 0),
            }
          : { currency, amount: 0, reserved: 0 },
        profile: summary.profile,
        environment: summary.environment,
        balances: summary.balances,
      };
    } catch (err) {
      return {
        configured: true,
        available: false,
        currency,
        balance: null,
        error:
          err instanceof Error
            ? err.message
            : 'Wise balance could not be loaded.',
      };
    }
  }

  private async safeWiseBalance(currency: string) {
    const summary = await this.safeWiseSummary(currency);
    return summary.balance;
  }

  private async ensureDestination(): Promise<StripeWiseDestinationDocument> {
    let doc = await this.destinationModel.findOne({ key: DEST_KEY }).exec();
    if (!doc) {
      doc = await this.destinationModel.create({
        key: DEST_KEY,
        accountName: 'Wise receiving account',
        currency: 'USD',
        stripeAccountKey: 'global',
        payoutToDefaultStripeBank: false,
      });
    }
    const currency = normalizeCurrency(doc.currency) || 'USD';
    if (doc.currency !== currency) {
      doc.currency = currency;
      await doc.save();
    }
    return doc;
  }

  private keepOrReplace(
    current: string | undefined,
    incoming: string | undefined,
  ): string | undefined {
    if (incoming === undefined) return current;
    const trimmed = incoming.trim();
    if (!trimmed) return undefined;
    if (trimmed.includes('*')) return current;
    return trimmed.replace(/\s+/g, '');
  }

  private toPublicDestination(
    dest: StripeWiseDestinationDocument,
    resolution: { ok: boolean; error?: string; summary?: string },
  ) {
    return {
      configured: Boolean(dest.iban || dest.accountNumber || dest.payoutToDefaultStripeBank),
      accountName: dest.accountName,
      currency: normalizeCurrency(dest.currency) || 'USD',
      country: dest.country || null,
      accountHolderName: dest.accountHolderName || null,
      bankName: dest.bankName || null,
      ibanMasked: maskSecret(dest.iban),
      accountNumberMasked: maskSecret(dest.accountNumber),
      routingNumberMasked: maskSecret(dest.routingNumber),
      sortCodeMasked: maskSecret(dest.sortCode),
      swiftBicMasked: maskSecret(dest.swiftBic),
      hasIban: Boolean(dest.iban),
      hasAccountNumber: Boolean(dest.accountNumber),
      hasRoutingNumber: Boolean(dest.routingNumber),
      stripeAccountKey: dest.stripeAccountKey,
      payoutToDefaultStripeBank: Boolean(dest.payoutToDefaultStripeBank),
      stripeFinancialAccountId: dest.stripeFinancialAccountId || null,
      stripeRecipientId: dest.stripeRecipientId || null,
      stripePayoutMethodId: dest.stripePayoutMethodId || null,
      stripeDestinationReady: resolution.ok,
      stripeDestinationError: resolution.ok ? null : resolution.error || null,
      stripeDestinationSummary: resolution.ok ? resolution.summary || null : null,
      lastVerifiedAt: dest.lastVerifiedAt || null,
    };
  }

  private toPublicPayout(item: StripeWisePayoutDocument) {
    const estimated = item.estimatedAmount ?? item.amount;
    const actual = item.actualReceivedAmount;
    return {
      id: String(item._id),
      date: (item as any).createdAt || null,
      amount: item.amount,
      estimatedAmount: estimated,
      actualReceivedAmount: actual ?? null,
      amountKind:
        actual != null && Math.abs(actual - estimated) > 0.009
          ? 'actual_differs'
          : actual != null
            ? 'actual'
            : 'estimated',
      currency: item.currency,
      sourceType: item.sourceType || 'payments_balance',
      stripePayoutId: item.stripePayoutId || null,
      stripeOutboundPaymentId: item.stripeOutboundPaymentId || null,
      stripeFinancialAccountId: item.stripeFinancialAccountId || null,
      stripeAccountKey: item.stripeAccountKey,
      status: item.status,
      statusLabel: stripeStatusLabel(item.status),
      wiseStatus: item.wiseStatus,
      wiseStatusLabel: wiseStatusLabel(item.wiseStatus),
      destinationName: item.destinationName || null,
      destinationSummary: item.destinationSummary || null,
      failureMessage: item.failureMessage || null,
      arrivalDate: item.arrivalDate || null,
      settlement:
        item.wiseStatus === 'received'
          ? {
              previousBalance: item.wisePreviousBalance ?? null,
              receivedAmount: item.actualReceivedAmount ?? null,
              newBalance: item.wiseNewBalance ?? null,
              estimatedAmount: estimated,
            }
          : null,
      createdAt: (item as any).createdAt || null,
      updatedAt: (item as any).updatedAt || null,
      displayAmount: formatMoney(item.amount, item.currency),
    };
  }

  private isDuplicateKey(err: unknown): boolean {
    return Boolean(
      err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: number }).code === 11000,
    );
  }
}
