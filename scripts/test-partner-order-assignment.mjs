/**
 * End-to-end tests for Admin assign-existing-orders → OSP / Shop Intro flow.
 *
 * SAFETY: Never creates/modifies orders on real shops. Uses only a dedicated
 * disposable shop: e2e-partner-assign@skygloss.test
 *
 * Run: node scripts/test-partner-order-assignment.mjs
 */
import axios from 'axios';

const BASE = process.env.API_URL || 'http://localhost:3001';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@skygloss.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

/** Dedicated disposable shop — never use a real customer account. */
const E2E_SHOP_EMAIL = 'e2e-partner-assign@skygloss.test';
const E2E_SHOP_PASSWORD = 'E2eTestShop!234';
const REAL_EMAIL_BLOCKLIST = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'me.com',
  'live.com',
  'protonmail.com',
];

function assertNotRealShop(shop) {
  const email = String(shop?.email || '').toLowerCase();
  if (!email.endsWith('@skygloss.test') && !email.includes('e2e-')) {
    throw new Error(
      `Refusing to run tests on non-test shop: ${email}. Use ${E2E_SHOP_EMAIL} only.`,
    );
  }
  const domain = email.split('@')[1] || '';
  if (REAL_EMAIL_BLOCKLIST.includes(domain)) {
    throw new Error(`Refusing real consumer email domain shop: ${email}`);
  }
}

