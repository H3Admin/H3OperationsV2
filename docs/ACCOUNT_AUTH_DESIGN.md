# Account Authentication & Onboarding Design

This document outlines the two primary flows for a user to gain access to an account in the system:
1.  A new user signs up and creates a new Account, becoming its owner.
2.  A new user signs up to join an existing Account they were invited to.

## Core Entities & Conventions

-   **`accounts/{accountId}`**: A top-level collection where each document represents a single business/tenant. The `accountId` is a unique, auto-generated Firestore ID, completely independent of any user's `uid`.
-   **`accounts/{accountId}/members/{uid}`**: A subcollection where each document represents a user's membership to the account. The document ID is the user's Firebase Auth `uid`. It contains the user's role.
-   **`invites/{inviteId}`**: A new top-level collection to manage pending invitations. Each document represents a single invitation for a specific email to join a specific account with a designated role.

### Canonical Enums

-   **Role**: The allowed values for a user's role are `owner`, `admin`, `member`.

### Email Normalization Rule

**All email addresses MUST be normalized to lowercase** before being written to or queried from the `invites` collection. This prevents case-sensitivity bugs where an invited user signs up with a different email casing (e.g., `John@Acme.com` vs `john@acme.com`) and is incorrectly routed to the new account creation flow.

---

## Flow 1: New User Creates a New Account

This flow applies when a user signs up with an email that does not have a pending invitation.

1.  **Sign-up**: A user registers with their email and password. Firebase Authentication creates a new user record and returns a `uid`.
2.  **Check for Invites**: A backend process (Cloud Function triggered by user creation) queries the `invites` collection for any `pending` document where `email` matches the new user's **lowercase** email.
3.  **No Invite Found -> Create Account**: Since no invite is found, the system proceeds to create a new account for this user.
    a. A new document is created in the `accounts` collection. Firestore auto-generates a new `accountId`.
    b. A new document is created in the `accounts/{newAccountId}/members` subcollection, using the user's `uid` as the document ID. This document's content will be `{ "role": "owner" }`.
4.  **Set Custom Claims**: The backend process sets custom claims on the user's Firebase Auth token: `{ "accountId": newAccountId, "role": "owner" }`. The client will need to handle the latency of this step (see "Client-Side Handling of Custom Claim Latency" below).

---

## Flow 2: Invited User Joins an Existing Account

### A. Creating an Invitation

1.  **Trigger**: An existing user with `owner` or `admin` privileges initiates an invite.
2.  **Create Invite Record**: The backend creates a new document in the `invites` collection, ensuring the `email` field is stored in **lowercase**.

    **`invites` collection schema:**
    -   `email`: `string` (The normalized, lowercase email address of the invitee.)
    -   `accountId`: `string`
    -   `role`: `string` (Must be one of the canonical role values.)
    -   `status`: `string` (Enum: `pending`, `accepted`, `expired`.)
    -   `createdAt`: `timestamp`
    -   `invitedBy`: `string` (The `uid` of the user who sent the invitation.)

### B. Onboarding the Invited User

1.  **Sign-up**: The invited person signs up. Their client application MUST normalize the email to **lowercase** before sending it to Firebase Auth.
2.  **Check for Invites**: The same backend process (Cloud Function on user creation) queries the `invites` collection for a `pending` document matching the new user's **lowercase** email.
3.  **Invite Found -> Join Account**: The system finds the matching invite and proceeds:
    a. A new document is created in the `accounts/{accountId}/members` subcollection (using the `accountId` from the invite) keyed by the new user's `uid`. The document will contain the `role` from the invite.
    b. The status of the invite document is updated to `accepted`.
4.  **Set Custom Claims**: The backend process sets custom claims on the user's Auth token: `{ "accountId": invite.accountId, "role": invite.role }`.

---

## Client-Side Handling of Custom Claim Latency

There is a natural delay between the moment a user is created in Firebase Auth and when the user-creation Cloud Function completes and sets their custom claims (`accountId`, `role`). The client-side application must not assume claims are present immediately after sign-up.

**Recommended Client-Side Flow:**

1.  After a successful sign-up or login, the application should show a loading or pending state (e.g., "Setting up your account...").
2.  The application should then periodically force a refresh of the user's ID token (e.g., every 1-2 seconds for a short duration) using `user.getIdToken(true)`.
3.  After each refresh, inspect the token's claims. Once the `accountId` claim is present, the loading state can be dismissed, and the user can be redirected to their account dashboard.
4.  A timeout should be implemented to handle cases where the function fails, preventing an infinite loading state. After the timeout, the user should be shown an error message and prompted to try logging in again.
