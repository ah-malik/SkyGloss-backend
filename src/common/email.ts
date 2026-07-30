/** Normalize email for storage and lookups (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Escape a string for safe use inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive exact email match query (covers legacy mixed-case records).
 */
export function emailEqualsQuery(email: string): { $regex: RegExp } {
  return {
    $regex: new RegExp(`^${escapeRegex(normalizeEmail(email))}$`, 'i'),
  };
}
