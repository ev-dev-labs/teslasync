// Native parity port of web/src/lib/export.ts.
//
// Web behaviour: builds server-side export URLs, serialises in-memory data
// arrays to CSV / JSON, then triggers a browser file download via a Blob +
// URL.createObjectURL + a synthetic `<a download>` click (downloadBlob, web
// L51-L60).
//
// Web -> native adaptation (conversion contract rule 7):
//   * buildExportUrl (web L8-L19) is a pure string builder and is ported
//     faithfully. `URLSearchParams` is kept to match the api/* parity ports;
//     the conditional `.set(...)` calls become `.append(...)` because the React
//     Native URLSearchParams TypeScript surface exposes `append` but not `set`,
//     and each key (format/start/end/vehicle_id) is written at most once, so the
//     serialised query string is byte-identical to the web output.
//   * The CSV / JSON serialisation (web L27-L41 / L47) is platform-agnostic and
//     ported verbatim: the empty-data early return, the column inference from
//     Object.keys(data[0]), the header join, the RFC-4180 quote escaping of any
//     value containing a comma / double-quote / newline, and the
//     JSON.stringify(data, null, 2) indentation are all preserved.
//   * The download itself (downloadBlob, web L51-L60: Blob /
//     URL.createObjectURL / document.createElement('a') / link.click /
//     body.appendChild / body.removeChild / URL.revokeObjectURL) is DOM-only and
//     has no equivalent in the current bare React Native dependency set (no
//     expo-file-system / expo-sharing / react-native-share is installed). It is
//     modelled as a pluggable FileDownloadSink. The default
//     nativeUnavailableDownloadSink reports an explicit
//     { downloaded: false, reason: 'unavailable' } state instead of silently
//     pretending to save — the honest parity of the web download side effect.
//     The serialised payload (content + filename + mimeType) is always returned
//     so a native screen or a future share/file-system transport can persist or
//     share it without re-deriving anything.

/** Build a server-side export URL with optional filters. Ported from web L8-L19. */
export function buildExportUrl(
  type: 'drives' | 'charging' | 'positions',
  format: 'csv' | 'json',
  filters?: {start?: string; end?: string; vehicleId?: number | string},
): string {
  const params = new URLSearchParams({format});
  if (filters?.start) {
    params.append('start', filters.start);
  }
  if (filters?.end) {
    params.append('end', filters.end);
  }
  if (filters?.vehicleId) {
    params.append('vehicle_id', String(filters.vehicleId));
  }
  return `/api/v1/export/${type}?${params.toString()}`;
}

/** A column projection for CSV export (web L25: `{ key: keyof T; label: string }`). */
export interface ExportColumn<T> {
  key: keyof T;
  label: string;
}

/** Descriptor of a file the web version would have downloaded via downloadBlob. */
export interface DownloadPayload {
  content: string;
  filename: string;
  mimeType: string;
}

/** Outcome of attempting to deliver a {@link DownloadPayload} through a sink. */
export interface DownloadOutcome {
  downloaded: boolean;
  /** 'unavailable' = no native download transport; 'empty' = nothing to export. */
  reason?: 'unavailable' | 'empty';
}

/** Result of an export call: the serialised payload (or null) plus the sink outcome. */
export interface ExportResult {
  payload: DownloadPayload | null;
  outcome: DownloadOutcome;
}

/**
 * Pluggable side-effect target — the native analogue of web's
 * Blob + URL.createObjectURL + `<a download>`.click() pipeline (downloadBlob,
 * web L51-L60). Receives the serialised payload and reports whether it could
 * deliver it.
 */
export type FileDownloadSink = (payload: DownloadPayload) => DownloadOutcome;

/**
 * Default native sink: bare React Native ships no Blob / URL.createObjectURL /
 * anchor-download pipeline, so delivery is explicitly unavailable. Mirrors the
 * web download side effect with an honest unavailable state rather than a silent
 * no-op so callers can surface a real "not supported here" message.
 */
export const nativeUnavailableDownloadSink: FileDownloadSink = () => ({
  downloaded: false,
  reason: 'unavailable',
});

/**
 * Serialise an array of objects to a CSV string, or `null` for empty input.
 * Ported verbatim from the body of web exportAsCSV (L27-L41): same empty-data
 * guard, same column inference, same header join, and the same RFC-4180
 * escaping of values containing a comma / double-quote / newline.
 */
export function serializeCSV<T extends Record<string, unknown>>(
  data: T[],
  columns?: ExportColumn<T>[],
): string | null {
  if (!data.length) {
    return null;
  }

  const cols =
    columns ??
    Object.keys(data[0]).map(key => ({key: key as keyof T, label: String(key)}));
  const header = cols.map(c => c.label).join(',');
  const rows = data.map(row =>
    cols
      .map(c => {
        const val = row[c.key];
        if (val === null || val === undefined) {
          return '';
        }
        if (
          typeof val === 'string' &&
          (val.includes(',') || val.includes('"') || val.includes('\n'))
        ) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val);
      })
      .join(','),
  );
  return [header, ...rows].join('\n');
}

/**
 * Export an array of objects as a CSV file download. Native parity of web
 * exportAsCSV (L22-L43): serialises with {@link serializeCSV} and routes the
 * payload through a {@link FileDownloadSink}. Empty data is a no-op
 * ({ downloaded: false, reason: 'empty' }, payload null) exactly like web's
 * `if (!data.length) return`. The CSV mime type matches web L42.
 */
export function exportAsCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  columns?: ExportColumn<T>[],
  sink: FileDownloadSink = nativeUnavailableDownloadSink,
): ExportResult {
  const csv = serializeCSV(data, columns);
  if (csv === null) {
    return {payload: null, outcome: {downloaded: false, reason: 'empty'}};
  }
  const payload: DownloadPayload = {
    content: csv,
    filename,
    mimeType: 'text/csv;charset=utf-8;',
  };
  return {payload, outcome: sink(payload)};
}

/**
 * Export an array of objects as a JSON file download. Native parity of web
 * exportAsJSON (L46-L49): `JSON.stringify(data, null, 2)` then routes the
 * payload through a {@link FileDownloadSink}. The JSON mime type matches web
 * L48.
 */
export function exportAsJSON<T>(
  data: T[],
  filename: string,
  sink: FileDownloadSink = nativeUnavailableDownloadSink,
): ExportResult {
  const json = JSON.stringify(data, null, 2);
  const payload: DownloadPayload = {
    content: json,
    filename,
    mimeType: 'application/json',
  };
  return {payload, outcome: sink(payload)};
}
