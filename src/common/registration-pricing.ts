import {
  getEuropeVatRatePercent,
  shouldApplyEuropeOrderVat,
} from './europe-vat';
import { roundMoney } from './order-monetary';
import { requiresEuropeanVat } from './vies-vat';

export const DEFAULT_REGISTRATION_FEE_AMOUNT = 250;
export const DEFAULT_REGISTRATION_CURRENCY = 'USD';

export interface RegistrationFeeQuote {
  currency: string;
  feeAmount: number;
  /** Europe VAT % for the country, or null when the country is not in the VAT table. */
  vatRate: number | null;
  /** Fixed tax from the fee group, used only when vatRate is null. */
  fixedTaxAmount: number;
  /** European buyer with a verified VAT ID — no VAT charged. */
  vatExempt?: boolean;
}

export interface RegistrationVatChoice {
  taxId?: string | null;
  noVatId?: boolean | null;
}

/** True when the shop must answer "Do you have a VAT ID?" before paying (same rule as shop orders). */
export function registrationRequiresVatChoice(
  country?: string | null,
): boolean {
  return requiresEuropeanVat(undefined, country);
}

/**
 * Same rule as shop orders: European buyers pay country VAT only when they
 * declare no VAT ID; a verified VAT ID means no VAT.
 */
export function applyRegistrationVatChoice(
  quote: RegistrationFeeQuote,
  country: string | null | undefined,
  choice: RegistrationVatChoice,
): RegistrationFeeQuote {
  if (!registrationRequiresVatChoice(country)) return quote;
  return {
    ...quote,
    vatExempt: !shouldApplyEuropeOrderVat({
      country,
      taxId: choice.taxId,
      noVatId: choice.noVatId,
    }),
  };
}

export interface RegistrationTotals {
  feeAmount: number;
  discount: number;
  taxableBase: number;
  taxAmount: number;
  total: number;
}

export function buildRegistrationFeeQuote(
  feeGroup:
    | { currency?: string; feeAmount?: number; taxAmount?: number }
    | null
    | undefined,
  country?: string | null,
): RegistrationFeeQuote {
  const vatRate = getEuropeVatRatePercent(country);
  if (feeGroup) {
    return {
      currency: (
        feeGroup.currency || DEFAULT_REGISTRATION_CURRENCY
      ).toUpperCase(),
      feeAmount: roundMoney(Number(feeGroup.feeAmount) || 0),
      vatRate,
      fixedTaxAmount:
        vatRate != null ? 0 : roundMoney(Number(feeGroup.taxAmount) || 0),
    };
  }
  return {
    currency: DEFAULT_REGISTRATION_CURRENCY,
    feeAmount: DEFAULT_REGISTRATION_FEE_AMOUNT,
    vatRate,
    fixedTaxAmount: 0,
  };
}

/** Effective tax % on the registration fee (VAT %, or fixed tax expressed as % of the fee). */
export function getRegistrationTaxPercent(quote: RegistrationFeeQuote): number {
  if (quote.vatExempt) return 0;
  if (quote.vatRate != null) return Math.max(0, quote.vatRate);
  if (quote.feeAmount <= 0 || quote.fixedTaxAmount <= 0) return 0;
  return (quote.fixedTaxAmount / quote.feeAmount) * 100;
}

/**
 * Coupon discount applies to the registration fee only; tax/VAT is then
 * calculated on the discounted fee.
 */
export function calculateRegistrationTotals(
  quote: RegistrationFeeQuote,
  couponDiscount = 0,
): RegistrationTotals {
  const feeAmount = roundMoney(Math.max(0, quote.feeAmount));
  const discount = roundMoney(
    Math.min(Math.max(0, Number(couponDiscount) || 0), feeAmount),
  );
  const taxableBase = roundMoney(feeAmount - discount);

  let taxAmount = 0;
  if (taxableBase > 0 && !quote.vatExempt) {
    if (quote.vatRate != null) {
      taxAmount =
        quote.vatRate > 0 ? roundMoney((taxableBase * quote.vatRate) / 100) : 0;
    } else if (quote.fixedTaxAmount > 0 && feeAmount > 0) {
      taxAmount = roundMoney((quote.fixedTaxAmount * taxableBase) / feeAmount);
    }
  }

  return {
    feeAmount,
    discount,
    taxableBase,
    taxAmount,
    total: roundMoney(taxableBase + taxAmount),
  };
}

/**
 * Split an amount actually paid (tax included) back into discount + tax so the
 * stored order always adds up to what Stripe charged.
 */
export function splitPaidRegistrationAmount(
  quote: RegistrationFeeQuote,
  totalPaid: number,
  knownTaxAmount?: number,
): RegistrationTotals {
  const feeAmount = roundMoney(Math.max(0, quote.feeAmount));
  const total = roundMoney(Math.max(0, Number(totalPaid) || 0));

  let taxAmount: number;
  if (knownTaxAmount != null && knownTaxAmount > 0) {
    taxAmount = roundMoney(Math.min(knownTaxAmount, total));
  } else {
    const percent = getRegistrationTaxPercent(quote);
    taxAmount =
      percent > 0 ? roundMoney(total - total / (1 + percent / 100)) : 0;
  }

  const taxableBase = roundMoney(Math.min(feeAmount, total - taxAmount));
  const discount = roundMoney(Math.max(0, feeAmount - taxableBase));

  return { feeAmount, discount, taxableBase, taxAmount, total };
}
