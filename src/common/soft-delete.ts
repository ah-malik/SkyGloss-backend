import { Schema, Query } from 'mongoose';

/** Soft-deleted records are permanently removed after this many days. */
export const SOFT_DELETE_RETENTION_DAYS = 20;

export const SOFT_DELETE_RETENTION_MS =
  SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type SoftDeleteQueryOptions = {
  /** Include soft-deleted documents in the query result. */
  withDeleted?: boolean;
};

export function computePurgeAt(deletedAt: Date = new Date()): Date {
  return new Date(deletedAt.getTime() + SOFT_DELETE_RETENTION_MS);
}

export function softDeleteSetPayload(deletedAt: Date = new Date()) {
  return {
    deletedAt,
    purgeAt: computePurgeAt(deletedAt),
  };
}

export function softDeleteUnsetPayload() {
  return {
    $unset: { deletedAt: 1, purgeAt: 1 },
  };
}

/**
 * Auto-excludes soft-deleted docs from find/count unless `{ withDeleted: true }`.
 * Documents with `deletedAt: null` or missing `deletedAt` are treated as active
 * (`{ deletedAt: null }` matches both in MongoDB).
 */
export function applySoftDeletePlugin(schema: Schema): void {
  const excludeDeleted = function (
    this: Query<unknown, unknown> & { getOptions: () => SoftDeleteQueryOptions },
  ) {
    if (this.getOptions()?.withDeleted) return;
    const query = this.getQuery() as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(query, 'deletedAt')) return;
    this.where({ deletedAt: null });
  };

  schema.pre('find', excludeDeleted);
  schema.pre('findOne', excludeDeleted);
  schema.pre('findOneAndUpdate', excludeDeleted);
  schema.pre('findOneAndReplace', excludeDeleted);
  schema.pre('findOneAndDelete', excludeDeleted);
  schema.pre('countDocuments', excludeDeleted);
}

/** Match clause for aggregations (plugin does not wrap aggregate). */
export const notSoftDeletedMatch = { deletedAt: null };
