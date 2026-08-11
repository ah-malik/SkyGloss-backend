import { PdfService } from './pdf.service';
import { Order } from '../orders/entities/order.entity';

function buildOrderLikeSgprtr0663(extraItems = 0): Order {
  const baseItems = [
    { name: 'FUSION', size: '2L', orderType: 'unit', quantity: 5, price: 300 },
    {
      name: 'APPLICATOR BOTTLE',
      size: 'Applicator Bottle',
      orderType: 'unit',
      quantity: 20,
      price: 2,
    },
    { name: 'RESIN FILM', size: '60ml', orderType: 'unit', quantity: 5, price: 70 },
    {
      name: 'PPF GLOSS',
      size: '15m Roll',
      orderType: 'unit',
      quantity: 8,
      price: 450,
    },
    {
      name: 'PPF MATTE',
      size: '15m Roll',
      orderType: 'unit',
      quantity: 2,
      price: 480,
    },
    { name: 'SHINE', size: '30ml', orderType: 'unit', quantity: 10, price: 50 },
    { name: 'MATTE', size: '30ml', orderType: 'unit', quantity: 5, price: 45 },
    { name: 'SEAL', size: '250ml', orderType: 'unit', quantity: 10, price: 15 },
    {
      name: 'EDGE BLADE',
      size: 'Edge Blade',
      orderType: 'unit',
      quantity: 1,
      price: 25,
    },
    {
      name: 'PAINT PEN',
      size: 'Paint Pen',
      orderType: 'unit',
      quantity: 1,
      price: 15,
    },
  ];

  for (let i = 0; i < extraItems; i++) {
    baseItems.push({
      name: `EXTRA PRODUCT ${i + 1}`,
      size: '100ml',
      orderType: 'unit',
      quantity: 1,
      price: 10,
    });
  }

  const subtotal = baseItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return {
    orderNumber: 'SGPRTR0663',
    status: 'pending',
    currency: 'EUR',
    originalCurrency: 'EUR',
    createdAt: new Date('2026-08-11T10:32:12.000Z'),
    user: {
      firstName: 'Julio',
      lastName: 'Gontijo',
      email: 'julio.jgo@gmail.com',
      country: 'Portugal',
    },
    shippingAddress: {
      firstName: 'Júlio',
      lastName: 'Oliveira',
      email: 'julio.jgo@gmail.com',
      address: 'rua de Cedofeita, n2 - Adaúfe',
      city: 'Braga',
      state: 'Porto',
      zipCode: '4710-533',
      country: 'Portugal',
      phoneNumber: '966826347',
      taxId: '304630187',
    },
    items: baseItems,
    subtotal,
    shippingFee: 0,
    discount: 0,
    totalAmount: subtotal,
  } as unknown as Order;
}

describe('PdfService.generateOrderDetails', () => {
  const pdfService = new PdfService();

  it('keeps SGPRTR0663-style item rows on contiguous pages (no cell-per-page split)', async () => {
    const brokenDownloadedPages = 9;
    const buffer = await pdfService.generateOrderDetails(buildOrderLikeSgprtr0663());
    const pages = pdfService.countPdfPages(buffer);

    expect(pages).toBeGreaterThan(0);
    // Bug regression: last item cells each became their own page → 9 pages.
    expect(pages).toBeLessThan(brokenDownloadedPages);
    expect(pages).toBe(1);
  });

  it('paginates long item lists without exploding page count', async () => {
    const buffer = await pdfService.generateOrderDetails(
      buildOrderLikeSgprtr0663(40),
    );
    const pages = pdfService.countPdfPages(buffer);
    const itemCount = 10 + 40;

    expect(pages).toBeGreaterThan(1);
    // Even with many items, pages should stay far below one-page-per-cell.
    expect(pages).toBeLessThan(itemCount);
    expect(pages).toBeLessThanOrEqual(6);
  });

  it('returns a non-empty PDF buffer with a valid page count', async () => {
    const buffer = await pdfService.generateOrderDetails(buildOrderLikeSgprtr0663());

    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdfService.countPdfPages(buffer)).toBe(1);
  });
});

