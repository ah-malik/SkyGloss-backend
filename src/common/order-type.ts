export type OrderItemType = 'unit' | 'case';

export function formatOrderItemTypeLabel(
  orderType?: string | null,
): string {
  if ((orderType || '').toLowerCase() === 'case') {
    return 'Case';
  }
  return 'Unit';
}

export function normalizeOrderItemType(
  orderType?: string | null,
): OrderItemType {
  return (orderType || '').toLowerCase() === 'case' ? 'case' : 'unit';
}

/** Map size labels like "250mL" / "2L" to FUSION display codes: 250, 500, 2000. */
export function resolveFusionSizeCode(size?: string | null): string | null {
  if (!size) return null;
  const normalized = String(size).trim().toLowerCase().replace(/\s+/g, '');

  if (normalized === '2l' || normalized === '2000ml' || normalized === '2000') {
    return '2000';
  }

  const mlMatch = normalized.match(/^(\d+(?:\.\d+)?)m?l$/);
  if (mlMatch) {
    const ml = Number(mlMatch[1]);
    if (Number.isFinite(ml)) return String(Math.round(ml));
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  return null;
}

/** Display FUSION as "FUSION 250" / "FUSION 500" / "FUSION 2000" based on size. */
export function formatOrderItemDisplayName(item: {
  name?: string | null;
  size?: string | null;
}): string {
  const name = (item?.name || '').trim();
  if (!name) return '';

  const upper = name.toUpperCase();
  if (upper !== 'FUSION') return name;

  if (/\bFUSION\s+\d+\b/i.test(name)) return name;

  const sizeCode = resolveFusionSizeCode(item?.size);
  if (!sizeCode) return name;

  return `FUSION ${sizeCode}`;
}
