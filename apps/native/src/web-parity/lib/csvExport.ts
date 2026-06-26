/**
 * Pure-JS CSV utilities for client-side data export — React Native parity port
 * of `web/src/lib/csvExport.ts`.
 *
 * RFC-4180 compliant: fields containing commas, quotes, or newlines are
 * wrapped in double quotes; embedded quotes are doubled. Numbers serialize
 * via String(); null/undefined become empty cells; objects and arrays are
 * JSON-stringified so structured columns survive round-trip.
 *
 * ## Native adaptation
 *
 * Every serialization helper (`escapeCell`, `toCSV`, `objectsToCSV`,
 * `defaultExportFilename`) is pure string/number logic with no DOM dependency,
 * so it ports verbatim and behaves identically to the web original.
 *
 * The web `downloadCSV` / `downloadRowsAsCSV` helpers trigger a file download
 * through browser-only APIs — a UTF-8 `Blob`, `URL.createObjectURL`, and a
 * synthetic `<a download>` click appended to `document.body`. React Native has
 * none of those globals (its TypeScript config omits the DOM lib), and the web
 * source is itself documented as a "No-op on non-browser environments" — it
 * early-returns when `window`/`document` are `undefined`, which React Native
 * always is. We therefore keep the same public signatures but implement the
 * download as a native-safe no-op, exposing the prepared bytes via
 * {@link prepareCSVDownload} and the {@link CSV_DOWNLOAD_AVAILABLE} flag so a
 * caller can route them through a native share/file API instead.
 */

export type CsvCellValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | object;

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
export function toCSV<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): string {
  const header = columns.map(c => escapeCell(c.header ?? c.key)).join(',');
  const body = rows
    .map(row =>
      columns
        .map(c => {
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
export function objectsToCSV(
  rows: readonly Record<string, CsvCellValue>[],
): string {
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
  const cols: CsvColumn<Record<string, CsvCellValue>>[] = headers.map(k => ({
    key: k,
  }));
  return toCSV(rows, cols);
}

/**
 * UTF-8 byte-order mark prepended to downloaded CSV content so Excel renders
 * accented characters correctly (web parity).
 */
const UTF8_BOM = '\ufeff';

/**
 * Whether a real CSV file download can be performed in the current runtime.
 *
 * Always `false` on React Native: there is no DOM `document`, `Blob`, or
 * `URL.createObjectURL` to drive an `<a download>` click. The web original is
 * likewise a documented no-op outside a browser. Consumers can branch on this
 * to surface their own native "export prepared / download unavailable" UI.
 */
export const CSV_DOWNLOAD_AVAILABLE: boolean = false;

/**
 * The payload the web `downloadCSV` would have streamed into a `Blob`: the
 * `.csv`-normalized filename and the BOM-prefixed CSV body, plus the MIME type
 * and an availability flag. Computed natively so a caller can hand the bytes to
 * a platform share/file API even though the browser download path is absent.
 */
export interface PreparedCsvDownload {
  /** Filename with a `.csv` extension ensured (case-insensitive check). */
  filename: string;
  /** CSV string prefixed with a UTF-8 BOM. */
  content: string;
  /** MIME type the web `Blob` used. */
  mimeType: string;
  /** `false` on React Native — see {@link CSV_DOWNLOAD_AVAILABLE}. */
  available: boolean;
}

/**
 * Build the exact bytes the web download path would produce — the `.csv`
 * filename and UTF-8-BOM-prefixed content — without touching any DOM API.
 */
export function prepareCSVDownload(
  filename: string,
  csv: string,
): PreparedCsvDownload {
  const name = filename.toLowerCase().endsWith('.csv')
    ? filename
    : `${filename}.csv`;
  return {
    filename: name,
    content: `${UTF8_BOM}${csv}`,
    mimeType: 'text/csv;charset=utf-8;',
    available: CSV_DOWNLOAD_AVAILABLE,
  };
}

/**
 * Trigger a browser download of the given CSV string. On the web this adds a
 * UTF-8 BOM, creates a `Blob`/object URL, clicks a hidden `<a download>`, and
 * revokes the URL on the next tick.
 *
 * Native parity: React Native is a non-browser environment, so — exactly like
 * the web original's `typeof window/document === 'undefined'` guard — this is a
 * no-op. The would-be payload is still assembled via {@link prepareCSVDownload}
 * (preserving the filename + BOM logic); callers that need to deliver the file
 * should read that payload and route it through a native share/file API.
 */
export function downloadCSV(filename: string, csv: string): void {
  const prepared = prepareCSVDownload(filename, csv);
  if (!prepared.available) {
    // No DOM `Blob` / `URL.createObjectURL` / `<a download>` sink on React
    // Native — return without performing a download, mirroring the web source's
    // documented non-browser no-op.
    return;
  }
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
export function defaultExportFilename(
  prefix: string,
  date: Date = new Date(),
): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${yyyy}-${mm}-${dd}`;
}
