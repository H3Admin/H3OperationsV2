import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import twilio from "twilio";
import nodemailer from "nodemailer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import customersSchema from "./schema/customers.js";
import jobsSchema from "./schema/jobs.js";
import smsOptinsSchema from "./schema/smsOptins.js";
import signupRequestsSchema from "./schema/signupRequests.js";
import checklistRequestsSchema from "./schema/checklistRequests.js";

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

function validateTwilioSignature(req: any, authToken: string, functionName: string): boolean {
  const signature = req.headers["x-twilio-signature"] as string;
  if (!signature) {
    console.warn("Missing x-twilio-signature header");
    return false;
  }
  // req.originalUrl inside Firebase v1 onRequest is relative to the function root ("/"),
  // so the function name is absent. Reconstruct the full URL explicitly.
  const qIndex = (req.originalUrl as string).indexOf("?");
  const qs = qIndex !== -1 ? (req.originalUrl as string).slice(qIndex) : "";
  const fullUrl = `${CF_BASE_URL}/${functionName}${qs}`;
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
  if (!validateTwilioSignature(req, authToken, "handleInboundCall")) {
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
    `<Gather input="speech" enhanced="true" speechModel="phone_call" speechTimeout="2" action="${CF_BASE_URL}/handleSpeech?callId=${callId}&amp;accountId=${accountId}" method="POST">` +
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
  if (!validateTwilioSignature(req, authToken, "handleSpeech")) {
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
      `<Gather input="speech" enhanced="true" speechModel="phone_call" speechTimeout="2" action="${CF_BASE_URL}/handleSpeech?callId=${callId}&amp;accountId=${accountId}" method="POST">` +
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
    `4. When you have captured all needed information or the caller indicates they are done, ALWAYS end with a warm spoken sign-off that thanks them for calling ${businessName} and tells them someone will be in touch shortly (for example: "Thank you for calling ${businessName} — we'll be in touch shortly. Have a great day!"). Put that sign-off as the last spoken sentence, then append [DONE] on a new line at the very end. Never end the call without speaking that closing line.`,
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
    // DECISION (2026-07): NO maxOutputTokens cap. gemini-3.5-flash is a thinking
    // model, and this SDK (@google/generative-ai 0.24.1) counts thinking tokens
    // against maxOutputTokens with no separate thinking budget. A 200-token cap
    // (tried for dead-air latency) truncated the model mid-thought
    // (finishReason MAX_TOKENS), so .text() returned a leaked reasoning fragment
    // (e.g. "keep short and simple") to <Say> instead of a real reply. Latency
    // work must DISABLE thinking — which requires migrating to the @google/genai
    // SDK (thinkingBudget) — not capping output here. Do not re-add this cap.
  });
  const chat = geminiModel.startChat({ history: chatHistory });

  // Wrap the model round-trip: a Gemini failure must never crash this webhook
  // into a dead call. On error we log (no PII, §9.2) and re-prompt so the caller
  // can keep talking rather than hitting Twilio's default failure hang-up.
  // PERF (§10 dead-air diagnosis): the timing log attributes the between-request
  // gap to Gemini vs. Gather from Cloud Logging. Milliseconds only — no PII.
  let rawResponse: string;
  try {
    const geminiStart = Date.now();
    const result = await chat.sendMessage(SpeechResult);
    functions.logger.info("handleSpeech: gemini round-trip", { ms: Date.now() - geminiStart });
    rawResponse = result.response.text().trim();
  } catch (err: any) {
    functions.logger.error("handleSpeech: Gemini call failed", { message: err?.message });
    sendTwiml(
      `<Gather input="speech" enhanced="true" speechModel="phone_call" speechTimeout="2" action="${CF_BASE_URL}/handleSpeech?callId=${callId}&amp;accountId=${accountId}" method="POST">` +
        `<Say voice="Polly.Joanna-Neural">Sorry, I didn't quite catch that. Could you say that again?</Say>` +
      `</Gather>`,
    );
    return;
  }

  // Gemini signals end-of-conversation by including [DONE]
  const isDone = rawResponse.includes("[DONE]");
  const aiText = rawResponse.replace(/\[DONE\]/g, "").trim();

  // If the model produced no spoken text and did not signal done, never emit an
  // empty <Say>. Re-prompt (don't record an empty turn) so the caller continues.
  if (!isDone && !aiText) {
    functions.logger.warn("handleSpeech: empty model turn — re-prompting");
    sendTwiml(
      `<Gather input="speech" enhanced="true" speechModel="phone_call" speechTimeout="2" action="${CF_BASE_URL}/handleSpeech?callId=${callId}&amp;accountId=${accountId}" method="POST">` +
        `<Say voice="Polly.Joanna-Neural">Sorry, could you say that again?</Say>` +
      `</Gather>`,
    );
    return;
  }

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
    // Guarantee a spoken close before hanging up. The prompt instructs the model
    // to end with a warm sign-off, but if a [DONE] turn ever comes back with no
    // spoken text, fall back to a generic close so we never hang up on silence.
    // Kept tenant-agnostic (no hardcoded business name) — the model's own close
    // is the normal path and carries the business name from the playbook.
    const closeText = escapeTwiml(
      aiText || "Thank you for calling. We'll be in touch shortly. Have a great day!",
    );
    sendTwiml(`<Say voice="Polly.Joanna-Neural">${closeText}</Say><Hangup/>`);
  } else {
    sendTwiml(
      `<Gather input="speech" enhanced="true" speechModel="phone_call" speechTimeout="2" action="${CF_BASE_URL}/handleSpeech?callId=${callId}&amp;accountId=${accountId}" method="POST">` +
        `<Say voice="Polly.Joanna-Neural">${spokenText}</Say>` +
      `</Gather>`,
    );
  }
});

