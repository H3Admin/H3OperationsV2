/**
 * conversation-relay — PRODUCTION streaming voice pipeline (Cloud Run).
 *
 * Replaces the Gather/STT/TTS turn loop (functions/src/index.ts handleInboundCall
 * + handleSpeech) with Twilio ConversationRelay + Gemini token streaming: no dead
 * air, real barge-in. Needs a persistent WebSocket, so it runs on Cloud Run, not
 * Cloud Functions.
 *
 * Surfaces (one HTTP server):
 *   HTTP  POST /twiml   -> validates X-Twilio-Signature, resolves the account from
 *                          the dialed number, returns <Connect><ConversationRelay>
 *                          pointed at this service's own wss /ws, passing accountId
 *                          + callerFrom as trusted <Parameter>s (derived from the
 *                          SIGNATURE-VALIDATED request, not the open socket).
 *   WS         /ws      -> the ConversationRelay turn loop.
 *   HTTP  GET  /healthz -> Cloud Run liveness.
 *
 * Persona: the REAL receptionist system instruction from index.ts, tenant-driven
 * from the account's phonePlaybook (see receptionist-prompt.js). Lead write: the
 * SAME createLeadFromCall path as production (see lead-capture.js); notifyNewLead
 * fires on the resulting customers/ doc automatically.
 *
 * Per-call stdout logging (§9.2 — ms only, no name/number/transcript):
 *   turnLatencyMs=<n>          prompt received -> first text token sent
 *   totalCallDurationMs=<n>    setup -> socket close
 *   leadWrite=<created|exists|skipped_unparseable|error>
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Firestore } from '@google-cloud/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSystemPrompt, DONE_SENTINEL, GEMINI_MODEL } from './receptionist-prompt.js';
import { createLeadFromCall } from './lead-capture.js';
import { isValidTwilioSignature } from './twilio-signature.js';

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Public base URL of THIS Cloud Run service. Behind Cloud Run's proxy,
// req.headers.host is an internal hostname, so reconstructing the URL from
// request headers produces a URL Twilio never signed against — the exact
// failure that broke handleInboundCall (see CF_BASE_URL there). Twilio signs
// the webhook URL it was configured with, so we validate against a known
// constant instead. Set SERVICE_URL in the deploy command (--set-env-vars);
// the hardcoded fallback is this service's stable run.app URL.
const SERVICE_URL =
  process.env.SERVICE_URL || 'https://conversation-relay-760093548916.us-central1.run.app';

// ConversationRelay TTS voice. ConversationRelay has its own voice naming (not
// the Gather flow's Polly.Joanna-Neural). Overridable per-deploy.
const TTS_VOICE = process.env.TTS_VOICE || 'en-US-Journey-O';

// ADC on Cloud Run: project + credentials come from the metadata server, so no
// key file and no secret (task #7). Same service account the service runs under.
const db = new Firestore();
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');

// ---------------------------------------------------------------------------
// Firestore lookups (mirror handleInboundCall / handleSpeech reads)
// ---------------------------------------------------------------------------

/** Resolve accountId from the dialed number, same query handleInboundCall uses. */
async function resolveAccountId(dialedNumber) {
  const snap = await db
    .collectionGroup('phoneSettings')
    .where('twilioPhoneNumber', '==', dialedNumber)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].ref.parent.parent.id;
}

/** Read the persona inputs + greeting for an account (phonePlaybook + phoneSettings). */
async function loadAccountVoiceConfig(accountId) {
  const [playbookSnap, settingsSnap] = await Promise.all([
    db.collection('accounts').doc(accountId).collection('phonePlaybook').doc(accountId).get(),
    db.collection('accounts').doc(accountId).collection('phoneSettings').doc(accountId).get(),
  ]);
  const playbook = playbookSnap.data() ?? {};
  const settings = settingsSnap.data() ?? {};
  const greeting =
    typeof settings.greetingText === 'string' && settings.greetingText
      ? settings.greetingText
      : 'Thank you for calling.';
  return { playbook, greeting };
}

