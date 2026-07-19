/**
 * gemini-stream-safety — keep an aborted Gemini stream (barge-in) from crashing
 * the Node process.
 *
 * WHY THIS EXISTS: @google/generative-ai's generateContentStream tees the HTTP
 * response body into TWO consumers — result.stream (the async iterator we read)
 * and result.response (an aggregation promise the SDK begins pumping
 * immediately). On AbortController.abort() the error propagates to BOTH teed
 * branches. server.js consumes and catches the first; it never touches the
 * second, so that branch's rejection is unhandled and Node exits(1) — dropping
 * the entire live call. Observed twice in prod immediately after "ws: interrupt".
 *
 * The PRIMARY fix lives in server.js runTurn (a .catch attached directly to
 * result.response, keyed off turn.aborted). This module holds the reusable,
 * unit-testable pieces: the abort-error classifier and the process-level
 * last-resort safety net (§7.2).
 */

/**
 * True only when an error is the expected consequence of aborting an in-flight
 * generateContentStream (barge-in).
 *
 * Deliberately STRICT: it matches SDK/undici abort shapes by name, or a message
 * that actually says "abort" — but NOT the SDK's generic "Error reading from the
 * stream", which can also mean a real mid-call network failure. Only genuinely
 * abort-shaped errors are treated as expected; everything else must surface
 * loudly (see installProcessSafetyNet). The primary server.js catch does the
 * precise abort-vs-not classification using turn.aborted; this is the coarse
 * net for anything that slips past.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbortRelatedError(err) {
  if (!err || typeof err !== 'object') return false;
  const name = String(err.name || '');
  const message = String(err.message || '');
  if (name === 'AbortError' || name === 'GoogleGenerativeAIAbortError') return true;
  return /\babort/i.test(message);
}

// Guard so repeated imports/startups don't stack duplicate listeners.
let installed = false;

/**
 * Install a process-level unhandledRejection handler that NEVER exits the
 * process.
 *
 * DECISION: a live-call voice server must not crash on a stray rejection — a
 * crash drops the active call, which is strictly worse than the dead air
 * ConversationRelay was adopted to remove. So we keep the process alive in both
 * cases, and differentiate only by log level:
 *   - abort-related (expected barge-in fallout the primary catch didn't reach):
 *     warn, non-fatal.
 *   - anything else (genuinely unexpected): error, logged loudly with the full
 *     reason for log-based alerting — surfaced, never silently swallowed.
 *
 * @param {{ warn?: Function, error?: Function }} [logger] injectable for tests
 * @returns {boolean} true if a handler was installed, false if already installed
 */
export function installProcessSafetyNet(logger = console) {
  if (installed) return false;
  installed = true;
  process.on('unhandledRejection', (reason) => {
    if (isAbortRelatedError(reason)) {
      logger.warn(
        `unhandledRejection (abort-related, non-fatal): ${reason?.name || 'Error'}: ${reason?.message || ''}`,
      );
      return;
    }
    logger.error('unhandledRejection (unexpected, process kept alive):', reason);
  });
  return true;
}