/**
 * createLeadFromCall — internal Receptionist→CRM handoff writer.
 *
 * DECISION (2026-07): a DIRECT server-side helper, NOT a call to the
 * createCustomer callable. handleCallStatus is a Twilio webhook, so it has no
 * context.auth (the caller is Twilio's infrastructure, not a signed-in user) —
 * the callable's auth + accountId-claim gate (S3) simply cannot be satisfied
 * here. accountId is instead derived from the verified call-doc path, never from
 * client input, so the server boundary (S2) still holds. buildNewCustomer stays
 * the single schema authority (§2.2); we never hand-roll the document body.
 * (Sharing this write path with createCustomer is deliberately NOT done in this
 * slice — that refactor carries its own test surface.)
 *
 * DECISION (2026-07): enrich the lead with the caller's name via one Gemini pass
 * over the transcript (Task B). The name lives only as free text in the turns, so
 * we extract it, but treat the model output as UNTRUSTED: it is sanitized by the
 * schema authority (customersSchema.sanitizeDisplayName) before it can reach
 * Firestore (§8 S2 — no LLM output in the data path), and tagged with provenance
 * displayNameSource='ai_extracted' so an AI-guessed name is never confused with a
 * human-confirmed one. On no confident name, displayName AND displayNameSource
 * stay null (the CRM Name column renders "—") — we never fabricate a value.
 *
 * Idempotent: existence-checks the doc first, so it neither clobbers an existing
 * customer/lead nor duplicates on Twilio's up-to-3x status-callback retries. The
 * existence check also GATES the Gemini call, so retries and already-known
 * customers cost zero tokens.
 */
async function extractCallerName(
  turns: Array<{ callerText: string; aiText: string }>,
  geminiApiKey: string | undefined,
): Promise<string | null> {
  // Best-effort enrichment. Any failure (missing key, model error, refusal)
  // resolves to null so it can NEVER block lead creation.
  if (!geminiApiKey) return null;
  try {
    const transcript = turns
      .map((t) => `Caller: ${t.callerText}\nAssistant: ${t.aiText}`)
      .join("\n");
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
    const prompt =
      "From the following phone call transcript, extract ONLY the caller's own " +
      "name if they clearly stated it. Respond with just the name and nothing " +
      "else — no punctuation, no labels, no explanation. If the caller did not " +
      "clearly give their name, respond with exactly: NONE\n\nTranscript:\n" +
      transcript;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text || text.toUpperCase() === "NONE") return null;
    return text;
  } catch (err: any) {
    // Best-effort only — never block the lead. No transcript/PII logged (§9.2).
    console.error("extractCallerName: extraction failed", err?.message);
    return null;
  }
}

