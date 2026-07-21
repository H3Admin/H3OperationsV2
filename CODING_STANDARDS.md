# H3 Operations — Coding Standards & Engineering Practices

**Version:** 1.5 · **Last updated:** July 20, 2026 · **Status:** Living document. Referenced by Claude and Claude Code every session. Updated deliberately, not per-sprint.

**v1.5 change (July 20, 2026):** Added a §10 environment fact recording the **Firestore Rules unit-test harness** — a dedicated `firestore-tests/` directory (own `package.json` + vitest node-env config) that reads the real `firestore.rules` via `readFileSync` and runs against the emulator via `npm run test:rules` (`emulators:exec --only firestore`; Node 20 + Java; no `firebase login`). Cross-referenced it from §7.2 as the concrete home for the required tenant-isolation Rules tests. Stood up alongside tightening the `calls` rule to server-write-only (client writes removed as pure attack surface — all legitimate writes are Admin SDK, bypassing Rules). No practice in §§0–9, 11 changed.

**v1.4 change (July 20, 2026):** §5 (feature-toggle architecture) graduated from **PROPOSED to IN FORCE** — the first implementation shipped: the typed feature registry (§5.3A), the pure `resolveEnabledFeatures` resolver (§5.3B, unit-tested per §7.2), and the first feature-gated route (§5.3C), the Subscriber Dashboard `/dashboard`. §5's PROPOSED banner was replaced with an IN-FORCE note and the §0 status-markers note updated accordingly. §§6–7 remain PROPOSED. No other practice changed.

**v1.3 change (July 18, 2026):** Added two §10 environment facts from the ConversationRelay production-hardening session — (1) `@google/generative-ai` `generateContentStream()` tees the response body, so an aborted stream's never-consumed `result.response` rejection crashes the whole Node process unless it is `.catch()`ed; (2) Cloud Run + Twilio signature validation must reconstruct the signed URL from the `SERVICE_URL` constant, never `req.headers.host`. No practice in §§0–9, 11 changed; §§5/6/7 remain PROPOSED.

**v1.2 change (July 11, 2026):** Added a §10 fact on Twilio `<Gather>` `speechTimeout` (fixed short value, not `"auto"`) from the Session S dead-air fix, and flagged the design-system filename reference in §10 as `[VERIFY]` (repo name unconfirmed). No practice in §§0–9, 11 changed.

**v1.1 change (July 11, 2026):** Added two durable operational facts to §10 — Firestore `fieldOverride` scope-completeness (source of a live index regression in Session R) and the staleness of CLI `firebase functions:log` (use Cloud Logging Explorer instead). No practice in §§0–9, 11 changed.

## 0\. How to use this document

This is the **durable** engineering reference for H3 Operations. It changes rarely.

Two companion documents exist, and the split matters:

| Document | Contains | Change frequency |
| :---- | :---- | :---- |
| **Project Brief** (in Project instructions) | Current sprint state, open items, live IDs, what was done last session | Every session |
| **This document** (CODING\_STANDARDS.md) | How we build, comment, test, release, and secure — regardless of what we're building this week | Rarely; only when a practice changes |
| **CLAUDE.md** (repo root) | Machine-facing context auto-loaded by Claude Code each session | When repo facts change |

**Standing instruction (add to Project instructions):** At end of every session, when updating the Brief, confirm whether anything done that session should promote a *durable* practice into this document. Sprint state stays in the Brief; reusable standards move here. This document should also be committed to the repo root so Claude Code loads it alongside CLAUDE.md.

**A note on status markers.** Sections describing practices already in force are written plainly. Sections proposing something **not yet built** — the Dev/Test environment (§6) and the fuller testing pyramid (§7) — open with a **⚠ PROPOSED** banner. Treat those as recommendations awaiting your sign-off, not locked decisions, until you move them into the Brief's Resolved Decisions list. (The feature-toggle architecture, §5, graduated to IN FORCE in v1.4 with the first feature-gated route.)

## 1\. Core engineering principles

These govern every decision and outrank convenience.

- **Lean first.** Under a \~5 hr/week ceiling, velocity comes from *not* building machinery before it earns its place. Prefer the smallest thing that works; graduate to heavier tooling only when the pain is real and recurring.  
    
- **Verify live state, never assume.** Read the actual repo, the actual Firestore, the actual deployed functions before acting. Prior-session memory and "the template we used before" are hypotheses, not facts, until confirmed against what's live.  
    
