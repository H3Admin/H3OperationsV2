/**
 * xlsx-export.ts — client-side .xlsx generation and download for the Calls
 * and Leads list views. Sibling to csv-export.ts: same shared rows from
 * call-export-rows.ts, same columns, same ordering — just a different
 * serialization. Uses SheetJS (xlsx) for workbook writing only; we never
 * parse untrusted files with it.
 */

// DECISION (2026-07): xlsx@0.18.5 carries two high-severity advisories
// (prototype pollution, ReDoS) that apply ONLY to the parse path. This module
// is write-only — workbooks are built from our own Firestore call data and no
// untrusted input is ever parsed — so the vulnerable vectors are unreachable.
// Accepted rather than pinning an older/forked build. If a future feature
// parses uploaded spreadsheets, this calculus changes: revisit then.

import * as XLSX from "xlsx";
import { buildCallExportRows, CALL_EXPORT_COLUMNS } from "@/lib/call-export-rows";
import type { Call } from "@/lib/calls-schema";

export function callsToXlsxWorkbook(calls: Call[]): XLSX.WorkBook {
  const rows = buildCallExportRows(calls);
  const sheet = XLSX.utils.aoa_to_sheet([[...CALL_EXPORT_COLUMNS], ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Calls");
  return workbook;
}

// Triggers a browser download of the given workbook as .xlsx.
export function downloadXlsx(filename: string, workbook: XLSX.WorkBook): void {
  XLSX.writeFile(workbook, filename);
}
