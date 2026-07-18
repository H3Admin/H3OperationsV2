/**
 * twilio-signature — X-Twilio-Signature validation for the ConversationRelay
 * webhook, factored out of server.js so it can be unit-tested without booting
 * the HTTP/WebSocket server (§7.2). Mirrors the READ side of
 * functions/src/index.ts validateTwilioSignature.
 *
 * The signed URL is reconstructed from a TRUSTED origin (serviceUrl) plus the
 * request path/query — NEVER req.headers.host. Cloud Run terminates TLS at its
 * proxy, so the host header is an internal name Twilio never signed against
 * (same CF_BASE_URL rationale as the Cloud Function). Reconciled 2026-07-18
 * against the live test-number webhook: the configured VoiceUrl is exactly
 * serviceUrl + "/twiml" (POST, no query string).
 *
 * Does NOT read secrets, env, or the network — pure over its inputs.
 */
import twilio from 'twilio';

/**
 * Validate a Twilio webhook signature.
 *
 * @param {object}  args
 * @param {string}  args.authToken   Twilio account Auth Token (32-hex).
 * @param {string=} args.signature   The X-Twilio-Signature header value.
 * @param {string}  args.serviceUrl  Public origin of this service, no trailing slash.
 * @param {string}  args.requestUrl  Request path (+ any query), e.g. "/twiml".
 * @param {object}  args.params      Parsed POST form params (Twilio signs these sorted).
 * @returns {boolean} true only when authToken + signature are present and the
 *                    signature matches the reconstructed URL and params.
 */
export function isValidTwilioSignature({ authToken, signature, serviceUrl, requestUrl, params }) {
  if (!authToken) return false;
  if (typeof signature !== 'string' || !signature) return false;
  const fullUrl = `${serviceUrl}${requestUrl}`;
  return twilio.validateRequest(authToken, signature, fullUrl, params);
}