// ---------------------------------------------------------------------------
// HTTP: /twiml + /healthz
// ---------------------------------------------------------------------------

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (url.pathname === '/twiml') {
    await handleTwiml(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

async function handleTwiml(req, res) {
  const sendXml = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'text/xml' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
  };

  const rawBody = await readBody(req);
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // S3: every inbound webhook is signature-validated before any Firestore read.
  // The /ws socket cannot be signed by ConversationRelay, so this HTTP entry
  // point is the meaningful gate; accountId + callerFrom are derived here from
  // the validated request and passed to the socket as trusted <Parameter>s.
  if (!TWILIO_AUTH_TOKEN) {
    // Fail closed: with no token we cannot authenticate Twilio, so we refuse
    // rather than serve an unauthenticated call — matches handleInboundCall
    // returning 500 on a missing token (index.ts).
    console.error('twiml: TWILIO_AUTH_TOKEN not set — cannot validate signature');
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Configuration error');
    return;
  }
  if (
    !isValidTwilioSignature({
      authToken: TWILIO_AUTH_TOKEN,
      signature: req.headers['x-twilio-signature'],
      serviceUrl: SERVICE_URL,
      requestUrl: req.url,
      params,
    })
  ) {
    console.warn('twiml: Twilio signature validation failed');
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const dialedNumber = params.Called || params.To;
  const callerFrom = params.From || '';
  if (!dialedNumber) {
    sendXml(200, '<Say voice="Polly.Joanna-Neural">An error occurred. Goodbye.</Say><Hangup/>');
    return;
  }

  let accountId;
  try {
    accountId = await resolveAccountId(dialedNumber);
  } catch (err) {
    console.error('twiml: account lookup failed', err?.message);
    sendXml(200, '<Say voice="Polly.Joanna-Neural">We are experiencing a technical issue. Please call back later.</Say><Hangup/>');
    return;
  }

  if (!accountId) {
    console.log('twiml: no account configured for dialed number');
    sendXml(200, '<Say voice="Polly.Joanna-Neural">Sorry, this number is not configured.</Say><Hangup/>');
    return;
  }

  // Derive the socket URL from SERVICE_URL too (not proxy headers): Cloud Run
  // terminates TLS, so the public scheme is always wss.
  const wsUrl = `${SERVICE_URL.replace(/^https:/, 'wss:')}/ws`;
  sendXml(
    200,
    '<Connect>' +
      `<ConversationRelay url="${wsUrl}" ttsProvider="Google" voice="${xmlEscape(TTS_VOICE)}" interruptible="true">` +
        `<Parameter name="accountId" value="${xmlEscape(accountId)}"/>` +
        `<Parameter name="callerFrom" value="${xmlEscape(callerFrom)}"/>` +
      '</ConversationRelay>' +
    '</Connect>',
  );
}

// ---------------------------------------------------------------------------
// WebSocket: ConversationRelay turn loop
// ---------------------------------------------------------------------------

// BUG 2 (choppy speech): perMessageDeflate batches small frames through the
// compressor, coalescing the per-token text frames into bursts. Disable it so
// each token frame goes out on its own.
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  // BUG 2 (choppy speech): disable Nagle's algorithm on this socket. Nagle
  // coalesces small TCP writes (~40ms), which turns our steady per-token text
  // frames into bursts the caller hears as word gaps mid-sentence. TCP_NODELAY
  // flushes each frame immediately for smooth streaming TTS.
  try {
    req.socket.setNoDelay(true);
  } catch (err) {
    console.warn('ws: setNoDelay failed', err?.message);
  }

  const call = {
    sessionId: null,
    callSid: null,
    accountId: null,
    from: '',
    connectedAt: Date.now(),
    model: null, // ONE model (with systemInstruction) per connection
    history: [], // manual chat history: [{ role, parts }] — see runTurn / commitTurn
    turns: [], // [{ callerText, aiText }] accumulated for lead capture
    currentTurn: null, // the turn currently streaming; interrupt aborts it
    turnChain: Promise.resolve(), // serializes turns so history is written in order
    leadWritten: false,
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.warn('ws: non-JSON frame ignored');
      return;
    }

    switch (msg.type) {
      case 'setup':
        await handleSetup(msg);
        break;
      case 'prompt':
        handlePrompt(msg);
        break;
      case 'interrupt':
        handleInterrupt();
        break;
      case 'dtmf':
        // Not part of this pipeline; log only.
        console.log(`ws: dtmf ignored sid=${call.callSid}`);
        break;
      case 'error':
        console.error(`ws: ConversationRelay error: ${msg.description || 'unknown'}`);
        break;
      default:
        console.log(`ws: unhandled message type=${msg.type}`);
    }
  });

  ws.on('close', async () => {
    abortCurrentTurn();
    console.log(
      `ws: call ended sid=${call.callSid} session=${call.sessionId} totalCallDurationMs=${Date.now() - call.connectedAt}`,
    );
    // Safety net: a caller who hangs up without the model emitting [DONE] should
    // still produce a lead (matches handleCallStatus writing at call end).
    await maybeWriteLead('close');
  });

  ws.on('error', (err) => {
    console.error(`ws: socket error sid=${call.callSid}: ${err.message}`);
  });

  // -- setup ----------------------------------------------------------------

  async function handleSetup(msg) {
    call.sessionId = msg.sessionId || null;
    call.callSid = msg.callSid || null;
    call.connectedAt = Date.now();

    // Trust the accountId + callerFrom passed from the signature-validated /twiml
    // (customParameters), not the raw setup fields.
    const customParams = msg.customParameters || {};
    call.accountId = customParams.accountId || null;
    call.from = customParams.callerFrom || msg.from || '';

    if (!call.accountId) {
      console.error('ws: setup missing accountId — cannot start session');
      safeSend(ws, { type: 'text', token: 'Sorry, this number is not configured.', last: true });
      safeSend(ws, { type: 'end' });
      return;
    }
    if (!GEMINI_API_KEY) {
      console.error('ws: GEMINI_API_KEY not set — prompts will fail');
    }

    let voiceConfig;
    try {
      voiceConfig = await loadAccountVoiceConfig(call.accountId);
    } catch (err) {
      console.error('ws: loadAccountVoiceConfig failed', err?.message);
      voiceConfig = { playbook: {}, greeting: 'Thank you for calling.' };
    }

    const systemPrompt = buildSystemPrompt(voiceConfig.playbook);
    // ONE model (with the persona as systemInstruction) for the whole call.
    // History is managed manually in call.history and passed to each
    // generateContentStream call — NOT via ChatSession auto-history. This is
    // deliberate (BUG 1): ChatSession commits the FULL generated response on an
    // aborted stream, so after a barge-in Gemini's record diverges from what the
    // caller actually heard. Managing history ourselves lets us commit exactly
    // the delivered text (see commitTurn).
    call.model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
      // Same DECISION as index.ts: NO maxOutputTokens cap (thinking-token
      // truncation leaks reasoning fragments). See index.ts handleSpeech.
    });

    console.log(`ws: setup sid=${call.callSid} session=${call.sessionId} account=${call.accountId}`);

    // Speak the greeting immediately as the first text frame (task #1) — not via
    // a welcomeGreeting attribute, so it comes from the account's phoneSettings.
    safeSend(ws, { type: 'text', token: voiceConfig.greeting, last: true });
  }

  // -- prompt (enqueued so turns never overlap on the one chat) --------------

  function handlePrompt(msg) {
    const voicePrompt = typeof msg.voicePrompt === 'string' ? msg.voicePrompt : '';
    if (msg.last === false) return; // ignore partial transcripts
    if (!voicePrompt.trim()) return;
    if (!call.model) {
      console.warn('ws: prompt before setup — ignoring');
      return;
    }
    // Supersede any still-streaming turn (abort its generation), then queue this
    // one behind it so history is written in order.
    abortCurrentTurn();
    call.turnChain = call.turnChain.then(() => runTurn(voicePrompt)).catch((err) => {
      console.error(`ws: turn failed sid=${call.callSid}: ${err?.message}`);
    });
  }

  async function runTurn(text) {
    const turn = {
      aborted: false,
      promptReceivedAt: Date.now(),
      firstTokenSent: false,
      controller: new AbortController(),
    };
    call.currentTurn = turn;

    const userContent = { role: 'user', parts: [{ text }] };
    let sentinelBuffer = '';
    let sawDone = false;
    let spoken = ''; // exactly what we forwarded to Twilio = what the caller heard

    let result;
    try {
      result = await call.model.generateContentStream(
        { contents: [...call.history, userContent] },
        { signal: turn.controller.signal },
      );
    } catch (err) {
      if (turn.aborted) {
        // Barged in before the model responded — nothing heard, record nothing.
        return;
      }
      console.error(`ws: gemini send failed sid=${call.callSid}: ${err?.message}`);
      sendText(turn, "Sorry, I didn't catch that. Could you say that again?", true);
      return;
    }

    try {
      for await (const chunk of result.stream) {
        // Barge-in: stop immediately. We do NOT drain — the AbortController has
        // already cut generation, so the next turn starts without waiting.
        if (turn.aborted) break;
        if (sawDone) break; // [DONE] reached; nothing after the sentinel matters

        const t = typeof chunk.text === 'function' ? chunk.text() : '';
        if (!t) continue;

        // Relay each chunk's safe text the instant it arrives — no batching.
        sentinelBuffer += t;
        const { emit, hold, done } = splitOnSentinel(sentinelBuffer);
        sentinelBuffer = hold;
        if (emit) {
          sendText(turn, emit, false);
          spoken += emit;
        }
        if (done) sawDone = true;
      }
    } catch (err) {
      // An AbortError here is the expected barge-in path — not a real failure.
      if (!turn.aborted) console.error(`ws: gemini stream error sid=${call.callSid}: ${err?.message}`);
    }

    // Finalize the spoken turn (skip entirely if the caller barged in).
    if (!turn.aborted) {
      if (sawDone) {
        const tail = sentinelBuffer.replace(/\[DONE\][\s\S]*$/, '');
        if (tail) {
          sendText(turn, tail, true);
          spoken += tail;
        } else {
          safeSend(ws, { type: 'text', token: '', last: true });
        }
      } else if (sentinelBuffer) {
        // Stream ended holding a benign partial (rare) — speak it.
        sendText(turn, sentinelBuffer, true);
        spoken += sentinelBuffer;
      }
    }

    // BUG 1 FIX: commit to history exactly what the caller heard. On a clean turn
    // that's the full reply; on a barge-in it's the delivered partial, tidied to a
    // clean boundary so a dangling half-word never confuses the model. Never the
    // ungenerated remainder, never nothing (Gemini must know it spoke).
    const heard = turn.aborted ? tidyPartial(spoken) : spoken.trim();
    if (heard) {
      call.history.push(userContent);
      call.history.push({ role: 'model', parts: [{ text: heard }] });
      call.turns.push({ callerText: text, aiText: heard });
    }

    if (sawDone && !turn.aborted) {
      // Persona signalled end-of-conversation: write the lead, then hand control
      // back to Twilio (empty TwiML on the number = hangup).
      await maybeWriteLead('done');
      safeSend(ws, { type: 'end', handoffData: JSON.stringify({ reason: 'done' }) });
      console.log(`ws: turn done+end sid=${call.callSid}`);
    }
  }

  function abortCurrentTurn() {
    const turn = call.currentTurn;
    if (turn && !turn.aborted) {
      turn.aborted = true;
      try {
        turn.controller.abort();
      } catch {
        // AbortController.abort() never throws in practice; guard defensively.
      }
    }
  }

  function handleInterrupt() {
    // Barge-in: abort the current turn's generation and token flow immediately.
    // The next prompt starts a fresh turn; history already reflects only what the
    // caller heard (committed in runTurn).
    abortCurrentTurn();
    console.log(`ws: interrupt sid=${call.callSid}`);
  }

  function sendText(turn, token, last) {
    if (turn.aborted) return;
    if (!turn.firstTokenSent) {
      turn.firstTokenSent = true;
      console.log(`ws: turnLatencyMs=${Date.now() - turn.promptReceivedAt} sid=${call.callSid}`);
    }
    safeSend(ws, { type: 'text', token, last: !!last });
  }

  // Idempotent per connection AND per customer doc (createLeadFromCall re-checks
  // existence). §9.2: log only the outcome, never name/number/transcript.
  async function maybeWriteLead(trigger) {
    if (call.leadWritten) return;
    if (!call.accountId || !call.from || call.turns.length === 0) return;
    call.leadWritten = true;
    try {
      const outcome = await createLeadFromCall(db, call.accountId, call.from, call.turns, GEMINI_API_KEY);
      console.log(`ws: leadWrite=${outcome} trigger=${trigger} sid=${call.callSid}`);
    } catch (err) {
      // Reset so the close-time safety net can retry a transient failure.
      call.leadWritten = false;
      console.error(`ws: leadWrite=error trigger=${trigger} sid=${call.callSid}: ${err?.message}`);
    }
  }
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Streaming sentinel guard. Returns the portion safe to speak now (`emit`), the
 * tail to hold back because it might be the start of DONE_SENTINEL (`hold`), and
 * whether the full sentinel was seen (`done`). Prevents speaking a partial
 * "[DONE]" split across token chunks.
 */
