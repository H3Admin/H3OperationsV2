# Firestore rules update needed: `invites` collection

The new "Invite Member" flow on `/account/team` writes new documents to the top-level
`invites` collection. The currently deployed rule for that collection blocks everything:

```
match /invites/{inviteId} {
  allow read, write: if false;
}
```

Replace it with the rule below, which allows an authenticated account member to **create**
an invite. Read/update/delete stay locked down — nothing reads or modifies invites yet
(no accept-invite flow exists), so there's no reason to open those up.

```
match /invites/{inviteId} {
  allow create: if request.auth != null
    && request.resource.data.keys().hasAll(['email', 'accountId', 'role', 'status', 'createdAt', 'invitedBy'])
    && request.resource.data.accountId is string
    && exists(/databases/$(database)/documents/accounts/$(request.resource.data.accountId)/members/$(request.auth.uid))
    && request.resource.data.invitedBy == request.auth.uid
    && request.resource.data.status == 'pending'
    && request.resource.data.role in ['member', 'admin'];

  allow read, update, delete: if false;
}
```

What each check does, so it's clear what's safe to loosen later:

- `request.auth != null` — caller must be signed in.
- `keys().hasAll([...])` — the invite has all six fields the app writes; rejects partial/malformed docs.
- `accountId is string` + `exists(.../accounts/$(accountId)/members/$(request.auth.uid))` — the caller must already be a member of the account they're inviting into. Without this, any authenticated user (not just account members) could create invites for accounts they have nothing to do with.
- `invitedBy == request.auth.uid` — can't attribute an invite to someone else.
- `status == 'pending'` — can't create an invite in any other state.
- `role in ['member', 'admin']` — invites can't grant `'owner'` directly.

Apply by editing `firestore.rules` in Cloud Shell and running `firebase deploy --only firestore:rules`, same as your existing rules deploys.
