import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import {
  digitsOnly,
  fromStripeAmount,
  last4,
  normalizeCurrency,
  StripeAccountKey,
  toStripeAmount,
  userFacingStripeError,
} from '../stripe-wise-payouts.logic';
import { StripeWiseDestination } from '../entities/stripe-wise-destination.entity';

const MONEY_MGMT_VERSION = '2026-04-22.preview';

export type FinancialAccountBalance = {
  currency: string;
  available: number;
  inboundPending: number;
  outboundPending: number;
};

export type FinancialAccountSummary = {
  id: string;
  type: string;
  status: string;
  country: string | null;
  displayName: string | null;
  balances: FinancialAccountBalance[];
};

export type WiseOutboundTarget = {
  ok: true;
  recipientId: string;
  payoutMethodId: string;
  summary: string;
  bankName?: string | null;
  last4?: string | null;
  routingNumber?: string | null;
};

export type WiseOutboundTargetError = {
  ok: false;
  error: string;
};

export type OutboundPaymentResult = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  expectedArrivalDate?: string | null;
  failureMessage?: string | null;
  raw: Record<string, unknown>;
};

@Injectable()
export class StripeMoneyManagementService {
  private readonly logger = new Logger(StripeMoneyManagementService.name);

  constructor(private readonly config: ConfigService) {}

  private secretFor(key: StripeAccountKey): string | undefined {
    if (key === 'usa') {
      return this.config.get<string>('USA_STRIPE_SECRET_KEY') || undefined;
    }
    return this.config.get<string>('STRIPE_SECRET_KEY') || undefined;
  }

  async listFinancialAccounts(
    key: StripeAccountKey,
  ): Promise<{
    configured: boolean;
    accounts: FinancialAccountSummary[];
    error?: string;
  }> {
    const secret = this.secretFor(key);
    if (!secret) {
      return {
        configured: false,
        accounts: [],
        error:
          key === 'usa'
            ? 'USA Stripe is not configured.'
            : 'Stripe is not configured.',
      };
    }
    try {
      const payload = await this.request<{
        data?: Array<Record<string, any>>;
      }>(secret, 'GET', '/v2/money_management/financial_accounts?limit=20');
      const accounts = (payload.data || []).map((row) =>
        this.mapFinancialAccount(row),
      );
      return { configured: true, accounts };
    } catch (err) {
      const message = userFacingStripeError(err);
      this.logger.warn(`Financial accounts unavailable (${key}): ${message}`);
      return { configured: true, accounts: [], error: message };
    }
  }

  availableOnAccount(
    account: FinancialAccountSummary,
    currency: string,
  ): number {
    const code = normalizeCurrency(currency);
    return (
      account.balances.find((row) => row.currency === code)?.available ?? 0
    );
  }

  async resolveWiseOutboundTarget(
    key: StripeAccountKey,
    dest: StripeWiseDestination,
  ): Promise<WiseOutboundTarget | WiseOutboundTargetError> {
    const secret = this.secretFor(key);
    if (!secret) {
      return { ok: false, error: 'Stripe is not configured.' };
    }

    if (dest.stripeRecipientId && dest.stripePayoutMethodId) {
      try {
        const method = await this.request<Record<string, any>>(
          secret,
          'GET',
          `/v2/money_management/payout_methods/${dest.stripePayoutMethodId}`,
          undefined,
          { 'Stripe-Context': dest.stripeRecipientId },
        );
        const bank = method.bank_account || {};
        return {
          ok: true,
          recipientId: dest.stripeRecipientId,
          payoutMethodId: dest.stripePayoutMethodId,
          bankName: bank.bank_name || dest.bankName || null,
          last4: bank.last4 || last4(dest.accountNumber) || last4(dest.iban),
          routingNumber: bank.routing_number || dest.routingNumber || null,
          summary: `${bank.bank_name || dest.bankName || 'Wise'} • ****${bank.last4 || last4(dest.accountNumber) || '????'}`,
        };
      } catch {
        // Fall through to discovery.
      }
    }

    try {
      const accounts = await this.request<{
        data?: Array<{ id?: string; applied_configurations?: string[] }>;
      }>(secret, 'GET', '/v2/core/accounts?limit=20');
      const recipients = (accounts.data || []).filter((row) =>
        (row.applied_configurations || []).includes('recipient'),
      );

      const wantedLast4 = last4(dest.accountNumber) || last4(dest.iban);
      const wantedRouting = digitsOnly(dest.routingNumber);

      for (const recipient of recipients) {
        if (!recipient.id) continue;
        const methods = await this.request<{
          data?: Array<Record<string, any>>;
        }>(
          secret,
          'GET',
          '/v2/money_management/payout_methods?limit=20',
          undefined,
          { 'Stripe-Context': recipient.id },
        );
        for (const method of methods.data || []) {
          const bank = method.bank_account || {};
          const methodLast4 = String(bank.last4 || '');
          const methodRouting = digitsOnly(bank.routing_number);
          const last4Ok = !wantedLast4 || methodLast4 === wantedLast4;
          const routingOk =
            !wantedRouting ||
            !methodRouting ||
            methodRouting === wantedRouting;
          const nameHint = String(bank.bank_name || '').toLowerCase();
          const looksWise =
            nameHint.includes('wise') || nameHint.includes('column');
          if ((last4Ok && routingOk) || (looksWise && last4Ok)) {
            return {
              ok: true,
              recipientId: recipient.id,
              payoutMethodId: String(method.id),
              bankName: bank.bank_name || dest.bankName || null,
              last4: methodLast4 || wantedLast4,
              routingNumber: bank.routing_number || dest.routingNumber || null,
              summary: `${bank.bank_name || 'Wise'} • ****${methodLast4 || wantedLast4 || '????'}`,
            };
          }
        }
      }

      return {
        ok: false,
        error:
          'No Stripe recipient payout method matches the Wise receiving account. Add Wise as a recipient payout method in Stripe (Global Payouts / Financial Accounts), then refresh.',
      };
    } catch (err) {
      return { ok: false, error: userFacingStripeError(err) };
    }
  }