- **One change at a time.** One terminal command per step, pwd verified before sequences. Never batch a verification gate with a deploy — stale files ship that way.  
    
- **Recommend, then decide.** Claude leads with a concrete recommendation and the reasoning behind it; the founder decides. No open-ended option dumps. Flag concerns rather than silently complying.  
    
- **Division of labor is fixed.** Claude and Claude Code write all code and design. The founder does not hand-write code. **All git operations run from Terminal.app** — never from Claude Code (it cannot push; it fails silently reporting success). This is non-negotiable to prevent corruption and lost commits.  
    
- **Verify by content, not by filename or timestamp.** After any change, confirm the actual bytes — grep the content, read the diff. A file's name or mtime proves nothing.

## 2\. Code style & structure

### 2.1 Data conventions (canonical — do not deviate)

- **Multi-tenant paths** always scope by account: `accounts/{accountId}/...`. Nothing tenant-owned lives at the root.  
    
- **Field names:** camelCase.  
    
- **Enum values:** snake\_case (e.g. `manual_entry`, `lead`).  
    
- **Money:** integer **cents**. Never floats for currency.  
    
- **Timestamps:** UTC, stored as Firestore Timestamp.  
    
- **Document IDs** follow the schema's rule for that collection (e.g. customers use E.164 digits with no leading `+`). Don't invent ID schemes ad hoc.  
    
- **Case sensitivity is real and unforgiving.** Collection names, field names, and URL routes are all case-sensitive. `customers` ≠ `Customers`; `/customers` ≠ `/Customers`. A mismatch produces silent "no data, no error," not a crash.

### 2.2 Schema authority

- The **server-side schema module is the single source of truth** (e.g. `functions/src/schema/customers.js`). Write factories (`buildNewCustomer`, etc.) stay **server-only**.  
    
- The front end may **mirror the read-side** of a schema by hand into `web/src/lib/*-schema.ts` (types, path builders, enum labels). It must **never re-derive** the schema independently, and must **never duplicate write factories**. If the canonical module changes, mirror the change by hand and note it.

### 2.3 Structure & naming

- Keep functions narrow and single-purpose. One agent \= one service \= one clear responsibility.  
    
- Name for the reader who has never seen the code. `resolveEnabledFeatures(accountContext)` beats `getFlags(x)`.  
    
- No dead code in main. Delete it; git remembers.  
    
- Front-end imports use the `@/` alias. `routeTree.gen.ts` is generated and gitignored — never hand-edit it.

### 2.4 Diagnostic discipline

- For front-end auth/claim debugging, add a **temporary `console.log` via Claude Code**, read the output, then remove it and **verify removal by content search**. Do not rely on pasting into Chrome DevTools (the "allow pasting" guard blocks it) and do not leave debug logging in committed code.  
    
- **No diagnostic or debug endpoints in production.** Ever.

## 3\. Comment & documentation standards

Comments exist for **the developer who inherits this code** — including future hires who weren't in the room for any decision. Assume that reader is smart, unfamiliar, and under time pressure.

### 3.1 The golden rule: comment the *why*, not the *what*

Code already says what it does. Comments explain **why it does it that way** — the constraint, the trade-off, the non-obvious reason.

// BAD — restates the code

// increment the counter

count++;

// GOOD — explains the why

// Twilio retries status callbacks up to 3x; dedupe on callSid so a

// retried delivery doesn't double-count the call.

if (\!seen.has(callSid)) { count++; }

### 3.2 Decision records inline (ADR-lite)

When code embodies a **deliberate decision** — especially one where the obvious alternative was rejected — record it at the point of the decision using a `DECISION:` tag. This is how a future developer learns *why* rather than "fixing" something that was intentional.

// DECISION (2026-07): Repoint claim rather than migrate data (Option A over B).

// 88shk... holds all production data and is hardcoded across functions; migrating

// everything to the newer account was rejected as far more disruptive. See Brief.

Keep the full rationale in the Brief's Resolved Decisions list; the inline tag is a pointer plus the one-line summary so the reader doesn't have to leave the file to understand intent.

### 3.3 Module / file headers

Every non-trivial module starts with a short header block: what it's responsible for, what it deliberately is *not* responsible for, and any cross-file coupling a reader must know.

