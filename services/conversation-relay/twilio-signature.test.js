/**
 * Unit tests for isValidTwilioSignature (§7.2 — anything on the security path
 * gets a test). Run: `node --test` (or `npm test`) from this directory.
 *
 * Signatures are computed with twilio.getExpectedTwilioSignature using the SAME
 * throwaway token below, so the suite is self-contained and needs no network,
 * secrets, or a running server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { isValidTwilioSignature } from './twilio-signature.js';

// A throwaway 32-hex value — NOT a real credential (§3.6). Only used to sign and
// verify within this test.
const AUTH_TOKEN = '0123456789abcdef0123456789abcdef';
const SERVICE_URL = 'https://conversation-relay-760093548916.us-central1.run.app';
const REQUEST_URL = '/twiml';
const PARAMS = { Called: '+18174790717', From: '+18173073455', CallSid: 'CAtest0000000000000000000000000001' };

// The exact URL Twilio signs = trusted origin + request path.
const SIGNED_URL = `${SERVICE_URL}${REQUEST_URL}`;
const VALID_SIGNATURE = twilio.getExpectedTwilioSignature(AUTH_TOKEN, SIGNED_URL, PARAMS);

test('accepts a correctly-signed request', () => {
  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      signature: VALID_SIGNATURE,
      serviceUrl: SERVICE_URL,
      requestUrl: REQUEST_URL,
      params: PARAMS,
    }),
    true,
  );
});

test('rejects a tampered body (params changed after signing)', () => {
  const tampered = { ...PARAMS, From: '+19995550000' };
  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      signature: VALID_SIGNATURE,
      serviceUrl: SERVICE_URL,
      requestUrl: REQUEST_URL,
      params: tampered,
    }),
    false,
  );
});

test('rejects a forged/garbage signature', () => {
  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      signature: 'not-a-real-signature',
      serviceUrl: SERVICE_URL,
      requestUrl: REQUEST_URL,
      params: PARAMS,
    }),
    false,
  );
});

test('rejects a missing signature header', () => {
  for (const signature of [undefined, '', null]) {
    assert.equal(
      isValidTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        serviceUrl: SERVICE_URL,
        requestUrl: REQUEST_URL,
        params: PARAMS,
      }),
      false,
    );
  }
});

test('rejects when authToken is missing (fail closed)', () => {
  assert.equal(
    isValidTwilioSignature({
      authToken: '',
      signature: VALID_SIGNATURE,
      serviceUrl: SERVICE_URL,
      requestUrl: REQUEST_URL,
      params: PARAMS,
    }),
    false,
  );
});

test('rejects when origin differs from what Twilio signed (proxy-host spoof / SERVICE_URL mismatch)', () => {
  // The signature was computed for SERVICE_URL. Validating against a different
  // origin — e.g. Cloud Run's internal host header — must fail. This is exactly
  // why we reconstruct from SERVICE_URL and never from req.headers.host.
  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      signature: VALID_SIGNATURE,
      serviceUrl: 'https://internal-host.local',
      requestUrl: REQUEST_URL,
      params: PARAMS,
    }),
    false,
  );
});

test('rejects a signature valid for a different auth token', () => {
  const otherToken = 'fedcba9876543210fedcba9876543210';
  const sigForOther = twilio.getExpectedTwilioSignature(otherToken, SIGNED_URL, PARAMS);
  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      signature: sigForOther,
      serviceUrl: SERVICE_URL,
      requestUrl: REQUEST_URL,
      params: PARAMS,
    }),
    false,
  );
});
