const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "h3operations-prod",
});

const db = admin.firestore();

async function main() {
  // --- phoneSettings ---
  console.log("=== phoneSettings ===");
  const phoneSettingsSnap = await db.collectionGroup("phoneSettings").get();
  if (phoneSettingsSnap.empty) {
    console.log("  (none found)");
  } else {
    phoneSettingsSnap.docs.forEach((doc) => {
      const data = doc.data();
      console.log("  path:                ", doc.ref.path);
      console.log("  accountId:           ", doc.ref.parent?.parent?.id ?? "(unknown)");
      console.log("  twilioPhoneNumber:   ", data.twilioPhoneNumber ?? "(not set)");
      console.log("  twilioPhoneNumberSid:", data.twilioPhoneNumberSid ?? "(not set)");
      console.log();
    });
  }

  // --- phonePlaybook ---
  console.log("=== phonePlaybook ===");
  const phonePlaybookSnap = await db.collectionGroup("phonePlaybook").get();
  if (phonePlaybookSnap.empty) {
    console.log("  (none found)");
  } else {
    phonePlaybookSnap.docs.forEach((doc) => {
      const data = doc.data();
      console.log("  path:        ", doc.ref.path);
      console.log("  accountId:   ", doc.ref.parent?.parent?.id ?? "(unknown)");
      console.log("  businessName:", data.businessName ?? "(not set)");
      console.log("  services:    ", data.services ?? "(not set)");
      console.log();
    });
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
