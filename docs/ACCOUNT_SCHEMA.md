# Account Schema (Firestore)

This document outlines the data structure for an account record in Firestore.

**Collection:** `accounts`
**Document ID:** `{accountId}` (unique identifier)

**Fields:**

*   `id`: `string` (matches the document ID)
*   `createdAt`: `timestamp` (Firestore timestamp)
*   `updatedAt`: `timestamp` (Firestore timestamp)
*   `name`: `string` (The account's display name)

**Subcollection:** `members`
**Document ID:** `{userId}`

**Fields:**

*   `role`: `string` (Enum: `owner`, `admin`, `member`)
