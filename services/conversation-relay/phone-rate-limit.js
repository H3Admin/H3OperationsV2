/**
 * phone-rate-limit.js — deterministic spend guard for the inbound voice path.
 *
 * Responsible for: deciding, at the /twiml boundary (before the costly /ws
 * socket and Gemini turn loop open), whether an inbound call is allowed under
 * three limits — per-caller hourly, per-caller daily, and a global daily ceiling.
 *
 * NOT responsible for: per-call duration/turn bounds (those live in the /ws loop
 * in server.js), Twilio signature validation (done upstream), or account lookup
 * (runs only after this passes).
 *
 * SECURITY (§8 S4): spend-protection path. No LLM here — pure counters
 * (§8 S2, "no LLM in the security path"). Changes here get extra review.
 *
 * DECISION: storage is root-level (`phoneRateLimits`, `phoneUsage`), NOT
 * tenant-scoped (accounts/{id}/...). A rate limit gates BEFORE we know or trust
 * the caller's account, so it is not tenant-owned data — a deliberate, documented
 * exception to the §2.1 "everything scopes by account" rule. Admin-SDK writes
 * only; Firestore Rules deny all client access as defense-in-depth.
 *
 * Correctness does NOT depend on Firestore TTL: the date/hour is baked into the
 * doc ID, so a stale bucket is simply never read again. The expireAt field +
 * TTL policy are housekeeping only (best-effort, ~24h lag — safe to lag).
 */

// --- Policy caps (founder-set; tunable). -----------------------------------
// DECISION: caps are code constants, not a Firestore config doc, for now.
// Flipping them is a scoped deploy — acceptable at current volume and avoids a
// per-call config read on a latency-sensitive path. Graduate to
// `config/phoneRateLimits` (per §5.3A's code→Firestore path) only if we need to
// raise the ceiling mid-incident without a deploy.
export const CAPS = Object.freeze({
  perCallerPerHour: 5,
  perCallerPerDay: 10,
  // Global daily ceiling bounds worst-case daily spend regardless of how many
  // distinct (or spoofed) caller IDs an attacker rotates through. Load-bearing.
  // Exposure math: ~$0.23 per 3-min call (Brief) → 150 ≈ $34.50/day max.
  globalPerDay: 150,
  // Warn once when the global counter crosses this, so a human can raise the cap
  // for a legitimate surge before real leads get turned away.
  globalWarnAt: 75,
});

/**
 * Caller bucket key. E.164 digits, no leading '+' (the §2.1 customer doc-ID
 * convention) so it lines up with the rest of the schema. Anonymous / withheld /
 * unparseable caller IDs collapse to a shared 'anonymous' bucket so a flood of
 * withheld-CID calls is still rate-limited as a group.
 * @param {string|undefined} fromRaw - Twilio `From` (e.g. '+18175551234')
 * @returns {string} caller digits or 'anonymous'
 */
export function callerKey(fromRaw) {
  if (typeof fromRaw !== "string") return "anonymous";
  const digits = fromRaw.replace(/\D/g, "");
  return digits.length >= 10 ? digits : "anonymous";
}

/** UTC YYYYMMDD or YYYYMMDDHH. Deterministic, timezone-independent. */
export function utcStamp(now, withHour) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  return withHour ? `${y}${m}${d}${h}` : `${y}${m}${d}`;
}

// Bucket doc IDs embed the time window so buckets self-partition and old ones
// are never re-read (see module header on TTL).
export function hourBucketId(callerDigits, now) { return `${callerDigits}__h${utcStamp(now, true)}`; }
export function dayBucketId(callerDigits, now)  { return `${callerDigits}__d${utcStamp(now, false)}`; }
export function globalDayId(now)                { return utcStamp(now, false); } // YYYYMMDD

/**
 * Pure limit check: is `nextCount` (the value AFTER this call increments) within
 * `limit`? Extracted pure so the boundary logic is unit-testable without
 * Firestore (§7.2). Units: plain call counts.
 * @returns {boolean} true if allowed
 */
export function withinLimit(nextCount, limit) { return nextCount <= limit; }

/**
 * Check-and-consume all applicable limits for one inbound call.
 *
 * DECISION (order matters): per-caller limits are checked and consumed FIRST;
 * only if the caller passes do we touch the global counter. Rationale — a
 * per-caller rejection returns <Reject> before /ws opens (≈ $0 cost), so it must
 * NOT burn the global daily budget. The global counter counts only calls that
 * will actually reach the paid path.
 *
 * Uses a transaction per counter (not FieldValue.increment) so a rejected call
 * does not inflate the counter: read, and only write when allowing. Atomic under
 * concurrency (max-instances 2 + Twilio retries).
 *
 * PERF: runs on the pre-call /twiml handshake, before audio — a ~tens-of-ms
 * transaction is inaudible to the caller, and the instance is warm
 * (min-instances 1). Twilio may retry /twiml on timeout, slightly over-counting;
 * that errs toward rejecting (safe direction), so no CallSid dedupe here.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{fromRaw: string|undefined, now?: Date}} args
 * @returns {Promise<{allowed:boolean, scope:'caller'|'global'|null,
 *   reason:string|null, globalCount:number|null, crossedWarn:boolean}>}
 */
