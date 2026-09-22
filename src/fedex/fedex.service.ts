import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { toIsoCountryCode } from '../payouts/wise-country-iso';

export type FedExAddressInput = {
  streetLines?: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  countryCode: string;
  residential?: boolean;
};

export type FedExRateQuote = {
  serviceType: string;
  serviceName: string;
  packagingType?: string;
  totalNetCharge: number;
  currency: string;
  transitDays?: number | null;
  deliveryDate?: string | null;
  rateType?: string | null;
};

@Injectable()
export class FedexService {
  private readonly logger = new Logger(FedexService.name);
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  private getBaseUrl(): string {
    return (
      this.configService.get<string>('FEDEX_API_BASE_URL') ||
      'https://apis-sandbox.fedex.com'
    ).replace(/\/$/, '');
  }

  private getApiKey(): string {
    return (this.configService.get<string>('FEDEX_API_KEY') || '').trim();
  }

  private getSecretKey(): string {
    return (this.configService.get<string>('FEDEX_SECRET_KEY') || '').trim();
  }

  private getAccountNumber(): string {
    return (
      this.configService.get<string>('FEDEX_ACCOUNT_NUMBER') || '740561073'
    ).trim();
  }

  assertConfigured() {
    if (!this.getApiKey() || !this.getSecretKey()) {
      throw new ServiceUnavailableException(
        'FedEx API credentials are not configured. Set FEDEX_API_KEY and FEDEX_SECRET_KEY.',
      );
    }
  }

  /** Normalize stored country names / ISO codes to FedEx countryCode. */
  toCountryCode(country?: string | null): string | null {
    return toIsoCountryCode(country);
  }

  /** Best-effort US/CA state → 2-letter code; otherwise pass through trimmed value. */
  toStateCode(state?: string | null): string | undefined {
    const raw = String(state || '').trim();
    if (!raw) return undefined;
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();

    const map: Record<string, string> = {
      alabama: 'AL',
      alaska: 'AK',
      arizona: 'AZ',
      arkansas: 'AR',
      california: 'CA',
      colorado: 'CO',
      connecticut: 'CT',
      delaware: 'DE',
      florida: 'FL',
      georgia: 'GA',
      hawaii: 'HI',
      idaho: 'ID',
      illinois: 'IL',
      indiana: 'IN',
      iowa: 'IA',
      kansas: 'KS',
      kentucky: 'KY',
      louisiana: 'LA',
      maine: 'ME',
      maryland: 'MD',
      massachusetts: 'MA',
      michigan: 'MI',
      minnesota: 'MN',
      mississippi: 'MS',
      missouri: 'MO',
      montana: 'MT',
      nebraska: 'NE',
      nevada: 'NV',
      'new hampshire': 'NH',
      'new jersey': 'NJ',
      'new mexico': 'NM',
      'new york': 'NY',
      'north carolina': 'NC',
      'north dakota': 'ND',
      ohio: 'OH',
      oklahoma: 'OK',
      oregon: 'OR',
      pennsylvania: 'PA',
      'rhode island': 'RI',
      'south carolina': 'SC',
      'south dakota': 'SD',
      tennessee: 'TN',
      texas: 'TX',
      utah: 'UT',
      vermont: 'VT',
      virginia: 'VA',
      washington: 'WA',
      'west virginia': 'WV',
      wisconsin: 'WI',
      wyoming: 'WY',
      'district of columbia': 'DC',
      alberta: 'AB',
      'british columbia': 'BC',
      manitoba: 'MB',
      'new brunswick': 'NB',
      newfoundland: 'NL',
      'newfoundland and labrador': 'NL',
      'northwest territories': 'NT',
      'nova scotia': 'NS',
      nunavut: 'NU',
      ontario: 'ON',
      'prince edward island': 'PE',
      quebec: 'QC',
      saskatchewan: 'SK',
      yukon: 'YT',
    };
    return map[raw.toLowerCase()] || raw.slice(0, 2).toUpperCase();
  }

  buildAddress(
    parts: {
      address?: string | null;
      address2?: string | null;
      streetAddress?: string | null;
      city?: string | null;
      state?: string | null;
      zipCode?: string | null;
      country?: string | null;
      residential?: boolean;
    },
    label = 'Address',
  ): FedExAddressInput {
    const countryCode = this.toCountryCode(parts.country);
    if (!countryCode) {
      throw new BadRequestException(
        `${label}: unable to map country "${parts.country || ''}" to an ISO country code for FedEx.`,
      );
    }

    const line1 = String(parts.streetAddress || parts.address || '').trim();
    const line2 = String(parts.address2 || '').trim();
    const streetLines = [line1, line2].filter(Boolean);
    if (!streetLines.length) {
      throw new BadRequestException(
        `${label}: street address is required for FedEx rates.`,
      );
    }

    const city = String(parts.city || '').trim();
    if (!city) {
      throw new BadRequestException(
        `${label}: city is required for FedEx rates.`,
      );
    }

    const postalCode =
      String(parts.zipCode || '').trim() ||
      this.extractPostalCode(
        [parts.streetAddress, parts.address, parts.address2, parts.city]
          .filter(Boolean)
          .join(' '),
        countryCode,
      );

    if (!postalCode) {
      throw new BadRequestException(
        `${label}: postal / ZIP code is required for FedEx rates. Update the Hub profile ZIP, or enter an origin ZIP when calculating.`,
      );
    }

    const stateOrProvinceCode = this.toStateCode(parts.state);
    const needsState = countryCode === 'US' || countryCode === 'CA';
    if (needsState && !stateOrProvinceCode) {
      throw new BadRequestException(
        `${label}: state / province is required for FedEx rates when country is ${countryCode}.`,
      );
    }

    return {
      streetLines,
      city,
      ...(stateOrProvinceCode ? { stateOrProvinceCode } : {}),
      postalCode,
      countryCode,
      ...(parts.residential != null ? { residential: parts.residential } : {}),
    };
  }

