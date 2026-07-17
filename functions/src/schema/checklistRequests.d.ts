/**
 * Type declaration for the CommonJS schema module schema/checklistRequests.js.
 *
 * Same posture as smsOptins.d.ts / customers.d.ts: the module stays plain
 * CommonJS .js (single source of truth; its zero-dep node --test suite depends on
 * it staying .js), so we hand-declare its shape here for the TS caller
 * (submitChecklistRequest in index.ts) rather than enabling allowJs. Mirror this
 * by hand if checklistRequests.js exports change.
 */
declare const schema: {
  CHECKLIST_REQUESTS_COLLECTION: string;
  CHECKLIST_REQUEST_STATUS: Record<string, string>;
  VALID_CHECKLIST_REQUEST_STATUSES: string[];
  buildNewChecklistRequest(input: Record<string, unknown>): Record<string, unknown>;
  buildChecklistRequestRefresh(input: Record<string, unknown>): Record<string, unknown>;
  normalizeEmail(raw: unknown): string;
  sanitizeTag(value: unknown, max: number): string | null;
};
export default schema;