function splitOnSentinel(buffer) {
  const idx = buffer.indexOf(DONE_SENTINEL);
  if (idx !== -1) {
    return { emit: buffer.slice(0, idx), hold: '', done: true };
  }
  const maxHold = Math.min(buffer.length, DONE_SENTINEL.length - 1);
  for (let n = maxHold; n > 0; n--) {
    if (DONE_SENTINEL.startsWith(buffer.slice(buffer.length - n))) {
      return {
        emit: buffer.slice(0, buffer.length - n),
        hold: buffer.slice(buffer.length - n),
        done: false,
      };
    }
  }
  return { emit: buffer, hold: '', done: false };
}

/**
 * Tidy a partial (barged-in) model reply to a clean boundary so history never
 * stores a dangling half-word that would confuse the model on the next turn.
 * Prefer cutting after the last completed sentence; else drop the trailing
 * (possibly partial) word. Returns '' when only a fragment of the first word was
 * delivered — too little to be worth recording.
 */
function tidyPartial(text) {
  const t = (text || '').trim();
  if (!t) return '';
  const sentence = t.match(/^[\s\S]*[.!?](?=\s|$)/);
  if (sentence) return sentence[0].trim();
  const lastSpace = t.lastIndexOf(' ');
  return lastSpace > 0 ? t.slice(0, lastSpace).trim() : '';
}

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

server.listen(PORT, () => {
  console.log(`conversation-relay listening on :${PORT} (twiml=/twiml ws=/ws health=/healthz)`);
});