/\*\*

 \* useCustomers — live tenant-scoped customer list hook.

 \*

 \* Reads accountId from the Firebase Auth ID-token custom claim (async, via

 \* getIdTokenResult) — NOT from a Firestore membership lookup.

 \* Opens an onSnapshot listener on accounts/{accountId}/customers.

 \*

 \* Does NOT handle writes. Mirrors the READ side of functions/src/schema/customers.js;

 \* if that changes, update customers-schema.ts by hand.

 \*/

### 3.4 Function documentation

- Use **JSDoc/TSDoc** on exported functions: purpose, params, return, and any thrown/error behavior.  
    
- Document **assumptions and preconditions** explicitly ("caller must have verified the Twilio signature before this runs").  
    
- Document **units** where ambiguous (cents, milliseconds, E.164).

### 3.5 Standard annotation tags

Use these consistently so they're greppable across the codebase:

| Tag | Meaning |
| :---- | :---- |
| `TODO:` | Known future work, non-blocking |
| `FIXME:` | Known defect or fragile spot needing repair |
| `DECISION:` | A deliberate choice \+ why the alternative was rejected |
| `SECURITY:` | Code on the security path; changes here need extra review (see §8) |
| `COMPLIANCE:` | Code touching a regulated data type or control (see §9); tag the regime, e.g. `COMPLIANCE(HIPAA):` |
| `HACK:` | A deliberate shortcut with a stated reason and ideally an exit condition |
| `PERF:` | Performance-sensitive; note the constraint (e.g. cold-start, per-call cost) |

A quarterly grep of `FIXME`, `HACK`, and `TODO` is a cheap health check.

### 3.6 What not to do

- Don't leave commented-out code in main.  
    
- Don't write comments that will silently rot (avoid restating values that live elsewhere).  
    
- Don't comment secrets, tokens, or real credentials into existence anywhere, ever.

## 4\. Git & version control standards

- **`git add` is a required, separate step before commit.** Files under "Untracked" are not staged; committing captures nothing and push reports "up-to-date." Confirm files are staged (green) after `git add`. Use `git status -u` to expand a wholly-new directory that status collapses to `foldername/`.  
    
- **All pushes from Terminal.app.** Claude Code cannot push (no TTY) and will report false success.  
    
- **Review the diff before committing.** The founder reviews `git diff` / `git diff --staged` and verifies the dev server after significant changes.  
    
- **Pre-commit secret gate:** `git diff --staged | grep -iE "key|secret|token|password"`. This matches benign words (`Object.keys`, `getIdTokenResult`, `token.claims`, a "dedupe key" comment) — read every hit and confirm none is a real credential before proceeding.  
    
- **Commit messages:** imperative summary line, then body explaining *why* when non-obvious. Reference the decision when a commit embodies one.  
    
- **Scoped deploys only.** Never bare `firebase deploy`. Always `--only hosting` or `--only functions:specificFunction`. Never batch a gate check with a deploy.  
    
- **Temp functions are git no-ops.** A guarded temp function added and removed within one session leaves no net change — don't fabricate `--allow-empty` commits for it.  
    
- Repo is the **authoritative inventory** of prior work, not chat memory. `H3OperationsV2` is the single source of truth; `launchpad-studio` is archived.

## 5\. Multi-service / multi-industry architecture (feature toggles)

**IN FORCE (as of v1.4, July 20, 2026).** The first implementation of this architecture has shipped: a typed feature **registry** (§5.3A), the pure **`resolveEnabledFeatures`** resolver (§5.3B), and the first **feature-gated route** (§5.3C) — the Subscriber Dashboard `/dashboard`, gated on `subscriber_dashboard` — all in `web/src/lib/features/` + `web/src/routes/dashboard.tsx`. Industry `verticalConfig` (§5.3D) and Firestore-backed runtime overrides remain future work, built out as they earn their place; the model below is the standard they follow.

### 5.1 The problem

H3 will ship many services (the five pillars — Get Found, Capture the Lead, Answer Every Call, Quote Fast, Book the Job — and the agents beneath them) across multiple industries (plumbing, HVAC, electrical, franchise operators, and more later). They ship over a long horizon, one at a time. We need to:

- **Deploy code before a feature is ready to show** (ship dark), and flip it on when ready — so a half-built service in main never disrupts production.  
    
- **Show different capabilities to different accounts** — by plan tier, by industry, by beta/concierge status.  
    