async function createLeadFromCall(
  accountId: string,
  phone: string,
  turns: Array<{ callerText: string; aiText: string }>,
  geminiApiKey: string | undefined,
): Promise<void> {
  const customerId = customersSchema.customerIdFromPhone(phone);
  if (!customerId) {
    // Unparseable number — never attempt an empty-ID doc write. No PII logged (§9.2).
    console.warn("createLeadFromCall: phone did not normalize; skipping lead creation");
    return;
  }

  const docRef = db
    .collection("accounts").doc(accountId)
    .collection("customers").doc(customerId);

  const existing = await docRef.get();
  if (existing.exists) {
    // Already a customer/lead (or a retried status callback) — do nothing. This
    // return also gates the Gemini call below: retries/known customers = 0 tokens.
    return;
  }

  // Only now (creating a brand-new lead) do we spend a Gemini call. The result
  // is untrusted model output, so it passes through the schema-authority
  // sanitizer before storage; a null name carries a null provenance.
  const rawName = await extractCallerName(turns, geminiApiKey);
  const displayName = customersSchema.sanitizeDisplayName(rawName);
  const displayNameSource = displayName
    ? customersSchema.DISPLAY_NAME_SOURCE.AI_EXTRACTED
    : null;

  const body = customersSchema.buildNewCustomer({
    accountId,
    phone,
    status: "lead",
    source: customersSchema.CUSTOMER_SOURCE.PHONE_CALL,
    createdBy: customersSchema.SYSTEM_ACTOR.RECEPTIONIST,
    displayName,
    displayNameSource,
  });

  await docRef.set(body);
}

// TODO: After deploying, register this URL as the "Status Callback URL" on your Twilio
// phone number in the Twilio Console (Phone Numbers → Manage → Active Numbers → select number):
// https://us-central1-h3operations-prod.cloudfunctions.net/handleCallStatus
// Set HTTP method to POST.
export const handleCallStatus = functions
  .runWith({ invoker: "public", secrets: ["TWILIO_AUTH_TOKEN", "GMAIL_APP_PASSWORD", "GEMINI_API_KEY"] })
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
  if (!validateTwilioSignature(req, authToken, "handleCallStatus")) {
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

  // Receptionist→CRM handoff, fully isolated from everything below it. Gate:
  // a phone number to key the lead on + at least one spoken turn = an actionable
  // call (skips pure hang-ups and empty-transcript bot drops). No transcript
  // parsing / no Gemini — zero token cost. Its own try/catch swallows any failure
  // so a CRM error can never break call handling, the summary email, or the 200.
  if (
    typeof callData.from === "string" &&
    callData.from !== "" &&
    Array.isArray(callData.turns) &&
    callData.turns.length > 0
  ) {
    try {
      await createLeadFromCall(accountId, callData.from, callData.turns, process.env.GEMINI_API_KEY);
    } catch (err: any) {
      // §9.2: CallSid + err.message only. The only buildNewCustomer throw that
      // echoes the phone is the phone-normalize branch, which is unreachable here
      // (customerIdFromPhone already validated it upstream) — never the transcript
      // or any other PII.
      console.error(`createLeadFromCall failed for CallSid ${CallSid}`, err?.message);
    }
  }

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

/**
 * createCustomer — callable that creates a customer under the caller's account.
 *
 * DECISION (2026-07): single canonical server-side write path. The CRM create
 * form AND the future Receptionist->CRM handoff both go through the schema
 * factory here rather than writing from the client, so buildNewCustomer is the
 * one true validator. accountId + createdBy come from the verified auth token,
 * never from client input (SECURITY: S2 server-boundary validation).
 *
 * Reads accountId from the caller's custom claim. Doc ID is derived from the
 * phone via customerIdFromPhone (E.164 digits, no leading +). Rejects a phone
 * that already exists (dedupe on the identity path).
 */
export const createCustomer = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  const accountId = context.auth?.token?.accountId as string | undefined;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  if (!accountId) {
    throw new functions.https.HttpsError("failed-precondition", "No account on this user.");
  }

  const rawPhone = (data?.phone ?? "") as string;
  const customerId = customersSchema.customerIdFromPhone(rawPhone);
  if (!customerId) {
    throw new functions.https.HttpsError("invalid-argument", "Enter a valid US phone number.");
  }

  const docRef = db
    .collection("accounts").doc(accountId)
    .collection("customers").doc(customerId);

  const existing = await docRef.get();
  if (existing.exists) {
    throw new functions.https.HttpsError("already-exists", "A customer with this phone already exists.");
  }

  let body;
  try {
    body = customersSchema.buildNewCustomer({
      accountId,
      phone: rawPhone,
      displayName: data?.displayName ?? null,
      email: data?.email ?? null,
      status: data?.status,
      source: data?.source,
      notes: data?.notes ?? null,
      createdBy: uid,
    });
  } catch (err: any) {
    throw new functions.https.HttpsError("invalid-argument", err.message ?? "Invalid customer data.");
  }

  await docRef.set(body);
  return { customerId };
});

