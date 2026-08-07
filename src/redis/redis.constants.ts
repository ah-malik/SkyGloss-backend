export const REDIS_CLIENT = 'REDIS_CLIENT';

/** Shared cache key prefixes — keep invalidation consistent across services. */
export const CacheKeys = {
  exchangeRatesMap: 'exchange-rates:map',
  exchangeRatesAll: 'exchange-rates:all',
  productsList: (status?: string, targetAudience?: string) =>
    `products:list:${status || 'all'}:${targetAudience || 'all'}`,
  productsPrefix: 'products:',
  usersStats: 'users:stats',
  ordersDashboardStats: 'orders:dashboard-stats',
} as const;

export const CacheTtl = {
  exchangeRates: 300, // 5 minutes
  productsList: 120, // 2 minutes
  usersStats: 60, // 1 minute
  ordersDashboardStats: 45, // 45 seconds
} as const;