export async function checkAndConsume(db, { fromRaw, now = new Date() }) {
  const caller  = callerKey(fromRaw);
  const ttlHour = new Date(now.getTime() + 2 * 60 * 60 * 1000);   // 2h
  const ttlDay  = new Date(now.getTime() + 26 * 60 * 60 * 1000);  // >1d

  // --- Layer 1: per-caller hourly, then daily. ---
  const hourRef = db.collection("phoneRateLimits").doc(hourBucketId(caller, now));
  const dayRef  = db.collection("phoneRateLimits").doc(dayBucketId(caller, now));

  const callerOk = await db.runTransaction(async (tx) => {
    const [hourSnap, daySnap] = await Promise.all([tx.get(hourRef), tx.get(dayRef)]);
    const hourNext = (hourSnap.exists ? hourSnap.data().count : 0) + 1;
    const dayNext  = (daySnap.exists  ? daySnap.data().count  : 0) + 1;
    if (!withinLimit(hourNext, CAPS.perCallerPerHour)) return { ok: false, reason: "caller_hour" };
    if (!withinLimit(dayNext,  CAPS.perCallerPerDay))  return { ok: false, reason: "caller_day" };
    tx.set(hourRef, { caller, count: hourNext, expireAt: ttlHour }, { merge: true });
    tx.set(dayRef,  { caller, count: dayNext,  expireAt: ttlDay  }, { merge: true });
    return { ok: true };
  });

  if (!callerOk.ok) {
    return { allowed: false, scope: "caller", reason: callerOk.reason,
             globalCount: null, crossedWarn: false };
  }

  // --- Layer 2: global daily ceiling. ---
  const globalRef = db.collection("phoneUsage").doc(globalDayId(now));
  const globalRes = await db.runTransaction(async (tx) => {
    const snap = await tx.get(globalRef);
    const data = snap.exists ? snap.data() : { count: 0, warnedAt: null, cappedAt: null };
    const next = (data.count || 0) + 1;
    const crossedWarn = !data.warnedAt && next >= CAPS.globalWarnAt && next < CAPS.globalPerDay;
    if (!withinLimit(next, CAPS.globalPerDay)) {
      // Record the cap trip once (for the alert + audit); do not increment past
      // the ceiling — the counter is already at/over the limit.
      if (!data.cappedAt) tx.set(globalRef, { cappedAt: now, expireAt: ttlDay }, { merge: true });
      return { ok: false, count: data.count || 0 };
    }
    const patch = { count: next, expireAt: ttlDay };
    if (crossedWarn) patch.warnedAt = now;
    tx.set(globalRef, patch, { merge: true });
    return { ok: true, count: next, crossedWarn };
  });

  if (!globalRes.ok) {
    return { allowed: false, scope: "global", reason: "global_day",
             globalCount: globalRes.count, crossedWarn: false };
  }

  return { allowed: true, scope: null, reason: null,
           globalCount: globalRes.count, crossedWarn: globalRes.crossedWarn };
}

/**
 * Founder-visible alert via Cloud Logging.
 * DECISION: alert by log marker, not a Twilio SMS from this service — reuses the
 * existing GCP alert-policy-emails-admin@ path (mirrors the /livez uptime alert)
 * and adds no new secret (founder cell stays out of this service). Single-line
 * JSON on stdout → Cloud Run parses into jsonPayload with the given severity; the
 * alert policy filters on jsonPayload.marker. Keep the marker strings stable —
 * they are the alert filter.  [VERIFY: Cloud Run parses stdout JSON lines into
 * jsonPayload incl. severity — confirm once in Logs Explorer after first deploy.]
 */
export function fireGlobalCapAlert({ kind, globalCount }) {
  const capped = kind === "capped";
  process.stdout.write(JSON.stringify({
    severity: capped ? "ERROR" : "WARNING",
    marker: capped ? "PHONE_GLOBAL_CAP_TRIPPED" : "PHONE_GLOBAL_CAP_WARN",
    message: capped
      ? `Global daily voice cap (${CAPS.globalPerDay}) reached — calls being turned away.`
      : `Global daily voice calls crossed warn threshold ${CAPS.globalWarnAt}.`,
    globalCount, cap: CAPS.globalPerDay,
  }) + "\n");
}
