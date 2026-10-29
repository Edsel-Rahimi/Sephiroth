/* ============================================================
   Sephiroth · v2.7 — minimal CSV toolkit (server-side)

   No external dependency by design: the panel's export/import
   round-trip needs exactly RFC-4180 quoting rules and nothing
   more. Handles quoted fields, escaped quotes (""), CRLF and
   BOM-prefixed files that Excel produces.
   ============================================================ */

/** Parse one CSV document into rows of string cells (header row included). */
export function parseCsv(input: string): string[][] {
  // strip UTF-8 BOM + normalize newlines
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    // skip fully-empty trailing lines
    if (row.length === 1 && row[0] === "" && field === "") {
      row = [];
      return;
    }
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

const needsQuote = (v: string) => /[",\n\r]/.test(v);

/** Serialize rows (including header) into an RFC-4180 CSV document. */
export function stringifyCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  const out = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell === null || cell === undefined ? "" : String(cell);
          return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\r\n");
  // BOM so Excel detects UTF-8 (Persian notes etc.)
  return `\uFEFF${out}\r\n`;
}
