# H3 Operations — Founder Tasks (Guided)

**What this is:** the founder-side, outside-the-code work that only you can do — account setups, verifications, banking, compliance paperwork. These run *in parallel* to the build and don't need a Claude session. Keep this open for when a session limit hits: each task is a guided walkthrough, not just a checklist, so you can actually work it solo.

**Last updated:** July 28, 2026 (after Session AA). **Status of the money path:** EIN ✅ done → **Twilio business/toll-free verification → business bank account → Stripe** is the remaining chain to revenue.

**How to read each task:** *What it is · Why it matters · Before you start · Steps · What to expect · Gotchas.* Where a specific detail may have changed since this was written, it's marked `[VERIFY]` — confirm it in the actual UI rather than trusting the doc.

---

## ✅ DONE — EIN (Employer Identification Number)

You have this. It's the key that unlocks everything below — Twilio business verification, the bank account, and Stripe all need it. Keep the exact **legal entity name** ("H3 Operations LLC") and EIN digits somewhere handy; several tasks below require them to *match exactly*, character-for-character, or the verification bounces.

---

## Task 1 — Convert Twilio to a Business Profile (Trust Hub)

**Status: ✅ COMPLETE — Business Profile approved (as of the July 27 Brief).**

**What it is.** Your Twilio account console profile is currently set to "Individual." This task moves it to a verified **business** identity by creating a Primary Business Profile in Twilio's Trust Hub, using your EIN and legal entity. It's the foundation the toll-free verification (Task 2) sits on top of.

**Why it matters.** Carriers increasingly treat unregistered/individual senders as untrusted — higher filtering, throttling, and in some cases blocking. A verified business profile is also a prerequisite for toll-free messaging verification. Now that you have the EIN, there's no reason to stay on "Individual."

**Important scope note.** This (and Task 2) primarily governs **SMS/messaging**. Your **voice** pipeline — the Receptionist Agent answering inbound calls — is *not* gated by this and works today. So none of this blocks the current build. It becomes load-bearing the moment the product **sends texts** (appointment confirmations, "we got your message" replies, lead follow-up). Treat it as lead-time insurance, not an emergency.

**Before you start — have ready:**
- Legal business name, exactly as registered: **H3 Operations LLC**
- EIN
- Business address (the one associated with the LLC registration)
- Business website: `h3operations.com`
- Your role/title in the business

