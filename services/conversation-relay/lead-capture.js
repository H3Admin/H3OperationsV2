/**
 * lead-capture — Receptionist→CRM handoff for the ConversationRelay service.
 *
 * Ported from functions/src/index.ts (extractCallerName + createLeadFromCall) so
 * the ConversationRelay path writes the SAME customer/lead document the
 * Gather-based flow did — customers/{E164-digits}, status=lead,
 * source=phone_call, createdBy=system:receptionist, with displayName enriched by
 * a single Gemini pass over the transcript and provenance ai_extracted. The
 * write goes through the schema authority (buildNewCustomer), and the onCreate
 * trigger notifyNewLead fires automatically on the resulting doc.
 *
 * Idempotent: existence-checks the doc first, so it neither clobbers an existing
 * customer nor duplicates if called more than once for the same caller (e.g.
 * [DONE] AND socket-close both trigger a write). The existence check also gates
 * the Gemini enrichment call, so a repeat costs zero tokens.
 *
 * Untrusted model output (§8 S2): the extracted name is sanitized by the schema
 * authority before it can reach Firestore. §9.2: never logs the transcript,
 * name, or phone.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  buildNewCustomer,
  customerIdFromPhone,
  sanitizeDisplayName,
  CUSTOMER_SOURCE,
  SYSTEM_ACTOR,
  DISPLAY_NAME_SOURCE,
} from './customers-schema.js';
import { GEMINI_MODEL } from './receptionist-prompt.js';

/**
 * Best-effort caller-name extraction. Any failure resolves to null so it can
 * NEVER block lead creation. Ported verbatim from index.ts extractCallerName.
 */
async function extractCallerName(turns, geminiApiKey) {
  if (!geminiApiKey) return null;
  try {
    const transcript = turns
      .map((t) => `Caller: ${t.callerText}\nAssistant: ${t.aiText}`)
      .join('\n');
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const prompt =
      "From the following phone call transcript, extract ONLY the caller's own " +
      'name if they clearly stated it. Respond with just the name and nothing ' +
      'else — no punctuation, no labels, no explanation. If the caller did not ' +
      'clearly give their name, respond with exactly: NONE\n\nTranscript:\n' +
      transcript;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text || text.toUpperCase() === 'NONE') return null;
    return text;
  } catch (err) {
    // Best-effort only — never block the lead. No transcript/PII logged (§9.2).
    console.error('extractCallerName: extraction failed', err?.message);
    return null;
  }
}

/**
 * Write the inbound-call lead. Ported from index.ts createLeadFromCall.
 *
 * @param {import('@google-cloud/firestore').Firestore} db
 * @param {string} accountId
 * @param {string} phone       caller's number (from the signature-validated /twiml request)
 * @param {Array<{callerText:string, aiText:string}>} turns
 * @param {string|undefined} geminiApiKey
 * @returns {Promise<'created'|'exists'|'skipped_unparseable'>}
 */
export async function createLeadFromCall(db, accountId, phone, turns, geminiApiKey) {
  const customerId = customerIdFromPhone(phone);
  if (!customerId) {
    // Unparseable number — never attempt an empty-ID doc write. No PII logged.
    console.warn('createLeadFromCall: phone did not normalize; skipping lead creation');
    return 'skipped_unparseable';
  }

  const docRef = db
    .collection('accounts').doc(accountId)
    .collection('customers').doc(customerId);

  const existing = await docRef.get();
  if (existing.exists) {
    // Already a customer/lead (or a repeat trigger) — do nothing. Gates Gemini.
    return 'exists';
  }

  const rawName = await extractCallerName(turns, geminiApiKey);
  const displayName = sanitizeDisplayName(rawName);
  const displayNameSource = displayName ? DISPLAY_NAME_SOURCE.AI_EXTRACTED : null;

  const body = buildNewCustomer({
    accountId,
    phone,
    status: 'lead',
    source: CUSTOMER_SOURCE.PHONE_CALL,
    createdBy: SYSTEM_ACTOR.RECEPTIONIST,
    displayName,
    displayNameSource,
  });

  await docRef.set(body);
  return 'created';
}