- **Drive navigation, header/footer, and landing pages from the enabled feature set** — never hardcode a nav item for a service that isn't on for that account.  
    
- Keep all of this cheap and inside the existing stack.

### 5.2 Two orthogonal dimensions

Keep these separate in the model — conflating them causes pain later:

- **Feature availability** — *is this capability on?* Driven by release status, plan entitlement, and per-account overrides.  
    
- **Industry vertical** — *who is this account?* Drives terminology, defaults, default-enabled features, landing-page content, and compliance profile.

An account has one industry; it has a resolved set of enabled features. The two combine to produce what the user actually sees.

### 5.3 Recommended model

**A. Feature registry.** A single typed source of truth listing every feature flag: key, human description, `defaultEnabled`, scope (`global | plan | account | industry`), and lifecycle status (`in_development | beta | ga`). Start as a **code module** (typed constant) for compile-time safety; graduate the *values* to a Firestore doc (e.g. `config/features` and per-account overrides at `accounts/{accountId}/config/features`) once you need to flip flags **without a deploy**. Recommendation: start in code, move account-level overrides to Firestore first (that's the one you'll flip at runtime for concierge/beta).

**B. Layered resolution.** One pure function computes the effective flag set for an account context, resolving in a fixed precedence:

global default  →  industry applicability  →  plan entitlement  →  account override

`resolveEnabledFeatures(accountContext) → Set<FeatureKey>`. Everything downstream reads this one result. It's pure and therefore trivially unit-testable (§7).

**C. UI driven by the resolved set.** Navigation config, feature routes, and header/footer modules are **data**, each entry gated on a feature key. The shell renders whatever the resolved set permits. No service is ever hardcoded into nav. A disabled feature's route should also guard server-side — hiding a nav link is UX, not security (§8).

**D. Industry as a first-class account attribute.** A `verticalConfig` per industry supplies: display terminology, default playbook, features enabled-by-default for that vertical, and a **compliance profile** (§9). Landing pages read the same vertical config so marketing and product stay consistent.

### 5.4 Release discipline this enables

- **Deploy ≠ release.** Merge and deploy a service `in_development`/dark; flip to `ga` when tested. This is what makes incremental building safe under continuous deploys.  
    
- **Reversible releases.** A bad release is a flag flip back, not an emergency redeploy.  
    
- **Progressive rollout.** Enable per-account (concierge/beta cohort) before global GA.

### 5.5 Build vs. buy

Recommendation: **build the lightweight in-house model above; do not adopt a flag SaaS (LaunchDarkly et al.) yet.** It's cost, a dependency, and machinery beyond current need. Revisit only if flag complexity, targeting rules, or audit requirements outgrow a Firestore-backed model. (Consistent with lean-first and the standing build-vs-buy pattern: options presented, founder decides.)

## 6\. Environments & release management

⚠ **PROPOSED — not yet built.** Today there is a single environment (`h3operations-prod`). This section recommends adding a separate Dev/Test environment. Confirm before adopting.

### 6.1 Target model

Firebase's unit of environment isolation is the **project**. Recommendation: create a second Firebase project (e.g. `h3operations-dev`) as a full, separate environment — its own Firestore, Auth, Functions, Hosting, and secrets — so no experiment can touch production data or the live phone line.

- Add a CLI alias (mirroring `H3PROD` → `h3operations-prod`), e.g. `H3DEV` → `h3operations-dev`. Select with `firebase use` before any command; **verify the active project before every deploy** (a prod deploy from the wrong alias is the failure mode this environment exists to prevent).  
    
- Same codebase, environment-specific configuration and secrets. Secrets are per-project in Secret Manager — never shared across environments.  
    
- Twilio: a **separate test number** for dev so test calls never hit the production line or incur confusion. `[VERIFY: cost of a second Twilio number and whether a trial/subaccount suffices for dev.]`

### 6.2 Promotion & hotfix flow

- **Normal path:** build and test in dev → review diff → merge → scoped deploy to prod. Combined with §5, ship dark to prod and verify the flipped-on state in dev first.  
    
- **Hotfix path:** for a production defect, fix and test against dev where feasible, then scoped-deploy only the affected function/hosting to prod. Document the hotfix as a FIXME-closing commit and backfill any missing test (§7) so the regression can't recur.  
    
- **Release checklist (pre-prod, every time):** dependency audit clean (§8); relevant tests green (§7); secret gate clean; diff reviewed; deploy scoped; post-deploy content/behavior verified; feature flags in intended state.

