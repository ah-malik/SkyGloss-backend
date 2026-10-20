import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrdersService } from './orders.service';
import { UserRole } from '../users/entities/user.entity';
import {
  calculateEuropeOrderVatAmount,
  getOrderVatTaxableBase,
} from '../common/europe-vat';
import { resolveOrderShippingFee } from '../common/order-totals';

const p1 = new Types.ObjectId();
const p2 = new Types.ObjectId();
const shopId = new Types.ObjectId();
const orderId = new Types.ObjectId();

const exec = <T>(v: T) => ({ exec: async () => v });

const shop = (enabled = true) =>
  ({
    _id: shopId,
    role: UserRole.CERTIFIED_SHOP,
    country: 'United States',
    dValueInvoiceEnabled: enabled,
  }) as any;

const items = [
  { product: String(p1), name: 'SHINE', size: '50ml', quantity: 2, orderType: 'unit', price: 100 },
  { product: String(p2), name: 'SEAL', size: '100ml', quantity: 1, orderType: 'unit', price: 50 },
];

function makeGroup(dValuePrices: any[]) {
  return {
    products: [
      { productId: p1, sizes: [{ size: '50ml', price: 100 }] },
      { productId: p2, sizes: [{ size: '100ml', price: 50 }] },
    ],
    dValuePrices,
  };
}

const dValuePrices = [
  { productId: p1, size: '50ml', price: 60 },
  { productId: p2, size: '100ml', price: 20 },
];

function makeService(group: any, existingB: any = null) {
  const upserts: any[] = [];
  const svc = Object.create(OrdersService.prototype) as any;
  svc.productGroupModel = {
    findById: () => exec(group),
    findOne: () => exec(group),
  };
  svc.usersService = { findOne: async () => shop() };
  svc.duplicateInvoiceModel = {
    findOne: () => ({ lean: () => exec(existingB) }),
    findOneAndUpdate: (filter: any, update: any, opts: any) => {
      upserts.push({ filter, update, opts });
      return exec({});
    },
  };
  return { svc, upserts };
}

// 2×100 + 50 = 250 subtotal, $10 shipping, US → no VAT
const usOrder = (overrides: Record<string, any> = {}) => ({
  _id: orderId,
  orderNumber: 'SG1001',
  items,
  shippingFee: 10,
  discount: 0,
  vatAmount: 0,
  vatRate: 0,
  totalAmount: 260,
  currency: 'USD',
  shippingAddress: { country: 'United States' },
  isDValueOrder: true,
  ...overrides,
});

