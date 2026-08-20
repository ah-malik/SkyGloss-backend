export type ApiPortal = 'frontend' | 'admin';

export interface ApiEndpointDef {
  /** Unique id used for enable/disable persistence */
  id: string;
  portal: ApiPortal;
  group: string;
  method: string;
  /** Express-style path, e.g. /users/:id */
  path: string;
  label: string;
}

function def(
  portal: ApiPortal,
  group: string,
  method: string,
  path: string,
  label: string,
): ApiEndpointDef {
  const id = `${portal}:${method}:${path}`;
  return { id, portal, group, method, path, label };
}

/** Frontend / partner / shop portal APIs (grouped). */
export const FRONTEND_APIS: ApiEndpointDef[] = [
  // Auth
  def('frontend', 'Auth', 'POST', '/auth/login', 'Login'),
  def('frontend', 'Auth', 'POST', '/auth/login/access-code', 'Login with access code'),
  def('frontend', 'Auth', 'POST', '/auth/forgot-password', 'Forgot password'),
  def('frontend', 'Auth', 'POST', '/auth/reset-password', 'Reset password'),
  def('frontend', 'Auth', 'POST', '/auth/register-shop', 'Register shop'),
  def('frontend', 'Auth', 'POST', '/auth/register-partner', 'Register partner'),
  def('frontend', 'Auth', 'POST', '/auth/register', 'Register'),
  def(
    'frontend',
    'Auth',
    'POST',
    '/auth/validate-shop-registration-coupon',
    'Validate shop registration coupon',
  ),
  def('frontend', 'Auth', 'GET', '/auth/profile', 'Get profile'),
  def('frontend', 'Auth', 'POST', '/auth/refresh', 'Refresh session'),
  def('frontend', 'Auth', 'POST', '/auth/logout', 'Logout / revoke session'),
  def('frontend', 'Auth', 'POST', '/auth/establish-session', 'Establish cookie session'),
  def('frontend', 'Auth', 'GET', '/auth/verify-payment/:userId', 'Verify registration payment'),

  // Public
  def('frontend', 'Public', 'GET', '/public/map-locations', 'Map locations'),
  def(
    'frontend',
    'Public',
    'GET',
    '/public/validate-network-id/:code',
    'Validate network ID',
  ),
  def(
    'frontend',
    'Public',
    'GET',
    '/registration-fees/public/by-country/:country',
    'Registration fee by country',
  ),

  // Users / profile / training
  def('frontend', 'Users', 'PATCH', '/users/me/profile', 'Update my profile'),
  def('frontend', 'Users', 'POST', '/users/me/profile-image', 'Upload profile image'),
  def('frontend', 'Users', 'PATCH', '/users/me/course-progress', 'Update course progress'),
  def('frontend', 'Users', 'PATCH', '/users/me/complete-course', 'Complete course'),
  def('frontend', 'Users', 'POST', '/users/me/training-complete', 'Complete training'),
  def(
    'frontend',
    'Users',
    'POST',
    '/users/upload-certification-video',
    'Upload certification video',
  ),
  def('frontend', 'Users', 'GET', '/users/referred-shops', 'Get referred shops'),
  def(
    'frontend',
    'Users',
    'PATCH',
    '/users/referred-shops/:id/visibility',
    'Update referred shop visibility',
  ),
  def(
    'frontend',
    'Users',
    'GET',
    '/users/network/search-representative',
    'Search representative',
  ),
  def(
    'frontend',
    'Users',
    'POST',
    '/users/network/add-representative',
    'Add representative',
  ),
  def('frontend', 'Users', 'GET', '/users/partners-list', 'Partners list'),
  def(
    'frontend',
    'Users',
    'GET',
    '/users/me/local-representative',
    'Get shop local representative and Hub/Distributor parent link',
  ),
  def('frontend', 'Users', 'PATCH', '/users/:id/transfer-shop', 'Transfer shop'),
  def('frontend', 'Users', 'PATCH', '/users/:id', 'Update user'),
  def('frontend', 'Users', 'GET', '/users', 'List users (network)'),

  // Access codes (partner)
  def('frontend', 'Access Codes', 'POST', '/access-codes', 'Create access code'),
  def('frontend', 'Access Codes', 'GET', '/access-codes', 'List access codes'),

  // Products
  def('frontend', 'Products', 'GET', '/products', 'List products'),
  def('frontend', 'Products', 'GET', '/products/:id', 'Get product'),
  def('frontend', 'Product Groups', 'GET', '/product-groups', 'List product groups'),
  def('frontend', 'Product Groups', 'GET', '/product-groups/:id', 'Get product group'),

  // Orders
  def('frontend', 'Orders', 'POST', '/orders/checkout-session', 'Create checkout session'),
  def('frontend', 'Orders', 'POST', '/orders/activation-fee', 'Create activation fee session'),
  def('frontend', 'Orders', 'GET', '/orders/my-orders', 'My orders'),
  def('frontend', 'Orders', 'GET', '/orders/network-orders', 'Network orders'),
  def('frontend', 'Orders', 'GET', '/orders/network-sales-stats', 'Network sales stats'),
  def('frontend', 'Orders', 'GET', '/orders/commission-orders', 'Commission orders'),
  def('frontend', 'Orders', 'GET', '/orders/verify/:orderId', 'Verify order payment'),
  def('frontend', 'Orders', 'GET', '/orders/:id', 'Get order'),
  def('frontend', 'Orders', 'POST', '/orders/:id/pay', 'Pay for order'),
  def('frontend', 'Orders', 'POST', '/orders/request', 'Create order request'),
  def('frontend', 'Orders', 'POST', '/orders/admin/:id/status', 'Update order status'),

  // Certifications
  def(
    'frontend',
    'Certifications',
    'POST',
    '/certifications/checkout-session',
    'Certification checkout',
  ),
  def('frontend', 'Certifications', 'GET', '/certifications/my-requests', 'My certification requests'),
  def(
    'frontend',
    'Certifications',
    'GET',
    '/certifications/verify-payment/:sessionId',
    'Verify certification payment',
  ),

  // Coupons
  def('frontend', 'Coupons', 'POST', '/coupons/validate', 'Validate coupon'),

  // Shop requests
  def('frontend', 'Shop Requests', 'POST', '/shop-requests', 'Create shop request'),

  // Notifications
  def('frontend', 'Notifications', 'GET', '/notifications/my-unread', 'My unread count'),
  def('frontend', 'Notifications', 'GET', '/notifications/my', 'My notifications'),
  def(
    'frontend',
    'Notifications',
    'PATCH',
    '/notifications/mark-all-my-read',
    'Mark all my notifications read',
  ),
  def(
    'frontend',
    'Notifications',
    'PATCH',
    '/notifications/mark-my-chat-read',
    'Mark my chat read',
  ),
  def(
    'frontend',
    'Notifications',
    'PATCH',
    '/notifications/mark-chat-read/:triggeredById',
    'Mark chat read by sender',
  ),

  // Support
  def('frontend', 'Support', 'POST', '/support', 'Create support ticket'),
  def('frontend', 'Support', 'GET', '/support/user/:email', 'Support tickets by email'),
  def('frontend', 'Support', 'GET', '/support/:id', 'Get support ticket'),
  def('frontend', 'Support', 'POST', '/support/:id/messages', 'Add support message'),

  // Chat
  def('frontend', 'Chat', 'POST', '/chat/room', 'Create chat room'),
  def('frontend', 'Chat', 'GET', '/chat/room/:id', 'Get chat room'),
  def('frontend', 'Chat', 'GET', '/chat/room/:id/messages', 'Get chat messages'),
  def('frontend', 'Chat', 'POST', '/chat/room/:id/close', 'Close chat room'),

  // Payouts
  def('frontend', 'Wallets', 'GET', '/wallets/my', 'My wallet'),
  def('frontend', 'Wallets', 'GET', '/wallets/my/transactions', 'Wallet transactions'),
  def('frontend', 'Wallets', 'GET', '/wallets/my/history', 'Transaction history'),
  def('frontend', 'Bank Details', 'GET', '/bank-details/my', 'Get bank details'),
  def('frontend', 'Bank Details', 'POST', '/bank-details', 'Save bank details'),
  def('frontend', 'Commissions', 'GET', '/commissions/summary', 'Commission summary'),
  def('frontend', 'Commissions', 'GET', '/commissions', 'List commissions'),
  def(
    'frontend',
    'Withdrawals',
    'GET',
    '/withdrawals/available-balance',
    'Available balance',
  ),
  def(
    'frontend',
    'Withdrawals',
    'GET',
    '/withdrawals/hubs',
    'Hubs available for withdrawal',
  ),
  def('frontend', 'Withdrawals', 'POST', '/withdrawals', 'Submit withdrawal'),
  def('frontend', 'Withdrawals', 'GET', '/withdrawals/my', 'My withdrawals'),
  def('frontend', 'Withdrawals', 'GET', '/withdrawals/hub/pending', 'Hub pending withdrawals'),
  def('frontend', 'Withdrawals', 'GET', '/withdrawals/:id', 'Withdrawal detail'),
  def('frontend', 'Withdrawals', 'PATCH', '/withdrawals/:id/hub-review', 'Hub review withdrawal'),
  def(
    'frontend',
    'Withdrawals',
    'PATCH',
    '/withdrawals/:id/resume-after-bank',
    'Resume after bank update',
  ),

  // PDF
  def('frontend', 'PDF', 'GET', '/pdf/certificate', 'Download certificate'),
];

