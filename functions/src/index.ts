import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

admin.initializeApp();

// Defines the roles that can be assigned to a user
const VALID_ROLES = ["owner", "admin", "member"];

/**
 * On user creation, check for an invite and assign account and role.
 * If no invite is found, create a new account for the user.
 */
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  const { uid, email } = user;

  if (!email) {
    functions.logger.error(`User ${uid} has no email address.`);
    return;
  }

  const normalizedEmail = email.toLowerCase();

  const db = admin.firestore();
  const invitesRef = db.collection("invites");

  // 1. Check for a pending invite
  const inviteQuery = await invitesRef
    .where("email", "==", normalizedEmail)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (!inviteQuery.empty) {
    // --- Flow 2: Invited User --- //
    const inviteDoc = inviteQuery.docs[0];
    const { accountId, role } = inviteDoc.data();

    if (!VALID_ROLES.includes(role)) {
      functions.logger.error(`Invalid role "${role}" found in invite ${inviteDoc.id}`);
      return;
    }

    // Add user to the members subcollection
    await db.collection("accounts").doc(accountId).collection("members").doc(uid).set({
      uid,
      role,
      displayName: user.displayName ?? "",
      email: normalizedEmail,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Set custom claims
    await admin.auth().setCustomUserClaims(uid, { accountId, role });

    // Update invite status
    await inviteDoc.ref.update({ status: "accepted" });

    functions.logger.info(
      `User ${uid} joined account ${accountId} with role ${role} via invite ${inviteDoc.id}.`,
    );
  } else {
    // --- Flow 1: New User Creates Account --- //

    // Create a new account
    const accountRef = await db.collection("accounts").add({});
    const accountId = accountRef.id;

    // Add user as the owner in the members subcollection
    await db
      .collection("accounts")
      .doc(accountId)
      .collection("members")
      .doc(uid)
      .set({
        uid,
        role: "owner",
        displayName: user.displayName ?? "",
        email: normalizedEmail,
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Set custom claims
    await admin.auth().setCustomUserClaims(uid, { accountId, role: "owner" });

    functions.logger.info(`New account ${accountId} created for user ${uid}.`);
  }
});
