export const REDIS_CLIENT = 'REDIS_CLIENT';

/** Shared cache key prefixes — keep invalidation consistent across services. */
export const CacheKeys = {
  exchangeRatesMap: 'exchange-rates:map',
  exchangeRatesAll: 'exchange-rates:all',
  productsList: (status?: string, targetAudience?: string) =>
    `products:list:${status || 'all'}:${targetAudience || 'all'}`,
  productsPrefix: 'products:',
  usersStats: 'users:stats',
  usersPrefix: 'users:',
  usersNetwork: (viewerId: string) => `users:network:${viewerId}`,
  ordersPrefix: 'orders:',
  ordersDashboardStats: 'orders:dashboard-stats',
  ordersMy: (userId: string) => `orders:my:${userId}`,
  ordersNetwork: (viewerId: string) => `orders:network:${viewerId}`,
  ordersNetworkStats: (viewerId: string) => `orders:network-stats:${viewerId}`,
  ordersCommission: (viewerId: string) => `orders:commission:${viewerId}`,
  ordersAdminAll: 'orders:admin:all',
  notificationsPrefix: 'notifications:',
  notificationsUser: (userId: string) => `notifications:user:${userId}`,
  notificationsUserUnread: (userId: string) =>
    `notifications:user:${userId}:unread`,
  notificationsAdminList: 'notifications:admin:list',
  notificationsAdminUnread: 'notifications:admin:unread',
  inventoryPrefix: 'inventory:',
  inventoryPackaging: (userId: string) => `inventory:packaging:${userId}`,
} as const;

export const CacheTtl = {
  exchangeRates: 300, // 5 minutes
  productsList: 120, // 2 minutes
  usersStats: 60, // 1 minute
  usersNetwork: 30, // network tree — short; cleared on link changes
  ordersDashboardStats: 45, // 45 seconds
  ordersMy: 20,
  ordersNetwork: 20,
  ordersNetworkStats: 20,
  ordersCommission: 20,
  ordersAdminAll: 20,
  notificationsUser: 15,
  notificationsUnread: 10,
  inventoryPackaging: 30,
} as const;
