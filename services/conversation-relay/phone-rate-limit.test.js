/**
 * Unit tests for the pure parts of phone-rate-limit.js (§7.2 — anything on the
 * security path gets a test). Run: `node --test` (or `npm test`) from this
 * directory.
 *
 * checkAndConsume itself is impure (Firestore transactions) and is NOT covered
 * here — see the module's Follow-up note: it belongs in an emulator integration
 * test (firestore-tests/ harness or a service-level emulator test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callerKey, utcStamp, hourBucketId, dayBucketId, globalDayId, withinLimit, CAPS,
} from './phone-rate-limit.js';

test("callerKey normalizes E.164 to digits, no leading +", () => {
  assert.equal(callerKey("+18175551234"), "18175551234");
});

test("callerKey collapses withheld/short/undefined to 'anonymous'", () => {
  assert.equal(callerKey(undefined), "anonymous");
  assert.equal(callerKey(""), "anonymous");
  assert.equal(callerKey("anonymous"), "anonymous");
  assert.equal(callerKey("+123"), "anonymous");
});

test("utcStamp is deterministic and timezone-independent", () => {
  const d = new Date("2026-07-27T09:05:00Z");
  assert.equal(utcStamp(d, false), "20260727");
  assert.equal(utcStamp(d, true), "2026072709");
});

test("bucket IDs embed caller + window", () => {
  const d = new Date("2026-07-27T09:05:00Z");
  assert.equal(hourBucketId("18175551234", d), "18175551234__h2026072709");
  assert.equal(dayBucketId("18175551234", d), "18175551234__d20260727");
  assert.equal(globalDayId(d), "20260727");
});

test("withinLimit is inclusive of the cap and rejects above it", () => {
  assert.equal(withinLimit(CAPS.perCallerPerHour, CAPS.perCallerPerHour), true);
  assert.equal(withinLimit(CAPS.perCallerPerHour + 1, CAPS.perCallerPerHour), false);
});
