/**
 * receptionist-prompt — production receptionist persona for ConversationRelay.
 *
 * This is the REAL H3 Operations receptionist system instruction, ported
 * verbatim from functions/src/index.ts (the handleSpeech Gemini system prompt,
 * lines ~229-238). It is tenant-driven: businessName / services /
 * toneInstructions come from the account's Firestore phonePlaybook doc
 * (accounts/{accountId}/phonePlaybook/{accountId}), exactly as the Gather-based
 * flow built it. The `[DONE]` end-of-conversation sentinel and the goals list
 * are part of the persona and are reproduced unchanged.
 *
 * NOT the spike's skeleton copy. If the canonical prompt in index.ts changes,
 * update this port by hand and note it (same discipline as the schema mirror).
 */

// End-of-conversation sentinel the persona appends as its final line.
export const DONE_SENTINEL = '[DONE]';

// Same model the production Gather-based flow uses.
export const GEMINI_MODEL = 'gemini-3.5-flash';

/**
 * Build the receptionist system instruction from the account's phonePlaybook.
 * Verbatim mirror of functions/src/index.ts handleSpeech systemPrompt.
 *
 * @param {{ businessName?: string, services?: string, toneInstructions?: string }} playbook
 * @returns {string}
 */
export function buildSystemPrompt(playbook = {}) {
  const businessName =
    typeof playbook.businessName === 'string' && playbook.businessName
      ? playbook.businessName
      : 'this business';
  const services = typeof playbook.services === 'string' ? playbook.services : '';
  const toneInstructions =
    typeof playbook.toneInstructions === 'string' ? playbook.toneInstructions : '';

  return [
    `You are a professional receptionist for ${businessName}.`,
    toneInstructions,
    `Services offered: ${services || 'not specified'}.`,
    `Your goals:`,
    `1. Understand the caller's reason for calling.`,
    `2. Capture the caller's name, phone number, and reason for calling.`,
    `3. Keep responses concise and conversational — this is a phone call, not a chat.`,
    `4. When you have captured all needed information or the caller indicates they are done, ALWAYS end with a warm spoken sign-off that thanks them for calling ${businessName} and tells them someone will be in touch shortly (for example: "Thank you for calling ${businessName} — we'll be in touch shortly. Have a great day!"). Put that sign-off as the last spoken sentence, then append [DONE] on a new line at the very end. Never end the call without speaking that closing line.`,
  ]
    .filter(Boolean)
    .join('\n');
}
