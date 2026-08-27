/**
 * E2E test: create order → modify (add items) → verify invoice/details
 * Run: node test-modify-order-e2e.js
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

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Client-App': 'frontend',
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
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  // API wraps payloads as { data: ... }
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

  assert(shop, 'No non-USA certified_shop user found for request-flow test');
  log('1', `Shop: ${shop.email} (${shop.country}) id=${shop._id}`);

  const products = await Product.find({ status: 'published' }).limit(5).lean();
  assert(products.length >= 2, 'Need at least 2 published products');
  const p1 = products[0];
  const p2 = products[1];
  const size1 = p1.sizes?.[0]?.size || p1.sizes?.[0] || 'Default';
  const price1 = p1.sizes?.[0]?.price || 100;
  const size2 = p2.sizes?.[0]?.size || p2.sizes?.[0] || 'Default';
  const price2 = p2.sizes?.[0]?.price || 50;

  const token = buildToken(shop);

  // --- Step 2: Create original order (request flow) ---
  log('2', 'Creating original order via POST /orders/request');
  const createPayload = {
    items: [
      {
        product: String(p1._id),
        name: p1.name,
        size: size1,
        quantity: 1,
        orderType: 'unit',
        price: price1,
        image: p1.images?.[0] || p1.shopImages?.[0] || '',
      },
    ],
    shippingAddress: shippingFromUser(shop),
  };
  const originalOrder = await api('POST', '/orders/request', token, createPayload);
  assert(originalOrder._id, 'Original order missing _id');
  assert(originalOrder.status === 'PENDING', `Expected PENDING, got ${originalOrder.status}`);
  assert(originalOrder.orderKind !== 'add_on', 'Original should be standard order');
  log('2', `Original order ${originalOrder.orderNumber} total=${originalOrder.totalAmount} shipping=${originalOrder.shippingFee}`);

  // --- Step 3: Fetch order detail — isModifiable ---
  log('3', 'GET /orders/:id — check isModifiable');
  const detail1 = await api('GET', `/orders/${originalOrder._id}`, token);
  assert(detail1.isModifiable === true, `Expected isModifiable=true, got ${detail1.isModifiable}`);
  assert(!detail1.addOnOrders?.length, 'Should have no add-ons yet');
  log('3', 'isModifiable=true ✓');

  // --- Step 4: Add items (modify) ---
  log('4', 'POST /orders/:parentId/add-items');
  const addPayload = {
    items: [
      {
        product: String(p2._id),
        name: p2.name,
        size: size2,
        quantity: 2,
        orderType: 'unit',
        price: price2,
        image: p2.images?.[0] || p2.shopImages?.[0] || '',
      },
    ],
  };
  const addOnResult = await api(
    'POST',
    `/orders/${originalOrder._id}/add-items`,
    token,
    addPayload,
  );
  const addOnId = String(addOnResult.orderId || addOnResult.order?._id);
  assert(addOnId, 'Add-on order id missing');
  log('4', `Add-on order ${addOnResult.orderNumber || addOnId} created`);

  // --- Step 5: Verify add-on order fields ---
  log('5', 'Verify add-on order in DB + API');
  const addOnDb = await Order.findById(addOnId).lean();
  assert(addOnDb, 'Add-on not in DB');
  assert(addOnDb.orderKind === 'add_on', `orderKind=${addOnDb.orderKind}`);
  assert(String(addOnDb.parentOrderId) === String(originalOrder._id), 'parentOrderId mismatch');
  assert(addOnDb.shippingFee === 0, `Expected shippingFee=0, got ${addOnDb.shippingFee}`);
  assert(addOnDb.items.length === 1, 'Add-on should have 1 line');
  assert(addOnDb.items[0].quantity === 2, 'Add-on qty should be 2');

  const addOnDetail = await api('GET', `/orders/${addOnId}`, token);
  assert(addOnDetail.orderKind === 'add_on', 'API orderKind mismatch');
  assert(addOnDetail.parentOrder, 'parentOrder should be populated');
  assert(addOnDetail.isModifiable === false, 'Add-on itself should not be modifiable');
  log('5', `Add-on total=${addOnDetail.totalAmount} shipping=${addOnDetail.shippingFee} ✓`);

  // --- Step 6: Parent should list add-on ---
  log('6', 'Parent order should list addOnOrders');
  const parentDetail = await api('GET', `/orders/${originalOrder._id}`, token);
  assert(parentDetail.addOnOrders?.length >= 1, 'Parent missing addOnOrders');
  assert(
    parentDetail.addOnOrders.some((o) => String(o._id) === addOnId),
    'Parent addOnOrders does not include new add-on',
  );
  assert(parentDetail.isModifiable === true, 'Parent still modifiable before shipped');
  log('6', `Parent has ${parentDetail.addOnOrders.length} add-on(s) ✓`);

  // --- Step 7: Shipped parent → modify blocked ---
  log('7', 'Mark parent SHIPPED → modify should fail');
  await Order.findByIdAndUpdate(originalOrder._id, {
    status: 'SHIPPED',
    trackingId: 'TEST-TRACK-001',
    shippingCompany: 'DHL',
    shippedAt: new Date(),
  });
  try {
    await api('POST', `/orders/${originalOrder._id}/add-items`, token, addPayload);
    throw new Error('Expected add-items to fail on SHIPPED order');
  } catch (e) {
    assert(
      String(e.message).includes('400') || String(e.message).toLowerCase().includes('cannot be modified'),
      `Unexpected error: ${e.message}`,
    );
    log('7', 'Modify correctly blocked on SHIPPED order ✓');
  }

  // --- Step 8: Invoice PDF (admin) ---
  log('8', 'Admin invoice PDF for add-on order');
  const admin = await User.findOne({ role: 'admin' }).lean();
  assert(admin, 'No admin user for PDF test');
  const adminToken = buildToken(admin);
  const pdfRes = await fetch(`${API}/pdf/order/${addOnId}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'X-Client-App': 'admin',
    },
  });
  assert(pdfRes.ok, `PDF download failed: ${pdfRes.status}`);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  assert(pdfBuf.length > 500, `PDF too small (${pdfBuf.length} bytes)`);
  assert(pdfBuf.slice(0, 4).toString() === '%PDF', 'Response is not a PDF');
  log('8', `Invoice PDF OK (${pdfBuf.length} bytes) ✓`);

  // --- Step 9: New order flow still works ---
  log('9', 'Sanity: POST /orders/request still works (new order untouched)');
  const secondOrder = await api('POST', '/orders/request', token, createPayload);
  assert(secondOrder._id !== originalOrder._id, 'Second order should be new');
  assert(secondOrder.orderKind !== 'add_on', 'Second order should be standard');
  log('9', `New order ${secondOrder.orderNumber} created independently ✓`);

  console.log('\n========================================');
  console.log('ALL CHECKS PASSED');
  console.log('========================================');
  console.log(`Original: ${originalOrder.orderNumber} (${originalOrder._id})`);
  console.log(`Add-on:   ${addOnResult.orderNumber || addOnId}`);
  console.log(`Receipt:  /dashboard/shop/receipt/${originalOrder._id}`);
  console.log(`Add-on receipt: /dashboard/shop/receipt/${addOnId}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nTEST FAILED:', err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