describe('Shop D-Value order request split', () => {
  it('Invoice A = Original − D-Value (+ shipping), Invoice B = D-Value prices', async () => {
    const { svc } = makeService(makeGroup(dValuePrices));
    const split = await svc.computeDValueSplitInvoices(shop(), usOrder());

    expect(split.dValue.items.map((i: any) => i.price)).toEqual([60, 20]);
    expect(split.original.items.map((i: any) => i.price)).toEqual([40, 30]);
    // B: 2×60 + 20 = 140; A: 2×40 + 30 + 10 shipping = 120
    expect(split.dValue.totalAmount).toBe(140);
    expect(split.dValue.shippingFee).toBe(0);
    expect(split.original.totalAmount).toBe(120);
    expect(split.original.shippingFee).toBe(10);
    expect(split.original.totalAmount + split.dValue.totalAmount).toBe(260);
  });

  it('puts the discount on Invoice A and keeps A + B = order total', async () => {
    const { svc } = makeService(makeGroup(dValuePrices));
    const split = await svc.computeDValueSplitInvoices(
      shop(),
      usOrder({ discount: 25, totalAmount: 235 }),
    );
    expect(split.original.discount).toBe(25);
    expect(split.dValue.discount).toBe(0);
    expect(split.original.totalAmount).toBe(95);
    expect(split.original.totalAmount + split.dValue.totalAmount).toBe(235);
  });

  it('splits European VAT so A VAT + B VAT = order VAT', async () => {
    const address = { country: 'Germany', taxId: '', noVatId: true };
    const vat = calculateEuropeOrderVatAmount(getOrderVatTaxableBase(250, 0), address);
    const total = Math.round((250 + 10 + vat.amount) * 100) / 100;
    const { svc } = makeService(makeGroup(dValuePrices));
    const split = await svc.computeDValueSplitInvoices(
      shop(),
      usOrder({
        shippingAddress: address,
        vatAmount: vat.amount,
        vatRate: vat.rate,
        totalAmount: total,
      }),
    );
    expect(
      Math.round((split.original.vatAmount + split.dValue.vatAmount) * 100) / 100,
    ).toBe(vat.amount);
    expect(
      Math.round((split.original.totalAmount + split.dValue.totalAmount) * 100) / 100,
    ).toBe(total);
  });

  it('blocks the order when a D-Value price is missing', async () => {
    const { svc } = makeService(makeGroup([dValuePrices[0]]));
    await expect(
      svc.computeDValueSplitInvoices(shop(), usOrder()),
    ).rejects.toThrow(/D-Value price is not set for: SEAL \(100ml\)/);
  });

  it('blocks the order when D-Value price is not lower than the original', async () => {
    const { svc } = makeService(
      makeGroup([dValuePrices[0], { productId: p2, size: '100ml', price: 50 }]),
    );
    await expect(
      svc.computeDValueSplitInvoices(shop(), usOrder()),
    ).rejects.toThrow(/must be lower than the original price for: SEAL/);
  });

  it('blocks a discount larger than Invoice A', async () => {
    const { svc } = makeService(makeGroup(dValuePrices));
    await expect(
      svc.computeDValueSplitInvoices(
        shop(),
        // Invoice A subtotal is 2×40 + 30 = 110
        usOrder({ discount: 120, totalAmount: 140 }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts exactly ORDERNO-A and ORDERNO-D1 (no duplicates on re-save)', async () => {
    const { svc, upserts } = makeService(makeGroup(dValuePrices));
    const order = usOrder();
    const split = await svc.computeDValueSplitInvoices(shop(), order);
    await svc.saveDValueSplitInvoices(order, split, shopId);
    await svc.saveDValueSplitInvoices(order, split, shopId);

    expect(upserts.map((u) => u.filter.invoiceNumber)).toEqual([
      'SG1001-A',
      'SG1001-D1',
      'SG1001-A',
      'SG1001-D1',
    ]);
    expect(upserts.every((u) => u.opts.upsert)).toBe(true);
    expect(upserts[0].update.$set.invoiceType).toBe('original');
    expect(upserts[1].update.$set.invoiceType).toBe('d_value');
    expect(upserts[0].update.$set.orderId).toBe(orderId);
  });

  it('keeps D-Value prices locked when the order is re-split (e.g. shipping change)', async () => {
    // Admin later changed the group D-Value price for SHINE to 90.
    const group = makeGroup([
      { productId: p1, size: '50ml', price: 90 },
      dValuePrices[1],
    ]);
    const existingB = {
      items: [
        { product: String(p1), size: '50ml', orderType: 'unit', price: 60 },
        { product: String(p2), size: '100ml', orderType: 'unit', price: 20 },
      ],
    };
    const { svc } = makeService(group, existingB);
    const split = await svc.computeDValueSplitForExistingOrder(
      usOrder({ shippingFee: 25, totalAmount: 275 }),
      shop(),
    );
    expect(split.dValue.items.map((i: any) => i.price)).toEqual([60, 20]);
    expect(split.original.totalAmount).toBe(135);
  });

  it('does nothing for normal (non D-Value) orders', async () => {
    const { svc } = makeService(makeGroup(dValuePrices));
    await expect(
      svc.computeDValueSplitForExistingOrder(usOrder({ isDValueOrder: false }), shop()),
    ).resolves.toBeNull();
  });

  it('requires the shop D-Value toggle', () => {
    const svc = Object.create(OrdersService.prototype) as any;
    expect(() => svc.assertShopCanRequestDValueSplit(shop(false))).toThrow(
      /not enabled/,
    );
    expect(() =>
      svc.assertShopCanRequestDValueSplit({ role: UserRole.PARTNER }),
    ).toThrow(/only available for shop orders/);
    expect(() => svc.assertShopCanRequestDValueSplit(shop(true))).not.toThrow();
  });

  it('PDF keeps an invoice shipping of 0 (no calculated shipping on Invoice B)', () => {
    const invoiceB = {
      items: [{ price: 60, quantity: 1 }],
      totalAmount: 60,
      shippingFee: 0,
      vatAmount: 0,
      shippingAddress: { country: 'United States' },
      orderNumber: 'SG1001-D1',
    };
    expect(resolveOrderShippingFee({ ...invoiceB, shippingFeeIsFinal: true })).toBe(0);
  });

  it('upsert is scoped to this order (never takes over another order invoice)', async () => {
    const { svc, upserts } = makeService(makeGroup(dValuePrices));
    const order = usOrder();
    const split = await svc.computeDValueSplitInvoices(shop(), order);
    await svc.saveDValueSplitInvoices(order, split, shopId);
    expect(upserts.every((u) => u.filter.orderId === orderId)).toBe(true);
  });

  it('admin edit writes invoices before the order and re-syncs if the order save fails', async () => {
    const calls: string[] = [];
    const { svc } = makeService(makeGroup(dValuePrices));
    svc.logger = { error: () => undefined };
    svc.saveDValueSplitInvoices = async (o: any) => {
      calls.push(`invoices:${o.totalAmount}`);
    };
    svc.orderModel = { findById: async () => usOrder() };
    const order = {
      ...usOrder({ shippingFee: 25, totalAmount: 275 }),
      save: async () => {
        calls.push('order');
        throw new Error('db down');
      },
    };
    await expect(
      svc.saveOrderWithDValueSplit(order, shop(), shopId),
    ).rejects.toThrow('db down');
    // new totals first, then restored to the stored order (260)
    expect(calls).toEqual(['invoices:275', 'order', 'invoices:260']);
  });

  it('shop "Generate D-Value" is blocked on a D-Value split order', async () => {
    const svc = Object.create(OrdersService.prototype) as any;
    svc.orderModel = {
      findById: async () => ({ ...usOrder(), user: shopId, status: 'PENDING' }),
    };
    await expect(
      svc.generateShopDValueInvoice(String(orderId), shop(true)),
    ).rejects.toThrow(/already has its Original and D-Value invoices/);
  });
});
