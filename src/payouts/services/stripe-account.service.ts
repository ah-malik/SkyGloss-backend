import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  digitsOnly,
  fromStripeAmount,
  last4,
  normalizeCurrency,
  StripeAccountKey,
  unsupportedDestinationMessage,
  userFacingStripeError,
} from '../stripe-wise-payouts.logic';
import { StripeWiseDestination } from '../entities/stripe-wise-destination.entity';

export type StripeBalanceRow = {
  currency: string;
  available: number;
  pending: number;
  sourceTypes: Record<string, number>;
};

export type StripeExternalBank = {
  id: string;
  last4?: string | null;
  routingNumber?: string | null;
  country?: string | null;
  currency: string;
  bankName?: string | null;
  status?: string | null;
  defaultForCurrency: boolean;
  availablePayoutMethods: string[];
};

export type StripeAccountOverview = {
  key: StripeAccountKey;
  configured: boolean;
  livemode: boolean | null;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  country: string | null;
  defaultCurrency: string | null;
  accountId: string | null;
  available: StripeBalanceRow[];
  externalAccounts: StripeExternalBank[];
  error?: string;
};

export type DestinationResolution =
  | {
      ok: true;
      destinationId?: string;
      summary: string;
      matchedLast4?: string | null;
      usedDefault: boolean;
    }
  | { ok: false; error: string };

@Injectable()
export class StripeAccountService {
  private readonly logger = new Logger(StripeAccountService.name);
  private readonly clients = new Map<StripeAccountKey, Stripe>();

  constructor(private readonly config: ConfigService) {
    const apiVersion =
      this.config.get<string>('STRIPE_API_VERSION') || '2022-11-15';
    const globalKey = this.config.get<string>('STRIPE_SECRET_KEY');
    const usaKey = this.config.get<string>('USA_STRIPE_SECRET_KEY');

    if (globalKey) {
      this.clients.set(
        'global',
        new Stripe(globalKey, {
          apiVersion: apiVersion as Stripe.LatestApiVersion,
        }),
      );
    }
    if (usaKey) {
      this.clients.set(
        'usa',
        new Stripe(usaKey, {
          apiVersion: apiVersion as Stripe.LatestApiVersion,
        }),
      );
    }
  }

  getClient(key: StripeAccountKey): Stripe | null {
    return this.clients.get(key) || null;
  }

  isConfigured(key: StripeAccountKey): boolean {
    return this.clients.has(key);
  }