/**
 * updateCustomer — callable that applies a whitelisted partial update to a
 * customer under the caller's account.
 *
 * DECISION (2026-07): NESTED payload shape — { customerId, patch } — mirroring
 * updateJob one-to-one. This function was first written with a FLAT payload
 * (mutable fields at the top level alongside customerId), which forced a local
 * MUTABLE_KEYS loop to reconstruct a clean patch object before handing it to
 * buildCustomerUpdate. That duplicated the allowlist — the six mutable keys
 * lived both here AND inside buildCustomerUpdate's own whitelist — so a new
 * field would have to be added in two places. Corrected to nested before
 * commit, while nothing else depended on the flat shape yet: `patch` IS the
 * clean object buildCustomerUpdate's contract expects, so we pass it straight
 * through and the single source of truth for the whitelist stays in
 * schema/customers.js.
 *
 * House pattern: nested-for-update / flat-for-create. Creates take flat
 * payloads (createCustomer, createJob); updates take { id, patch }
 * (updateJob, updateCustomer). buildCustomerUpdate ignores identity fields
 * (phone / accountId / createdBy / createdAt), re-validates enums, and always
 * stamps updatedAt.
 *
 * accountId + uid come from the verified auth token, never client input
 * (SECURITY: S2 boundary validation, S3 auth/membership). The customer must
 * belong to the caller's account or we 404 rather than leak cross-tenant
 * existence (mirrors updateJob).
 *
 * @param {object} data              callable payload
 * @param {string} data.customerId   doc id (E.164 digits, no "+"); required
 * @param {object} [data.patch]      whitelisted mutable fields: displayName,
 *                                    email, address, notes, status, source
 * @returns {{ customerId: string }}
 */
export const updateCustomer = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  const accountId = context.auth?.token?.accountId as string | undefined;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  if (!accountId) {
    throw new functions.https.HttpsError("failed-precondition", "No account on this user.");
  }

  const customerId = (data?.customerId ?? "") as string;
  if (!customerId) {
    throw new functions.https.HttpsError("invalid-argument", "customerId is required.");
  }

  const docRef = db
    .collection("accounts").doc(accountId)
    .collection("customers").doc(customerId);

  const existing = await docRef.get();
  if (!existing.exists) {
    // Do not distinguish "wrong account" from "no such customer" — both are 404.
    throw new functions.https.HttpsError("not-found", "Customer not found.");
  }

  let patch;
  try {
    patch = customersSchema.buildCustomerUpdate({
      ...(data?.patch ?? {}),
    });
  } catch (err: any) {
    throw new functions.https.HttpsError("invalid-argument", err.message ?? "Invalid customer update.");
  }

  await docRef.set(patch, { merge: true });
  return { customerId };
});

/**
 * createJob — callable that creates a job under the caller's account.
 *
 * DECISION (2026-07): single canonical server-side write path, mirroring
 * createCustomer. buildNewJob is the one true validator; accountId + createdBy
 * come from the verified auth token, never client input (SECURITY: S2).
 *
 * Unlike customers, a job has NO natural dedupe key — one customer has many
 * jobs — so the doc ID is an auto-generated Firestore ID (docRef with no arg),
 * not derived from any field. No existence check / dedupe here by design.
 *
 * Customer link (hybrid): if the caller supplies a customerPhone that normalizes,
 * we derive and attach customerId via the SAME customerIdFromPhone the CRM uses,
 * so a job booked for a known number links back to that customer record. If the
 * phone doesn't resolve (or none given), the job still saves with a null link —
 * booking a job must never be blocked on customer resolution.
 */
export const createJob = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  const accountId = context.auth?.token?.accountId as string | undefined;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  if (!accountId) {
    throw new functions.https.HttpsError("failed-precondition", "No account on this user.");
  }

  // Best-effort customer link. A non-resolving phone is NOT an error here —
  // it just means no CRM link (the phone snapshot itself is validated by the
  // schema factory below, which throws only if a *malformed* phone was given).
  const rawPhone = (data?.customerPhone ?? "") as string;
  const linkedCustomerId = rawPhone
    ? customersSchema.customerIdFromPhone(rawPhone)
    : null;

  let body;
  try {
    body = jobsSchema.buildNewJob({
      accountId,
      createdBy: uid,
      customerId: (data?.customerId as string | undefined) ?? linkedCustomerId ?? null,
      customerName: data?.customerName,
      customerPhone: rawPhone || null,
      customerEmail: data?.customerEmail ?? null,
      service: data?.service,
      scheduledAt: data?.scheduledAt, // Date | epoch millis | ISO string
      status: data?.status,
      source: data?.source,
      durationMin: data?.durationMin ?? null,
      assignee: data?.assignee ?? null,
      serviceAddress: data?.serviceAddress ?? null,
      notes: data?.notes ?? null,
      priceCents: data?.priceCents ?? null,
    });
  } catch (err: any) {
    throw new functions.https.HttpsError("invalid-argument", err.message ?? "Invalid job data.");
  }

  const docRef = db
    .collection("accounts").doc(accountId)
    .collection("jobs").doc(); // auto-generated ID

  await docRef.set(body);
  return { jobId: docRef.id };
});

