import axios from 'axios';
import { isEuropeCountryName } from '../payouts/stripe-wise-payouts.logic';
import {
  formatVatForStorage,
  getViesCountryCode,
  normalizeVatNumber,
  requiresEuropeanVat,
  resolveOrderDestinationCountry,
  validateEuropeanVatNumber,
} from './vies-vat';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('vies-vat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses existing Europe country detection', () => {
    expect(isEuropeCountryName('Germany')).toBe(true);
    expect(isEuropeCountryName('United States')).toBe(false);
    expect(requiresEuropeanVat('France', 'United States')).toBe(true);
    expect(requiresEuropeanVat('', 'Germany')).toBe(true);
    expect(requiresEuropeanVat('Canada', 'Canada')).toBe(false);
  });

  it('resolves destination country preferring shipping', () => {
    expect(resolveOrderDestinationCountry('Spain', 'Germany')).toBe('Spain');
    expect(resolveOrderDestinationCountry('', 'Germany')).toBe('Germany');
  });

  it('maps Greece to EL and strips prefixes', () => {
    expect(getViesCountryCode('Greece')).toBe('EL');
    expect(normalizeVatNumber('EL123456789', 'EL')).toBe('123456789');
    expect(normalizeVatNumber('GR123456789', 'EL')).toBe('123456789');
    expect(formatVatForStorage('123456789', 'DE')).toBe('DE123456789');
  });

  it('requires VAT for European orders', async () => {
    const result = await validateEuropeanVatNumber({
      country: 'Germany',
      taxId: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing');
  });

  it('accepts Norway VAT without VIES (not covered by VIES)', async () => {
    const result = await validateEuropeanVatNumber({
      country: 'Norway',
      taxId: 'NO123456789MVA',
    });
    expect(result.ok).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns invalid when VIES says valid=false', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { valid: false } });
    const result = await validateEuropeanVatNumber({
      country: 'Germany',
      taxId: 'DE123456789',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('returns unavailable when VIES times out / errors', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('timeout'));
    const result = await validateEuropeanVatNumber({
      country: 'France',
      taxId: 'FR12345678901',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unavailable');
  });

  it('returns ok with normalized VAT when VIES validates', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { valid: true } });
    const result = await validateEuropeanVatNumber({
      country: 'Germany',
      taxId: 'de 123 456 789',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalizedVat).toBe('DE123456789');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('check-vat-number'),
      { countryCode: 'DE', vatNumber: '123456789' },
      expect.any(Object),
    );
  });
});
