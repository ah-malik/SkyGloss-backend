import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { toIsoCountryCode } from '../payouts/wise-country-iso';
import { FedexService } from '../fedex/fedex.service';
import {
  getPostalCodeFormatError,
  isPostalCodeCheckedCountry,
  normalizePostalCode,
} from '../common/postal-codes';

export type AddressSuggestion = {
  formatted: string;
  street: string;
  city: string;
  state: string;
  stateCode: string;
  postcode: string;
  countryCode: string;
};

export type PostcodeValidation = {
  valid: boolean;
  /** false when the lookup could not run (no key / network); never blocks. */
  verified: boolean;
  message?: string;
  city?: string;
  state?: string;
  stateCode?: string;
};

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);
  /** "near|cc" → "lon,lat" (null when not found). */
  private readonly nearCache = new Map<string, string | null>();
  /** "cc|postcode" → Geoapify postcode results. */
  private readonly postcodeCache = new Map<string, any[]>();

  constructor(
    private readonly configService: ConfigService,
    private readonly fedexService: FedexService,
  ) {}

  private getApiKey(): string {
    return (this.configService.get<string>('GEOAPIFY_API') || '').trim();
  }

  /**
   * ZIP / postal code check for checkout: format, existence in the country,
   * and (US / Canada) that it belongs to the chosen state / province.
   * Countries without a known format, or a failed lookup, are not blocked.
   */
  async validatePostcode(
    postcode: string,
    country?: string | null,
    state?: string | null,
  ): Promise<PostcodeValidation> {
    const countryCode = toIsoCountryCode(country);
    const value = String(postcode || '').trim();
    if (!countryCode || !isPostalCodeCheckedCountry(countryCode)) {
      return value
        ? { valid: true, verified: false }
        : {
            valid: false,
            verified: true,
            message: 'ZIP / Postal code is required.',
          };
    }

    const formatError = getPostalCodeFormatError(value, countryCode);
    if (formatError) {
      return { valid: false, verified: true, message: formatError };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) return { valid: true, verified: false };

    const normalized = normalizePostalCode(value);
    const cacheKey = `${countryCode}|${normalized}`;
    let results: any[] = this.postcodeCache.get(cacheKey) ?? [];
    if (!this.postcodeCache.has(cacheKey)) {
      try {
        const { data } = await axios.get(
          'https://api.geoapify.com/v1/geocode/search',
          {
            params: {
              postcode: value,
              type: 'postcode',
              filter: `countrycode:${countryCode.toLowerCase()}`,
              format: 'json',
              limit: 5,
              lang: 'en',
              apiKey,
            },
            timeout: 10_000,
          },
        );
        results = Array.isArray(data?.results) ? data.results : [];
      } catch (err: any) {
        this.logger.warn(
          `Geoapify postcode lookup failed: ${err?.message || err}`,
        );
        return { valid: true, verified: false };
      }
      if (this.postcodeCache.size > 2000) this.postcodeCache.clear();
      this.postcodeCache.set(cacheKey, results);
    }

    // US ZIP+4 is checked on its 5-digit ZIP.
    const target = countryCode === 'US' ? normalized.slice(0, 5) : normalized;
    const strict = countryCode === 'US' || countryCode === 'CA';
    const match = strict
      ? results.find(
          (r) => normalizePostalCode(String(r?.postcode || '')) === target,
        )
      : results[0];
    if (!match) {
      return {
        valid: false,
        verified: true,
        message: `ZIP / Postal code ${value} was not found. Please check it.`,
      };
    }

    const matchStateCode = String(match.state_code || '').toUpperCase();
    if (strict && state && matchStateCode) {
      const chosen = this.fedexService.toStateCode(state);
      if (chosen && chosen !== matchStateCode) {
        return {
          valid: false,
          verified: true,
          message: `ZIP / Postal code ${value} belongs to ${match.state || matchStateCode}, not ${state}.`,
        };
      }
    }

    return {
      valid: true,
      verified: true,
      city: match.city ? String(match.city) : undefined,
      state: match.state ? String(match.state) : undefined,
      stateCode: matchStateCode || undefined,
    };
  }

  /** Coordinates of the buyer's city/state, so partial input favours their area. */
  private async resolveNear(
    near: string,
    countryCode: string | null,
    apiKey: string,
  ): Promise<string | null> {
    const key = `${near.toLowerCase()}|${countryCode || ''}`;
    if (this.nearCache.has(key)) return this.nearCache.get(key) ?? null;
    let coords: string | null = null;
    try {
      const { data } = await axios.get(
        'https://api.geoapify.com/v1/geocode/search',
        {
          params: {
            text: near,
            format: 'json',
            limit: 1,
            ...(countryCode
              ? { filter: `countrycode:${countryCode.toLowerCase()}` }
              : {}),
            apiKey,
          },
          timeout: 10_000,
        },
      );
      const hit = data?.results?.[0];
      if (Number.isFinite(hit?.lon) && Number.isFinite(hit?.lat)) {
        coords = `${hit.lon},${hit.lat}`;
      }
    } catch (err: any) {
      this.logger.warn(`Geoapify near lookup failed: ${err?.message || err}`);
      return null;
    }
    if (this.nearCache.size > 500) this.nearCache.clear();
    this.nearCache.set(key, coords);
    return coords;
  }

  /** Geoapify address autocomplete, limited to one country; matches in the buyer's city/state come first. */
  async autocompleteAddress(
    text: string,
    country?: string,
    near?: string,
  ): Promise<AddressSuggestion[]> {
    const query = String(text || '').trim();
    if (query.length < 3) return [];

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Address search is not configured. Set GEOAPIFY_API.',
      );
    }

    const countryCode = toIsoCountryCode(country);
    const nearText = String(near || '')
      .trim()
      .slice(0, 100);
    const proximity = nearText
      ? await this.resolveNear(nearText, countryCode, apiKey)
      : null;
    const search = async (
      text: string,
      bias?: string | null,
    ): Promise<any[]> => {
      const { data } = await axios.get(
        'https://api.geoapify.com/v1/geocode/autocomplete',
        {
          params: {
            text: text.slice(0, 300),
            format: 'json',
            limit: 8,
            lang: 'en',
            ...(bias ? { bias: `proximity:${bias}` } : {}),
            ...(countryCode
              ? { filter: `countrycode:${countryCode.toLowerCase()}` }
              : {}),
            apiKey,
          },
          timeout: 10_000,
        },
      );
      return Array.isArray(data?.results) ? data.results : [];
    };

    try {
      // Geoapify keeps one match per street name country-wide, so combine:
      // biased near the buyer (best while typing), city/state appended (best
      // for a full street), then country-wide for addresses elsewhere.
      const [biased, withArea, countryWide] = await Promise.all([
        proximity ? search(query, proximity) : Promise.resolve([]),
        nearText ? search(`${query}, ${nearText}`) : Promise.resolve([]),
        search(query),
      ]);
      const interleaved: any[] = [];
      for (let i = 0; i < Math.max(biased.length, withArea.length); i++) {
        if (biased[i]) interleaved.push(biased[i]);
        if (withArea[i]) interleaved.push(withArea[i]);
      }
      const seen = new Set<string>();
      const results = [...interleaved, ...countryWide].filter((r) => {
        const key = String(r.formatted || '').toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return results.slice(0, 8).map((r) => ({
        formatted: String(r.formatted || ''),
        street:
          [r.housenumber, r.street].filter(Boolean).join(' ') ||
          String(r.address_line1 || ''),
        city: String(r.city || r.town || r.village || r.county || ''),
        state: String(r.state || ''),
        stateCode: String(r.state_code || '').toUpperCase(),
        postcode: String(r.postcode || ''),
        countryCode: String(r.country_code || '').toUpperCase(),
      }));
    } catch (err: any) {
      this.logger.warn(
        `Geoapify autocomplete failed: ${err?.response?.status || ''} ${err?.message || err}`,
      );
      throw new ServiceUnavailableException('Address search is unavailable.');
    }
  }
}