/**
 * updateJob — callable that applies a whitelisted partial update to a job.
 *
 * buildJobUpdate enforces the whitelist (identity fields ignored, updatedAt
 * always stamped). accountId comes from the token; the job must belong to the
 * caller's account or we 404 rather than leak cross-tenant existence.
 */
export const updateJob = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  const accountId = context.auth?.token?.accountId as string | undefined;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  if (!accountId) {
    throw new functions.https.HttpsError("failed-precondition", "No account on this user.");
  }

  const jobId = (data?.jobId ?? "") as string;
  if (!jobId) {
    throw new functions.https.HttpsError("invalid-argument", "jobId is required.");
  }

  const docRef = db
    .collection("accounts").doc(accountId)
    .collection("jobs").doc(jobId);

  const existing = await docRef.get();
  if (!existing.exists) {
    // Do not distinguish "wrong account" from "no such job" — both are 404.
    throw new functions.https.HttpsError("not-found", "Job not found.");
  }

  let patch;
  try {
    patch = jobsSchema.buildJobUpdate({
      ...(data?.patch ?? {}),
    });
  } catch (err: any) {
    throw new functions.https.HttpsError("invalid-argument", err.message ?? "Invalid job update.");
  }

  await docRef.set(patch, { merge: true });
  return { jobId };
});

// Origins allowed to call submitSmsOptin from a browser. The consent form is a
// static page on the marketing site; reflect an allowlisted Origin back so we
// don't run a blanket wildcard on a PII-writing endpoint.
const SMS_OPTIN_ALLOWED_ORIGINS = new Set([
  "https://h3operations.com",
  "https://www.h3operations.com",
]);

/**
 * submitSmsOptin — public HTTPS endpoint backing the static /sms-optin form.
 *
 * PUBLIC by design (unauthenticated, pre-account marketing capture), so it uses
 * the same guarded-public onRequest posture as the Twilio webhooks:
 * invoker:"public" plus explicit CORS. maxInstances caps cost on this low-traffic
 * path (§8 S4). CORS is not a security boundary here (any server can POST) — the
 * real boundary is server-side validation below (§8 S2): consent must be an
 * explicit true, and the phone must pass the SAME NANP normalizer the CRM uses
 * (customersSchema.customerIdFromPhone) — client validation is UX only.
 *
 * The consent record is written at root smsOptins/{phoneDigits} (see
 * schema/smsOptins.js for the pre-account / doc-ID-matches-customers rationale).
 * Idempotent: a repeat submit for the same number re-affirms consent and moves
 * updatedAt, but preserves the original createdAt as the audit anchor.
 */
export const submitSmsOptin = functions
  .runWith({ invoker: "public", maxInstances: 5 })
  .https.onRequest(async (req, res) => {
    const origin = req.headers.origin as string | undefined;
    res.set(
      "Access-Control-Allow-Origin",
      origin && SMS_OPTIN_ALLOWED_ORIGINS.has(origin) ? origin : "https://h3operations.com",
    );
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const { phone, consent, consentCopyVersion, ref } = (req.body ?? {}) as {
      phone?: string;
      consent?: boolean;
      consentCopyVersion?: string;
      ref?: string;
    };

    // Consent must be an explicit true — never inferred from presence of a phone.
    if (consent !== true) {
      res.status(400).send("Consent is required.");
      return;
    }

    // Reuse the CRM phone normalizer so a consent record and a future customer
    // keyed by the same number share one doc-ID shape (E.164 digits, no "+").
    const rawPhone = phone ?? "";
    const docId = customersSchema.customerIdFromPhone(rawPhone);
    const phoneE164 = customersSchema.normalizePhoneE164(rawPhone);
    if (!docId || !phoneE164) {
      res.status(400).send("Enter a valid US phone number.");
      return;
    }

    // Build the first-write body now; this also validates consentCopyVersion via
    // the schema factory regardless of which write path we take below.
    let firstWriteBody;
    try {
      firstWriteBody = smsOptinsSchema.buildNewSmsOptin({
        phone: phoneE164,
        consentCopyVersion,
        ref: ref ?? null,
      });
    } catch {
      res.status(400).send("Invalid request.");
      return;
    }

    try {
      const docRef = db.collection(smsOptinsSchema.SMS_OPTINS_COLLECTION).doc(docId);
      const existing = await docRef.get();
      if (existing.exists) {
        // Re-affirm without clobbering the original consent timestamp.
        await docRef.set(
          smsOptinsSchema.buildSmsOptinRefresh({ consentCopyVersion, ref: ref ?? null }),
          { merge: true },
        );
      } else {
        await docRef.set(firstWriteBody);
      }
      res.status(200).send("OK");
    } catch (err: any) {
      // No PII in logs (§9.2) — log the failure, not the phone number.
      console.error("submitSmsOptin failed", err?.message);
      res.status(500).send("Something went wrong.");
    }
  });

