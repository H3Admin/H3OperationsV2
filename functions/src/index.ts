import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import twilio from "twilio";
import nodemailer from "nodemailer";
import { GoogleGenerativeAI } from "@google/generative-ai";

admin.initializeApp();

const db = admin.firestore();

function escapeTwiml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// req.headers.host is unreliable inside GCP's proxy layer (it may be an internal hostname).
// Twilio signs the exact public URL it POSTs to, so we reconstruct it from this known base.
const CF_BASE_URL = "https://us-central1-h3operations-prod.cloudfunctions.net";

function validateTwilioSignature(req: any, authToken: string): boolean {
  const signature = req.headers["x-twilio-signature"] as string;
  if (!signature) {
    console.warn("Missing x-twilio-signature header");
    return false;
  }
  // req.originalUrl includes path + query string exactly as Twilio saw it
  const fullUrl = `${CF_BASE_URL}${req.originalUrl}`;
  console.log("Validating Twilio signature for URL:", fullUrl);
  return twilio.validateRequest(authToken, signature, fullUrl, req.body);
}

/*
 * handleInboundCall is intentionally PUBLIC — Twilio's infrastructure must reach
 * this URL from the internet and cannot attach Firebase auth headers. Security is
 * enforced by validating the X-Twilio-Signature header on every non-OPTIONS request
 * using the TWILIO_AUTH_TOKEN secret from Secret Manager. Any request that fails
 * signature validation receives a 403 before any Firestore reads occur.
 */
export const handleInboundCall = functions
  .runWith({ invoker: "public", secrets: ["TWILIO_AUTH_TOKEN"] })
  .https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Twilio-Signature");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN not set");
    res.status(500).send("Configuration error");
    return;
  }
  if (!validateTwilioSignature(req, authToken)) {
    console.warn("Twilio signature validation failed");
    res.status(403).send("Forbidden");
    return;
  }

  functions.logger.info("handleInboundCall: incoming request", {
    contentType: req.headers["content-type"],
    body: JSON.stringify(req.body),
  });

  const { Called, To, From, CallSid } = req.body as {
    Called?: string;
    To?: string;
    From?: string;
    CallSid?: string;
  };
  const dialedNumber = Called || To;

  const twimlXmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

  const sendTwiml = (body: string) => {
    const twiml = `${twimlXmlHeader}<Response>${body}</Response>`;
    functions.logger.info("handleInboundCall: returning TwiML", { twiml });
    res.set("Content-Type", "text/xml");
    res.status(200).send(twiml);
  };

  if (!dialedNumber || !From || !CallSid) {
    functions.logger.warn("handleInboundCall: missing required Twilio fields", { Called, To, From, CallSid });
    sendTwiml('<Say voice="Polly.Joanna-Neural">An error occurred. Goodbye.</Say><Hangup/>');
    return;
  }

  // Find the account whose phoneSettings doc has this twilioPhoneNumber
  const phoneSettingsSnap = await db
    .collectionGroup("phoneSettings")
    .where("twilioPhoneNumber", "==", dialedNumber)
    .limit(1)
    .get();

  if (phoneSettingsSnap.empty) {
    functions.logger.info(`handleInboundCall: no account configured for number ${dialedNumber}`);
    sendTwiml('<Say voice="Polly.Joanna-Neural">Sorry, this number is not configured.</Say><Hangup/>');
    return;
  }

  const phoneSettingsDoc = phoneSettingsSnap.docs[0];
  const phoneSettings = phoneSettingsDoc.data();
  const accountId = phoneSettingsDoc.ref.parent.parent!.id;

  // Log the inbound call and capture the doc id to pass to handleSpeech
  const callRef = await db.collection("accounts").doc(accountId).collection("calls").add({
    callSid: CallSid,
    from: From,
    to: dialedNumber,
    status: "initiated",
    direction: "inbound",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const callId = callRef.id;

  const greetingText = escapeTwiml(
    typeof phoneSettings.greetingText === "string" && phoneSettings.greetingText
      ? phoneSettings.greetingText
      : "Thank you for calling.",
  );

  sendTwiml(
    `<Gather input="speech" speechTimeout="auto" action="${CF_BASE_URL}/handleSpeech?callId=${callId}&amp;accountId=${accountId}" method="POST">` +
      `<Say voice="Polly.Joanna-Neural">${greetingText}</Say>` +
    `</Gather>`,
  );
});