### 6.3 Emulator as the near-term step

Before a full second project exists, the **Firebase Emulator Suite** gives local Firestore/Auth/Functions for integration testing without touching prod. Recommendation: adopt the emulator now as the immediate, zero-cost win; stand up the dev *project* when features warrant a shared, deployed pre-prod environment.

## 7\. Testing standards

Current state: `node --test` unit tests in `functions/` (zero deps; the established pattern). The layered pyramid below is the **⚠ PROPOSED** target, adopted incrementally.

### 7.1 The layers

| Layer | Tests | Tooling |
| :---- | :---- | :---- |
| **Unit** | Pure logic, schema factories, flag resolution (§5.3B) | `node --test` (established) |
| **Integration** | Function ↔ Firestore ↔ Twilio; Rules enforcement | Firebase Emulator Suite; `@firebase/rules-unit-testing` |
| **System / E2E** | Full pipeline, e.g. real call to the production number | Manual live test (established hard rule for phone sessions) |
| **Regression** | The accumulated suite, run before every prod release | Whatever the above use, run as a gate |
| **Security** | Dependency audit, Rules tests, auth-boundary tests, secret-leak gate | `npm audit`, Rules tests, the pre-commit grep |

### 7.2 Standards

- **Multi-tenant isolation is security-critical and directly testable.** Firestore **Rules unit tests** (tenant A cannot read tenant B) are a required standard, not optional — this is the core promise of a multi-tenant platform. Their concrete home is the dedicated `firestore-tests/` harness (see §10) — run against the emulator, reading the real `firestore.rules`.  
    
- **Anything on the security path gets a test** (§8): auth boundary, signature validation, input validation.  
    
- **Test flag resolution** (§5.3B): the precedence logic is pure and must be covered, because it gates what every user sees.  
    
- **A hard rule stands:** any session that touched the phone path ends with a **real end-to-end test call** to the live number.  
    
- **Regression gate before prod:** the relevant suite must be green before a scoped prod deploy. Don't ship on the assumption that an unrelated change is safe.  
    
- **Backfill on defect:** every fixed bug earns a test that would have caught it.

## 8\. Security standards (codified SOP)

These are in force now and apply to all product work. They are the durable version of the Brief's Security SOP.

**S1 — Secrets never leave the server.** Keys/tokens only in Firebase Functions secrets (`defineSecret`). Never in client code, Firestore, or git. `.env*` gitignored forever. Every third-party API call goes through a Cloud Function. Exposure protocol: rotate same session, revoke at provider, redeploy, check usage logs. (The Firebase Web API key in client config is **public by design** — not a secret; the `client.ts` config block is fine committed.)

**S2 — Validate at the server boundary.** Every HTTP function validates type/shape/length/allowlist before touching Firestore or any API. Client validation is UX, not security. Firestore Rules are an independent second layer: deny-by-default, tenant isolation via custom claims. **No LLM in the security path.**

**S3 — Auth on every entry point.** User endpoints verify the Firebase Auth token server-side **and** check membership. Webhooks validate provider signatures (Twilio signature validation — reconstruct the URL as `CF_BASE_URL + "/" + functionName`, not `req.originalUrl` alone). Admin/temp functions use the **guarded pattern only** and are deleted the same session; run `firebase functions:list` at the end of any session that created one.

**S4 — Rate limiting \+ cost caps on anything that spends money.** Per-caller and global limits; `maxInstances` on every function; GCP billing alert and Twilio usage trigger. **Status: not yet done — required before anything customer-facing ships.**

**S5 — Least privilege, no debug surface in prod.** No diagnostic endpoints in production. `npm audit` at the start of any session touching `package.json`; high/critical addressed before feature work.

### 8.1 The guarded temp-function pattern (standard for all prod data/auth admin ops)

Local `applicationDefault()` scripts fail here (no gcloud CLI; org policy blocks service-account keys), so **all production Firestore/Auth admin operations use a guarded temporary HTTP function**:

- Hard assertions protecting known-good documents.  
    
- **Dry-run by default**; a live run is an explicit, separate flip.  
    
- Field-by-field **post-write verification** (read back and confirm).  
    
- Source deletion only **after** a successful read-back.  
    
- **Delete the function the same session**, then `firebase functions:list` to confirm it's gone.