const results = [];
function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log(`  ✅ PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.log(`  ❌ FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function assert(cond, name, detail = '') {
  if (cond) pass(name, detail);
  else fail(name, detail);
}

function parseCookies(setCookieHeaders = []) {
  const jar = {};
  for (const raw of setCookieHeaders) {
    const part = String(raw).split(';')[0];
    const eq = part.indexOf('=');
    if (eq > 0) jar[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function mergeCookies(jar, setCookieHeaders = []) {
  return { ...jar, ...parseCookies(setCookieHeaders) };
}

async function main() {
  console.log(`\n🧪 Partner existing-order assignment tests → ${BASE}\n`);

  const client = axios.create({
    baseURL: BASE,
    timeout: 60000,
    validateStatus: () => true,
    withCredentials: true,
  });

  let jar = {};
  let accessToken = '';
  let csrf = '';

  const headers = () => {
    const h = {
      'Content-Type': 'application/json',
      'X-Client-App': 'admin',
      Cookie: cookieHeader(jar),
    };
    if (accessToken) h.Authorization = `Bearer ${accessToken}`;
    if (csrf) h['X-CSRF-Token'] = csrf;
    return h;
  };

  const unwrap = (payload) =>
    payload && typeof payload === 'object' && payload.data != null
      ? payload.data
      : payload;

  const req = async (method, url, data) => {
    const res = await client.request({
      method,
      url,
      data,
      headers: headers(),
    });
    const setCookies = res.headers['set-cookie'] || [];
    jar = mergeCookies(jar, setCookies);
    const body = unwrap(res.data) || {};
    const bodyCsrf = body?.csrf_token || res.data?.csrf_token;
    if (bodyCsrf) csrf = bodyCsrf;
    const hdrCsrf =
      res.headers['x-csrf-token'] || res.headers['X-CSRF-Token'];
    if (hdrCsrf) csrf = hdrCsrf;
    if (body?.access_token) accessToken = body.access_token;
    // Normalize for callers: prefer unwrapped business payload
    res.payload = body;
    return res;
  };

  // --- 1. Login ---
  console.log('1) Admin login');
  let login = await req('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    portal: 'partner',
  });
  if (login.status !== 200 || !login.payload?.access_token) {
    login = await req('POST', '/auth/login', {
      email: 'admin@example.com',
      password: 'adminpassword123',
      portal: 'partner',
    });
  }
  assert(
    login.status === 200 && !!login.payload?.access_token,
    'Admin can log in',
    `status=${login.status}`,
  );
  if (!login.payload?.access_token) {
    console.log('\nAborting — cannot authenticate.\n');
    process.exit(1);
  }

  // --- 2. Load users / products ---
  console.log('\n2) Load users & products');
  const usersRes = await req('GET', '/users');
  const usersRaw = unwrap(usersRes.data);
  const users = Array.isArray(usersRaw)
    ? usersRaw
    : Array.isArray(usersRaw?.users)
      ? usersRaw.users
      : [];
  assert(usersRes.status === 200 && users.length > 0, 'GET /users', `count=${users.length}`);

  const shops = users.filter((u) => u.role === 'certified_shop');
  const reps = users.filter((u) => u.role === 'master_partner' && u.partnerCode);
  const promoters = users.filter(
    (u) => u.role === 'regional_partner' && u.partnerCode,
  );

  assert(shops.length > 0, 'At least one shop exists', `count=${shops.length}`);
  assert(reps.length > 0, 'At least one Representative exists', `count=${reps.length}`);

  const productsRes = await req('GET', '/products?status=published');
  const productsRaw = unwrap(productsRes.data);
  const products = Array.isArray(productsRaw)
    ? productsRaw
    : Array.isArray(productsRaw?.products)
      ? productsRaw.products
      : [];
  const productWithSize = products.find(
    (p) =>
      Array.isArray(p.sizes) &&
      p.sizes.length > 0 &&
      (p.sizes[0].size || p.sizes[0].name),
  );
  assert(!!productWithSize, 'Published product with size exists');

  const rep = reps[0];
  const siPartner = promoters[0] || reps.find((r) => r._id !== rep._id) || rep;
  assert(!!rep?.partnerCode, 'Selected OSP Representative', rep?.partnerCode);
  assert(!!siPartner?.partnerCode, 'Selected SI partner', siPartner?.partnerCode);

  // ONLY use a dedicated disposable @skygloss.test shop — never a real account.
  console.log('\n3) Ensure dedicated E2E test shop (never a real account)');
  let shop = shops.find(
    (s) => String(s.email || '').toLowerCase() === E2E_SHOP_EMAIL,
  );
  if (!shop) {
    const createShop = await req('POST', '/users', {
      email: E2E_SHOP_EMAIL,
      password: E2E_SHOP_PASSWORD,
      firstName: 'E2E',
      lastName: 'AssignOrders',
      shopName: 'E2E Partner Assign Test Shop',
      role: 'certified_shop',
      status: 'active',
      country: 'Ireland',
      city: 'Dublin',
      address: '1 Test Street',
      phoneNumber: '+353800000000',
      referredByPartnerCode: '',
      operationalSupportRepresentativeCode: '',
      isCertified: true,
    });
    shop = unwrap(createShop.data);
    assert(
      createShop.status === 201 || createShop.status === 200,
      'Create dedicated E2E test shop',
      `status=${createShop.status} ${JSON.stringify(createShop.data?.message || '').slice(0, 160)}`,
    );
  } else {
    pass('Reuse dedicated E2E test shop', E2E_SHOP_EMAIL);
  }

  assert(!!shop?._id, 'Dedicated E2E shop available');
  assertNotRealShop(shop);
  pass('Safety: shop is disposable test account', shop.email);

  console.log(`   Shop: ${shop.email} (${shop._id})`);
  console.log(`   OSP candidate: ${rep.partnerCode}`);
  console.log(`   SI candidate: ${siPartner.partnerCode}`);

  // Clear OSP + SI for a clean unassigned baseline (selective empty = no stamp-all)
  const clearRes = await req('PATCH', `/users/${shop._id}`, {
    referredByPartnerCode: '',
    operationalSupportRepresentativeCode: '',
    linkOperationalSupportOrderIds: [],
    linkShopIntroductionOrderIds: [],
  });
  assert(
    clearRes.status === 200 || clearRes.status === 201,
    'Clear E2E shop OSP/SI assignment',
    `status=${clearRes.status} ${JSON.stringify(clearRes.data?.message || clearRes.payload?.message || '')}`,
  );

  // --- 4. Create test orders ONLY on the dedicated E2E shop ---
  console.log('\n4) Create test orders on dedicated E2E shop only');
  assertNotRealShop(shop);
  const sizeVal =
    productWithSize.sizes[0].size ||
    productWithSize.sizes[0].name ||
    productWithSize.sizes[0];
  const createdOrderIds = [];

  for (let i = 0; i < 3; i++) {
    const create = await req('POST', '/orders/admin/test-order', {
      shopUserId: shop._id,
      items: [
        {
          productId: productWithSize._id,
          size: String(sizeVal),
          quantity: 1,
          orderType: 'unit',
        },
      ],
      initialStatus: i === 0 ? 'PENDING' : 'PAID',
      markShippedImmediately: i === 2,
      trackingId: i === 2 ? `TEST-ASSIGN-${Date.now()}-${i}` : undefined,
    });
    const created = unwrap(create.data);
    if (create.status >= 200 && create.status < 300 && created?._id) {
      createdOrderIds.push(String(created._id));
      pass(
        `Create test order #${i + 1}`,
        `${created.orderNumber} status=${created.status}`,
      );
    } else {
      fail(
        `Create test order #${i + 1}`,
        `status=${create.status} ${JSON.stringify(create.data?.message || create.data).slice(0, 200)}`,
      );
    }
  }

  // Fallback: list shop orders via admin orders if create failed
  let shopOrders = [];
  const ordersList = await req('GET', `/orders/admin/all`);
  const allOrdersRaw = unwrap(ordersList.data);
  const allOrders = Array.isArray(allOrdersRaw)
    ? allOrdersRaw
    : Array.isArray(allOrdersRaw?.orders)
      ? allOrdersRaw.orders
      : [];
  shopOrders = allOrders.filter(
    (o) =>
      String(o.user?._id || o.user) === String(shop._id) ||
      String(o.shopId) === String(shop._id),
  );

  // Also try users-based: fetch via preview after we have partner
  assert(
    createdOrderIds.length > 0 || shopOrders.length > 0,
    'Shop has orders available for assignment testing',
    `created=${createdOrderIds.length} listed=${shopOrders.length}`,
  );

  // --- 5. Preview OSP ---
  console.log('\n5) Preview OSP assignment orders');
  const previewOs = await req(
    'GET',
    `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=Operational%20Support&partnerCode=${encodeURIComponent(rep.partnerCode)}&ratePercent=10`,
  );
  assert(
    previewOs.status === 200,
    'OSP preview returns 200',
    `status=${previewOs.status}`,
  );
  const osPreview = unwrap(previewOs.data) || {};
  assert(
    osPreview.earningType === 'Operational Support',
    'OSP preview earningType correct',
  );
  assert(
    Array.isArray(osPreview.orders) && osPreview.orders.length > 0,
    'OSP preview lists orders',
    `count=${osPreview.orders?.length ?? 0}`,
  );
  assert(
    osPreview.ratePercent === 10,
    'OSP preview rate is 10%',
    `rate=${osPreview.ratePercent}`,
  );

  const osEligible = (osPreview.orders || []).filter((o) => o.eligible);
  assert(
    osEligible.length > 0,
    'At least one OSP-eligible order',
    `eligible=${osEligible.length}`,
  );

  // Role mix check: every eligible row must be OSP commission only
  assert(
    (osPreview.orders || []).every(
      (o) => o.partnerRole === 'Operational Support',
    ),
    'OSP preview does not mix SI commission role',
  );

  // Commission math sanity: amount ≈ convertedUsd * rate/100
  const sample = osEligible[0];
  if (sample) {
    const expected = Math.round(
      sample.convertedUsdAmount * (sample.commissionPercent / 100) * 100,
    ) / 100;
    const diff = Math.abs(expected - sample.commissionAmount);
    assert(
      diff < 0.05,
      'OSP commission matches base × rate',
      `expected≈${expected} got=${sample.commissionAmount}`,
    );
  }

  // Invalid earning type
  const badType = await req(
    'GET',
    `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=bogus&partnerCode=${encodeURIComponent(rep.partnerCode)}`,
  );
  assert(badType.status >= 400, 'Preview rejects invalid earningType');

  // Promoter as OSP should fail
  if (promoters[0]) {
    const badOs = await req(
      'GET',
      `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=Operational%20Support&partnerCode=${encodeURIComponent(promoters[0].partnerCode)}`,
    );
    assert(
      badOs.status >= 400,
      'OSP preview rejects Promoter as Operational Support',
      `status=${badOs.status}`,
    );
  }

  // --- 6. Selective OSP link (subset only) ---
  console.log('\n6) Assign OSP + link subset of eligible orders');
  const linkOsIds = osEligible.slice(0, Math.max(1, Math.min(2, osEligible.length))).map(
    (o) => o.orderId,
  );
  const unlinkedOsIds = osEligible
    .filter((o) => !linkOsIds.includes(o.orderId))
    .map((o) => o.orderId);

  const assignOs = await req('PATCH', `/users/${shop._id}`, {
    operationalSupportRepresentativeCode: rep.partnerCode,
    operationalSupportRatePercent: 10,
    linkOperationalSupportOrderIds: linkOsIds,
    linkShopIntroductionOrderIds: [],
  });
  assert(
    assignOs.status === 200,
    'Assign OSP with selective order IDs',
    `status=${assignOs.status}`,
  );
  const assignOsBody = unwrap(assignOs.data) || {};
  assert(
    String(assignOsBody.operationalSupportRepresentativeCode || '')
      .toUpperCase() === String(rep.partnerCode).toUpperCase(),
    'Shop OSP code saved',
  );

  // Wait for async selective link queue
  await new Promise((r) => setTimeout(r, 2500));

  const previewOsAfter = await req(
    'GET',
    `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=Operational%20Support&partnerCode=${encodeURIComponent(rep.partnerCode)}&ratePercent=10`,
  );
  const afterOrders = unwrap(previewOsAfter.data)?.orders || [];

  for (const id of linkOsIds) {
    const row = afterOrders.find((o) => o.orderId === id);
    assert(
      row?.alreadyAssigned === true || row?.eligible === false,
      `Linked OSP order now marked assigned`,
      id.slice(-6),
    );
  }
  for (const id of unlinkedOsIds) {
    const row = afterOrders.find((o) => o.orderId === id);
    // Unselected should still be eligible (not stamped)
    assert(
      row?.eligible === true && row?.alreadyAssigned !== true,
      'Unselected OSP order remains unlinked',
      id.slice(-6),
    );
  }

  // Duplicate prevention: re-link same orders
  console.log('\n7) Duplicate OSP link prevention');
  const relink = await req('PATCH', `/users/${shop._id}`, {
    operationalSupportRepresentativeCode: rep.partnerCode,
    operationalSupportRatePercent: 10,
    linkOperationalSupportOrderIds: linkOsIds,
  });
  assert(relink.status === 200, 'Re-save with same OSP link IDs succeeds');
  await new Promise((r) => setTimeout(r, 2000));

  // Fetch one linked order detail if possible
  const linkedId = linkOsIds[0];
  const orderDetail = await req('GET', `/orders/admin/${linkedId}`);
  const orderBody = unwrap(orderDetail.data) || {};
  let commissions = orderBody.commissions;
  if (!Array.isArray(commissions) && orderBody.order?.commissions) {
    commissions = orderBody.order.commissions;
  }
  if (Array.isArray(commissions)) {
    const osLines = commissions.filter(
      (c) =>
        String(c.earningType || '')
          .replace(/\s*\(partial[^)]*\)\s*$/i, '')
          .trim() === 'Operational Support',
    );
    assert(
      osLines.length === 1,
      'No duplicate Operational Support commission lines',
      `count=${osLines.length}`,
    );
    assert(
      String(osLines[0]?.recipientPartnerCode || '').toUpperCase() ===
        String(rep.partnerCode).toUpperCase(),
      'OSP commission recipient matches assigned REP',
    );
  } else {
    // Fallback via preview alreadyAssigned
    const row = afterOrders.find((o) => o.orderId === linkedId);
    assert(!!row?.alreadyAssigned, 'Linked order shows alreadyAssigned via preview');
  }

  // --- 8. SI preview + independent assign ---
  console.log('\n8) Shop Introduction Partner preview + selective link');
  const previewSi = await req(
    'GET',
    `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=Shop%20Introduction&partnerCode=${encodeURIComponent(siPartner.partnerCode)}&ratePercent=10`,
  );
  assert(previewSi.status === 200, 'SI preview returns 200');
  const siPreview = unwrap(previewSi.data) || {};
  assert(
    siPreview.earningType === 'Shop Introduction',
    'SI preview earningType correct',
  );
  assert(
    (siPreview.orders || []).every(
      (o) => o.partnerRole === 'Shop Introduction',
    ),
    'SI preview does not mix OSP commission role',
  );

  const siEligible = (siPreview.orders || []).filter((o) => o.eligible);
  const linkSiIds = siEligible.slice(0, 1).map((o) => o.orderId);
  // Prefer an order that already has OSP (independence) if possible
  const preferredSi =
    siEligible.find((o) => linkOsIds.includes(o.orderId)) || siEligible[0];
  const siLink = preferredSi ? [preferredSi.orderId] : linkSiIds;

  if (siLink.length) {
    const assignSi = await req('PATCH', `/users/${shop._id}`, {
      referredByPartnerCode: siPartner.partnerCode,
      shopIntroductionFirstOrderRatePercent: 10,
      linkShopIntroductionOrderIds: siLink,
      linkOperationalSupportOrderIds: [],
    });
    assert(assignSi.status === 200, 'Assign SI with selective order IDs');
    await new Promise((r) => setTimeout(r, 2500));

    const previewSiAfter = await req(
      'GET',
      `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=Shop%20Introduction&partnerCode=${encodeURIComponent(siPartner.partnerCode)}&ratePercent=10`,
    );
    const siRow = (unwrap(previewSiAfter.data)?.orders || []).find(
      (o) => o.orderId === siLink[0],
    );
    assert(
      siRow?.alreadyAssigned === true || siRow?.eligible === false,
      'Selected SI order linked',
    );

    // Order that had OSP should still have OSP (independence)
    if (linkOsIds.includes(siLink[0])) {
      const osCheck = await req(
        'GET',
        `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=Operational%20Support&partnerCode=${encodeURIComponent(rep.partnerCode)}`,
      );
      const osRow = (unwrap(osCheck.data)?.orders || []).find(
        (o) => o.orderId === siLink[0],
      );
      assert(
        osRow?.alreadyAssigned === true || osRow?.eligible === false,
        'OSP assignment intact after SI link on same order',
      );
    }
  } else {
    fail('SI eligible orders available to link');
  }

  // --- 9. Empty selection does not stamp remaining ---
  console.log('\n9) Empty link array does not stamp remaining eligible');
  // Find still-eligible OSP orders (unlinked earlier)
  const still = await req(
    'GET',
    `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=Operational%20Support&partnerCode=${encodeURIComponent(rep.partnerCode)}`,
  );
  const stillEligible = (unwrap(still.data)?.orders || []).filter((o) => o.eligible);
  const emptyLink = await req('PATCH', `/users/${shop._id}`, {
    operationalSupportRepresentativeCode: rep.partnerCode,
    linkOperationalSupportOrderIds: [],
  });
  assert(emptyLink.status === 200, 'PATCH with empty OSP link array');
  await new Promise((r) => setTimeout(r, 2000));
  const still2 = await req(
    'GET',
    `/orders/admin/shops/${shop._id}/partner-assignment-preview?earningType=Operational%20Support&partnerCode=${encodeURIComponent(rep.partnerCode)}`,
  );
  const stillEligible2 = (unwrap(still2.data)?.orders || []).filter((o) => o.eligible);
  assert(
    stillEligible2.length === stillEligible.length,
    'Empty link array left remaining eligible orders untouched',
    `before=${stillEligible.length} after=${stillEligible2.length}`,
  );

  // --- 10. Cleanup created E2E orders (keep disposable shop for reuse) ---
  console.log('\n10) Cleanup E2E test orders');
  assertNotRealShop(shop);
  let deleted = 0;
  for (const id of createdOrderIds) {
    const del = await req('DELETE', `/orders/admin/${id}`);
    if (del.status === 200) deleted += 1;
  }
  assert(
    deleted === createdOrderIds.length,
    'Soft-deleted all E2E test orders',
    `${deleted}/${createdOrderIds.length}`,
  );

  // Clear partners again so the disposable shop stays unassigned.
  await req('PATCH', `/users/${shop._id}`, {
    referredByPartnerCode: '',
    operationalSupportRepresentativeCode: '',
    linkOperationalSupportOrderIds: [],
    linkShopIntroductionOrderIds: [],
  });

  // --- Summary ---
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('\nFailed cases:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  console.log('='.repeat(60) + '\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
