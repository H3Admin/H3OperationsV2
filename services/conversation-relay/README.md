# conversation-relay (production)

Streaming voice pipeline on **Cloud Run**: Twilio **ConversationRelay** + **Gemini**
token streaming. Replaces the Gather/STT/TTS turn loop in
`functions/src/index.ts` (`handleInboundCall` + `handleSpeech`) — no dead air,
real barge-in.

## Surfaces

| Path       | Kind | Purpose                                                                    |
| ---------- | ---- | ------------------------------------------------------------------------- |
| `/twiml`   | HTTP | Validates `X-Twilio-Signature`, resolves the account from the dialed number, returns `<Connect><ConversationRelay>` pointed at `/ws` with `accountId` + `callerFrom` params. |
| `/ws`      | WS   | ConversationRelay turn loop (setup / prompt / interrupt).                 |
| `/healthz` | HTTP | Cloud Run liveness.                                                       |

## What matches production exactly

- **Persona** (`receptionist-prompt.js`) — the real receptionist system
  instruction ported from `index.ts` `handleSpeech`, tenant-driven from
  `accounts/{accountId}/phonePlaybook/{accountId}` (businessName / services /
  toneInstructions). Greeting from `phoneSettings.greetingText`.
- **Lead write** (`lead-capture.js`) — the same `createLeadFromCall` path:
  `customers/{E164-digits}`, `status=lead`, `source=phone_call`,
  `createdBy=system:receptionist`, `displayName` enriched via one Gemini pass and
  sanitized by the schema authority. Idempotent. `notifyNewLead` (onCreate
  trigger on `customers/`) fires automatically.
- **Schema authority** (`customers-schema.js`) — a hand-synced ESM port of
  `functions/src/schema/customers.js` (see the §2.2 caveat in its header).

## The two spike bugs, fixed

1. **Real persona** — not the skeleton copy (`receptionist-prompt.js`).
2. **History persists** — **one** `startChat()` per WebSocket connection; every
   turn is committed to that session's history (we always `await result.response`
   before the next turn, and turns are serialized). This is what stops the
   receptionist from looping the same questions.

## Barge-in

An `interrupt` message aborts the current turn's token forwarding immediately.
The stream keeps draining in the background only so the SDK commits the turn to
history; no further `text` frames are sent for that turn. The next `prompt`
starts a fresh turn on the same chat session.

## Per-call logging (stdout → Cloud Run logs, §9.2 — no PII)

- `turnLatencyMs=<n>` — prompt received → first text token.
- `totalCallDurationMs=<n>` — setup → socket close.
- `leadWrite=<created|exists|skipped_unparseable|error>`.

## Secrets / credentials

- `GEMINI_API_KEY` — from Secret Manager (`--set-secrets`).
- `TWILIO_AUTH_TOKEN` — from Secret Manager; used to validate the `/twiml`
  signature (S3). If unset, `/twiml` logs loudly and skips validation (test only).
- Firestore — **Application Default Credentials**; Cloud Run supplies the
  runtime service account automatically. No key file, no secret.

## Deploy

See the `gcloud run deploy` command in the handoff notes.

## ⚠ Test number only

Point **only the test number's** Voice webhook at `<service-url>/twiml`.
**Do NOT** repoint **(877) 368-2008** yet.
