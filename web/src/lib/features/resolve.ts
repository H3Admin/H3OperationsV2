/**
 * resolve.ts — resolveEnabledFeatures: the ONE pure function that computes the
 * effective set of enabled feature flags for an account (CODING_STANDARDS §5.3B).
 *
 * Precedence, applied per flag in a fixed order, each layer overriding the last:
 *
 *   global default  →  industry applicability  →  plan entitlement  →  account override
 *
 * Pure and dependency-free (no Firestore, no auth SDK) so it is trivially
 * unit-testable (§7.2) — the caller passes an AccountContext assembled from the
 * auth claims / account config. Everything downstream (the /dashboard route gate
 * today, the nav shell later) reads this ONE result; no consumer re-derives
 * enablement on its own.
 *
 * Reads the flag catalogue from registry.ts; it does not declare flags itself.
 */

import { FEATURE_REGISTRY, FEATURE_KEYS, type FeatureKey } from "./registry";

/**
 * The inputs enablement is resolved against. Only accountId is required — a
 * brand-new account with nothing else resolves purely on registry defaults.
 * Today the auth claims carry accountId + role; plan / industry / overrides are
 * plumbed later (§5.3A/D), so the resolver already handles them but current
 * callers pass little.
 */
export interface AccountContext {
  accountId: string;
  /** Membership role (owner|admin|member). Not used for gating yet; carried for future rules. */
  role?: string;
  /** Plan tier, when plan entitlements exist. */
  plan?: string;
  /** Industry vertical (§5.3D), when vertical config exists. */
  industry?: string;
  /**
   * Flags this account's industry forces on/off (§5.3D). Applied before plan and
   * account layers. Absent = no industry effect.
   */
  industryOverrides?: Partial<Record<FeatureKey, boolean>>;
  /**
   * Flags this account's plan grants/withholds. Applied after industry, before
   * account overrides. Absent = no plan effect.
   */
  planEntitlements?: Partial<Record<FeatureKey, boolean>>;
  /**
   * Per-flag overrides for THIS account — the concierge/beta lever (§5.3A) and the
   * HIGHEST-precedence layer: an explicit true/false here wins over everything.
   */
  accountOverrides?: Partial<Record<FeatureKey, boolean>>;
}

/**
 * Compute the set of enabled feature keys for an account context.
 *
 * @param ctx the account's resolution inputs
 * @returns a Set of enabled FeatureKeys (never null; empty if nothing is on)
 */
export function resolveEnabledFeatures(ctx: AccountContext): Set<FeatureKey> {
  const enabled = new Set<FeatureKey>();

  // Override layers in ASCENDING precedence (each later one wins). The global
  // default is the starting value below; these three stack on top of it in the
  // §5.3B order.
  const layers = [ctx.industryOverrides, ctx.planEntitlements, ctx.accountOverrides];

  for (const key of FEATURE_KEYS) {
    // Explicit boolean: defaultEnabled narrows to a literal under `as const`, and
    // we reassign a general boolean from the override layers below.
    let on: boolean = FEATURE_REGISTRY[key].defaultEnabled; // 1. global default
    for (const layer of layers) {
      // Only a layer that explicitly carries a boolean for this key overrides —
      // an absent key (or a non-boolean) leaves the prior layer's value intact.
      if (layer && typeof layer[key] === "boolean") on = layer[key] as boolean;
    }
    if (on) enabled.add(key);
  }

  return enabled;
}

/** Convenience: is a single flag enabled for this context? */
export function isFeatureEnabled(ctx: AccountContext, key: FeatureKey): boolean {
  return resolveEnabledFeatures(ctx).has(key);
}