/** Admin panel APIs (grouped). */
export const ADMIN_APIS: ApiEndpointDef[] = [
  // Auth
  def('admin', 'Auth', 'POST', '/auth/login', 'Login'),
  def('admin', 'Auth', 'GET', '/auth/profile', 'Get profile'),
  def('admin', 'Auth', 'POST', '/auth/refresh', 'Refresh session'),
  def('admin', 'Auth', 'POST', '/auth/logout', 'Logout / revoke session'),
  def('admin', 'Auth', 'POST', '/auth/establish-session', 'Establish cookie session'),
  def('admin', 'Auth', 'POST', '/auth/impersonate/:userId', 'Impersonate user'),
  def('admin', 'Auth', 'POST', '/auth/register', 'Register'),
  def('admin', 'Auth', 'POST', '/auth/forgot-password', 'Forgot password'),
  def('admin', 'Auth', 'POST', '/auth/reset-password', 'Reset password'),

  // Users
  def('admin', 'Users', 'GET', '/users', 'List users'),
  def('admin', 'Users', 'GET', '/users/stats', 'User stats'),
  def('admin', 'Users', 'POST', '/users', 'Create user'),
  def('admin', 'Users', 'GET', '/users/:id', 'Get user'),
  def('admin', 'Users', 'PATCH', '/users/:id', 'Update user'),
  def('admin', 'Users', 'DELETE', '/users/:id', 'Delete user'),
  def('admin', 'Users', 'PATCH', '/users/me/profile', 'Update my profile'),
  def('admin', 'Users', 'POST', '/users/me/profile-image', 'Upload profile image'),
  def('admin', 'Users', 'PATCH', '/users/:id/transfer-shop', 'Transfer shop'),
  def('admin', 'Users', 'GET', '/users/partners-list', 'Partners list'),

  // Network (admin)
  def(
    'admin',
    'Network',
    'GET',
    '/users/admin/network/:ownerId/links',
    'Network links',
  ),
  def(
    'admin',
    'Network',
    'GET',
    '/users/admin/network/search-member',
    'Search network member',
  ),
  def(
    'admin',
    'Network',
    'POST',
    '/users/admin/network/add-member',
    'Add network member',
  ),
  def(
    'admin',
    'Network',
    'PATCH',
    '/users/admin/network/linked-representative-rate',
    'Update linked representative rate',
  ),
  def(
    'admin',
    'Network',
    'POST',
    '/users/admin/network/remove-member',
    'Remove network member',
  ),

  // Access codes
  def('admin', 'Access Codes', 'POST', '/access-codes', 'Create access code'),
  def('admin', 'Access Codes', 'GET', '/access-codes', 'List access codes'),

  // Shop requests
  def('admin', 'Shop Requests', 'GET', '/shop-requests', 'List shop requests'),
  def('admin', 'Shop Requests', 'GET', '/shop-requests/:id', 'Get shop request'),
  def('admin', 'Shop Requests', 'POST', '/shop-requests/:id/approve', 'Approve shop request'),
  def('admin', 'Shop Requests', 'POST', '/shop-requests/:id/reject', 'Reject shop request'),

  // Products
  def('admin', 'Products', 'POST', '/products/upload', 'Upload product images'),
  def('admin', 'Products', 'POST', '/products', 'Create product'),
  def('admin', 'Products', 'GET', '/products', 'List products'),
  def('admin', 'Products', 'GET', '/products/:id', 'Get product'),
  def('admin', 'Products', 'PATCH', '/products/:id', 'Update product'),
  def('admin', 'Products', 'DELETE', '/products/:id', 'Delete product'),

  // Product groups
  def('admin', 'Product Groups', 'POST', '/product-groups', 'Create product group'),
  def('admin', 'Product Groups', 'GET', '/product-groups', 'List product groups'),
  def('admin', 'Product Groups', 'GET', '/product-groups/:id', 'Get product group'),
  def('admin', 'Product Groups', 'PATCH', '/product-groups/:id', 'Update product group'),
  def('admin', 'Product Groups', 'DELETE', '/product-groups/:id', 'Delete product group'),

  // Orders
  def('admin', 'Orders', 'GET', '/orders/admin/all', 'List all orders'),
  def('admin', 'Orders', 'GET', '/orders/admin/stats', 'Order dashboard stats'),
  def('admin', 'Orders', 'POST', '/orders/admin/test-order', 'Create test order'),
  def('admin', 'Orders', 'POST', '/orders/admin/:id/status', 'Update order status'),
  def('admin', 'Orders', 'DELETE', '/orders/admin/:id', 'Delete order'),
  def('admin', 'Orders', 'GET', '/orders/admin/exchange-rates', 'Get exchange rates'),
  def('admin', 'Orders', 'POST', '/orders/admin/exchange-rates', 'Update exchange rate'),
  def(
    'admin',
    'Orders',
    'POST',
    '/orders/admin/exchange-rates/refresh',
    'Refresh exchange rates',
  ),
  def('admin', 'Orders', 'GET', '/orders/:id', 'Get order'),
  def('admin', 'Orders', 'POST', '/orders/request', 'Create order request'),

  // Certifications
  def('admin', 'Certifications', 'GET', '/certifications/admin/all', 'All certification requests'),
  def(
    'admin',
    'Certifications',
    'GET',
    '/certifications/admin/summary',
    'Certification status summary',
  ),
  def(
    'admin',
    'Certifications',
    'POST',
    '/certifications/admin/email-summary',
    'Email certification summary',
  ),
  def(
    'admin',
    'Certifications',
    'PATCH',
    '/certifications/admin/:id/status',
    'Update certification status',
  ),
  def(
    'admin',
    'Certifications',
    'GET',
    '/certifications/admin/verify-payment/:sessionId',
    'Verify certification payment',
  ),

  // Coupons
  def('admin', 'Coupons', 'POST', '/coupons', 'Create coupon'),
  def('admin', 'Coupons', 'GET', '/coupons', 'List coupons'),
  def('admin', 'Coupons', 'GET', '/coupons/analytics/overview', 'Coupon analytics'),
  def('admin', 'Coupons', 'GET', '/coupons/:id/report', 'Coupon report'),
  def('admin', 'Coupons', 'GET', '/coupons/:id', 'Get coupon'),
  def('admin', 'Coupons', 'PATCH', '/coupons/:id', 'Update coupon'),
  def('admin', 'Coupons', 'DELETE', '/coupons/:id', 'Delete coupon'),

  // Registration fees
  def('admin', 'Registration Fees', 'POST', '/registration-fees', 'Create fee'),
  def('admin', 'Registration Fees', 'GET', '/registration-fees', 'List fees'),
  def('admin', 'Registration Fees', 'GET', '/registration-fees/:id', 'Get fee'),
  def('admin', 'Registration Fees', 'PATCH', '/registration-fees/:id', 'Update fee'),
  def('admin', 'Registration Fees', 'DELETE', '/registration-fees/:id', 'Delete fee'),

  // Support
  def('admin', 'Support', 'GET', '/support', 'List support tickets'),
  def('admin', 'Support', 'GET', '/support/:id', 'Get support ticket'),
  def('admin', 'Support', 'PATCH', '/support/:id', 'Update support ticket'),
  def('admin', 'Support', 'POST', '/support/:id/messages', 'Add support message'),

  // Chat
  def('admin', 'Chat', 'GET', '/chat/rooms', 'List chat rooms'),
  def('admin', 'Chat', 'GET', '/chat/room/:id', 'Get chat room'),
  def('admin', 'Chat', 'GET', '/chat/room/:id/messages', 'Get chat messages'),
  def('admin', 'Chat', 'POST', '/chat/room/:id/close', 'Close chat room'),

  // Notifications
  def('admin', 'Notifications', 'GET', '/notifications', 'List notifications'),
  def('admin', 'Notifications', 'GET', '/notifications/unread-count', 'Unread count'),
  def('admin', 'Notifications', 'PATCH', '/notifications/:id/read', 'Mark notification read'),
  def('admin', 'Notifications', 'PATCH', '/notifications/read-all', 'Mark all read'),

  // User activity logs
  def(
    'admin',
    'User Activity',
    'GET',
    '/admin/user-activity',
    'List user login and action activity logs',
  ),
  def(
    'admin',
    'User Activity',
    'GET',
    '/admin/user-activity/countries',
    'List countries available for activity filter',
  ),

  // Withdrawals
  def('admin', 'Withdrawals', 'GET', '/withdrawals/admin/pending', 'Pending withdrawals'),
  def('admin', 'Withdrawals', 'GET', '/withdrawals/:id', 'Withdrawal detail'),
  def(
    'admin',
    'Withdrawals',
    'PATCH',
    '/withdrawals/:id/admin-review',
    'Admin review withdrawal',
  ),
  def('admin', 'Commissions', 'POST', '/commissions/admin/backfill', 'Backfill commissions'),

  // PDF
  def('admin', 'PDF', 'GET', '/pdf/order/:id', 'Download order PDF'),

  // Email settings
  def('admin', 'Email Settings', 'GET', '/email-settings', 'Get email settings'),
  def('admin', 'Email Settings', 'PATCH', '/email-settings', 'Update email settings'),
];

