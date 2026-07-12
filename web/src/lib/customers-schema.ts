/**
 * customers-schema.ts — Front-end mirror of the READ-side of the canonical
 * customer schema. The source of truth is functions/src/schema/customers.js
 * (server, CommonJS). This is a deliberate minimal copy: only what the CRM UI
 * needs to READ and display. Write factories (buildNewCustomer, etc.) stay
 * server-only and are NOT duplicated here.
 *
 * If a field or path changes in customers.js, mirror it here.
 */

// Firestore collection path for an account's customers. Mirrors
// customersCollectionPath() in the canonical module.
export function customersCollectionPath(accountId: string): string {
  if (!accountId) throw new Error("accountId must be a non-empty string");
  return `accounts/${accountId}/customers`;
}

// Status enum — values match CUSTOMER_STATUS in the canonical module.
export const CUSTOMER_STATUS = {
  LEAD: "lead",
  ACTIVE: "active",
  INACTIVE: "inactive",
  ARCHIVED: "archived",
} as const;

export type CustomerStatus =
  (typeof CUSTOMER_STATUS)[keyof typeof CUSTOMER_STATUS];

// Human-readable labels for display.
export const STATUS_LABELS: Record<CustomerStatus, string> = {
  lead: "Lead",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const SOURCE_LABELS: Record<string, string> = {
  phone_call: "Phone call",
  web_form: "Web form",
  referral: "Referral",
  manual_entry: "Manual entry",
};

// Provenance of displayName — values match DISPLAY_NAME_SOURCE in the canonical
// module. Distinguishes an AI-guessed name (from the receptionist call) from a
// human-entered/confirmed one. null = no name, so no provenance.
export const DISPLAY_NAME_SOURCE = {
  AI_EXTRACTED: "ai_extracted",
  MANUAL_ENTRY: "manual_entry",
} as const;

export type DisplayNameSource =
  (typeof DISPLAY_NAME_SOURCE)[keyof typeof DISPLAY_NAME_SOURCE];

export const DISPLAY_NAME_SOURCE_LABELS: Record<DisplayNameSource, string> = {
  ai_extracted: "AI extracted",
  manual_entry: "Manual entry",
};

// Shape of a customer document as READ from Firestore (the .id is the
// Firestore doc id — E.164 digits without the leading "+").
export interface Customer {
  id: string;
  accountId: string;
  phone: string;
  displayName: string | null;
  displayNameSource: DisplayNameSource | null;
  email: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null;
  status: CustomerStatus;
  source: string | null;
  notes: string | null;
  createdBy: string;
  // createdAt / updatedAt are Firestore Timestamps; typed loosely for the UI.
  createdAt: { toDate: () => Date } | null;
  updatedAt: { toDate: () => Date } | null;
}
