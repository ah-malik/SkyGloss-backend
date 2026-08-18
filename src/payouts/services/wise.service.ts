import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import { currencyFromIban, toIsoCountryCode } from '../wise-country-iso';

export type WiseBankDetails = {
  accountHolderName: string;
  bankName?: string;
  iban?: string;
  accountNumber?: string;
  routingNumber?: string;
  swiftBic?: string;
  country?: string;
  currency?: string;
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
    const baseURL = (
      this.config.get<string>('WISE_API_URL') || 'https://api.wise.com'
    ).replace(/\/+$/, '');
    this.token = (this.config.get<string>('WISE_API_TOKEN') || '').trim();
    this.sourceCurrency = (
      this.config.get<string>('WISE_SOURCE_CURRENCY') || 'USD'
    ).toUpperCase();
    const balanceRaw = this.config.get<string>('WISE_BALANCE_ID');
    this.balanceId = balanceRaw ? Number(balanceRaw) : undefined;
    this.http = axios.create({
      baseURL,
      timeout: 45000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  isConfigured(): boolean {
    return Boolean(this.token);
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
        recipientId = await this.createRecipient(
          profileId,
          input.bank,
          input.recipient,
          targetCurrency,
        );
      }

      let sourceAmount = amount;
      let targetAmount = amount;

      if (!transferId) {
        const quote = await this.createQuote({
          profileId,
          targetCurrency,
          targetAmount: amount,
          targetAccount: recipientId,
        });
        quoteId = String(quote.id);
        sourceAmount = Number(quote.sourceAmount ?? amount);
        targetAmount = Number(quote.targetAmount ?? amount);
        await this.assertSufficientBalance(profileId, sourceAmount);

        const transfer = await this.createTransfer({
          recipientId,
          quoteId,
          customerTransactionId,
          reference: input.reference,
        });
        transferId = Number(transfer.id);
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
    targetAmount: number;
    targetAccount?: number;
  }) {
    const body: Record<string, unknown> = {
      sourceCurrency: this.sourceCurrency,
      targetCurrency: params.targetCurrency,
      targetAmount: params.targetAmount,
      preferredPayIn: 'BALANCE',
    };
    if (params.targetAccount) body.targetAccount = params.targetAccount;

    return this.request<{
      id: string;
      sourceAmount?: number;
      targetAmount?: number;
    }>('POST', `/v3/profiles/${params.profileId}/quotes`, body);
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
  ): Promise<number> {
    const payload = this.buildRecipientPayload(profileId, bank, user, currency);
    const created = await this.request<{ id: number }>(
      'POST',
      '/v1/accounts',
      payload,
    );
    if (!created?.id) {
      throw new BadRequestException('Wise did not return a recipient account id');
    }
    return created.id;
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

    const iban = this.clean(bank.iban);
    const accountNumber = this.clean(bank.accountNumber);
    const routing = this.clean(bank.routingNumber);
    const swift = this.clean(bank.swiftBic);
    const country =
      toIsoCountryCode(bank.country) ||
      toIsoCountryCode(user.country) ||
      (iban ? iban.slice(0, 2) : null);

    if (!iban && !accountNumber) {
      throw new BadRequestException(
        'Recipient bank details need an IBAN or account number for Wise payout.',
      );
    }

    const address = {
      country: country || 'US',
      city: user.city || 'Unknown',
      postCode: user.zipCode || '00000',
      firstLine:
        user.address || user.streetAddress || bank.bankName || 'Address on file',
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
        },
      };
    }

    if (currency === 'GBP' && routing && accountNumber) {
      return {
        ...base,
        type: 'sort_code',
        details: {
          legalType: 'PRIVATE',
          sortCode: routing,
          accountNumber,
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

  private resolveTargetCurrency(bank: WiseBankDetails): string {
    const explicit = (bank.currency || '').trim().toUpperCase();
    if (explicit && explicit !== 'USD') return explicit;
    const fromIban = currencyFromIban(bank.iban);
    if (fromIban) return fromIban;
    return explicit || this.sourceCurrency;
  }

  private clean(value?: string): string {
    return (value || '').replace(/\s+/g, '').trim();
  }

  private async request<T>(
    method: 'GET' | 'POST',
    url: string,
    data?: Record<string, unknown>,
  ): Promise<T> {
    try {
      const res = await this.http.request<T>({
        method,
        url,
        data,
        headers: this.authHeaders(),
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
      `Wise API ${axiosErr.config?.method?.toUpperCase()} ${axiosErr.config?.url} failed (${status}): ${message}`,
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
        'Wise authentication failed. Check WISE_API_TOKEN and WISE_PROFILE_ID.',
      );
    }

    if (status && status >= 500) {
      return new ServiceUnavailableException(
        'Wise payment service is temporarily unavailable. Try again shortly.',
      );
    }

    return new BadRequestException(message || 'Wise payout failed');
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
        .map((e: { message?: string; code?: string }) => e.message || e.code)
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