// ---------------------------------------------------------------------------
// Public marketing capture endpoints (submitSignupRequest, submitChecklistRequest)
// ---------------------------------------------------------------------------

// Origins allowed to call the marketing capture endpoints from a browser. Same
// posture as SMS_OPTIN_ALLOWED_ORIGINS: reflect an allowlisted Origin back so we
// don't run a blanket wildcard on a PII-writing endpoint. CORS is NOT the
// security boundary (any server can POST) — server-side validation is (§8 S2).
const MARKETING_SITE_ORIGINS = new Set([
  "https://h3operations.com",
  "https://www.h3operations.com",
]);

/**
 * S4 rate limiting (§8) for the PUBLIC, unauthenticated marketing endpoints.
 *
 * DECISION (2026-07): best-effort IN-MEMORY, PER-INSTANCE sliding window keyed by
 * client IP — deliberately NOT a Firestore-backed global limiter. Lean-first
 * (§1): these are low-traffic pre-account forms, and every write is already
 * idempotent (one doc per phone / per email), so a repeat submitter can't pile up
 * documents regardless. maxInstances (below) is the hard GLOBAL cost cap (§8 S4);
 * this map curbs burst abuse from one IP on a warm instance without the read/
 * write cost and GC burden of a rate-limit collection. Not a security boundary —
 * it degrades gracefully (a cold/rotated instance simply starts a fresh window).
 * If abuse outgrows this, graduate to a Firestore/Redis limiter with a TTL.
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_PER_WINDOW = 5; // per IP per window, per instance
const rateLimitHits = new Map<string, number[]>();

/** Best-effort client IP: GCP places the real caller first in x-forwarded-for. */
function clientIp(req: any): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined) ?? "";
  const first = fwd.split(",")[0]?.trim();
  return first || (req.ip as string) || "unknown";
}

/**
 * Record a hit for `key` and report whether it is now over the limit.
 * @returns true if the caller is OVER the limit (reject with 429).
 */
function isRateLimited(key: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateLimitHits.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    rateLimitHits.set(key, hits); // keep the pruned list; do not count this attempt
    return true;
  }
  hits.push(now);
  rateLimitHits.set(key, hits);
  // Opportunistic GC so a long-lived instance's map can't grow unbounded.
  if (rateLimitHits.size > 5000) {
    for (const [k, v] of rateLimitHits) {
      const pruned = v.filter((t) => t > windowStart);
      if (pruned.length === 0) rateLimitHits.delete(k);
      else rateLimitHits.set(k, pruned);
    }
  }
  return false;
}

