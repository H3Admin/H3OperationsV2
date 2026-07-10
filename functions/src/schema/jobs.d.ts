/**
 * Type declaration for the CommonJS schema module schema/jobs.js.
 *
 * DECISION (2026-07): jobs.js stays plain CommonJS .js (single source of
 * truth; its zero-dep node --test suite depends on it staying .js). Rather than
 * enable allowJs project-wide or convert it to .ts, we declare its shape here so
 * TS callers get type-checking without changing the compile model. Mirror this
 * by hand if jobs.js exports change.
 */
import type { Timestamp } from 'firebase-admin/firestore';

declare const schema: {
  JOB_STATUS: Record<string, string>;
  JOB_SOURCE: Record<string, string>;
  VALID_JOB_STATUSES: string[];
  VALID_JOB_SOURCES: string[];
  jobsCollectionPath(accountId: string): string;
  jobDocPath(accountId: string, jobId: string): string;
  buildNewJob(input: Record<string, unknown>): Record<string, unknown>;
  buildJobUpdate(patch: Record<string, unknown>): Record<string, unknown>;
  toTimestamp(value: Date | number | string, name: string): Timestamp;
  normalizeSnapshotPhone(raw: string | null | undefined): string | null;
  normalizePriceCents(value: number | null | undefined, name: string): number | null;
  normalizeDurationMin(value: number | null | undefined, name: string): number | null;
};
export default schema;