  async createOutboundPayment(params: {
    key: StripeAccountKey;
    financialAccountId: string;
    recipientId: string;
    payoutMethodId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    description?: string;
  }): Promise<OutboundPaymentResult> {
    const secret = this.secretFor(params.key);
    if (!secret) {
      throw new Error('Stripe is not configured.');
    }
    const currency = normalizeCurrency(params.currency).toLowerCase();
    const body = {
      from: {
        financial_account: params.financialAccountId,
        currency,
      },
      to: {
        recipient: params.recipientId,
        payout_method: params.payoutMethodId,
        currency,
      },
      amount: {
        value: toStripeAmount(params.amount, currency),
        currency,
      },
      description: params.description || 'SkyGloss Stripe Financial Account → Wise',
    };

    const raw = await this.request<Record<string, any>>(
      secret,
      'POST',
      '/v2/money_management/outbound_payments',
      body,
      { 'Idempotency-Key': `stripe-wise-fa:${params.idempotencyKey}` },
    );

    const amountObj = raw.amount || {};
    return {
      id: String(raw.id),
      status: String(raw.status || 'processing'),
      amount: fromStripeAmount(Number(amountObj.value || 0), amountObj.currency || currency),
      currency: normalizeCurrency(amountObj.currency || currency),
      expectedArrivalDate: raw.expected_arrival_date || null,
      failureMessage:
        raw.status_details?.failed?.reason ||
        raw.status_details?.failed?.message ||
        null,
      raw,
    };
  }

  async retrieveOutboundPayment(
    key: StripeAccountKey,
    outboundPaymentId: string,
  ): Promise<OutboundPaymentResult | null> {
    const secret = this.secretFor(key);
    if (!secret) return null;
    const raw = await this.request<Record<string, any>>(
      secret,
      'GET',
      `/v2/money_management/outbound_payments/${outboundPaymentId}`,
    );
    const amountObj = raw.amount || {};
    return {
      id: String(raw.id),
      status: String(raw.status || 'processing'),
      amount: fromStripeAmount(
        Number(amountObj.value || 0),
        amountObj.currency || 'usd',
      ),
      currency: normalizeCurrency(amountObj.currency || 'usd'),
      expectedArrivalDate: raw.expected_arrival_date || null,
      failureMessage:
        raw.status_details?.failed?.reason ||
        raw.status_details?.failed?.message ||
        null,
      raw,
    };
  }

  mapOutboundStatus(
    status: string,
  ): 'creating' | 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled' {
    const s = String(status || '').toLowerCase();
    if (s === 'posted' || s === 'succeeded' || s === 'completed') return 'paid';
    if (s === 'failed' || s === 'returned') return 'failed';
    if (s === 'canceled' || s === 'cancelled') return 'canceled';
    if (s === 'processing' || s === 'created') return 'pending';
    return 'in_transit';
  }

  private mapFinancialAccount(row: Record<string, any>): FinancialAccountSummary {
    const balances: FinancialAccountBalance[] = [];
    const available = row.balance?.available || {};
    const inbound = row.balance?.inbound_pending || {};
    const outbound = row.balance?.outbound_pending || {};
    const currencies = new Set([
      ...Object.keys(available),
      ...Object.keys(inbound),
      ...Object.keys(outbound),
    ]);
    for (const code of currencies) {
      const currency = normalizeCurrency(code);
      balances.push({
        currency,
        available: fromStripeAmount(
          Number(available[code]?.value ?? 0),
          currency,
        ),
        inboundPending: fromStripeAmount(
          Number(inbound[code]?.value ?? 0),
          currency,
        ),
        outboundPending: fromStripeAmount(
          Number(outbound[code]?.value ?? 0),
          currency,
        ),
      });
    }
    return {
      id: String(row.id),
      type: String(row.type || 'storage'),
      status: String(row.status || 'open'),
      country: row.country || null,
      displayName: row.display_name || null,
      balances,
    };
  }

  private request<T>(
    secret: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = https.request(
        {
          hostname: 'api.stripe.com',
          path,
          method,
          headers: {
            Authorization: `Bearer ${secret}`,
            'Stripe-Version': MONEY_MGMT_VERSION,
            Accept: 'application/json',
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
            ...(extraHeaders || {}),
          },
        },
        (res) => {
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk;
          });
          res.on('end', () => {
            let parsed: any = {};
            try {
              parsed = buf ? JSON.parse(buf) : {};
            } catch {
              parsed = { message: buf };
            }
            if ((res.statusCode || 500) >= 400) {
              const err: any = new Error(
                parsed?.error?.message ||
                  parsed?.message ||
                  `Stripe money management request failed (${res.statusCode})`,
              );
              err.code = parsed?.error?.code;
              err.raw = parsed?.error || parsed;
              reject(err);
              return;
            }
            resolve(parsed as T);
          });
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