/** Apply the shared marketing-endpoint CORS headers. Returns the resolved Origin. */
function setMarketingCors(req: any, res: any): void {
  const origin = req.headers.origin as string | undefined;
  res.set(
    "Access-Control-Allow-Origin",
    origin && MARKETING_SITE_ORIGINS.has(origin) ? origin : "https://h3operations.com",
  );
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * submitSignupRequest — public HTTPS endpoint backing the "Get set up" form on
 * the static marketing site (h3-website/public/index.html).
 *
 * Same guarded-public posture as submitSmsOptin: invoker:"public" (pre-account,
 * unauthenticated marketing capture) + explicit CORS + maxInstances cost cap, now
 * with per-caller S4 rate limiting (§8). The real security boundary is server-
 * side validation (§8 S2): the phone must pass the SAME NANP normalizer the CRM
 * uses (customersSchema.customerIdFromPhone) and email/name are validated by the
 * schema factory — client validation is UX only.
 *
 * The record is written at root signupRequests/{phoneDigits} (see
 * schema/signupRequests.js for the pre-account / doc-ID-matches-customers
 * rationale). Idempotent: a repeat submit for the same number refreshes the
 * contact fields and moves updatedAt, but preserves the original createdAt (audit
 * anchor) and never resets status (owned by the sales/onboarding path).
 */
export const submitSignupRequest = functions
  .runWith({ invoker: "public", maxInstances: 5 })
  .https.onRequest(async (req, res) => {
    setMarketingCors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }
    if (isRateLimited(`submitSignupRequest:${clientIp(req)}`)) {
      res.status(429).send("Too many requests. Please try again in a minute.");
      return;
    }

    const { businessName, contactName, phone, email, ref, source } = (req.body ?? {}) as {
      businessName?: string;
      contactName?: string;
      phone?: string;
      email?: string;
      ref?: string;
      source?: string;
    };

    // Reuse the CRM phone normalizer so a signup request and a future customer
    // keyed by the same number share one doc-ID shape (E.164 digits, no "+").
    const rawPhone = phone ?? "";
    const docId = customersSchema.customerIdFromPhone(rawPhone);
    const phoneE164 = customersSchema.normalizePhoneE164(rawPhone);
    if (!docId || !phoneE164) {
      res.status(400).send("Enter a valid US phone number.");
      return;
    }

    // Build the first-write body now; this also validates the remaining required
    // fields (name/email) via the schema factory regardless of write path below.
    let firstWriteBody;
    try {
      firstWriteBody = signupRequestsSchema.buildNewSignupRequest({
        businessName,
        contactName,
        phone: phoneE164,
        email,
        ref: ref ?? null,
        source,
      });
    } catch {
      res.status(400).send("Please check the form and try again.");
      return;
    }

    try {
      const docRef = db.collection(signupRequestsSchema.SIGNUP_REQUESTS_COLLECTION).doc(docId);
      const existing = await docRef.get();
      if (existing.exists) {
        // Refresh contact fields without clobbering createdAt or status.
        await docRef.set(
          signupRequestsSchema.buildSignupRequestRefresh({
            businessName,
            contactName,
            email,
            ref: ref ?? null,
            source,
          }),
          { merge: true },
        );
      } else {
        await docRef.set(firstWriteBody);
      }
      res.status(200).json({ ok: true });
    } catch (err: any) {
      // No PII in logs (§9.2) — log the failure, not the submitted details.
      console.error("submitSignupRequest failed", err?.message);
      res.status(500).send("Something went wrong.");
    }
  });

/**
 * submitChecklistRequest — public HTTPS endpoint backing the "email me the
 * checklist" lead-magnet form on the static marketing site.
 *
 * Same guarded-public posture as submitSignupRequest (invoker:"public" + CORS +
 * maxInstances + S4 rate limiting). The email is validated AND normalized by the
 * schema factory (§8 S2); normalizeEmail also guarantees a doc-ID-safe value
 * (rejects '/'/whitespace), used both as the doc ID and the stored `email`.
 *
 * The record is written at root checklistRequests/{normalizedEmail}. Idempotent:
 * a repeat submit for the same email refreshes provenance and moves updatedAt,
 * but preserves the original createdAt and never resets status (owned by the
 * fulfilment path).
 */
export const submitChecklistRequest = functions
  .runWith({ invoker: "public", maxInstances: 5 })
  .https.onRequest(async (req, res) => {
    setMarketingCors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }
    if (isRateLimited(`submitChecklistRequest:${clientIp(req)}`)) {
      res.status(429).send("Too many requests. Please try again in a minute.");
      return;
    }

    const { email, ref, source } = (req.body ?? {}) as {
      email?: string;
      ref?: string;
      source?: string;
    };

    // Normalize + validate the email; this is BOTH the doc ID and the stored
    // field, so a bad address is rejected before any Firestore access.
    let normalizedEmail: string;
    try {
      normalizedEmail = checklistRequestsSchema.normalizeEmail(email ?? "");
    } catch {
      res.status(400).send("Enter a valid email address.");
      return;
    }

    let firstWriteBody;
    try {
      firstWriteBody = checklistRequestsSchema.buildNewChecklistRequest({
        email: normalizedEmail,
        ref: ref ?? null,
        source,
      });
    } catch {
      res.status(400).send("Please check the form and try again.");
      return;
    }

    try {
      const docRef = db
        .collection(checklistRequestsSchema.CHECKLIST_REQUESTS_COLLECTION)
        .doc(normalizedEmail);
      const existing = await docRef.get();
      if (existing.exists) {
        // Refresh provenance without clobbering createdAt or status.
        await docRef.set(
          checklistRequestsSchema.buildChecklistRequestRefresh({ ref: ref ?? null, source }),
          { merge: true },
        );
      } else {
        await docRef.set(firstWriteBody);
      }
      res.status(200).json({ ok: true });
    } catch (err: any) {
      // No PII in logs (§9.2) — log the failure, not the submitted email.
      console.error("submitChecklistRequest failed", err?.message);
      res.status(500).send("Something went wrong.");
    }
  });

