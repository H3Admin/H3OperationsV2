/**
 * call-doc.js — pure helpers for the ConversationRelay call-doc write path.
 *
 * Extracted from server.js so the shaping / resolution logic is unit-testable
 * WITHOUT importing server.js (which starts an HTTP + WebSocket listener on
 * import). No I/O here — the Firestore writes live in server.js; these functions
 * only compute values.
 *
 * Pairs with calls-schema.js (the buildNewCall body factory). The canonical
 * schema + the reader contract these helpers protect live in
 * functions/src/schema/calls.js (handleCallStatus reads `turns` as
 * [{callerText, aiText}] and never anything else).
 */

/**
 * Shape a conversation turn for the call doc. Carries the reader contract
 * { callerText, aiText } (strings only) PLUS a monotonic per-call `seq`.
 *
 * The `seq` exists to defeat an arrayUnion dedupe hazard: two turns with
 * identical { callerText, aiText } (plausible in a confirmation flow — "Yes." /
 * "Okay.") are deep-equal, and Firestore's arrayUnion silently drops a duplicate
 * element, losing a real turn from the transcript. A distinct `seq` per turn
 * makes every element unique so none is ever dropped. handleCallStatus reads only
 * callerText/aiText and ignores extra keys (proven by the old confidence/timestamp
 * superset), so `seq` is safe to persist.
 *
 * @param {{callerText?: unknown, aiText?: unknown}} turn
 * @param {number} seq  monotonic per-call turn counter (non-integer -> 0)
 * @returns {{callerText: string, aiText: string, seq: number}}
 */
export function shapeTurnForDoc(turn, seq) {
  const t = turn || {};
  return {
    callerText: typeof t.callerText === 'string' ? t.callerText : '',
    aiText: typeof t.aiText === 'string' ? t.aiText : '',
    seq: Number.isInteger(seq) ? seq : 0,
  };
}

/**
 * Append a write onto a fire-and-forget promise chain that NEVER rejects.
 *
 * On failure it routes the error to `onError` (console.error in prod → visible
 * in Cloud Logging) and RESOLVES, so (a) a transcript-write failure can never
 * throw into the live call, (b) it's never silent, and (c) one failed write
 * doesn't poison the chain — the next turn still writes. Returns the new chain
 * tail to store back.
 *
 * @param {Promise<unknown>} chain    current chain tail (must not reject)
 * @param {() => Promise<unknown>} writeFn  produces the write promise
 * @param {(err: unknown) => void} onError  failure sink (logs; must not throw)
 * @returns {Promise<unknown>} the new, non-rejecting chain tail
 */
export function chainWrite(chain, writeFn, onError) {
  return chain.then(writeFn).catch(onError);
}

/**
 * Resolve isNewLead from createLeadFromCall's idempotent-write outcome.
 *
 * 'created' = a brand-new lead doc was written -> true (new lead).
 * 'exists'  = the caller was already a customer/lead (callback) -> false.
 * 'skipped_unparseable' = number didn't normalize, no lead -> false.
 * Anything unexpected -> false (conservative: only a confirmed create is "new").
 *
 * @param {'created'|'exists'|'skipped_unparseable'|string} outcome
 * @returns {boolean}
 */
export function isNewLeadFromOutcome(outcome) {
  return outcome === 'created';
}
