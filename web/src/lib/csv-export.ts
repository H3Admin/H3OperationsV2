/**
 * csv-export.ts — client-side CSV generation and download for the Calls and
 * Leads list views. Generated from data already loaded via useCalls(); no
 * server round-trip. Hand-rolled escaping (the row shape is simple enough that
 * a CSV library would be pure overhead for v1).
 */

import { CALL_STATUS_LABELS, type Call } from "@/lib/calls-schema";
import { formatCaller, formatDuration, formatStartedAt } from "@/lib/calls-format";

// RFC 4180-style: quote a cell (doubling embedded quotes) whenever it contains
// a comma, quote, or newline.
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CALL_CSV_COLUMNS = ["Caller", "Started", "Duration", "Status", "New lead"] as const;

export function callsToCsv(calls: Call[]): string {
  const rows = calls.map((c) => [
    formatCaller(c.from),
    formatStartedAt(c.startedAt),
    formatDuration(c.durationSeconds),
    CALL_STATUS_LABELS[c.status] ?? c.status,
    c.isNewLead ? "Yes" : "No",
  ]);
  return [CALL_CSV_COLUMNS, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

// UTF-8 byte-order mark, prefixed onto the download so Excel (the most common
// opener) doesn't mangle non-ASCII characters. Built via fromCharCode rather
// than an embedded literal so the zero-width character isn't sitting invisibly
// in the source (and diffs) of this file.
const UTF8_BOM = String.fromCharCode(0xfeff);

// Triggers a browser download of the given CSV text.
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([UTF8_BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
