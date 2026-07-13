/**
 * Type declaration for the CommonJS schema module schema/smsOptins.js.
 *
 * Same posture as customers.d.ts: the module stays plain CommonJS .js (single
 * source of truth; its zero-dep node --test suite depends on it staying .js), so
 * we hand-declare its shape here for the TS caller (submitSmsOptin in index.ts)
 * rather than enabling allowJs. Mirror this by hand if smsOptins.js exports change.
 */
declare const schema: {
  SMS_OPTINS_COLLECTION: string;
  SMS_OPTIN_STATUS: Record<string, string>;
  VALID_SMS_OPTIN_STATUSES: string[];
  buildNewSmsOptin(input: Record<string, unknown>): Record<string, unknown>;
  buildSmsOptinRefresh(input: Record<string, unknown>): Record<string, unknown>;
  sanitizeRef(ref: unknown): string | null;
};
export default schema;
