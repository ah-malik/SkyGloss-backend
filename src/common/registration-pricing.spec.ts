import {
  applyRegistrationVatChoice,
  registrationRequiresVatChoice,
  buildRegistrationFeeQuote,
  calculateRegistrationTotals,
  getRegistrationTaxPercent,
  splitPaidRegistrationAmount,
} from './registration-pricing';

describe('registration pricing', () => {
  const netherlands = buildRegistrationFeeQuote(
    { currency: 'eur', feeAmount: 250, taxAmount: 0 },
    'Netherlands',
  );

  it('charges VAT on the fee without discount', () => {
    expect(calculateRegistrationTotals(netherlands)).toEqual({
      feeAmount: 250,
      discount: 0,
      taxableBase: 250,
      taxAmount: 52.5,
      total: 302.5,
    });
  });

  it('applies a 90% coupon to the fee only, then VAT on the discounted fee', () => {
    expect(calculateRegistrationTotals(netherlands, 225)).toEqual({
      feeAmount: 250,
      discount: 225,
      taxableBase: 25,
      taxAmount: 5.25,
      total: 30.25,
    });
  });

  it('250 → 90% coupon → 25 → 20% VAT → 30', () => {
    const france = buildRegistrationFeeQuote(
      { currency: 'eur', feeAmount: 250, taxAmount: 0 },
      'France',
    );
    expect(calculateRegistrationTotals(france, 225)).toEqual({
      feeAmount: 250,
      discount: 225,
      taxableBase: 25,
      taxAmount: 5,
      total: 30,
    });
    const withVatId = applyRegistrationVatChoice(france, 'France', {
      taxId: 'FR12345678901',
    });
    expect(calculateRegistrationTotals(withVatId, 225).total).toBe(25);
  });

  it('applies a fixed coupon before VAT', () => {
    expect(calculateRegistrationTotals(netherlands, 100)).toEqual({
      feeAmount: 250,
      discount: 100,
      taxableBase: 150,
      taxAmount: 31.5,
      total: 181.5,
    });
  });

  it('caps the discount at the fee so a 100% coupon is fully covered', () => {
    const totals = calculateRegistrationTotals(netherlands, 500);
    expect(totals.discount).toBe(250);
    expect(totals.taxAmount).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('scales a fixed non-VAT tax with the discounted fee', () => {
    const quote = buildRegistrationFeeQuote(
      { currency: 'usd', feeAmount: 250, taxAmount: 20 },
      'United States',
    );
    expect(quote.vatRate).toBeNull();
    expect(getRegistrationTaxPercent(quote)).toBe(8);
    expect(calculateRegistrationTotals(quote).total).toBe(270);
    expect(calculateRegistrationTotals(quote, 125)).toMatchObject({
      taxableBase: 125,
      taxAmount: 10,
      total: 135,
    });
  });

  it('falls back to USD 250 with no fee group', () => {
    const quote = buildRegistrationFeeQuote(null, 'Pakistan');
    expect(calculateRegistrationTotals(quote)).toMatchObject({
      feeAmount: 250,
      taxAmount: 0,
      total: 250,
    });
    expect(quote.currency).toBe('USD');
  });

  it('splits a Stripe-paid total back into discount and VAT', () => {
    expect(splitPaidRegistrationAmount(netherlands, 30.25)).toEqual({
      feeAmount: 250,
      discount: 225,
      taxableBase: 25,
      taxAmount: 5.25,
      total: 30.25,
    });
    expect(splitPaidRegistrationAmount(netherlands, 302.5)).toMatchObject({
      discount: 0,
      taxAmount: 52.5,
    });
  });

  describe('VAT ID choice (same rule as shop orders)', () => {
    it('asks European countries only', () => {
      expect(registrationRequiresVatChoice('Netherlands')).toBe(true);
      expect(registrationRequiresVatChoice('Germany')).toBe(true);
      expect(registrationRequiresVatChoice('United States')).toBe(false);
      expect(registrationRequiresVatChoice('Pakistan')).toBe(false);
    });

    it('charges no VAT with a verified VAT ID — actual fee only', () => {
      const quote = applyRegistrationVatChoice(netherlands, 'Netherlands', {
        taxId: 'NL123456789B01',
        noVatId: false,
      });
      expect(quote.vatExempt).toBe(true);
      expect(calculateRegistrationTotals(quote)).toMatchObject({
        feeAmount: 250,
        taxAmount: 0,
        total: 250,
      });
      expect(calculateRegistrationTotals(quote, 225).total).toBe(25);
      expect(getRegistrationTaxPercent(quote)).toBe(0);
    });

    it('charges country VAT when the shop has no VAT ID', () => {
      const quote = applyRegistrationVatChoice(netherlands, 'Netherlands', {
        noVatId: true,
      });
      expect(quote.vatExempt).toBe(false);
      expect(calculateRegistrationTotals(quote).total).toBe(302.5);
      expect(calculateRegistrationTotals(quote, 225).total).toBe(30.25);
    });

    it('leaves non-European fixed tax unchanged', () => {
      const usa = buildRegistrationFeeQuote(
        { currency: 'usd', feeAmount: 250, taxAmount: 20 },
        'United States',
      );
      const quote = applyRegistrationVatChoice(usa, 'United States', {
        noVatId: false,
      });
      expect(quote).toBe(usa);
      expect(calculateRegistrationTotals(quote).total).toBe(270);
    });

    it('splits a VAT-exempt Stripe payment with no VAT', () => {
      const quote = applyRegistrationVatChoice(netherlands, 'Netherlands', {
        taxId: 'NL123456789B01',
      });
      expect(splitPaidRegistrationAmount(quote, 25)).toMatchObject({
        discount: 225,
        taxAmount: 0,
        total: 25,
      });
    });
  });

  it('uses the Stripe-reported tax when present', () => {
    expect(splitPaidRegistrationAmount(netherlands, 181.5, 31.5)).toMatchObject(
      {
        discount: 100,
        taxableBase: 150,
        taxAmount: 31.5,
      },
    );
  });
});