`SECURITY:`\-tag any code that lands on this path so future changes get the extra scrutiny.

## 9\. Compliance & regulatory standards

⚠ **Framework, not certification.** These standards make the codebase *compliance-ready by design*. They do **not**, by themselves, constitute certification or legal compliance. SOC 2 (an AICPA audit against Trust Services Criteria), ISO 27001 (an information-security management system standard), and HIPAA (US health-data law) are **organizational \+ audit \+ legal** processes — code is necessary but not sufficient. When an industry with real requirements is onboarded, engage the appropriate audit/legal expertise; don't infer specifics from this document. `[VERIFY]` any specific regulatory requirement before relying on it.

### 9.1 The principle: compliance-by-design, identified per industry

As industries are onboarded, map their requirements to controls, and controls to code and test obligations. Attach a **compliance profile** to each industry's `verticalConfig` (§5.3D) so requirements travel with the vertical rather than living in someone's head.

### 9.2 Baseline controls we build regardless of regime

These support ISO 27001 / SOC 2 / HIPAA broadly and cost little to bake in early:

- **Data classification.** Know which fields are PII, and — for any regulated vertical — which are PHI or otherwise sensitive. Tag them (`COMPLIANCE(...)`), and treat classification as a first-class part of every schema.  
    
- **Audit logging.** Security- and data-relevant actions (auth changes, admin operations, access to sensitive records) produce an immutable, timestamped audit trail. Bake this in as features ship, not retrofitted.  
    
- **Access control & least privilege.** Tenant isolation via custom claims (§8, S2/S3); role-scoped access; the minimum privilege necessary. This is already load-bearing and directly testable (§7.2).  
    
- **Encryption.** In transit (HTTPS everywhere; every third-party call server-side) and at rest (Firestore encrypts at rest by default). `[VERIFY: whether default at-rest coverage satisfies a given regime, and any need for customer-managed keys.]`  
    
- **No sensitive data in logs.** Never log PII/PHI, tokens, or secrets. This intersects §3.6 and §8.  
    
- **Data retention & deletion.** The ability to retain per policy and to delete on request (relevant to privacy regimes) should be a design consideration for any collection holding personal data.

### 9.3 Regime notes (high level — verify specifics when it matters)

- **SOC 2** — an audited report against Trust Services Criteria (security, availability, processing integrity, confidentiality, privacy). Leans heavily on documented controls, access management, monitoring, and change management — much of which this document's §6/§7/§8 already push toward. `[VERIFY specifics against a qualified auditor.]`  
    
- **ISO 27001** — a certifiable information-security management system (ISMS): risk assessment, a statement of applicability, and operating controls. Organizational as much as technical. `[VERIFY specifics.]`  
    
- **HIPAA** — applies when handling Protected Health Information as a covered entity or business associate. Requires (among much else) a signed **Business Associate Agreement** with each vendor in the data path. **Critically for our stack:** Google Cloud will sign a BAA covering certain — not all — Firebase/GCP services. **Do not assume a given Firebase service is HIPAA-eligible.** `[VERIFY: current list of HIPAA-eligible Firebase/GCP services under Google's BAA before designing any PHI-handling feature, and obtain the BAA before touching PHI.]` Home-services verticals (plumbing/HVAC/electrical) are generally outside HIPAA; this becomes live only if H3 enters a vertical that handles health data.

### 9.4 When compliance enters the build

When a regulated vertical is on the roadmap: (1) confirm the specific requirements with qualified counsel/auditor; (2) record the requirement→control mapping in that vertical's compliance profile; (3) turn each control into concrete code \+ test obligations, tagged `COMPLIANCE(<regime>):`; (4) add the controls to the release checklist (§6.2) so they're gated before that vertical ships.

## 10\. Environment & tooling facts (stable reference)

- **Stack:** Firebase/Firestore, Cloud Functions (Node.js 22, v1, us-central1, 256MB), Firebase Auth, Twilio (voice). Front end: Vite \+ React 19 \+ TypeScript SPA in `web/`, TanStack **Router** (not Start — SPA, no SSR), Tailwind, shadcn/ui. Package manager: npm. Shell: zsh.  
    
- **Firebase CLI** requires Node 20 LTS via nvm (Node 24 has a known Firebase CLI auth bug on macOS). Periodic `firebase login --reauth`. Alias `H3PROD` → `h3operations-prod`.  
    
