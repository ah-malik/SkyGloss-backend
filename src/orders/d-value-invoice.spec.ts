import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrdersService } from './orders.service';
import { ProductGroupsService } from '../product-groups/product-groups.service';
import { UserRole } from '../users/entities/user.entity';

const p1 = new Types.ObjectId();
const p2 = new Types.ObjectId();
const shopId = new Types.ObjectId();
const orderId = new Types.ObjectId();

const exec = <T>(v: T) => ({ exec: async () => v });

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    _id: orderId,
    orderNumber: 'SG1001',
    user: shopId,
    status: 'PAID',
    discount: 0,
    shippingFee: 10,
    currency: 'USD',
    shippingAddress: { country: 'United States' },
    items: [
      { product: String(p1), name: 'SHINE', size: '50ml', quantity: 2, orderType: 'unit', price: 99 },
      { product: String(p2), name: 'SEAL', size: '100ml', quantity: 1, orderType: 'unit', price: 50 },
    ],
    ...overrides,
  };
}

function makeGroup(dValuePrices: any[]) {
  return {
    products: [
      { productId: p1, sizes: [{ size: '50ml', price: 99 }] },
      { productId: p2, sizes: [{ size: '100ml', price: 50 }] },
    ],
    dValuePrices,
  };
}

function makeService(order: any, group: any, latest: any = null) {
  const created: any[] = [];
  const svc = Object.create(OrdersService.prototype) as any;
  svc.orderModel = { findById: async () => order };
  svc.productGroupModel = {
    findById: () => exec(group),
    findOne: () => exec(group),
  };
  svc.duplicateInvoiceModel = {
    findOne: () => ({ sort: () => exec(latest) }),
    countDocuments: async () => 0,
    create: async (doc: any) => {
      created.push(doc);
      return { ...doc, toObject: () => doc };
    },
  };
  return { svc, created };
}

const shop = (enabled: boolean) =>
  ({ _id: shopId, role: UserRole.CERTIFIED_SHOP, country: 'United States', dValueInvoiceEnabled: enabled }) as any;

describe('Shop D-Value invoice', () => {
  const fullPrices = [
    { productId: p1, size: '50ml', price: 20 },
    { productId: p2, size: '100ml', price: 5 },
  ];

  it('uses Admin-defined D-Value prices for the order items', async () => {
    const { svc, created } = makeService(makeOrder(), makeGroup(fullPrices));
    await svc.generateShopDValueInvoice(String(orderId), shop(true));
    expect(created).toHaveLength(1);
    expect(created[0].items.map((i: any) => i.price)).toEqual([20, 5]);
    expect(created[0].items.map((i: any) => i.quantity)).toEqual([2, 1]);
    // 2*20 + 5 + 10 shipping (US → no VAT)
    expect(created[0].totalAmount).toBe(55);
    expect(created[0].invoiceNumber).toBe('SG1001-D1');
  });

  it('is forbidden when the Hub has not enabled D-Value for the shop', async () => {
    const { svc } = makeService(makeOrder(), makeGroup(fullPrices));
    await expect(
      svc.generateShopDValueInvoice(String(orderId), shop(false)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("is forbidden for another shop's order", async () => {
    const { svc } = makeService(
      makeOrder({ user: new Types.ObjectId() }),
      makeGroup(fullPrices),
    );
    await expect(
      svc.generateShopDValueInvoice(String(orderId), shop(true)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses the group price when no D-Value price is set', async () => {
    const { svc, created } = makeService(makeOrder(), makeGroup([fullPrices[0]]));
    await svc.generateShopDValueInvoice(String(orderId), shop(true));
    // SHINE override 20, SEAL falls back to group price 50
    expect(created[0].items.map((i: any) => i.price)).toEqual([20, 50]);
  });

  it('rejects items whose product is not assigned to the group', async () => {
    const group = makeGroup(fullPrices);
    group.products = [group.products[0]];
    const { svc, created } = makeService(makeOrder(), group);
    await expect(
      svc.generateShopDValueInvoice(String(orderId), shop(true)),
    ).rejects.toThrow(/SEAL \(100ml\)/);
    expect(created).toHaveLength(0);
  });

  it('re-uses the previous invoice when nothing changed', async () => {
    const latest = {
      shippingFee: 10,
      discount: 0,
      items: [
        { product: String(p1), size: '50ml', orderType: 'unit', quantity: 2, price: 20 },
        { product: String(p2), size: '100ml', orderType: 'unit', quantity: 1, price: 5 },
      ],
      toObject: () => ({ _id: 'existing' }),
    };
    const { svc, created } = makeService(makeOrder(), makeGroup(fullPrices), latest);
    const res = await svc.generateShopDValueInvoice(String(orderId), shop(true));
    expect(res.duplicateInvoice._id).toBe('existing');
    expect(created).toHaveLength(0);
  });

  it('rejects cancelled orders', async () => {
    const { svc } = makeService(makeOrder({ status: 'CANCELLED' }), makeGroup(fullPrices));
    await expect(
      svc.generateShopDValueInvoice(String(orderId), shop(true)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('status endpoint reflects the Hub toggle', () => {
    const svc = Object.create(OrdersService.prototype) as any;
    expect(svc.getShopDValueInvoiceStatus(shop(true))).toEqual({ enabled: true });
    expect(svc.getShopDValueInvoiceStatus(shop(false))).toEqual({ enabled: false });
  });
});

describe('Product group D-Value prices', () => {
  function groupsService(group: any) {
    const svc = Object.create(ProductGroupsService.prototype) as any;
    svc.productGroupModel = { findById: () => exec(group) };
    svc.findOne = async () => group;
    return svc as ProductGroupsService;
  }

  it('saves prices for assigned product sizes', async () => {
    const group: any = { ...makeGroup([]), save: jest.fn() };
    await groupsService(group).updateDValuePrices('g1', [
      { productId: String(p1), size: '50ml', price: 12.345 },
    ]);
    expect(group.dValuePrices).toEqual([
      { productId: String(p1), size: '50ml', price: 12.35 },
    ]);
    expect(group.save).toHaveBeenCalled();
  });

  it('rejects prices for products not in the group', async () => {
    const group: any = { ...makeGroup([]), save: jest.fn() };
    await expect(
      groupsService(group).updateDValuePrices('g1', [
        { productId: String(new Types.ObjectId()), size: '50ml', price: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(group.save).not.toHaveBeenCalled();
  });
});
