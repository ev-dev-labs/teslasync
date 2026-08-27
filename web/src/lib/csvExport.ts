/**
 * Pure-JS CSV utilities for client-side data export.
 *
 * RFC-4180 compliant: fields containing commas, quotes, or newlines are
 * wrapped in double quotes; embedded quotes are doubled. Numbers serialize
 * via String(); null/undefined become empty cells; objects and arrays are
 * JSON-stringified so structured columns survive round-trip.
 */

export type CsvCellValue = string | number | boolean | null | undefined | object;

export interface CsvColumn<T> {
  /** Stable column key — used as the header label by default and to look up
   *  values via `accessor` when no custom mapper is provided. */
  key: string;
  /** Optional human-readable header. Falls back to `key`. */
  header?: string;
  /** Optional value extractor. Defaults to `(row as Record<string, unknown>)[key]`. */
  accessor?: (row: T) => CsvCellValue;
}

/**
 * Escape a single CSV cell. Handles quotes, commas, CR/LF, leading whitespace.
 */
export function escapeCell(value: CsvCellValue): string {
  if (value === null || value === undefined) return '';

  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    str = String(value);
  } else {
    // Objects/arrays — JSON-encode so the cell remains parseable.
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }

  // Formula-looking strings are active content in spreadsheet applications.
  // Prefixing an apostrophe preserves the literal while preventing CSV
  // injection when an operator opens an exported support file in Excel.
  if (typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  // Quote if the field contains characters that would break naive parsers.
  // Also quote leading/trailing whitespace which Excel otherwise trims.
  if (/[",\r\n]/.test(str) || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize an array of rows to a CSV string with `columns` as the header.
 * The output uses CRLF line endings per RFC-4180 so it opens cleanly in Excel.
 */
export function toCSV<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header ?? c.key)).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const v = c.accessor
            ? c.accessor(row)
            : (row as unknown as Record<string, unknown>)[c.key];
          return escapeCell(v as CsvCellValue);
        })
        .join(','),
    )
    .join('\r\n');
  return body.length > 0 ? `${header}\r\n${body}` : header;
}

/**
 * Convert a list of plain objects to CSV. Keys are derived from the union of
 * all rows' keys, in insertion order from the first row that introduced them.
 * Useful for ad-hoc data shapes (e.g. chart series) where defining a `Column`
 * list would be redundant.
 */
export function objectsToCSV(rows: readonly Record<string, CsvCellValue>[]): string {
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  const cols: CsvColumn<Record<string, CsvCellValue>>[] = headers.map((k) => ({ key: k }));
  return toCSV(rows, cols);
}

/**
 * Trigger a browser download of the given CSV string. Adds a UTF-8 BOM so
 * Excel renders accented characters correctly. Filename gets `.csv` appended
 * if missing.
 *
 * No-op on non-browser environments.
 */
export function downloadCSV(filename: string, csv: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  const bom = '\ufeff';
  const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revocation so Safari has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Convenience: build CSV from rows + columns and immediately download.
 */
export function downloadRowsAsCSV<T>(
  filename: string,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): void {
  downloadCSV(filename, toCSV(rows, columns));
}

/**
 * Build a default filename like `"drives-2026-05-01"` for ad-hoc exports.
 */
export function defaultExportFilename(prefix: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${yyyy}-${mm}-${dd}`;
}