- **No `gcloud`; org policy blocks service-account keys** → guarded temp HTTP functions for all Firestore/Auth admin ops (§8.1).  
    
- **No `gh` CLI** — HTTPS push works from Terminal.app.  
    
- **Ad-blockers break GA4 and consoles** — verify in incognito (note: incognito drops the auth session, so authed routes redirect to login there — expected).  
    
- **`firestore.indexes.json` must declare *every* scope the code queries.** A `fieldOverride` **replaces** Firestore's automatic single-field indexing for that field — so an override that omits a scope silently drops indexing the code depends on, surfacing as `FAILED_PRECONDITION` at query time (or a silent no-data path), never as a deploy error. Collection-group equality queries (`collectionGroup(...).where(field, "==", ...)`) require an explicit `COLLECTION_GROUP` scope, which Firestore does **not** auto-create. Deploying an incomplete override caused a live regression (Session R): re-asserting the `phoneSettings` override without its collection-group scope broke `handleInboundCall` mid-session. After editing index config, confirm each affected index shows **Enabled** in Console → Firestore → Indexes before relying on it — a scoped `--only firestore:indexes` deploy also no-ops unless `firebase.json` points `firestore.indexes` at the file.  
    
- **CLI `firebase functions:log` returns stale front-of-buffer entries** — it repeatedly served old log lines during a debugging session and hid the current error. For recent errors use the **Cloud Logging Explorer** (web UI) with `resource.type="cloud_function"` \+ `resource.labels.function_name="<fn>"` \+ `severity>=ERROR`, scoped to a tight time window. That is Logs Explorer *query* syntax, entered in the web page's query box — **not** a shell command.  
    
- **Twilio conversational `<Gather>`: use a fixed short `speechTimeout` (e.g. `"2"`), not `"auto"`.** `speechTimeout="auto"` is tuned for open-ended dictation and holds the gather open \~15-17s after the caller stops speaking before finalizing and POSTing to the action URL — heard by the caller as long dead air (Session S: the "20-second pause" on the receptionist line). A fixed 2s end-of-speech window collapses that to a natural conversational pause; nudge to `"3"` if it clips slow talkers. **Diagnose call timing via Twilio Console → Monitor → Logs → Calls → Request Inspector:** gaps *between* consecutive requests \= time spent inside the gather; each request's own duration \= function/AI latency. In the Session S case the functions ran 2.5-6.4s (fine) while the inter-request gaps were 15-17s — proving the bottleneck was gather config, not code. (Known follow-on: on **speakerphone**, the greeting's own audio can bleed into the mic and trip an early turn; acceptable for handset callers, real fix is echo handling — deferred.)  
    
- **`@google/generative-ai` `generateContentStream()` TEES the response body — always `.catch()` `result.response` when a stream can be aborted.** The call returns `result.stream` **and** `result.response` (an aggregation promise the SDK begins pumping immediately). On `AbortController.abort()` — i.e. **every barge-in** — **both** teed branches reject. `result.stream`'s rejection is caught inside the `for await` loop, but `result.response` is typically never consumed, so its rejection goes **unhandled and crashes the whole Node process (`exit 1`), dropping the live call.** Attach a `.catch()` to `result.response`, and key the "is this an expected abort?" decision off **your own abort flag**, not the error — on abort the SDK surfaces a generic `"Error reading from the stream"` (**not** an `AbortError`), so message-matching is unreliable. Add a process-level `unhandledRejection` handler as cheap defense-in-depth for a voice service (a crashed call is worse than added latency); it must **never `exit()`** — log abort-shaped errors at warn, surface everything else loudly. (Verified on `v0.24.1`; ConversationRelay production hardening, 2026-07-18.)  
- **Cloud Run + Twilio signature validation: reconstruct the signed URL from a trusted constant (`SERVICE_URL` env var), NEVER `req.headers.host`.** Cloud Run terminates TLS at its proxy, so the inbound `Host` header is an internal name Twilio never signed against — validating against it 403s every real call. Same class of bug as the `CF_BASE_URL` rule for Cloud Functions (the `Host`/`originalUrl` a proxied request carries is not what the provider signed). Rebuild as `SERVICE_URL` + `req.url`, and confirm the number's configured **VoiceUrl matches `SERVICE_URL` + path byte-for-byte** — scheme, host form (project-number vs hash `run.app` vs custom domain), trailing slash, query string. Pull the live VoiceUrl from the `IncomingPhoneNumbers` resource (or Console → Request Inspector) and reconcile rather than assuming. (ConversationRelay signature fix, 2026-07-18.)  
- **Repo:** `H3Admin/H3OperationsV2` at `/Users/h3operations/h3operations-v2`. `launchpad-studio` archived.  
    