export const ALL_APIS: ApiEndpointDef[] = [...FRONTEND_APIS, ...ADMIN_APIS];

const PATH_PARAM_RE = /:([A-Za-z0-9_]+)/g;

/** Convert `/users/:id` → regex that matches `/users/abc`. */
export function pathToRegex(path: string): RegExp {
  const escaped = path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(PATH_PARAM_RE, '[^/]+');
  return new RegExp(`^${escaped}/?$`, 'i');
}

export interface CompiledApiEndpoint extends ApiEndpointDef {
  regex: RegExp;
  specificity: number;
  staticParts: number;
}

export const COMPILED_APIS: CompiledApiEndpoint[] = ALL_APIS.map((api) => {
  const parts = api.path.split('/').filter(Boolean);
  return {
    ...api,
    regex: pathToRegex(api.path),
    specificity: parts.length,
    staticParts: parts.filter((p) => !p.startsWith(':')).length,
  };
});

/**
 * Find the best matching controllable API for a client request.
 * Prefers more static segments so `/users/stats` wins over `/users/:id`.
 * Returns null if the route is not in the registry (left unrestricted).
 */
export function matchApiEndpoint(
  portal: ApiPortal,
  method: string,
  pathname: string,
): CompiledApiEndpoint | null {
  const m = method.toUpperCase();
  const path = pathname.split('?')[0] || '/';
  let best: CompiledApiEndpoint | null = null;
  let bestScore = -1;

  for (const api of COMPILED_APIS) {
    if (api.portal !== portal) continue;
    if (api.method !== m) continue;
    if (!api.regex.test(path)) continue;

    const score = api.staticParts * 1000 + api.specificity * 10 + api.path.length;
    if (score > bestScore) {
      bestScore = score;
      best = api;
    }
  }
  return best;
}

/** Paths that must never be blocked (control plane + payment webhooks + health). */
export function isAlwaysAllowedPath(pathname: string, method: string): boolean {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  const m = method.toUpperCase();

  if (path === '/' && m === 'GET') return true;
  if (path.startsWith('/health')) return true;
  if (path.startsWith('/api-control')) return true;
  if (path.startsWith('/api/docs')) return true;
  if (path === '/stripe/webhook') return true;
  if (path === '/orders/webhook' || path === '/orders/webhook-usa') return true;
  if (path === '/certifications/webhook') return true;
  if (path === '/webhooks/wise') return true;
  // Session lifecycle must remain reachable even if Auth APIs are toggled off
  if (
    m === 'POST' &&
    (path === '/auth/refresh' ||
      path === '/auth/logout' ||
      path === '/auth/establish-session')
  ) {
    return true;
  }
  return false;
}
