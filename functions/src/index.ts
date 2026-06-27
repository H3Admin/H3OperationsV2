import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import twilio from "twilio";
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

function buildTwilioUrl(functionName: string, originalUrl: string): string {
  const qIndex = originalUrl.indexOf("?");
  const qs = qIndex !== -1 ? originalUrl.slice(qIndex) : "";
  return `${CF_BASE_URL}/${functionName}${qs}`;
}

/*
 * handleInboundCall is intentionally PUBLIC — Twilio's infrastructure must reach
 * this URL from the internet and cannot attach Firebase auth headers. Security is
 * enforced by validating the X-Twilio-Signature header on every non-OPTIONS request
 * using the TWILIO_AUTH_TOKEN secret from Secret Manager. Any request that fails
 * signature validation receives a 403 before any Firestore reads occur.
 *
 * Set SKIP_TWILIO_VALIDATION=true in the function environment to bypass signature
 * checking during local/integration testing. Never set this in production.
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
    functions.logger.error("handleInboundCall: twilio.auth_token not configured");
    res.status(500).send("");
    return;
  }

  if (process.env.SKIP_TWILIO_VALIDATION === "true") {
    functions.logger.warn("handleInboundCall: SKIP_TWILIO_VALIDATION is set — signature check bypassed");
  } else {
    const twilioSignature = req.headers["x-twilio-signature"] as string | undefined;
    const url = buildTwilioUrl("handleInboundCall", req.originalUrl);
    const isValid = !!twilioSignature && twilio.validateRequest(authToken, twilioSignature, url, req.body as Record<string, string>);
    functions.logger.info("handleInboundCall: signature validation", {
      url,
      signaturePresent: !!twilioSignature,
      isValid,
    });
    if (!isValid) {
      functions.logger.warn("handleInboundCall: invalid Twilio signature", { url, twilioSignature });
      res.status(403).send("");
      return;
    }
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
 *
 * Set SKIP_TWILIO_VALIDATION=true in the function environment to bypass signature
 * checking during local/integration testing. Never set this in production.
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
    functions.logger.error("handleSpeech: TWILIO_AUTH_TOKEN not configured");
    res.status(500).send("");
    return;
  }

  if (process.env.SKIP_TWILIO_VALIDATION === "true") {
    functions.logger.warn("handleSpeech: SKIP_TWILIO_VALIDATION is set — signature check bypassed");
  } else {
    const twilioSignature = req.headers["x-twilio-signature"] as string | undefined;
    const url = buildTwilioUrl("handleSpeech", req.originalUrl);
    const isValid = !!twilioSignature && twilio.validateRequest(authToken, twilioSignature, url, req.body as Record<string, string>);
    functions.logger.info("handleSpeech: signature validation", {
      url,
      signaturePresent: !!twilioSignature,
      isValid,
    });
    if (!isValid) {
      functions.logger.warn("handleSpeech: invalid Twilio signature", { url, twilioSignature });
      res.status(403).send("");
      return;
    }
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