**Steps (Twilio Console):**
1. Sign in to the Twilio Console.
2. Navigate to **Trust Hub** (Console left nav → look under a "Trust Hub" or "Compliance" heading). `[VERIFY: exact nav label]`
3. Find **Customer Profiles** / **Business Profile** and start a **Primary Business Profile**.
4. Enter the business identity details — legal name, EIN, address, website, business type (you'll likely select a private, for-profit LLC). Match the legal name and EIN to your IRS paperwork **exactly**.
5. Add yourself as the authorized representative / point of contact.
6. Submit for review.

**What to expect.** Twilio (and its vetting partners) review the profile. It may be approved automatically or go to manual review; you'll get status via email and in Trust Hub. `[VERIFY: current turnaround — historically anywhere from near-instant to a few business days.]`

**Gotchas.**
- **Name mismatch is the #1 rejection cause.** "H3 Operations" vs "H3 Operations LLC" vs "H3 Operations, L.L.C." — use the exact string on your EIN letter.
- Do this **before** Task 2 — toll-free verification asks you to attach this profile.

---

## Task 2 — Verify the toll-free number for messaging

**Status: ✅ SUBMITTED — in review with Twilio (as of the July 27 Brief). Voice is
unaffected regardless; this gates SMS only.**

**What it is.** Formal verification of **+1 (877) 368-2008** for A2P (application-to-person) toll-free messaging. As of **February 17, 2026**, a **Business Registration Number (BRN) is mandatory** for all new toll-free verifications — and for a US business, **your EIN is the BRN**. It must match the legal business name on the profile from Task 1.

**Why it matters.** Unverified toll-free numbers get their messages increasingly filtered or blocked by carriers. If H3 is ever going to text customers, this number must be verified first — and verification isn't instant, so starting early avoids a launch-day scramble.

**Before you start — have ready:**
- Task 1 (Business Profile) submitted, ideally approved
- EIN (serves as the BRN), matching the legal name exactly
- The number's SID for reference: `PN542faea9bf06887e1250caf4bb27b349`
- **A documented opt-in process** — this is the part people underestimate. Twilio requires evidence of how customers *consent* to receive texts. For H3 that most likely means a **web form** where a customer checks a box / enters their number to opt in. You'll provide the URL or a screenshot. **If no such opt-in exists yet, that's a prerequisite to build** (this ties to Track A / the landing page — coordinate there).
- A clear **use-case description** and **sample messages** (e.g. "Appointment confirmations and service follow-ups for customers of home-service businesses using the H3 platform"). More specific = fewer rejections.
- Estimated monthly message volume (a rough band is fine)
- Privacy policy URL `[VERIFY: whether required for your use case]`

**Steps (Twilio Console):**
1. Console → **Numbers & senders** → **Numbers** → **Active numbers**. An unverified toll-free number shows a warning/notice.
2. Click **+1 877 368-2008**.
3. Go to the **Regulatory Information** tab.
4. Click **Verify this toll-free number**.
5. Select the Business Profile from Task 1, review details, continue to the messaging use case.
6. Fill in: use case, sample messages, opt-in type + evidence (the URL/screenshot), volume estimate, and the BRN (EIN).
7. Submit.

**What to expect.** A review period, then approval or rejection-with-reason. Rejections are usually about vague use-case text or insufficient opt-in evidence — both fixable and resubmittable from Trust Hub → Registrations → **Edit & resubmit**. `[VERIFY: current review turnaround — has historically ranged from days to a couple of weeks.]`

**Gotchas.**
- **The opt-in evidence is the most common blocker.** An email-signup form is *not* acceptable as SMS opt-in — it must be a phone-number opt-in with clear consent language. Build the real opt-in before submitting.
- Vague use-case summaries get rejected. Be concrete about what texts get sent and why.
- Voice keeps working regardless — this is purely about unlocking texting.

---

## Task 3 — Open a business bank account

**What it is.** A dedicated business checking account for **H3 Operations LLC**, separate from personal finances.

**Why it matters.** Two reasons: (1) it's the account Stripe (Task 4) will deposit revenue into, so it gates getting paid; (2) commingling personal and business funds undermines the liability protection the LLC exists to provide. This is basic entity hygiene.

**Before you start — have ready:**
- EIN letter (the IRS CP-575 or equivalent confirmation)
- LLC formation documents (Texas Certificate of Formation) and, if you have one, the operating agreement
- Personal ID
- Some banks want a business address and initial deposit

**Steps (general — varies by bank):**
1. Choose a bank. Options span traditional banks (in-person, established relationship) and business-focused online banks (faster online onboarding, often no/low fees). `[VERIFY: compare current fees, minimums, and features — this changes constantly and isn't something to take from this doc.]`
2. Start the business-account application (online or in branch).
3. Provide EIN, formation docs, and ID.
4. Fund the initial deposit if required.
5. Note the account and routing numbers once open — Stripe needs them.

**What to expect.** Online-first business banks can approve in anywhere from minutes to a few days; traditional banks may want an appointment. Verification of the EIN and formation docs is standard.

**Gotchas.**
- The business name on the account must match the LLC name Stripe and Twilio see — keep it consistent everywhere.
- Some banks distinguish "sole proprietor" vs "LLC" onboarding — you're an **LLC**; pick that path so the EIN is used, not your SSN.
- **This is not financial/legal advice** — for questions about account structure or tax handling, a CPA or attorney is the right call.

---

## Task 4 — Set up Stripe (accept payments)

**What it is.** A Stripe account for **H3 Operations LLC** so the platform can charge subscribers and route money to the business bank account from Task 3.

**Why it matters.** This is the literal revenue gate — no Stripe, no charging customers. It's the last link in the money chain. You can run **concierge / manual or free-pilot** onboarding *before* Stripe exists (which is the plan for early subscribers), but you **cannot collect payment** until this is live.

**Before you start — have ready:**
- EIN and legal entity details (matching everything above)
- Business bank account + routing numbers (Task 3)
- Business address, website (`h3operations.com`), and a description of what you sell
- Your personal details (Stripe verifies a responsible individual)

**Steps (high level):**
1. Create a Stripe account with your business email.
2. Complete the **business profile**: entity type (LLC), EIN, address, website, product description.
3. Add the **bank account** for payouts (Task 3's numbers).
4. Complete **identity verification** for yourself as the account representative.
5. Leave the technical integration (API keys, checkout, webhooks) for a **build session** — that's Track B work, not a founder task. When you get there, Stripe secret keys go in **Firebase Secret Manager**, never in client code or git (Security SOP S1), and every Stripe call routes through a Cloud Function (S2). Rate/cost caps (S4) apply before it's customer-facing.

**What to expect.** Stripe onboarding is mostly self-serve and can be completed quickly, but **payouts** are often held until identity + bank verification clear. `[VERIFY: current verification timing and any documentation Stripe requests.]`

**Gotchas.**
- **Don't wire Stripe into the app during a founder-tasks block** — account setup is founder work; the integration is a code session with security review. Keep them separate.
- Keep entity name/EIN identical to Twilio and the bank, or verification friction compounds.
- **Not financial advice** — pricing, tax, and payment-terms decisions are yours (with a CPA as needed).

---

## Task 5 (optional, console-only) — Configure the Firebase password-reset email

**What it is.** The password-reset email currently **doesn't send** (a known-broken item found in Session K). This is a Firebase Console configuration task — you can do it without a build session.

**Why it matters.** Auth can't really ship until users can recover passwords. Low urgency right now (you're the only user), but it's a clean solo task.

**Before you start:** access to the Firebase Console for `h3operations-prod`.

**Steps:**
1. Firebase Console → **Authentication** → **Templates** tab.
2. Find the **Password reset** template.
3. Confirm the sender address and customize the message. `[VERIFY: whether a custom sender domain needs verifying — the default firebaseapp.com sender usually works but may land in spam.]`
4. Check the **action URL** points at your app's reset route.
5. Save, then test end-to-end by triggering a reset for your own account.

**Alternative (no config needed):** you can always reset any password directly via Firebase Console → **Authentication** → **Users** → (user) → reset. Fine for now while you're the only user.

**Gotcha.** The e2e test of the reset flow is a tracked build item — configuring the template here is the founder half; verifying the app's reset route handles the link is the code half.

---

## Task 6 — Commercial insurance (get a quote now; buy at first outside user)

**What it is.** Basic commercial liability coverage for H3 Operations LLC — most likely a Tech E&O + General Liability bundle (often sold as a "Tech BOP"), the standard policy shape for a software/tech LLC.

**Why it matters.** The LLC is not a full substitute for insurance. The LLC shields your personal assets from the company's debts and liabilities — but it doesn't stop the company from being sued, and it doesn't cover a claim where you're personally accused of negligence, fraud, or an act outside the LLC's protection (the "piercing" risk). Insurance is what actually pays a legal defense or judgment; the entity structure alone doesn't.

**The trigger — earlier than "launch" sounds.** The moment anyone other than you interacts with the product — calls the (877) 368-2008 line, signs up on the website, or uses the dashboard, even as an unpaid beta/concierge customer — you've crossed from "building" into "operating a customer-facing product." That's the point most advisors say tech liability coverage starts earning its cost. Because the concierge onboarding plan means real people interact with the live system before Stripe/self-serve exists, this is closer than "pre-launch" implies. The live ConversationRelay phone line is already a third-party liability surface the moment it's used by someone outside your household.

**What doesn't require it yet.** The current state — no customers, no revenue, no employees, no physical storefront, no one entering a business-owned space (solo founder, home office, testing with yourself). Many insurers won't even want to underwrite yet without operating history or revenue. So this is not an emergency today.

**Recommended action now (the reason this task exists):** get one quote ahead of time. Don't wait until the first customer to start shopping — get a quote now so the decision is based on a real premium, not a guess. At this stage it's often ~$30–60/month, cheap enough that "wait until it's a problem" is a weak argument once you see the actual number. Then you can bind coverage the day the first outside user shows up, with no scramble.

**Before you start — have ready:**
- Legal entity name + EIN (H3 Operations LLC) — same exact string used everywhere else.
- Business address (Southlake, TX).
- A one-line description of what H3 does (AI receptionist / lead-capture software for home-service businesses).
- Rough answers on: any employees (no — contractors only for now), physical location (home office), expected revenue (pre-revenue).

**Steps:**
1. Get an online quote from one or more tech-focused insurers — Hiscox, Next Insurance, and Vouch all quote tech LLCs quickly online. `[VERIFY: current providers/pricing — get live quotes rather than trusting these names/numbers.]`
2. Note the premium and what's bundled (Tech E&O vs. General Liability vs. both).
3. File the quote; don't necessarily bind yet — the buy trigger is the first outside user.
4. Bind coverage when the first person outside your household uses the phone line, website, or dashboard (concierge beta counts).

**Related.** If you ever hire an actual employee (not a contractor), workers' comp becomes a legal requirement in most states — separate from this and triggered by headcount, not customers. And if you ever take on a lease or business-owned physical space, add commercial property coverage. Neither applies today.

**Not legal or insurance advice** — for coverage specifics and limits, a licensed commercial insurance broker is the right call.

---

## The dependency chain, at a glance

```
EIN ✅
 ├─→ Task 1: Twilio Business Profile ──→ Task 2: Toll-free verification (needs opt-in web form)
 └─→ Task 3: Business bank account ────→ Task 4: Stripe ──→ (build session: integration)
```

Task 6 (commercial insurance) is an **independent track** — gated on the first outside user (concierge beta counts), NOT on the EIN → bank → Stripe money chain — so it deliberately does not appear in the diagram above.

Tasks 1→2 and 3→4 are two independent tracks that both start from the EIN. Task 2 has a hidden prerequisite (a real SMS opt-in form) that touches Track A. Nothing here blocks the current Track B build — but Task 2 and Task 4 both have review/verification lead times, so **starting them early is free insurance** against a launch-day wait.

*Not legal or financial advice. For entity, tax, or compliance specifics, consult a qualified professional.*
