# Customer Schema (Firestore)

Canonical structure for a customer/lead record. Leads and customers share one
collection, distinguished by `status`. Source of truth for the schema is
`functions/src/schema/customers.js`; this doc explains intent.

## Paths

- **Collection:** `accounts/{accountId}/customers`
- **Document ID:** the customer's phone in E.164 **digits, no leading `+`**
  (e.g. `12145551234`). Phone is the dedupe key; using it as the ID makes the
  Receptionist→CRM write a direct `set(..., {merge:true})` with no query step,
  and keeps the ID URL-safe for the CRM detail route. Accepted limitation:
  shared-number households collapse to one record (merge/split is a later problem).
- **Interactions:** `accounts/{accountId}/customers/{customerId}/interactions/{interactionId}`
  — a **subcollection**, not an embedded array, to avoid the 1MB document cap
  and to allow paginated queries (e.g. "last 5 interactions").

## Customer fields

| Field         | Type                | Notes |
|---------------|---------------------|-------|
| `accountId`   | string              | Tenant id, stored redundantly to enable collection-group queries. |
| `phone`       | string (E.164)      | Canonical `+1XXXXXXXXXX`. Identity/dedupe key. Never mutated after create. |
| `displayName` | string \| null      | Person or company name. |
| `email`       | string \| null      | Primary email. |
| `address`     | object \| null      | Nested: `{ line1, line2, city, state, postalCode }`. Room for lat/lng later (routing/service-area). Empty input stores `null`. |
| `status`      | enum                | `lead` \| `active` \| `inactive` \| `archived`. |
| `source`      | enum                | `phone_call` \| `web_form` \| `referral` \| `manual_entry`. |
| `notes`       | string \| null      | Free-form. |
| `createdBy`   | string              | Firebase Auth uid, or a system actor (`system:receptionist`). Audit trail — matters because customer docs are client-writable today. |
| `createdAt`   | Timestamp (UTC)     | Server-set. |
| `updatedAt`   | Timestamp (UTC)     | Server-set on every write. |

There is no separate `id` field — the Firestore snapshot always carries `.id`.

### Status semantics
- `lead` — captured, not yet a paying relationship.
- `active` — current paying / engaged customer.
- `inactive` — real relationship, currently dormant.
- `archived` — soft-deleted; hidden from active views.

## Interaction fields (subcollection)

| Field       | Type            | Notes |
|-------------|-----------------|-------|
| `type`      | enum            | `call` \| `note` \| `sms` \| `email`. |
| `summary`   | string \| null  | Short human-readable line. |
| `data`      | object \| null  | Type-specific payload (e.g. `{ callSid, durationSec }`). |
| `createdBy` | string          | uid or system actor. |
| `createdAt` | Timestamp (UTC) | Server-set. |

## Notes for implementers
- Phone normalization is US/Canada (+1) only via `normalizePhoneE164`. A `null`
  return means **reject**, never store raw. Swap in `libphonenumber-js` if
  international is ever required.
- Factories build bodies only; they never write. Callers derive the doc ID with
  `customerIdFromPhone()` and own the Firestore write, wrapped in their own
  try/catch (per the CRM decision: a CRM failure must never break call handling).
