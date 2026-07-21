/**
 * registry.ts — Feature registry: the single typed source of truth for every
 * feature flag in the H3 Operations web app (CODING_STANDARDS §5.3A).
 *
 * Each flag declares its key, a human description, whether it is on by default,
 * its scope (the axis that turns it on/off), and its lifecycle stage. This is a
 * compile-time constant for now; per §5.3A the *values* graduate to a Firestore
 * doc (config/features + accounts/{id}/config/features) when we need to flip a
 * flag WITHOUT a deploy — not needed while there is a single account.
 *
 * This module ONLY declares flags. Resolution (precedence across scopes) lives in
 * resolve.ts (§5.3B), which reads this registry. Keeping declaration and
 * resolution separate is deliberate — the resolver is pure and unit-tested (§7.2)
 * against whatever this registry contains.
 */

// Scope = the axis a flag's enablement is driven by (§5.2's two-dimensional model:
// feature availability vs. industry vertical).
export type FeatureScope = "global" | "plan" | "account" | "industry";

// Release lifecycle stage of the capability (§5.3A).
export type FeatureLifecycle = "in_development" | "beta" | "ga";

export interface FeatureDef {
  /** Stable flag key (snake_case) used everywhere downstream. */
  key: string;
  /** Human description — what the capability is. */
  description: string;
  /** On by default, before any industry/plan/account override (§5.3B step 1). */
  defaultEnabled: boolean;
  /** Which axis drives this flag on/off. */
  scope: FeatureScope;
  /** Release stage. */
  lifecycle: FeatureLifecycle;
}

/**
 * The registry. One entry per feature, keyed by flag key so the key can never
 * drift from its entry and lookups are O(1). `as const satisfies` locks the
 * literal types (so FeatureKey is exact) while still checking each entry's shape.
 */
export const FEATURE_REGISTRY = {
  subscriber_dashboard: {
    key: "subscriber_dashboard",
    description:
      "Subscriber Dashboard — the account's live calls list. First §5.3C feature-gated route.",
    defaultEnabled: true,
    // account-scoped: intended to be flipped per-account (concierge/beta) once
    // Firestore overrides are plumbed. Until then it resolves on its default.
    scope: "account",
    lifecycle: "beta",
  },
} as const satisfies Record<string, FeatureDef>;

/** Union of all registered flag keys — the type every consumer uses. */
export type FeatureKey = keyof typeof FEATURE_REGISTRY;

/** All registered keys as an array (for iteration in the resolver and tests). */
export const FEATURE_KEYS = Object.keys(FEATURE_REGISTRY) as FeatureKey[];