- **Test runner:** `node --test` from `functions/`. **Dev server:** `cd web && npm run dev` (localhost:5173).  
    
- **Firestore Rules unit tests live in a dedicated `firestore-tests/` directory** (its own `package.json` + vitest node-env config), **NOT** in the web scaffolds or `functions/`. Tests read `firestore.rules` via `readFileSync` so they exercise the **real artifact** (no rules copy to drift). Run: `cd firestore-tests && npm run test:rules` (wraps the suite in `firebase emulators:exec --only firestore`). Requires **Node 20** (§10 CLI note) + **Java** for the emulator; a firestore-only `emulators:exec` needs **no** `firebase login`. This is the concrete home for §7.2's required tenant-isolation Rules tests.  
    
- **Design system:** the canonical "Operator Blue" brand/token file. Consult before any front-end or brand work. (Do not use for Cadenza Kits — separate DBA, out of scope.) **`[VERIFY: exact filename and location.]`** This doc previously named it `h3-design-system.html` at project root; the file uploaded to the Claude project is named `h3-operations-style-guide.html`; and neither name appeared at repo root in the Session S VS Code listing. Confirm the real path in the repo (it may live under `web/`, `docs/`, or `h3-website/`) and correct this reference once known.

## 11\. Change management for this document

- Update this document when a **durable practice changes** — not for sprint state (that's the Brief).  
    
- On a material change: bump the version, update the date, and note what changed.  
    
- Keep a committed copy at repo root so Claude Code loads it each session alongside CLAUDE.md.  
    
- The end-of-session standing instruction (§0) is the trigger to ask: "did anything this session earn a place in the standards?"

---

*v1.5 — July 20, 2026\. Added a §10 fact recording the Firestore Rules unit-test harness — a dedicated `firestore-tests/` directory (own `package.json` + vitest node-env config) that reads the real `firestore.rules` via `readFileSync` and runs against the emulator via `npm run test:rules` (`emulators:exec --only firestore`; Node 20 + Java; no `firebase login`). Cross-referenced from §7.2 as the concrete home for the required tenant-isolation Rules tests. Stood up alongside tightening the `calls` rule to server-write-only. No practice in §§0–9, 11 changed.*

*v1.4 — July 20, 2026\. §5 (feature-toggle architecture) graduated from PROPOSED to IN FORCE with its first implementation: the typed feature registry (§5.3A), the pure `resolveEnabledFeatures` resolver (§5.3B, unit-tested), and the first feature-gated route (§5.3C) — the Subscriber Dashboard `/dashboard`. Replaced §5's PROPOSED banner with an IN-FORCE note; updated the §0 status-markers note. §§6–7 remain proposals awaiting founder sign-off.*

*v1.3 — July 19, 2026\. Added two §10 environment facts from the ConversationRelay production-hardening session — (1) `@google/generative-ai` `generateContentStream()` teed-stream abort crash and the mandatory `.catch()` on `result.response` (key off your own abort flag, not the generic `"Error reading from the stream"`); (2) Cloud Run + Twilio signature validation reconstructing the signed URL from the `SERVICE_URL` constant, not `req.headers.host`, with byte-for-byte VoiceUrl reconciliation. Sections 5, 6, and the pyramid in 7 remain proposals awaiting founder sign-off; everything else codifies practices already in force.*

*v1.2 — July 11, 2026\. Added a §10 fact on Twilio `<Gather>` `speechTimeout` (fixed short value, not `"auto"`) with the Request-Inspector diagnosis method, from the Session S dead-air fix; flagged the §10 design-system filename as `[VERIFY]`. Sections 5, 6, and the pyramid in 7 remain proposals awaiting founder sign-off; everything else codifies practices already in force.*

*v1.1 — July 11, 2026\. Added two §10 environment facts (Firestore `fieldOverride` scope-completeness; `firebase functions:log` staleness → use Cloud Logging Explorer). Sections 5, 6, and the pyramid in 7 remain proposals awaiting founder sign-off; everything else codifies practices already in force.*

*v1.0 — July 8, 2026\. Initial version.*  
