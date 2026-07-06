### Customer Schema (Firestore)

This document outlines the data structure for a customer record in Firestore.

**Collection Path:** `accounts/{accountId}/customers`
**Document ID:** `{customerId}`

**Fields:**

*   `id`: `string` (unique identifier)
*   `createdAt`: `timestamp` (Firestore timestamp)
*   `updatedAt`: `timestamp` (Firestore timestamp)
*   `displayName`: `string` (customer's full name or company name)
*   `email`: `string` (primary email address)
*   `phone`: `string` (primary phone number)
*   `addressLine1`: `string`
*   `addressLine2`: `string` (optional)
*   `city`: `string`
*   `state`: `string`
*   `postalCode`: `string`
*   `status`: `string` (Enum: `lead`, `active`, `inactive`, `archived`)
*   `notes`: `string` (free-form text for notes, optional)
