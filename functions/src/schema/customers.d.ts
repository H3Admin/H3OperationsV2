/**
 * Type declaration for the CommonJS schema module schema/customers.js.
 *
 * DECISION (2026-07): customers.js stays plain CommonJS .js (single source of
 * truth; its zero-dep node --test suite depends on it staying .js). Rather than
 * enable allowJs project-wide or convert it to .ts, we declare its shape here so
 * TS callers (createCustomer, future writers) get type-checking without changing
 * the compile model. Mirror this by hand if customers.js exports change.
 */
declare const schema: {
  CUSTOMER_STATUS: Record<string, string>;
  CUSTOMER_SOURCE: Record<string, string>;
  SYSTEM_ACTOR: Record<string, string>;
  INTERACTION_TYPE: Record<string, string>;
  DISPLAY_NAME_SOURCE: Record<string, string>;
  VALID_STATUSES: string[];
  VALID_SOURCES: string[];
  VALID_INTERACTION_TYPES: string[];
  VALID_DISPLAY_NAME_SOURCES: string[];
  normalizePhoneE164(raw: string): string | null;
  customerIdFromPhone(raw: string): string | null;
  sanitizeDisplayName(raw: unknown): string | null;
  customersCollectionPath(accountId: string): string;
  customerDocPath(accountId: string, customerId: string): string;
  interactionsCollectionPath(accountId: string, customerId: string): string;
  interactionDocPath(accountId: string, customerId: string, interactionId: string): string;
  buildNewCustomer(input: Record<string, unknown>): Record<string, unknown>;
  buildCustomerUpdate(patch: Record<string, unknown>): Record<string, unknown>;
  buildInteraction(input: Record<string, unknown>): Record<string, unknown>;
  normalizeAddress(address: Record<string, unknown> | null): Record<string, unknown> | null;
};
export default schema;