/*
 * handleSpeech is the turn-based AI conversation loop. Twilio posts here after each
 * caller utterance, passing the transcribed text as SpeechResult. This function:
 *   1. Fetches the account's phonePlaybook to understand the business context.
 *   2. Fetches the existing call doc to reconstruct conversation history.
 *   3. Sends everything to Gemini (gemini-3.5-flash) to generate the next response.
 *   4. Appends the new turn (caller speech + AI reply) to the call doc.
 *   5. Returns TwiML to either continue the conversation or end the call.
 *
 * Like handleInboundCall, this is PUBLIC (Twilio must reach it from the internet)
 * and secured by X-Twilio-Signature validation before any Firestore reads occur.
 * Gemini signals end-of-conversation by appending [DONE] to its response.
 */
export const handleSpeech = functions
  .runWith({ invoker: "public", secrets: ["TWILIO_AUTH_TOKEN", "GEMINI_API_KEY"] })
  .https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Twilio-Signature");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN not set");
    res.status(500).send("Configuration error");
    return;
  }
  if (!validateTwilioSignature(req, authToken)) {
    console.warn("Twilio signature validation failed");
    res.status(403).send("Forbidden");
    return;
  }

  const twimlXmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
  const sendTwiml = (body: string) => {
    res.set("Content-Type", "text/xml");
    res.status(200).send(`${twimlXmlHeader}<Response>${body}</Response>`);
  };

  const { callId, accountId } = req.query as { callId?: string; accountId?: string };
  const { SpeechResult, Confidence } = req.body as { SpeechResult?: string; Confidence?: string };

  if (!callId || !accountId) {
    functions.logger.warn("handleSpeech: missing callId or accountId in query params");
    sendTwiml('<Say voice="Polly.Joanna-Neural">An error occurred. Goodbye.</Say><Hangup/>');
    return;
  }

  // Caller was silent — re-prompt without consuming a Gemini turn
  if (!SpeechResult) {
    sendTwiml(
      `<Gather input="speech" speechTimeout="auto" action="${CF_BASE_URL}/handleSpeech?callId=${callId}&amp;accountId=${accountId}" method="POST">` +
        `<Say voice="Polly.Joanna-Neural">I'm sorry, I didn't catch that. Could you please repeat that?</Say>` +
      `</Gather>`,
    );
    return;
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    functions.logger.error("handleSpeech: GEMINI_API_KEY not configured");
    sendTwiml('<Say voice="Polly.Joanna-Neural">I\'m experiencing a technical issue. Please call back later.</Say><Hangup/>');
    return;
  }

  // Fetch playbook and call doc in parallel
  const [playbookSnap, callSnap] = await Promise.all([
    db.collection("accounts").doc(accountId).collection("phonePlaybook").doc(accountId).get(),
    db.collection("accounts").doc(accountId).collection("calls").doc(callId).get(),
  ]);

  const playbook = playbookSnap.data() ?? {};
  const callData = callSnap.data() ?? {};
  const existingTurns = (callData.turns ?? []) as Array<{ callerText: string; aiText: string }>;

  const businessName = typeof playbook.businessName === "string" && playbook.businessName
    ? playbook.businessName
    : "this business";
  const services = typeof playbook.services === "string" ? playbook.services : "";
  const toneInstructions = typeof playbook.toneInstructions === "string" ? playbook.toneInstructions : "";

  const systemPrompt = [
    `You are a professional receptionist for ${businessName}.`,
    toneInstructions,
    `Services offered: ${services || "not specified"}.`,
    `Your goals:`,
    `1. Understand the caller's reason for calling.`,
    `2. Capture the caller's name, phone number, and reason for calling.`,
    `3. Keep responses concise and conversational — this is a phone call, not a chat.`,
    `4. When you have captured all needed information or the caller indicates they are done, append [DONE] on a new line at the very end of your response.`,
  ].filter(Boolean).join("\n");

  // Reconstruct chat history from stored turns
  const chatHistory = existingTurns.flatMap((turn) => [
    { role: "user" as const, parts: [{ text: turn.callerText }] },
    { role: "model" as const, parts: [{ text: turn.aiText }] },
  ]);

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const geminiModel = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    systemInstruction: systemPrompt,
  });
  const chat = geminiModel.startChat({ history: chatHistory });
  const result = await chat.sendMessage(SpeechResult);
  const rawResponse = result.response.text().trim();

  // Gemini signals end-of-conversation by including [DONE]
  const isDone = rawResponse.includes("[DONE]");
  const aiText = rawResponse.replace(/\[DONE\]/g, "").trim();

  // Append the new turn to the call doc
  const confidence = Confidence ? parseFloat(Confidence) : null;
  await db.collection("accounts").doc(accountId).collection("calls").doc(callId).update({
    turns: admin.firestore.FieldValue.arrayUnion({
      callerText: SpeechResult,
      aiText,
      ...(confidence !== null ? { confidence } : {}),
      timestamp: admin.firestore.Timestamp.now(),
    }),
    ...(isDone ? { status: "completed" } : {}),
  });

  const spokenText = escapeTwiml(aiText);

  if (isDone) {
    sendTwiml(`<Say voice="Polly.Joanna-Neural">${spokenText}</Say><Hangup/>`);
  } else {
    sendTwiml(
      `<Gather input="speech" speechTimeout="auto" action="${CF_BASE_URL}/handleSpeech?callId=${callId}&amp;accountId=${accountId}" method="POST">` +
        `<Say voice="Polly.Joanna-Neural">${spokenText}</Say>` +
      `</Gather>`,
    );
  }
});

