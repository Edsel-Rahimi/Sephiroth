/* ============================================================
   Sephiroth · v2.3 — Config Doctor shared types
   The server returns finding CODES + raw meta; the client
   localizes them (×6 languages) so tone stays consistent.
   ============================================================ */

export interface DoctorFinding {
  code: string;
  severity: "danger" | "warn" | "info";
  /** Raw values for the detail line (never localized). */
  meta: Record<string, string>;
}

export interface DoctorReport {
  score: number;
  grade: "A" | "B" | "C" | "D";
  counts: { danger: number; warn: number; info: number };
  scannedAt: string;
  findings: DoctorFinding[];
}
