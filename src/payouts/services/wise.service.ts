import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import * as https from 'https';
import { currencyFromIban, defaultCurrencyForCountry, toIsoCountryCode } from '../wise-country-iso';
import { ibanValidationError, normalizeIban } from '../iban-validate';
import {
  parseWiseReceivingAccounts,
  pickWiseReceivingAccount,
  WiseReceivingAccount,
} from '../wise-receiving-details';

export type WiseBankDetails = {
  accountHolderName: string;
  bankName?: string;
  iban?: string;
  accountNumber?: string;
  routingNumber?: string;
  sortCode?: string;
  swiftBic?: string;
  country?: string;
  currency?: string;
  extraDetails?: Record<string, string>;
};

export type WiseRecipientUser = {
  email?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  streetAddress?: string;
  city?: string;
  zipCode?: string;
  country?: string;
};

export type WisePayoutInput = {
  amount: number;
  reference: string;
  customerTransactionId?: string;
  existingRecipientId?: string;
  existingTransferId?: string;
  bank: WiseBankDetails;
  recipient: WiseRecipientUser;
};

export class WisePayoutError extends BadRequestException {
  constructor(
    message: string,
    public readonly partial?: {
      transferId?: string;
      recipientId?: string;
      quoteId?: string;
      customerTransactionId?: string;
    },
  ) {
    super(message);
  }
}

export type WiseRecipientResult = {
  recipientId: string;
  type?: string;
  status: string;
  accountVerified: boolean;
  outcome: string;
  summary: string;
};

type WiseConfirmationOutcome = {
  type?: string;
  outcome?: string;
  requiresCustomerAcceptance?: boolean;
  providedName?: string;
  fieldsChecked?: string[];
};

type WiseConfirmations = {
  outcomes?: WiseConfirmationOutcome[];
};

export type WisePayoutResult = {
  transferId: string;
  quoteId: string;
  recipientId: string;
  customerTransactionId: string;
  reference: string;
  sourceAmount: number;
  targetAmount: number;
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  fee: number;
  status: string;
};

@Injectable()
export class WiseService {
  private readonly logger = new Logger(WiseService.name);
  private readonly http: AxiosInstance;
  private readonly token: string;
  private readonly sourceCurrency: string;
  private readonly balanceId?: number;
  private cachedProfileId?: number;