// TODO: After deploying, register this URL as the "Status Callback URL" on your Twilio
// phone number in the Twilio Console (Phone Numbers → Manage → Active Numbers → select number):
// https://us-central1-h3operations-prod.cloudfunctions.net/handleCallStatus
// Set HTTP method to POST.
export const handleCallStatus = functions
  .runWith({ invoker: "public", secrets: ["TWILIO_AUTH_TOKEN", "GMAIL_APP_PASSWORD"] })
  .https.onRequest(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN not set");
    res.status(500).send("Configuration error");
    return;
  }
  if (!validateTwilioSignature(req, authToken)) {
    console.warn("Twilio signature validation failed");
    res.status(403).send("Forbidden");
    return;
  }

  const { CallSid, CallStatus, CallDuration } = req.body as {
    CallSid?: string;
    CallStatus?: string;
    CallDuration?: string;
  };

  if (!CallSid || !CallStatus) {
    console.warn("handleCallStatus: missing CallSid or CallStatus", req.body);
    res.status(400).send("Bad Request");
    return;
  }

  const statusMap: Record<string, string> = {
    completed: "completed",
    "no-answer": "no_answer",
    busy: "busy",
    failed: "failed",
    cancelled: "cancelled",
  };
  const mappedStatus = statusMap[CallStatus] ?? CallStatus;
  const durationSeconds = parseInt(CallDuration || "0", 10);
  const endedAt = admin.firestore.Timestamp.now();

  const callSnap = await db
    .collectionGroup("calls")
    .where("callSid", "==", CallSid)
    .limit(1)
    .get();

  if (callSnap.empty) {
    console.warn(`handleCallStatus: no call doc found for CallSid ${CallSid}`);
    res.status(200).send("OK");
    return;
  }

  const callDoc = callSnap.docs[0];
  const callData = callDoc.data();
  const accountId = callDoc.ref.parent.parent!.id;

  await callDoc.ref.update({ status: mappedStatus, durationSeconds, endedAt });

  const phoneSettingsSnap = await db
    .collection("accounts")
    .doc(accountId)
    .collection("phoneSettings")
    .doc(accountId)
    .get();
  const phoneSettings = phoneSettingsSnap.data() ?? {};

  if (phoneSettings.summaryEmailEnabled === true) {
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
    if (!gmailAppPassword) {
      console.warn("handleCallStatus: GMAIL_APP_PASSWORD not set — skipping summary email");
    } else {
      const recipients: string[] = Array.isArray(phoneSettings.summaryEmailRecipients)
        ? phoneSettings.summaryEmailRecipients
        : [];

      if (recipients.length > 0) {
        const playbookSnap = await db
          .collection("accounts")
          .doc(accountId)
          .collection("phonePlaybook")
          .doc(accountId)
          .get();
        const playbookData = playbookSnap.data() ?? {};
        const emailBusinessName =
          typeof playbookData.businessName === "string" && playbookData.businessName
            ? playbookData.businessName as string
            : "your business";

        const turns = (callData.turns ?? []) as Array<{ callerText: string; aiText: string }>;
        const endedAtDate = endedAt.toDate();
        const dateStr = endedAtDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const timeStr = endedAtDate.toLocaleTimeString("en-US");
        const totalMinutes = Math.floor(durationSeconds / 60);
        const remainingSeconds = durationSeconds % 60;

        const conversationLines = turns
          .map((t) => `Caller: ${t.callerText}\nAssistant: ${t.aiText}`)
          .join("\n\n");

        const emailBody = [
          "New call received on your H3 Operations line.",
          "",
          `From: ${callData.from ?? "unknown"}`,
          `Duration: ${totalMinutes} minutes ${remainingSeconds} seconds`,
          `Status: ${mappedStatus}`,
          `Time: ${dateStr} at ${timeStr}`,
          "",
          "Conversation summary:",
          conversationLines || "(no conversation recorded)",
          "",
          "View full call log: https://h3operations.com/account/phone",
          "",
          "— H3 Operations",
        ].join("\n");

        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: "michael@h3operations.com",
            pass: gmailAppPassword,
          },
        });

        await transporter.sendMail({
          from: "H3 Operations <michael@h3operations.com>",
          to: recipients.join(", "),
          subject: `Call summary — ${emailBusinessName} — ${dateStr}`,
          text: emailBody,
        });

        console.log(`handleCallStatus: summary email sent to ${recipients.join(", ")}`);
      }
    }
  }

  res.status(200).send("OK");
});

// TODO: DELETE before launch — throwaway diagnostic function, not for production.
export const debugPhoneData = functions
  .runWith({ invoker: "public" })
  .https.onRequest(async (req, res) => {
  if (req.query.key !== "h3debug2026") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [phoneSettingsSnap, phonePlaybookSnap] = await Promise.all([
    db.collectionGroup("phoneSettings").get(),
    db.collectionGroup("phonePlaybook").get(),
  ]);

  const phoneSettings = phoneSettingsSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      path: doc.ref.path,
      accountId: doc.ref.parent?.parent?.id ?? null,
      twilioPhoneNumber: data.twilioPhoneNumber ?? null,
      twilioPhoneNumberSid: data.twilioPhoneNumberSid ?? null,
    };
  });

  const phonePlaybook = phonePlaybookSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      path: doc.ref.path,
      accountId: doc.ref.parent?.parent?.id ?? null,
      businessName: data.businessName ?? null,
      services: data.services ?? null,
    };
  });

  res.status(200).json({ phoneSettings, phonePlaybook });
});

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
