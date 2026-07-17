/**
 * Type declaration for the CommonJS schema module schema/signupRequests.js.
 *
 * Same posture as smsOptins.d.ts / customers.d.ts: the module stays plain
 * CommonJS .js (single source of truth; its zero-dep node --test suite depends on
 * it staying .js), so we hand-declare its shape here for the TS caller
 * (submitSignupRequest in index.ts) rather than enabling allowJs. Mirror this by
 * hand if signupRequests.js exports change.
 */
declare const schema: {
  SIGNUP_REQUESTS_COLLECTION: string;
  SIGNUP_REQUEST_STATUS: Record<string, string>;
  VALID_SIGNUP_REQUEST_STATUSES: string[];
  buildNewSignupRequest(input: Record<string, unknown>): Record<string, unknown>;
  buildSignupRequestRefresh(input: Record<string, unknown>): Record<string, unknown>;
  normalizeEmail(raw: unknown): string;
  sanitizeTag(value: unknown, max: number): string | null;
};
export default schema;
