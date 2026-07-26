/**
 * call-export-rows.test.ts — unit tests for buildCallExportRows, the row
 * shape shared by csv-export.ts and xlsx-export.ts. Covering this once here
 * is what guarantees the two export formats can't drift apart (see module
 * header in call-export-rows.ts).
 *
 * Runner: vitest. Run from web/: npm run test
 */

import { describe, test, expect } from "vitest";
import { buildCallExportRows, CALL_EXPORT_COLUMNS } from "./call-export-rows";
import type { Call } from "./calls-schema";

function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    id: "CA1",
    callSid: "CA1",
    accountId: "acct_1",
    from: "+12145550123",
    to: "+18005551234",
    direction: "inbound",
    status: "completed",
    isNewLead: true,
    durationSeconds: 125,
    turns: [],
    startedAt: { toDate: () => new Date("2026-07-01T12:00:00Z") },
    endedAt: { toDate: () => new Date("2026-07-01T12:02:05Z") },
    ...overrides,
  };
}

describe("CALL_EXPORT_COLUMNS", () => {
  test("header order matches Caller, Started, Duration, Status, New lead", () => {
    expect(CALL_EXPORT_COLUMNS).toEqual([
      "Caller",
      "Started",
      "Duration",
      "Status",
      "New lead",
    ]);
  });
});

describe("buildCallExportRows", () => {
  test("empty input yields no rows", () => {
    expect(buildCallExportRows([])).toEqual([]);
  });

  test("one row per call, same order as input, one cell per column", () => {
    const calls = [
      makeCall({ id: "CA1", isNewLead: true, status: "completed" }),
      makeCall({ id: "CA2", isNewLead: false, status: "no_answer" }),
    ];
    const rows = buildCallExportRows(calls);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(CALL_EXPORT_COLUMNS.length);
    expect(rows[1]).toHaveLength(CALL_EXPORT_COLUMNS.length);
  });

  test("formats caller, status label, and new-lead flag per cell", () => {
    const [row] = buildCallExportRows([
      makeCall({ from: "+12145550123", status: "no_answer", isNewLead: true }),
    ]);
    expect(row[0]).toBe("(214) 555-0123");
    expect(row[3]).toBe("No answer");
    expect(row[4]).toBe("Yes");
  });

  test("isNewLead false renders 'No'", () => {
    const [row] = buildCallExportRows([makeCall({ isNewLead: false })]);
    expect(row[4]).toBe("No");
  });
});