  constructor(private readonly config: ConfigService) {
    let baseURL = (
      this.config.get<string>('WISE_API_URL') || 'https://api.wise.com'
    ).replace(/\/+$/, '');
    if (
      baseURL.includes('api.sandbox.transferwise.tech') ||
      baseURL.includes('api.sandbox.wise.tech')
    ) {
      baseURL = 'https://api.wise-sandbox.com';
    }
    this.token = (this.config.get<string>('WISE_API_TOKEN') || '').trim();
    this.sourceCurrency = (
      this.config.get<string>('WISE_SOURCE_CURRENCY') || 'USD'
    ).toUpperCase();
    const balanceRaw = this.config.get<string>('WISE_BALANCE_ID');
    this.balanceId = balanceRaw ? Number(balanceRaw) : undefined;
    this.http = axios.create({
      baseURL,
      timeout: 45000,
      family: 4,
      httpsAgent: new https.Agent({ family: 4, keepAlive: true }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  toUserFacingError(message: string): string {
    const raw = String(message || '').trim();
    const lower = raw.toLowerCase();
    if (
      lower.includes('not supported') ||
      lower.includes('unsupported') ||
      lower.includes('no available') ||
      lower.includes('account-requirements')
    ) {
      return 'Wise payout is not currently supported for this country or currency.';
    }
    if (
      lower.includes('iban') ||
      lower.includes('account') ||
      lower.includes('recipient') ||
      lower.includes('422') ||
      lower.includes('invalid')
    ) {
      if (!this.looksInternalError(raw) && raw.length <= 180) {
        return raw;
      }
      return 'Bank details could not be verified. Please check the account details.';
    }
    if (
      lower.includes('insufficient') ||
      lower.includes('balance')
    ) {
      return 'Admin Wise balance is insufficient for this payout.';
    }
    if (this.looksInternalError(raw)) {
      return 'Wise payout failed. Check bank details and Wise balance, then retry.';
    }
    if (raw.length > 180) {
      return 'Wise payout failed. Please retry.';
    }
    return raw || 'Wise payout failed';
  }

  private looksInternalError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('{') ||
      lower.includes('http') ||
      lower.includes('bearer') ||
      lower.includes('token') ||
      lower.includes('stack') ||
      lower.includes('axios') ||
      lower.includes('econn') ||
      lower.includes('enotfound') ||
      lower.includes('getaddrinfo') ||
      lower.includes('etimedout') ||
      lower.includes('mongo') ||
      /at\s+\S+\s+\(/.test(message)
    );
  }

  async getRecipientRequirements(country: string, currency?: string) {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Wise is not configured. Set WISE_API_TOKEN on the backend.',
      );
    }
    const iso = toIsoCountryCode(country);
    if (!iso) {
      throw new BadRequestException('Please select a valid country.');
    }
    const target = (
      currency ||
      defaultCurrencyForCountry(iso) ||
      ''
    ).toUpperCase();
    if (!target) {
      throw new BadRequestException(
        'Wise payout is not currently supported for this country or currency.',
      );
    }

    let raw: any[];
    try {
      raw = await this.request<any[]>(
        'GET',
        `/v1/account-requirements?source=${this.sourceCurrency}&target=${encodeURIComponent(target)}&sourceAmount=100`,
        undefined,
        { 'Accept-Minor-Version': '1' },
      );
    } catch {
      throw new BadRequestException(
        'Wise payout is not currently supported for this country or currency.',
      );
    }

    const options = (Array.isArray(raw) ? raw : []).map((opt) => ({
      type: String(opt.type || ''),
      title: String(opt.title || opt.type || 'Bank account'),
      fields: this.flattenRequirementFields(opt),
    }));
    const selected =
      options.find((o) => o.type === 'iban') ||
      options.find((o) => o.type === 'aba') ||
      options.find((o) => o.type === 'sort_code') ||
      options.find((o) => o.type === 'swift_code') ||
      options[0];
    if (!selected) {
      throw new BadRequestException(
        'Wise payout is not currently supported for this country or currency.',
      );
    }

    return {
      country,
      countryIso: iso,
      currency: target,
      sourceCurrency: this.sourceCurrency,
      type: selected.type,
      title: selected.title,
      fields: selected.fields.filter(
        (f) =>
          !['accountHolderName', 'ownedByCustomer', 'currency', 'type', 'profile', 'bankName'].includes(
            f.key,
          ),
      ),
      alternatives: options.map((o) => ({ type: o.type, title: o.title })),
    };
  }

  async createOrUpdateRecipient(input: {
    bank: WiseBankDetails;
    recipient: WiseRecipientUser;
    existingRecipientId?: string;
    fingerprint?: string;
    previousFingerprint?: string;
    force?: boolean;
  }): Promise<WiseRecipientResult> {
    if (
      !input.force &&
      input.existingRecipientId &&
      input.fingerprint &&
      input.previousFingerprint &&
      input.fingerprint === input.previousFingerprint
    ) {
      return {
        recipientId: input.existingRecipientId,
        status: 'ready',
        accountVerified: false,
        outcome: 'REUSED',
        summary: 'Existing Wise recipient reused. Run Verify Bank to confirm the account.',
      };
    }
    const profileId = await this.getProfileId();
    const targetCurrency = this.resolveTargetCurrency(input.bank);
    const created = await this.createRecipient(
      profileId,
      input.bank,
      input.recipient,
      targetCurrency,
    );
    let confirmations = created.confirmations;
    try {
      const fresh = await this.request<{
        id: number;
        confirmations?: WiseConfirmations;
      }>('GET', `/v1/accounts/${created.id}`);
      if (fresh?.confirmations?.outcomes?.length) {
        confirmations = fresh.confirmations;
      }
    } catch {
      // Create response confirmations are enough when GET is unavailable.
    }

    let result = this.interpretConfirmations(confirmations);

    if (input.force) {
      const quote = await this.createQuote({
        profileId,
        targetCurrency,
        sourceAmount: 100,
        targetAccount: created.id,
      });
      try {
        const compat = await this.request<{ confirmations?: WiseConfirmations }>(
          'POST',
          `/v1/accounts/${created.id}/quotes/${quote.id}/compatibility`,
        );
        const fromCompat = this.interpretConfirmations(compat.confirmations);
        result = this.mergeVerification(result, fromCompat);
      } catch (err) {
        this.logger.warn(
          `Wise compatibility check skipped: ${this.errorMessage(err)}`,
        );
      }
    }

    if (result.outcome === 'FAILURE' || result.outcome === 'PARTIAL_FAILURE') {
      throw new BadRequestException(result.summary);
    }

    return {
      recipientId: String(created.id),
      status: result.accountVerified ? 'verified' : 'ready',
      accountVerified: result.accountVerified,
      outcome: result.outcome,
      summary: result.summary,
    };
  }

  async probePayoutRoute(recipientId: string, bank: WiseBankDetails) {
    const profileId = await this.getProfileId();
    const targetCurrency = this.resolveTargetCurrency(bank);
    await this.createQuote({
      profileId,
      targetCurrency,
      sourceAmount: 100,
      targetAccount: Number(recipientId),
    });
  }

  private interpretConfirmations(confirmations?: WiseConfirmations): {
    accountVerified: boolean;
    outcome: string;
    summary: string;
  } {
    const outcomes = confirmations?.outcomes || [];
    if (!outcomes.length) {
      return {
        accountVerified: false,
        outcome: 'FORMAT_ONLY',
        summary:
          'Wise does not currently confirm account existence for this currency (live checks: EUR, INR, IDR, CNY, KRW). Format and payout route were checked.',
      };
    }
    const normalized = outcomes.map((o) => String(o.outcome || '').toUpperCase());
    if (normalized.includes('FAILURE')) {
      return {
        accountVerified: false,
        outcome: 'FAILURE',
        summary:
          'Wise could not confirm this bank account exists or matches the account holder name.',
      };
    }
    if (normalized.includes('PARTIAL_FAILURE')) {
      return {
        accountVerified: false,
        outcome: 'PARTIAL_FAILURE',
        summary:
          'Wise found a name or account mismatch. Update the account holder name or IBAN and try again.',
      };
    }
    if (normalized.every((o) => o === 'SUCCESS')) {
      return {
        accountVerified: true,
        outcome: 'SUCCESS',
        summary: 'Wise confirmed this bank account exists.',
      };
    }
    return {
      accountVerified: false,
      outcome: 'COULD_NOT_CHECK',
      summary:
        'Wise could not reach the destination bank to confirm this account. Try again later.',
    };
  }

  private mergeVerification(
    a: { accountVerified: boolean; outcome: string; summary: string },
    b: { accountVerified: boolean; outcome: string; summary: string },
  ) {
    const rank: Record<string, number> = {
      FAILURE: 4,
      PARTIAL_FAILURE: 3,
      SUCCESS: 2,
      COULD_NOT_CHECK: 1,
      FORMAT_ONLY: 0,
      REUSED: 0,
    };
    return (rank[b.outcome] || 0) >= (rank[a.outcome] || 0) ? b : a;
  }

  async getTransfer(transferId: string | number) {
    return this.request<{
      id: number;
      status?: string;
      sourceValue?: number;
      targetValue?: number;
      sourceCurrency?: string;
      targetCurrency?: string;
      rate?: number;
      quoteUuid?: string;
    }>('GET', `/v1/transfers/${transferId}`);
  }

  isSandbox(): boolean {
    return Boolean(this.http.defaults.baseURL?.includes('sandbox'));
  }

  async simulateSandboxUntilOutgoingSent(
    transferId: string | number,
  ): Promise<string> {
    const id = String(transferId);
    let status = String((await this.getTransfer(id)).status || '').toLowerCase();
    if (status === 'outgoing_payment_sent') return status;
    if (!this.isSandbox()) return status;

    const steps =
      status === 'funds_converted'
        ? ['outgoing_payment_sent']
        : ['processing', 'funds_converted', 'outgoing_payment_sent'];

    for (const step of steps) {
      try {
        await this.request('GET', `/v1/simulation/transfers/${id}/${step}`);
      } catch (err) {
        this.logger.warn(
          `Sandbox simulate ${step} for transfer ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5500));
      status = String((await this.getTransfer(id)).status || '').toLowerCase();
      if (status === 'outgoing_payment_sent') return status;
    }
    return status;
  }

  getAccountMeta() {
    return {
      configured: this.isConfigured(),
      environment: this.http.defaults.baseURL?.includes('sandbox')
        ? 'sandbox'
        : 'production',
      sourceCurrency: this.sourceCurrency,
    };
  }

  async getAccountSummary() {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Wise is not configured. Set WISE_API_TOKEN on the backend.',
      );
    }

    const profileId = await this.getProfileId();
    const profiles = await this.request<
      Array<{
        id: number;
        type?: string;
        fullName?: string;
        details?: { name?: string; firstName?: string; lastName?: string };
      }>
    >('GET', '/v1/profiles');
    const profile = profiles.find((p) => p.id === profileId) || profiles[0];
    const balances = await this.request<
      Array<{
        id: number;
        type?: string;
        currency?: string;
        amount?: { value?: number; currency?: string };
        reservedAmount?: { value?: number };
      }>
    >('GET', `/v4/profiles/${profileId}/balances?types=STANDARD`);

    const mapped = (balances || []).map((b) => ({
      id: b.id,
      type: b.type || 'STANDARD',
      currency: (b.amount?.currency || b.currency || '').toUpperCase(),
      amount: Number(b.amount?.value || 0),
      reserved: Number(b.reservedAmount?.value || 0),
    }));
    const visible = mapped.filter(
      (b) => b.amount > 0 || b.currency === this.sourceCurrency,
    );
    const source = visible.find((b) => b.currency === this.sourceCurrency);
    const usdRates = await this.getUsdRates(
      visible.map((b) => b.currency).filter(Boolean),
    );
    const withUsd = visible.map((b) => {
      const rate = b.currency === 'USD' ? 1 : Number(usdRates[b.currency] || 0);
      const usdEquivalent =
        Math.round(b.amount * (rate || 0) * 100) / 100;
      return { ...b, usdEquivalent, usdRate: rate || null };
    });
    const totalUsdEquivalent =
      Math.round(
        withUsd.reduce((sum, b) => sum + (b.usdEquivalent || 0), 0) * 100,
      ) / 100;

    return {
      configured: true,
      environment: this.http.defaults.baseURL?.includes('sandbox')
        ? 'sandbox'
        : 'production',
      profile: {
        id: profileId,
        type: profile?.type || null,
        name:
          profile?.fullName ||
          profile?.details?.name ||
          [profile?.details?.firstName, profile?.details?.lastName]
            .filter(Boolean)
            .join(' ') ||
          null,
      },
      sourceCurrency: this.sourceCurrency,
      sourceBalance: source?.amount ?? 0,
      sourceBalanceId: source?.id ?? null,
      totalUsdEquivalent,
      balances: withUsd,
    };
  }

  async getReceivingAccountDetails(currency?: string): Promise<{
    configured: boolean;
    accounts: WiseReceivingAccount[];
    error?: string;
  }> {
    if (!this.isConfigured()) {
      return { configured: false, accounts: [] };
    }
    try {
      const profileId = await this.getProfileId();
      const payload = await this.request<any>(
        'GET',
        `/v1/profiles/${profileId}/account-details`,
      );
      const accounts = parseWiseReceivingAccounts(payload);
      const wanted = (currency || this.sourceCurrency || '').toUpperCase();
      const preferred = pickWiseReceivingAccount(accounts, wanted);
      const ordered = preferred
        ? [preferred, ...accounts.filter((item) => item !== preferred)]
        : accounts;
      return {
        configured: true,
        accounts: ordered,
      };
    } catch (err) {
      this.logger.warn(
        `Wise receiving account details unavailable: ${this.errorMessage(err)}`,
      );
      return {
        configured: true,
        accounts: [],
        error:
          'Wise did not return receiving bank details for this profile. Enter them manually in Admin settings.',
      };
    }
  }

  async findIncomingCredit(params: {
    currency: string;
    amount: number;
    since: Date;
    excludeIds?: string[];
  }): Promise<{
    available: boolean;
    credit?: { id: string; amount: number; currency: string; date?: string };
    error?: string;
  }> {
    if (!this.isConfigured()) {
      return { available: false, error: 'Wise is not configured.' };
    }
    try {
      const profileId = await this.getProfileId();
      const currency = (params.currency || this.sourceCurrency).toUpperCase();
      const balances = await this.request<
        Array<{
          id: number;
          currency?: string;
          amount?: { value?: number; currency?: string };
        }>
      >('GET', `/v4/profiles/${profileId}/balances?types=STANDARD`);
      const match = (balances || []).find(
        (b) =>
          (b.amount?.currency || b.currency || '').toUpperCase() === currency,
      );
      if (!match?.id) {
        return { available: true };
      }

      const intervalStart = params.since.toISOString();
      const intervalEnd = new Date().toISOString();
      const statement = await this.request<{
        transactions?: Array<{
          referenceNumber?: string;
          date?: string;
          amount?: { value?: number; currency?: string };
          type?: string;
          details?: { type?: string; description?: string };
        }>;
      }>(
        'GET',
        `/v1/profiles/${profileId}/balance-statements/${match.id}/statement.json?currency=${encodeURIComponent(currency)}&intervalStart=${encodeURIComponent(intervalStart)}&intervalEnd=${encodeURIComponent(intervalEnd)}&type=COMPACT`,
      );

      const exclude = new Set(params.excludeIds || []);
      const credits = (statement.transactions || []).filter((tx) => {
        const type = String(tx.type || tx.details?.type || '').toUpperCase();
        const amount = Number(tx.amount?.value || 0);
        const id = String(tx.referenceNumber || '');
        if (exclude.has(id)) return false;
        if (amount <= 0) return false;
        if (type.includes('DEBIT')) return false;
        const isCredit =
          type.includes('CREDIT') ||
          type.includes('DEPOSIT') ||
          type === '' ||
          amount > 0;
        if (!isCredit) return false;
        const delta = Math.abs(amount - params.amount);
        const allowed = Math.max(0.01, Math.abs(params.amount) * 0.05);
        return delta <= allowed;
      });

      const credit = credits.sort((a, b) => {
        const da = Math.abs(Number(a.amount?.value || 0) - params.amount);
        const db = Math.abs(Number(b.amount?.value || 0) - params.amount);
        return da - db;
      })[0];

      if (!credit) return { available: true };
      return {
        available: true,
        credit: {
          id: String(credit.referenceNumber || `${match.id}-${credit.date}`),
          amount: Number(credit.amount?.value || 0),
          currency,
          date: credit.date,
        },
      };
    } catch (err) {
      this.logger.warn(
        `Wise incoming credit lookup failed: ${this.errorMessage(err)}`,
      );
      return {
        available: false,
        error: 'Wise transaction status is not available for this account.',
      };
    }
  }

  private async getUsdRates(currencies: string[]): Promise<Record<string, number>> {
    const rates: Record<string, number> = { USD: 1 };
    const unique = [...new Set(currencies.map((c) => c.toUpperCase()))].filter(
      (c) => c && c !== 'USD',
    );
    await Promise.all(
      unique.map(async (source) => {
        try {
          const rows = await this.request<
            Array<{ rate?: number; source?: string; target?: string }>
          >('GET', `/v1/rates?source=${encodeURIComponent(source)}&target=USD`);
          const row = Array.isArray(rows) ? rows[0] : undefined;
          const rate = Number(row?.rate || 0);
          if (rate > 0) rates[source] = rate;
        } catch {
          this.logger.warn(`Wise USD rate unavailable for ${source}`);
        }
      }),
    );
    return rates;
  }

  async sendPayout(input: WisePayoutInput): Promise<WisePayoutResult> {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Wise is not configured. Set WISE_API_TOKEN on the backend to pay from the admin Wise account.',
      );
    }

    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!amount || amount <= 0) {
      throw new BadRequestException('Invalid payout amount for Wise');
    }

    const customerTransactionId =
      input.customerTransactionId || randomUUID();
    const targetCurrency = this.resolveTargetCurrency(input.bank);
    const profileId = await this.getProfileId();

    let recipientId = input.existingRecipientId
      ? Number(input.existingRecipientId)
      : undefined;
    let quoteId = '';
    let transferId = input.existingTransferId
      ? Number(input.existingTransferId)
      : undefined;
    try {
      if (!recipientId) {
        const created = await this.createRecipient(
          profileId,
          input.bank,
          input.recipient,
          targetCurrency,
        );
        recipientId = created.id;
      }

      let sourceAmount = amount;
      let targetAmount = amount;
      let rate = 0;
      let fee = 0;
      let alreadyFunded = false;

      if (transferId) {
        const existing = await this.getTransfer(transferId);
        const existingStatus = String(existing.status || '').toLowerCase();
        if (
          existingStatus === 'cancelled' ||
          existingStatus === 'funds_refunded'
        ) {
          transferId = undefined;
        } else if (this.isTransferFunded(existingStatus)) {
          alreadyFunded = true;
          sourceAmount = Number(existing.sourceValue ?? amount);
          targetAmount = Number(existing.targetValue ?? amount);
          rate = Number(existing.rate ?? 0);
          quoteId = existing.quoteUuid ? String(existing.quoteUuid) : quoteId;
        }
      }

      if (!transferId) {
        const quote = await this.createQuote({
          profileId,
          targetCurrency,
          sourceAmount: amount,
          targetAccount: recipientId,
        });
        quoteId = String(quote.id);
        sourceAmount = quote.sourceAmount;
        targetAmount = quote.targetAmount;
        rate = quote.rate;
        fee = quote.fee;
        await this.assertSufficientBalance(profileId, sourceAmount);

        if (!recipientId) {
          throw new BadRequestException('Wise recipient is missing for this payout.');
        }
        const transfer = await this.createTransfer({
          recipientId,
          quoteId,
          customerTransactionId,
          reference: input.reference,
        });
        transferId = Number(transfer.id);
      }

      if (alreadyFunded) {
        return {
          transferId: String(transferId),
          quoteId,
          recipientId: String(recipientId),
          customerTransactionId,
          reference: `WISE-${transferId}`,
          sourceAmount,
          targetAmount,
          sourceCurrency: this.sourceCurrency,
          targetCurrency,
          rate,
          fee,
          status: 'PROCESSING',
        };
      }

      const fund = await this.fundTransfer(profileId, transferId as number);
      const status = String(fund.status || 'processing').toUpperCase();
      if (status === 'REJECTED' || status === 'FAILED') {
        throw new WisePayoutError(
          this.fundErrorMessage(fund) ||
            'Wise rejected the payout. Check the admin Wise balance and recipient bank details.',
          {
            transferId: String(transferId),
            recipientId: String(recipientId),
            quoteId,
            customerTransactionId,
          },
        );
      }

      return {
        transferId: String(transferId),
        quoteId,
        recipientId: String(recipientId),
        customerTransactionId,
        reference: `WISE-${transferId}`,
        sourceAmount,
        targetAmount,
        sourceCurrency: this.sourceCurrency,
        targetCurrency,
        rate,
        fee,
        status,
      };
    } catch (err) {
      if (err instanceof WisePayoutError) throw err;
      const message =
        err instanceof BadRequestException
          ? this.httpExceptionMessage(err)
          : err instanceof Error
            ? err.message
            : 'Wise payout failed';
      throw new WisePayoutError(message, {
        recipientId: recipientId ? String(recipientId) : undefined,
        transferId: transferId ? String(transferId) : undefined,
        quoteId: quoteId || undefined,
        customerTransactionId,
      });
    }
  }

  private httpExceptionMessage(err: BadRequestException): string {
    const res = err.getResponse();
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object' && 'message' in res) {
      const m = (res as { message: string | string[] }).message;
      return Array.isArray(m) ? m.join('; ') : String(m);
    }
    return err.message;
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async getProfileId(): Promise<number> {
    const configured = this.config.get<string>('WISE_PROFILE_ID');
    if (configured) {
      const n = Number(configured);
      if (!n) {
        throw new BadRequestException('WISE_PROFILE_ID must be a number');
      }
      return n;
    }
    if (this.cachedProfileId) return this.cachedProfileId;

    const profiles = await this.request<Array<{ id: number; type?: string }>>(
      'GET',
      '/v1/profiles',
    );
    const business = profiles.find((p) => p.type === 'business');
    const selected = business || profiles[0];
    if (!selected?.id) {
      throw new BadRequestException(
        'No Wise profile found for this API token. Set WISE_PROFILE_ID.',
      );
    }
    this.cachedProfileId = selected.id;
    return selected.id;
  }

  private async createQuote(params: {
    profileId: number;
    targetCurrency: string;
    sourceAmount: number;
    targetAccount?: number;
  }) {
    const body: Record<string, unknown> = {
      sourceCurrency: this.sourceCurrency,
      targetCurrency: params.targetCurrency,
      sourceAmount: params.sourceAmount,
      preferredPayIn: 'BALANCE',
    };
    if (params.targetAccount) body.targetAccount = params.targetAccount;

    const quote = await this.request<{
      id: string;
      rate?: number;
      sourceAmount?: number;
      targetAmount?: number;
      sourceCurrency?: string;
      targetCurrency?: string;
      paymentOptions?: Array<{
        payIn?: string;
        disabled?: boolean;
        sourceAmount?: number;
        targetAmount?: number;
        fee?: { total?: number };
      }>;
    }>('POST', `/v3/profiles/${params.profileId}/quotes`, body);

    const options = quote.paymentOptions || [];
    const balance = options.find((o) => o.payIn === 'BALANCE' && !o.disabled);
    if (!balance) {
      throw new BadRequestException(
        'Wise cannot pay this bank account with the current details.',
      );
    }
    return {
      id: quote.id,
      rate: Number(quote.rate || 0),
      sourceAmount: Number(balance?.sourceAmount ?? quote.sourceAmount ?? params.sourceAmount),
      targetAmount: Number(balance?.targetAmount ?? quote.targetAmount ?? 0),
      fee: Number(balance?.fee?.total ?? 0),
      sourceCurrency: quote.sourceCurrency || this.sourceCurrency,
      targetCurrency: quote.targetCurrency || params.targetCurrency,
    };
  }

  private async assertSufficientBalance(profileId: number, needed: number) {
    try {
      const balances = await this.request<
        Array<{
          id: number;
          currency?: string;
          amount?: { value?: number; currency?: string };
        }>
      >('GET', `/v4/profiles/${profileId}/balances?types=STANDARD`);
      const match = balances.find(
        (b) =>
          (b.amount?.currency || b.currency || '').toUpperCase() ===
          this.sourceCurrency,
      );
      const available = Number(match?.amount?.value ?? NaN);
      if (!Number.isNaN(available) && available < needed) {
        throw new BadRequestException(
          `Admin Wise ${this.sourceCurrency} balance (${available.toFixed(2)}) is less than the payout of ${needed.toFixed(2)}. Add funds to Wise and try again.`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(
        `Could not verify Wise balance before payout: ${this.errorMessage(err)}`,
      );
    }
  }

  private async createRecipient(
    profileId: number,
    bank: WiseBankDetails,
    user: WiseRecipientUser,
    currency: string,
  ): Promise<{ id: number; confirmations?: WiseConfirmations }> {
    const payload = this.buildRecipientPayload(profileId, bank, user, currency);
    const created = await this.request<{
      id: number;
      confirmations?: WiseConfirmations;
    }>('POST', '/v1/accounts', payload);
    if (!created?.id) {
      throw new BadRequestException('Wise did not return a recipient account id');
    }
    return created;
  }

  private buildRecipientPayload(
    profileId: number,
    bank: WiseBankDetails,
    user: WiseRecipientUser,
    currency: string,
  ): Record<string, unknown> {
    const holder = (bank.accountHolderName || '').trim();
    if (!holder) {
      throw new BadRequestException('Account holder name is required for Wise payout');
    }

    const iban = normalizeIban(bank.iban);
    const accountNumber = this.clean(bank.accountNumber);
    const routing = this.clean(bank.routingNumber);
    const sortCode = this.clean(bank.sortCode) || routing;
    const swift = this.clean(bank.swiftBic);
    const extra = bank.extraDetails || {};
    const country =
      toIsoCountryCode(bank.country) ||
      toIsoCountryCode(user.country) ||
      (iban ? iban.slice(0, 2) : null);

    if (iban) {
      const ibanError = ibanValidationError(iban, bank.country || user.country);
      if (ibanError) throw new BadRequestException(ibanError);
    }

    if (!iban && !accountNumber && !Object.keys(extra).length) {
      throw new BadRequestException(
        'Recipient bank details need an IBAN or account number for Wise payout.',
      );
    }

    const address = {
      country: country || 'US',
      city: user.city || 'Unknown',
      postCode: user.zipCode || '00000',
      firstLine:
        user.address || user.streetAddress || 'Address on file',
    };

    const base = {
      profile: profileId,
      accountHolderName: holder,
      currency,
      ownedByCustomer: false,
    };

    if (iban) {
      return {
        ...base,
        type: 'iban',
        details: {
          legalType: 'PRIVATE',
          iban,
          address,
          ...extra,
        },
      };
    }

    if (currency === 'USD' && routing && accountNumber) {
      return {
        ...base,
        type: 'aba',
        details: {
          legalType: 'PRIVATE',
          abartn: routing,
          accountNumber,
          accountType: 'CHECKING',
          address: { ...address, country: 'US' },
          ...extra,
        },
      };
    }

    if (currency === 'GBP' && sortCode && accountNumber) {
      return {
        ...base,
        type: 'sort_code',
        details: {
          legalType: 'PRIVATE',
          sortCode,
          accountNumber,
          ...extra,
        },
      };
    }

    if (swift && accountNumber) {
      return {
        ...base,
        type: 'swift_code',
        details: {
          legalType: 'PRIVATE',
          swiftCode: swift,
          accountNumber,
          address,
          ...extra,
        },
      };
    }

    if (accountNumber) {
      return {
        ...base,
        type: 'swift_code',
        details: {
          legalType: 'PRIVATE',
          ...(swift ? { swiftCode: swift } : {}),
          accountNumber,
          address,
          ...extra,
        },
      };
    }

    const extraType = extra.type;
    const restExtra = { ...extra };
    delete restExtra.type;
    if (Object.keys(restExtra).length) {
      return {
        ...base,
        type: extraType || 'iban',
        details: {
          legalType: 'PRIVATE',
          address,
          ...restExtra,
        },
      };
    }

    throw new BadRequestException(
      'Bank details are not complete enough for a Wise payout. Add IBAN, or account number + routing/SWIFT.',
    );
  }

  private async createTransfer(params: {
    recipientId: number;
    quoteId: string;
    customerTransactionId: string;
    reference: string;
  }) {
    return this.request<{ id: number }>('POST', '/v1/transfers', {
      targetAccount: params.recipientId,
      quoteUuid: params.quoteId,
      customerTransactionId: params.customerTransactionId,
      details: {
        reference: params.reference.slice(0, 35),
        transferPurpose: 'verification.transfers.purpose.pay.bills',
        sourceOfFunds: 'verification.source.of.funds.other',
      },
    });
  }

  private async fundTransfer(profileId: number, transferId: number) {
    const body: Record<string, unknown> = { type: 'BALANCE' };
    if (this.balanceId) body.balanceId = this.balanceId;
    return this.request<{ status?: string; errorCode?: string; type?: string }>(
      'POST',
      `/v3/profiles/${profileId}/transfers/${transferId}/payments`,
      body,
    );
  }

  private isTransferFunded(status: string): boolean {
    return [
      'processing',
      'funds_converted',
      'outgoing_payment_sent',
      'bounced_back',
      'charged_back',
    ].includes(status);
  }

  private resolveTargetCurrency(bank: WiseBankDetails): string {
    const explicit = (bank.currency || '').trim().toUpperCase();
    if (explicit && explicit !== 'USD') return explicit;
    const fromIban = currencyFromIban(bank.iban);
    if (fromIban) return fromIban;
    const fromCountry = defaultCurrencyForCountry(bank.country);
    if (fromCountry) return fromCountry;
    return explicit || this.sourceCurrency;
  }

  private flattenRequirementFields(opt: any): Array<{
    key: string;
    name: string;
    required: boolean;
    type: string;
    example?: string;
    minLength?: number;
    maxLength?: number;
    valuesAllowed?: Array<{ key: string; name?: string }>;
  }> {
    const fields: Array<{
      key: string;
      name: string;
      required: boolean;
      type: string;
      example?: string;
      minLength?: number;
      maxLength?: number;
      valuesAllowed?: Array<{ key: string; name?: string }>;
    }> = [];
    for (const group of opt.fields || []) {
      for (const item of group.group || []) {
        if (!item?.key) continue;
        if (item.key === 'legalType') continue;
        fields.push({
          key: item.key,
          name: item.name || group.name || item.key,
          required: Boolean(item.required),
          type: item.type || 'text',
          example: item.example || undefined,
          minLength: item.minLength,
          maxLength: item.maxLength,
          valuesAllowed: item.valuesAllowed,
        });
      }
    }
    return fields;
  }

  private clean(value?: string): string {
    return (value || '').replace(/\s+/g, '').trim();
  }

  private async request<T>(
    method: 'GET' | 'POST',
    url: string,
    data?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    try {
      const res = await this.http.request<T>({
        method,
        url,
        data,
        headers: { ...this.authHeaders(), ...(extraHeaders || {}) },
      });
      return res.data;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private wrapError(err: unknown): Error {
    const axiosErr = err as AxiosError<any>;
    const status = axiosErr.response?.status;
    const message = this.errorMessage(err);

    this.logger.error(
      `Wise API ${axiosErr.config?.method?.toUpperCase()} ${axiosErr.config?.url} failed (${status || axiosErr.code || 'error'})`,
    );

    if (status === 401 || status === 403) {
      const sca = String(
        axiosErr.response?.headers?.['www-authenticate'] || '',
      ).toLowerCase();
      if (sca.includes('sca') || message.toLowerCase().includes('sca')) {
        return new BadRequestException(
          'Wise requires additional authentication (SCA) to debit the admin balance. Use a Wise business API token with payouts enabled.',
        );
      }
      return new BadRequestException(
        'Wise authentication failed. Check the admin Wise API token and profile.',
      );
    }

    if (status === 422) {
      return new BadRequestException(this.toUserFacingError(message));
    }

    if (status && status >= 500) {
      return new ServiceUnavailableException(
        'Wise payment service is temporarily unavailable. Try again shortly.',
      );
    }

    const code = String(axiosErr.code || '');
    if (
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED'
    ) {
      return new ServiceUnavailableException(
        'Could not connect to Wise. Please retry.',
      );
    }

    return new BadRequestException(this.toUserFacingError(message));
  }

  private fundErrorMessage(fund: {
    status?: string;
    errorCode?: string;
  }): string {
    const code = String(fund.errorCode || '').toLowerCase();
    if (code.includes('balance') || code.includes('insufficient')) {
      return 'Admin Wise balance does not have enough funds for this payout.';
    }
    if (fund.errorCode) {
      return `Wise funding failed (${fund.errorCode}).`;
    }
    return '';
  }

  private errorMessage(err: unknown): string {
    const axiosErr = err as AxiosError<any>;
    const data = axiosErr.response?.data;
    if (!data) {
      return axiosErr.message || 'Wise request failed';
    }
    if (typeof data === 'string') return data;
    if (typeof data.message === 'string' && data.message) return data.message;
    if (Array.isArray(data.errors) && data.errors.length) {
      return data.errors
        .map((e: { message?: string; code?: string; path?: string; arguments?: string[] }) => {
          const path = e.path || (Array.isArray(e.arguments) ? e.arguments[0] : '');
          const text = e.message || e.code;
          if (path && text) return `${path}: ${text}`;
          return text;
        })
        .filter(Boolean)
        .join('; ');
    }
    if (data.error && typeof data.error === 'string') return data.error;
    try {
      return JSON.stringify(data);
    } catch {
      return 'Wise request failed';
    }
  }
}