  async inspect(key: StripeAccountKey): Promise<StripeAccountOverview> {
    const stripe = this.getClient(key);
    if (!stripe) {
      return {
        key,
        configured: false,
        livemode: null,
        payoutsEnabled: false,
        chargesEnabled: false,
        country: null,
        defaultCurrency: null,
        accountId: null,
        available: [],
        externalAccounts: [],
        error:
          key === 'usa'
            ? 'USA Stripe is not configured (USA_STRIPE_SECRET_KEY).'
            : 'Stripe is not configured (STRIPE_SECRET_KEY).',
      };
    }

    try {
      const [account, balance, banks] = await Promise.all([
        stripe.accounts.retrieve(),
        stripe.balance.retrieve(),
        this.listExternalBanks(stripe),
      ]);

      const available = this.mapBalance(balance.available, balance.pending);

      return {
        key,
        configured: true,
        livemode: Boolean((account as { livemode?: boolean }).livemode),
        payoutsEnabled: Boolean(account.payouts_enabled),
        chargesEnabled: Boolean(account.charges_enabled),
        country: account.country || null,
        defaultCurrency: normalizeCurrency(account.default_currency) || null,
        accountId: account.id || null,
        available,
        externalAccounts: banks,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to inspect Stripe ${key} account: ${userFacingStripeError(err)}`,
      );
      return {
        key,
        configured: true,
        livemode: null,
        payoutsEnabled: false,
        chargesEnabled: false,
        country: null,
        defaultCurrency: null,
        accountId: null,
        available: [],
        externalAccounts: [],
        error: userFacingStripeError(err),
      };
    }
  }

  availableForCurrency(
    overview: StripeAccountOverview,
    currency: string,
  ): number {
    const code = normalizeCurrency(currency);
    const row = overview.available.find((item) => item.currency === code);
    return row?.available ?? 0;
  }

  preferredSourceType(
    overview: StripeAccountOverview,
    currency: string,
  ): string | undefined {
    const code = normalizeCurrency(currency);
    const row = overview.available.find((item) => item.currency === code);
    if (!row) return undefined;
    const entries = Object.entries(row.sourceTypes || {}).sort(
      (a, b) => b[1] - a[1],
    );
    return entries[0]?.[0];
  }

  resolveDestination(
    overview: StripeAccountOverview,
    dest: StripeWiseDestination,
  ): DestinationResolution {
    if (!overview.configured) {
      return { ok: false, error: overview.error || 'Stripe is not configured.' };
    }
    if (overview.error) {
      return { ok: false, error: overview.error };
    }
    if (!overview.payoutsEnabled) {
      return {
        ok: false,
        error:
          'Stripe payouts are not enabled for this account. Enable payouts in the Stripe Dashboard before sending funds to Wise.',
      };
    }

    const currency = normalizeCurrency(dest.currency);
    const banks = overview.externalAccounts.filter(
      (bank) => bank.currency === currency,
    );

    if (dest.payoutToDefaultStripeBank) {
      const def =
        banks.find((bank) => bank.defaultForCurrency) ||
        banks[0] ||
        overview.externalAccounts.find((bank) => bank.defaultForCurrency);
      return {
        ok: true,
        usedDefault: true,
        destinationId: def?.id,
        matchedLast4: def?.last4,
        summary: def
          ? `${def.bankName || 'Default Stripe bank'} • ${currency} • ****${def.last4 || '????'}`
          : `Stripe default ${currency} payout bank (Wise must already be this account)`,
      };
    }

    const match = this.matchConfiguredBank(banks, dest);
    if (match) {
      return {
        ok: true,
        usedDefault: false,
        destinationId: match.id,
        matchedLast4: match.last4,
        summary: `${match.bankName || dest.bankName || dest.accountName || 'Wise'} • ${currency} • ****${match.last4 || '????'}`,
      };
    }

    if (dest.stripeExternalAccountId) {
      const cached = overview.externalAccounts.find(
        (bank) => bank.id === dest.stripeExternalAccountId,
      );
      if (cached && cached.currency === currency) {
        return {
          ok: true,
          usedDefault: false,
          destinationId: cached.id,
          matchedLast4: cached.last4,
          summary: `${cached.bankName || dest.accountName || 'Wise'} • ${currency} • ****${cached.last4 || '????'}`,
        };
      }
    }

    if (!this.hasReceivingDetails(dest)) {
      return {
        ok: false,
        error:
          'Configure Wise receiving account details (account/IBAN and routing where required) in Admin settings before sending a payout.',
      };
    }

    return {
      ok: false,
      error: unsupportedDestinationMessage(
        'The configured Wise account does not match any payout bank on this Stripe account.',
      ),
    };
  }

  async createPayout(params: {
    key: StripeAccountKey;
    amount: number;
    currency: string;
    destinationId?: string;
    sourceType?: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<Stripe.Payout> {
    const stripe = this.getClient(params.key);
    if (!stripe) {
      throw new Error(
        params.key === 'usa'
          ? 'USA Stripe is not configured.'
          : 'Stripe is not configured.',
      );
    }

    const body: Stripe.PayoutCreateParams = {
      amount: params.amount,
      currency: params.currency.toLowerCase(),
      metadata: params.metadata,
      statement_descriptor: 'WISE',
    };
    if (params.destinationId) {
      body.destination = params.destinationId;
    }
    if (params.sourceType) {
      body.source_type =
        params.sourceType as Stripe.PayoutCreateParams.SourceType;
    }

    return stripe.payouts.create(body, {
      idempotencyKey: `stripe-wise:${params.idempotencyKey}`,
    });
  }

  async retrievePayout(
    key: StripeAccountKey,
    payoutId: string,
  ): Promise<Stripe.Payout | null> {
    const stripe = this.getClient(key);
    if (!stripe) return null;
    return stripe.payouts.retrieve(payoutId);
  }

  constructEvent(
    key: StripeAccountKey,
    payload: Buffer,
    signature: string,
  ): Stripe.Event {
    const stripe = this.getClient(key);
    if (!stripe) {
      throw new Error('Stripe is not configured for this webhook.');
    }
    const secret = this.webhookSecret(key);
    if (!secret) {
      throw new Error('Stripe webhook secret is not configured.');
    }
    return stripe.webhooks.constructEvent(payload, signature, secret);
  }

  private webhookSecret(key: StripeAccountKey): string | undefined {
    if (key === 'usa') {
      return (
        this.config.get<string>('USA_STRIPE_WISE_PAYOUT_WEBHOOK_SECRET') ||
        this.config.get<string>('USA_STRIPE_WEBHOOK_SECRET')
      );
    }
    return (
      this.config.get<string>('STRIPE_WISE_PAYOUT_WEBHOOK_SECRET') ||
      this.config.get<string>('STRIPE_WEBHOOK_SECRET')
    );
  }

  private async listExternalBanks(stripe: Stripe): Promise<StripeExternalBank[]> {
    const account = await stripe.accounts.retrieve();
    if (!account.id) return [];
    try {
      const listed = await stripe.accounts.listExternalAccounts(account.id, {
        object: 'bank_account',
        limit: 100,
      });
      return (listed.data || []).map((item) => {
        const bank = item as Stripe.BankAccount;
        return {
          id: bank.id,
          last4: bank.last4 || null,
          routingNumber: bank.routing_number || null,
          country: bank.country || null,
          currency: normalizeCurrency(bank.currency),
          bankName: bank.bank_name || null,
          status: bank.status || null,
          defaultForCurrency: Boolean(bank.default_for_currency),
          availablePayoutMethods: Array.isArray(bank.available_payout_methods)
            ? bank.available_payout_methods.map(String)
            : [],
        };
      });
    } catch (err) {
      this.logger.warn(
        `Could not list Stripe external accounts: ${userFacingStripeError(err)}`,
      );
      return [];
    }
  }

  private mapBalance(
    available: Stripe.Balance.Available[],
    pending: Stripe.Balance.Available[],
  ): StripeBalanceRow[] {
    const pendingByCurrency = new Map(
      (pending || []).map((row) => [
        normalizeCurrency(row.currency),
        fromStripeAmount(row.amount, row.currency),
      ]),
    );
    return (available || []).map((row) => {
      const currency = normalizeCurrency(row.currency);
      const sourceTypes: Record<string, number> = {};
      const raw = row.source_types || {};
      for (const [name, minor] of Object.entries(raw)) {
        sourceTypes[name] = fromStripeAmount(Number(minor) || 0, currency);
      }
      return {
        currency,
        available: fromStripeAmount(row.amount, currency),
        pending: pendingByCurrency.get(currency) ?? 0,
        sourceTypes,
      };
    });
  }

  private matchConfiguredBank(
    banks: StripeExternalBank[],
    dest: StripeWiseDestination,
  ): StripeExternalBank | undefined {
    const accountLast4 = last4(dest.accountNumber) || last4(dest.iban);
    const routing = digitsOnly(dest.routingNumber);
    const sortCode = digitsOnly(dest.sortCode);

    return banks.find((bank) => {
      const last4Ok = accountLast4 && bank.last4 === accountLast4;
      const routingOk =
        !routing ||
        !bank.routingNumber ||
        digitsOnly(bank.routingNumber) === routing ||
        digitsOnly(bank.routingNumber) === sortCode;
      const countryOk =
        !dest.country ||
        !bank.country ||
        bank.country.toUpperCase() === dest.country.trim().toUpperCase();
      return Boolean(last4Ok && routingOk && countryOk);
    });
  }

  private hasReceivingDetails(dest: StripeWiseDestination): boolean {
    return Boolean(
      digitsOnly(dest.iban) ||
        digitsOnly(dest.accountNumber) ||
        dest.payoutToDefaultStripeBank,
    );
  }
}
