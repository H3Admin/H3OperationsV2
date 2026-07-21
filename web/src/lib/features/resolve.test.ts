/**
 * resolve.test.ts — unit tests for resolveEnabledFeatures (§7.2: flag-resolution
 * precedence is pure and MUST be covered, because it gates what every user sees).
 *
 * Runner: vitest (pure unit tests only; no jsdom / component setup this slice).
 *   Run from web/:  npm run test
 */

import { describe, test, expect } from "vitest";
import { resolveEnabledFeatures, isFeatureEnabled } from "./resolve";
import { FEATURE_REGISTRY } from "./registry";

const baseCtx = { accountId: "acct_1" };

describe("resolveEnabledFeatures — global default (§5.3B step 1)", () => {
  test("returns registry defaults when no overrides are given", () => {
    const enabled = resolveEnabledFeatures(baseCtx);
    // subscriber_dashboard ships defaultEnabled: true.
    expect(enabled.has("subscriber_dashboard")).toBe(true);
  });

  test("a defaultEnabled:false flag is off with no overrides", () => {
    // Guard the invariant generically: every flag's presence == its default here.
    for (const key of Object.keys(FEATURE_REGISTRY) as Array<
      keyof typeof FEATURE_REGISTRY
    >) {
      expect(resolveEnabledFeatures(baseCtx).has(key)).toBe(
        FEATURE_REGISTRY[key].defaultEnabled,
      );
    }
  });
});

describe("resolveEnabledFeatures — precedence (§5.3B)", () => {
  test("account override turns a default-on flag OFF (highest precedence)", () => {
    const enabled = resolveEnabledFeatures({
      ...baseCtx,
      accountOverrides: { subscriber_dashboard: false },
    });
    expect(enabled.has("subscriber_dashboard")).toBe(false);
  });

  test("account override beats plan entitlement beats industry", () => {
    // industry says off, plan says on, account says off → account wins → off.
    const off = resolveEnabledFeatures({
      ...baseCtx,
      industryOverrides: { subscriber_dashboard: false },
      planEntitlements: { subscriber_dashboard: true },
      accountOverrides: { subscriber_dashboard: false },
    });
    expect(off.has("subscriber_dashboard")).toBe(false);

    // industry off, plan on, no account override → plan wins over industry → on.
    const on = resolveEnabledFeatures({
      ...baseCtx,
      industryOverrides: { subscriber_dashboard: false },
      planEntitlements: { subscriber_dashboard: true },
    });
    expect(on.has("subscriber_dashboard")).toBe(true);
  });

  test("industry override alone can turn a default-on flag off", () => {
    const enabled = resolveEnabledFeatures({
      ...baseCtx,
      industryOverrides: { subscriber_dashboard: false },
    });
    expect(enabled.has("subscriber_dashboard")).toBe(false);
  });

  test("an empty override object leaves the default intact (not treated as off)", () => {
    const enabled = resolveEnabledFeatures({ ...baseCtx, accountOverrides: {} });
    expect(enabled.has("subscriber_dashboard")).toBe(true);
  });
});

describe("resolveEnabledFeatures — shape", () => {
  test("always returns a Set, never null", () => {
    expect(resolveEnabledFeatures(baseCtx)).toBeInstanceOf(Set);
  });

  test("isFeatureEnabled mirrors the resolved set", () => {
    expect(isFeatureEnabled(baseCtx, "subscriber_dashboard")).toBe(true);
    expect(
      isFeatureEnabled(
        { ...baseCtx, accountOverrides: { subscriber_dashboard: false } },
        "subscriber_dashboard",
      ),
    ).toBe(false);
  });
});