  /** Best-effort postal extraction from free-form address text. */
  extractPostalCode(text?: string | null, countryCode?: string | null): string {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const cc = String(countryCode || '').toUpperCase();

    if (cc === 'US') {
      const m = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
      return m?.[1] || '';
    }
    if (cc === 'CA') {
      const m = raw.match(/\b([A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d)\b/);
      return m?.[1] ? m[1].toUpperCase().replace(/\s+/g, ' ') : '';
    }
    if (cc === 'GB' || cc === 'UK') {
      const m = raw.match(
        /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i,
      );
      return m?.[1] ? m[1].toUpperCase() : '';
    }

    // Generic: 4–10 alphanumeric postal tokens (common EU / intl).
    const generic = raw.match(/\b([A-Z0-9][A-Z0-9 -]{2,9}\d[A-Z0-9]*)\b/i);
    if (generic?.[1] && /\d/.test(generic[1])) {
      return generic[1].trim().toUpperCase();
    }
    return '';
  }

  private async getAccessToken(): Promise<string> {
    this.assertConfigured();
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiresAt - 60_000) {
      return this.cachedToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.getApiKey(),
      client_secret: this.getSecretKey(),
    });

    try {
      const { data } = await axios.post(
        `${this.getBaseUrl()}/oauth/token`,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 20_000,
        },
      );

      const token = String(data?.access_token || '');
      const expiresIn = Number(data?.expires_in || 3600);
      if (!token) {
        throw new ServiceUnavailableException('FedEx OAuth did not return an access token.');
      }

