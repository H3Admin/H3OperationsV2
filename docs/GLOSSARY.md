# Glossary

This document defines the core data entities in the application.

## `accounts`

-   **Description:** A top-level collection representing a single business or tenant.
-   **ID:** `{accountId}` (auto-generated, unique)

## `customers`

-   **Description:** A subcollection of `accounts`. Each document is a customer of the business.
-   **Path:** `accounts/{accountId}/customers/{customerId}`
-   **ID:** `{customerId}` (auto-generated, unique)

## `invites`

-   **Description:** A top-level collection for managing pending invitations for users to join an account.
-   **ID:** `{inviteId}` (auto-generated, unique)
