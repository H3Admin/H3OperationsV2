# H3 Operations — Project Context

@./CODING_STANDARDS.md

## Stack

- **Frontend:** TanStack Start + TanStack Router (file-based routing), React 19, TypeScript, Vite 8, Tailwind v4
- **Backend:** Firebase — Firestore, Firebase Auth, Cloud Functions Gen1 (`firebase-functions/v1`)
- **Firebase project:** `h3operations-prod`
- **Package manager:** npm (frontend), npm (functions)
- **Test runner:** Vitest

### Key package versions (package.json)
- `react` ^19.2.0
- `@tanstack/react-start` latest
- `@tanstack/react-router` latest
- `tailwindcss` ^4.1.18
- `vite` ^8.0.0
- `typescript` ^6.0.2
- `firebase` ^12.15.0 (client SDK)
- `firebase-admin` ^13.10.0
- `firebase-functions` ^7.2.5

## Directory layout

```
h3operations-v2/
  firebase.json
  firestore.rules
  functions/
    src/index.ts          # Cloud Functions entry point
    package.json
    tsconfig.json
  src/
    integrations/firebase/client.ts   # initializeApp, auth, db exports
    lib/
      auth-context.tsx    # AuthProvider + useAuth hook
    routes/
      __root.tsx
      index.tsx
      login.tsx
      signup.tsx
      forgot-password.tsx
      reset-password.tsx
      account/
        route.tsx         # account layout route
        index.tsx
        profile.tsx
        team.tsx          # members list + invite flow
        customers/
          index.tsx       # customer list
    styles.css
    router.tsx
    routeTree.gen.ts      # auto-generated — do not edit
  public/
```

## Firebase / Firestore conventions

### Data model

```
accounts/{accountId}
  members/{uid}
    uid: string
    role: "owner" | "admin" | "member"
    displayName: string
    email: string
    joinedAt: Timestamp

  customers/{customerId}
    displayId: string
    firstName: string
    lastName: string
    email: string
    phone: string
    address: { street, city, state, zip }
    createdAt: Timestamp
    createdBy: string        # uid
    createdVia: string       # e.g. "manual"

invites/{inviteId}
  email: string              # normalised to lowercase
  accountId: string
  role: "member" | "admin"
  status: "pending" | "accepted"
  createdAt: Timestamp
  invitedBy: string          # uid of inviter
```

Calls and phoneSettings schemas are not yet implemented.

### Field naming rules

- All Firestore field names: **camelCase**
- Money / currency amounts: **integer cents** (never floats)
- Enum values: **snake_case** strings (e.g. `"pending"`, `"accepted"`)

### Critical invariants

- **Never use `uid` as an `accountId`.** Account IDs are Firestore auto-IDs from `accounts.add({})`. UIDs live only in `members/{uid}`.
- **Always scope data under `accounts/{accountId}/`.** No user-level top-level collections.
- Custom claims (`accountId`, `role`) are set by Cloud Functions on user creation or invite acceptance, never by client code.

## Auth / custom claims

`useAuth()` returns the Firebase `User` object. To get `accountId` and `role`, call:

```ts
const idTokenResult = await user.getIdTokenResult();
const accountId = idTokenResult.claims.accountId as string;
const role = idTokenResult.claims.role as string;
```

Roles: `"owner"` | `"admin"` | `"member"`. Only `"owner"` and `"admin"` can manage team roles.

## Firestore security rules summary

- `accounts/{accountId}` — read: any member; write: owner/admin only
- `accounts/{accountId}/members/{uid}` — read: any member; write: never from client (Functions only)
- `accounts/{accountId}/customers/{customerId}` — read/write: any member
- `invites/{inviteId}` — create: authenticated member of the target account (validated via `exists()` check + required fields check); read/update/delete: `false`

Deploy rules: `firebase deploy --only firestore:rules`

## Cloud Functions (Gen1)

All functions use `firebase-functions/v1` (not v2). Entry point: `functions/src/index.ts`.

Current functions:
- **`onUserCreate`** — triggers on `auth.user().onCreate`. Checks for a pending invite by email; if found, adds user to that account's `members` subcollection and sets custom claims. If no invite, creates a new account, adds user as `owner`, sets claims.

Deploy: `firebase deploy --only functions`

## Node version for Firebase Functions

Cloud Functions Gen1 runs on Node 20. The `functions/package.json` `engines.node` field should be `"20"` for production. Do not use Node 22+ features in `functions/src/`.

## Dev workflow

```bash
# Frontend dev server (port 3000)
npm run dev

# Generate route tree (run after adding/renaming route files)
npm run generate-routes

# Build
npm run build

# Tests
npm run vitest run

# Functions: build and watch
cd functions && npm run build:watch

# Deploy everything
firebase deploy
```

## TanStack Router patterns

- File-based routes under `src/routes/`. Route tree is auto-generated into `routeTree.gen.ts`.
- Layout routes use `route.tsx` (e.g., `account/route.tsx`).
- Auth guard lives in `account/route.tsx`'s `beforeLoad`.
- Use `createFileRoute` in every route file; never edit `routeTree.gen.ts` directly.
- Path alias `@/` maps to `src/`.

## Terminal / shell rules

- **No heredocs** (`<< EOF`) in Terminal commands — they do not work in this environment. Use the Write tool or single-quoted strings instead.

## Session log

- **Session A–E:** Initial scaffold, auth flows (login/signup/forgot/reset), account layout, customers CRUD, team page with member list and role management.
- **Session F (in progress):** Added invite-member flow to `/account/team` (writes to top-level `invites` collection). Updated `firestore.rules` to allow authenticated account members to create invites with full field validation and `exists()` membership check. The `onUserCreate` Cloud Function already handles invite acceptance on new user signup.
