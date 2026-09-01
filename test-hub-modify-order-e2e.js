/**
 * E2E: Hub/Admin same-invoice order modification
 * Run: node test-hub-modify-order-e2e.js
 */
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API = process.env.API_URL || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'secretKey';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

function log(step, detail) {
  console.log(`\n[${step}] ${detail}`);
}

async function api(method, path, token, body, client = 'frontend') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Client-App': client,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      typeof data === 'object'
        ? data.message || JSON.stringify(data)
        : String(data);
    const err = new Error(`${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  if (data && typeof data === 'object' && data.data !== undefined) {
    return data.data;
  }
  return data;
}

function buildToken(user) {
  return jwt.sign(
    { email: user.email, sub: String(user._id), role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function shippingFromUser(user) {
  return {
    email: user.email,
    firstName: user.firstName || 'Test',
    lastName: user.lastName || 'Shop',
    companyName: user.companyName || '',
    address: user.address || '123 Test Street',
    address2: '',
    city: user.city || 'Karachi',
    state: user.state || 'Sindh',
    zipCode: user.zipCode || '75000',
    country: user.country || 'Pakistan',
    phoneNumber: user.phoneNumber || '+923001234567',
    taxId: '',
  };
}

async function main() {
  log('0', `Connecting Mongo + API ${API}`);
  await mongoose.connect(process.env.MONGO_URI);

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }), 'products');
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }), 'orders');

  const shop = await User.findOne({
    role: 'certified_shop',
    status: { $ne: 'blocked' },
    country: { $nin: [/united states/i, /^usa$/i, /^us$/i] },
  }).sort({ updatedAt: -1 });
  assert(shop, 'No non-USA shop found');

  const admin = await User.findOne({ role: 'admin' }).lean();
  assert(admin, 'No admin found');

  const products = await Product.find({ status: 'published' }).limit(5).lean();
  assert(products.length >= 2, 'Need >= 2 published products');
  const p1 = products[0];
  const p2 = products[1];
  const size1 = p1.sizes?.[0]?.size || p1.sizes?.[0] || 'Default';
  const price1 = p1.sizes?.[0]?.price || 100;
  const size2 = p2.sizes?.[0]?.size || p2.sizes?.[0] || 'Default';
  const price2 = p2.sizes?.[0]?.price || 50;

  const shopToken = buildToken(shop);
  const adminToken = buildToken(admin);

  log('1', `Shop=${shop.email} Admin=${admin.email}`);

  // Create unpaid order as shop
  log('2', 'Create original order (shop request)');
  const createPayload = {
    items: [
      {
        product: String(p1._id),
        name: p1.name,
        size: size1,
        quantity: 1,
        orderType: 'unit',
        price: price1,
        image: '',
      },
    ],
    shippingAddress: shippingFromUser(shop),
  };
  const original = await api('POST', '/orders/request', shopToken, createPayload);
  assert(original._id, 'order id missing');
  const orderId = String(original._id);
  const orderNumber = original.orderNumber;
  const originalItemCount = original.items?.length || 0;
  const originalTotal = Number(original.totalAmount);
  log('2', `Order ${orderNumber} total=${originalTotal} items=${originalItemCount} shipping=${original.shippingFee}`);

  // Shop must NOT be able to add items
  log('3', 'Shop add-items must be forbidden');
  try {
    await api('POST', `/orders/${orderId}/add-items`, shopToken, {
      items: [
        {
          product: String(p2._id),
          name: p2.name,
          size: size2,
          quantity: 1,
          orderType: 'unit',
          price: price2,
          image: '',
        },
      ],
    });
    throw new Error('Shop was allowed to add items — should be 403');
  } catch (e) {
    assert(e.status === 403 || String(e.message).includes('403'), `Expected 403, got: ${e.message}`);
    log('3', 'Shop correctly blocked ✓');
  }

  // Admin appends items to SAME order
  log('4', 'Admin append items to same invoice');
  const updated = await api(
    'POST',
    `/orders/${orderId}/add-items`,
    adminToken,
    {
      items: [
        {
          product: String(p2._id),
          name: p2.name,
          size: size2,
          quantity: 2,
          orderType: 'unit',
          price: price2,
          image: '',
        },
      ],
    },
    'admin',
  );
  assert(String(updated._id) === orderId, 'Must stay same order id');
  assert(updated.orderNumber === orderNumber, 'Must keep same order number');
  assert((updated.items?.length || 0) >= originalItemCount, 'Items should grow or merge');
  assert(Number(updated.totalAmount) > originalTotal, `Total should increase (${updated.totalAmount} vs ${originalTotal})`);
  assert(Number(updated.shippingFee) === Number(original.shippingFee || 0), 'Shipping must stay unchanged');
  log('4', `Same order ${updated.orderNumber} newTotal=${updated.totalAmount} items=${updated.items.length} ✓`);

  // Detail enrichment
  log('5', 'GET order detail enrichment');
  const detail = await api('GET', `/orders/${orderId}`, adminToken, null, 'admin');
  assert(detail.isModifiable === true, 'Should be modifiable before shipped');
  assert(detail.orderNumber === orderNumber, 'Order number stable');
  log('5', `isModifiable=${detail.isModifiable} ✓`);

  // Paid amendment path: mark paid then add more items
  log('6', 'Mark PAID then add more items → amountPaid + remaining');
  await Order.findByIdAndUpdate(orderId, {
    status: 'PAID',
    amountPaid: Number(updated.totalAmount),
  });
  const beforePaidTotal = Number(updated.totalAmount);

  const afterPaidAdd = await api(
    'POST',
    `/orders/${orderId}/add-items`,
    adminToken,
    {
      items: [
        {
          product: String(p2._id),
          name: p2.name,
          size: size2,
          quantity: 1,
          orderType: 'unit',
          price: price2,
          image: '',
        },
      ],
    },
    'admin',
  );
  assert(String(afterPaidAdd._id) === orderId, 'Still same order after paid amend');
  assert(Number(afterPaidAdd.amountPaid) === beforePaidTotal, `amountPaid should lock prior total (${afterPaidAdd.amountPaid} vs ${beforePaidTotal})`);
  const remaining =
    afterPaidAdd.remainingAmount != null
      ? Number(afterPaidAdd.remainingAmount)
      : Math.max(0, Number(afterPaidAdd.totalAmount) - Number(afterPaidAdd.amountPaid));
  assert(remaining > 0, `Remaining should be > 0, got ${remaining}`);
  assert(
    ['PENDING', 'PENDING_PAYMENT'].includes(String(afterPaidAdd.status).toUpperCase()),
    `Status should reopen unpaid for remaining, got ${afterPaidAdd.status}`,
  );
  log('6', `amountPaid=${afterPaidAdd.amountPaid} remaining=${remaining} status=${afterPaidAdd.status} ✓`);

  // Invoice PDF
  log('7', 'Invoice PDF download');
  const pdfRes = await fetch(`${API}/pdf/order/${orderId}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'X-Client-App': 'admin',
    },
  });
  assert(pdfRes.ok, `PDF failed: ${pdfRes.status}`);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  assert(pdfBuf.length > 500, `PDF too small (${pdfBuf.length})`);
  assert(pdfBuf.slice(0, 4).toString() === '%PDF', 'Not a PDF');
  log('7', `Invoice PDF OK (${pdfBuf.length} bytes) ✓`);

  // Set shipping + send invoice (may succeed if shippingSetAt or amountPaid path)
  log('8', 'Send updated invoice (amountPaid path)');
  try {
    // Ensure shippingSetAt so unpaid-request gate is also satisfied if needed
    await api(
      'POST',
      `/orders/${orderId}/shipping`,
      adminToken,
      { shippingFee: Number(afterPaidAdd.shippingFee || 0) },
      'admin',
    );
  } catch (e) {
    // shipping endpoint may reject if not unpaid-request — ok if amountPaid path works
    log('8a', `shipping endpoint note: ${e.message}`);
  }

  const invoiced = await api(
    'POST',
    `/orders/${orderId}/send-invoice`,
    adminToken,
    null,
    'admin',
  );
  assert(invoiced.invoiceSentAt, 'invoiceSentAt should be set');
  log('8', `Invoice sent at ${invoiced.invoiceSentAt} ✓`);

  // Shipped locks modify
  log('9', 'SHIPPED locks Add Item');
  await Order.findByIdAndUpdate(orderId, {
    status: 'SHIPPED',
    trackingId: 'TEST-HUB-TRACK',
    shippingCompany: 'DHL',
    shippedAt: new Date(),
  });
  try {
    await api(
      'POST',
      `/orders/${orderId}/add-items`,
      adminToken,
      {
        items: [
          {
            product: String(p2._id),
            name: p2.name,
            size: size2,
            quantity: 1,
            orderType: 'unit',
            price: price2,
            image: '',
          },
        ],
      },
      'admin',
    );
    throw new Error('Add items should fail on SHIPPED');
  } catch (e) {
    assert(
      e.status === 400 || String(e.message).toLowerCase().includes('cannot be modified'),
      `Unexpected: ${e.message}`,
    );
    log('9', 'SHIPPED correctly locked ✓');
  }

  // New order flow untouched
  log('10', 'Sanity: new order request still works');
  const second = await api('POST', '/orders/request', shopToken, createPayload);
  assert(String(second._id) !== orderId, 'New order must be separate');
  assert(second.orderKind !== 'add_on', 'Should be standard order');
  log('10', `New order ${second.orderNumber} ✓`);

  console.log('\n========================================');
  console.log('ALL CHECKS PASSED');
  console.log('========================================');
  console.log(`Modified order: ${orderNumber} (${orderId})`);
  console.log(`Admin: /orders/${orderId}`);
  console.log(`Shop receipt: /dashboard/shop/receipt/${orderId}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nTEST FAILED:', err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