// Sender for founder notifications: the H3 toll-free line. See notifyNewLead's
// DECISION on messaging verification.
const FOUNDER_NOTIFY_FROM = "+18773682008";

/**
 * notifyNewLead — Firestore onCreate trigger that texts the founder when the
 * Receptionist captures a new inbound-call lead.
 *
 * Fires on accounts/{accountId}/customers/{customerId} creation (the real,
 * multi-tenant-scoped path — customers never live at the root). Only inbound-call
 * leads notify: it gates on source === CUSTOMER_SOURCE.PHONE_CALL ('phone_call'),
 * using the schema constant rather than a magic string so it tracks the read-side
 * schema (§2.2). Manual entries (manual_entry) and any other write path are
 * silently ignored.
 *
 * Message: "New lead: {displayName} — {phone}. Call them back." Falls back to
 * "New lead: {phone}. Call them back." when the receptionist could not extract a
 * name (displayName is null) — we never fabricate a name.
 *
 * Secrets (§8 S1): all three come from Secret Manager, never code or git —
 *   • TWILIO_AUTH_TOKEN   (already used by the webhook signature check)
 *   • TWILIO_ACCOUNT_SID  (required to build the Twilio REST client; the existing
 *     code only ever used the static twilio.validateRequest, which needs the token
 *     alone, so the SID was never stored — this is a genuinely new secret, not a
 *     duplicated one)
 *   • FOUNDER_NOTIFY_PHONE (the founder's personal cell — the single recipient)
 * The sender is the toll-free line (FOUNDER_NOTIFY_FROM). maxInstances:3 caps
 * cost on this background trigger (§8 S4); no per-caller throttle — it's an
 * internal one-recipient notification, not a public surface.
 *
 * No PII in logs (§9.2): we log that a notification was sent or failed, never the
 * recipient, the lead's name, or the phone number.
 *
 * DECISION (2026-07): the toll-free number +18773682008 is NOT YET verified for
 * outbound messaging (Founder Task 2, in progress). Low-volume internal texts to a
 * single known cell will most likely deliver, but if a carrier filters them the
 * fix is COMPLETING that messaging verification — NOT a code change here. This
 * function is correct as written; delivery is an account-provisioning concern.
 *
 * DECISION (2026-07): best-effort delivery — a Twilio failure is logged and
 * swallowed, never re-thrown. Re-throwing would make Firestore retry the trigger
 * (at-least-once) and risk duplicate texts for a notification not worth retrying.
 */
export const notifyNewLead = functions
  .runWith({
    maxInstances: 3,
    secrets: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "FOUNDER_NOTIFY_PHONE"],
  })
  .firestore.document("accounts/{accountId}/customers/{customerId}")
  .onCreate(async (snap) => {
    const data = snap.data() ?? {};

    // Gate: inbound-call leads only. Manual/other write paths never notify.
    if (data.source !== customersSchema.CUSTOMER_SOURCE.PHONE_CALL) {
      return;
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const founderPhone = process.env.FOUNDER_NOTIFY_PHONE;
    if (!accountSid || !authToken || !founderPhone) {
      // Config gap — log without any PII; there is nothing safe to send.
      console.error("notifyNewLead: missing Twilio creds or FOUNDER_NOTIFY_PHONE secret");
      return;
    }

    const phone = typeof data.phone === "string" ? data.phone : "";
    const displayName =
      typeof data.displayName === "string" && data.displayName ? data.displayName : null;
    const body = displayName
      ? `New lead: ${displayName} — ${phone}. Call them back.`
      : `New lead: ${phone}. Call them back.`;

    try {
      const client = twilio(accountSid, authToken);
      await client.messages.create({ to: founderPhone, from: FOUNDER_NOTIFY_FROM, body });
      // §9.2: confirm the send happened, never who it went to or what it said.
      console.log("notifyNewLead: notification sent");
    } catch (err: any) {
      // Best-effort (see DECISION) — log the failure with no PII, do not rethrow.
      console.error("notifyNewLead: Twilio send failed", err?.message);
    }
  });