      this.cachedToken = token;
      this.tokenExpiresAt = now + expiresIn * 1000;
      return token;
    } catch (err) {
      throw this.toHttpException(err, 'FedEx authentication failed');
    }
  }

  async getRateQuotes(params: {
    shipper: FedExAddressInput;
    recipient: FedExAddressInput;
    weight: number;
    weightUnits?: 'LB' | 'KG';
    preferredCurrency?: string;
    /** Declared customs value for international shipments (order merchandise value). */
    customsValue?: number;
    commodities?: Array<{
      description?: string;
      quantity?: number;
      unitPrice?: number;
      weight?: number;
      countryOfManufacture?: string;
    }>;
  }): Promise<FedExRateQuote[]> {
    this.assertConfigured();

    const weight = Number(params.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new BadRequestException('Package weight must be a positive number.');
    }

    const token = await this.getAccessToken();
    const shipDateStamp = new Date().toISOString().slice(0, 10);
    const weightUnits = params.weightUnits === 'KG' ? 'KG' : 'LB';
    const preferredCurrency = (params.preferredCurrency || 'USD').toUpperCase();
    const isInternational =
      String(params.shipper.countryCode || '').toUpperCase() !==
      String(params.recipient.countryCode || '').toUpperCase();

    const requestedShipment: Record<string, unknown> = {
      shipper: { address: params.shipper },
      recipient: { address: params.recipient },
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      packagingType: 'YOUR_PACKAGING',
      shipDateStamp,
      rateRequestType: ['LIST', 'ACCOUNT'],
      preferredCurrency,
      requestedPackageLineItems: [
        {
          weight: {
            units: weightUnits,
            value: weight,
          },
        },
      ],
    };

    if (isInternational) {
      requestedShipment.customsClearanceDetail = this.buildCustomsClearanceDetail({
        totalWeight: weight,
        weightUnits,
        currency: preferredCurrency,
        customsValue: params.customsValue,
        countryOfManufacture: params.shipper.countryCode,
        commodities: params.commodities,
      });
    }

    const payload = {
      accountNumber: { value: this.getAccountNumber() },
      rateRequestControlParameters: { returnTransitTimes: true },
      requestedShipment,
    };

    try {
      const { data } = await axios.post(
        `${this.getBaseUrl()}/rate/v1/rates/quotes`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-locale': 'en_US',
          },
          timeout: 30_000,
        },
      );

      return this.parseRateQuotes(data);
    } catch (err) {
      throw this.toHttpException(err, 'FedEx rate quote failed');
    }
  }

  private buildCustomsClearanceDetail(params: {
    totalWeight: number;
    weightUnits: 'LB' | 'KG';
    currency: string;
    customsValue?: number;
    countryOfManufacture?: string;
    commodities?: Array<{
      description?: string;
      quantity?: number;
      unitPrice?: number;
      weight?: number;
      countryOfManufacture?: string;
    }>;
  }) {
    const currency = params.currency || 'USD';
    const manufactureCountry = String(
      params.countryOfManufacture || 'US',
    ).toUpperCase();

    const rawCommodities =
      params.commodities?.length
        ? params.commodities
        : [
            {
              description: 'Beauty / cosmetic products',
              quantity: 1,
              unitPrice: Math.max(1, Number(params.customsValue) || 100),
              weight: params.totalWeight,
              countryOfManufacture: manufactureCountry,
            },
          ];

    const commodities = rawCommodities.map((item, index) => {
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = Math.max(
        0.01,
        Number(item.unitPrice) ||
          (Number(params.customsValue) || 100) / quantity,
      );
      const lineWeight = Math.max(
        0.1,
        Number(item.weight) ||
          params.totalWeight / Math.max(1, rawCommodities.length),
      );
      const description = String(
        item.description || `Product ${index + 1}`,
      ).slice(0, 450);

      return {
        description,
        name: description.slice(0, 60),
        quantity,
        quantityUnits: 'PCS',
        numberOfPieces: quantity,
        countryOfManufacture: String(
          item.countryOfManufacture || manufactureCountry,
        ).toUpperCase(),
        weight: {
          units: params.weightUnits,
          value: Number(lineWeight.toFixed(2)),
        },
        unitPrice: {
          amount: Number(unitPrice.toFixed(2)),
          currency,
        },
        customsValue: {
          amount: Number((unitPrice * quantity).toFixed(2)),
          currency,
        },
      };
    });

    const totalCustomsValue = commodities.reduce(
      (sum, c) => sum + Number(c.customsValue.amount || 0),
      0,
    );

    return {
      dutiesPayment: {
        paymentType: 'SENDER',
      },
      commodities,
      totalCustomsValue: {
        amount: Number(totalCustomsValue.toFixed(2)),
        currency,
      },
    };
  }

  private parseRateQuotes(data: any): FedExRateQuote[] {
    const details: any[] =
      data?.output?.rateReplyDetails ||
      data?.output?.rateReplyDetail ||
      [];

    const quotes: FedExRateQuote[] = [];

    for (const detail of details) {
      const serviceType = String(detail?.serviceType || '');
      const serviceName = String(
        detail?.serviceName || detail?.serviceType || 'FedEx Service',
      );
      const packagingType = detail?.packagingType
        ? String(detail.packagingType)
        : undefined;

      const shipmentRateDetails: any[] =
        detail?.ratedShipmentDetails || [];

      let best: any = null;
      for (const rate of shipmentRateDetails) {
        const rawCharge =
          rate?.totalNetCharge ??
          rate?.totalNetFedExCharge ??
          rate?.shipmentRateDetail?.totalNetCharge ??
          rate?.totalNetChargeWithDutiesAndTaxes;
        const amount =
          typeof rawCharge === 'object' && rawCharge != null
            ? Number(rawCharge.amount ?? rawCharge.value)
            : Number(rawCharge);
        if (!Number.isFinite(amount)) continue;

        const currency =
          (typeof rawCharge === 'object' && rawCharge?.currency) ||
          rate?.currency ||
          rate?.shipmentRateDetail?.currency ||
          'USD';

        if (!best || amount < Number(best._amount)) {
          best = {
            _amount: amount,
            _currency: String(currency),
            _rateType: String(rate?.rateType || rate?.ratedWeightMethod || ''),
          };
        }
      }

      if (!best) continue;

      const transit =
        detail?.commit?.transitDays?.minimumTransitTime ||
        detail?.commit?.transitDays?.maximumTransitTime ||
        detail?.operationalDetail?.transitTime ||
        null;
      const deliveryDate =
        detail?.commit?.dateDetail?.dayFormat ||
        detail?.commit?.dateDetail?.dayOfWeek ||
        null;

      quotes.push({
        serviceType,
        serviceName,
        packagingType,
        totalNetCharge: Number(best._amount),
        currency: best._currency,
        transitDays: transit != null ? Number(transit) || null : null,
        deliveryDate: deliveryDate ? String(deliveryDate) : null,
        rateType: best._rateType || null,
      });
    }

    quotes.sort((a, b) => a.totalNetCharge - b.totalNetCharge);
    return quotes;
  }

  private toHttpException(err: unknown, fallback: string) {
    const axiosErr = err as AxiosError<any>;
    const status = axiosErr.response?.status;
    const fedexErrors = axiosErr.response?.data?.errors;
    const message =
      (Array.isArray(fedexErrors) && fedexErrors[0]?.message) ||
      axiosErr.response?.data?.message ||
      axiosErr.message ||
      fallback;

    this.logger.error(
      `${fallback}: ${status || axiosErr.code || 'error'} ${message}`,
    );

    if (status && status >= 400 && status < 500) {
      return new BadRequestException(message);
    }
    return new ServiceUnavailableException(message || fallback);
  }
}
