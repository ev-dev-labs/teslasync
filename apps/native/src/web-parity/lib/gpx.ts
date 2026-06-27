// Native parity port of web/src/lib/gpx.ts.
//
// PURPOSE (web, source L1-42): a single helper, exportDriveAsGPX(drive,
// positions, vehicleName), that (a) serializes a drive + its position samples
// into a GPX 1.1 XML document (source L5-31) and (b) hands that document to the
// user as a file download (source L33-41 — Blob + URL.createObjectURL + a
// dynamically created <a download> anchor that is clicked then removed). The
// XML carries drive metadata (vehicle name + formatted date, distance/duration
// description, start time) and one <trkpt> per position with lat/lon, elevation,
// timestamp, and speed/battery/power extensions. Positions missing latitude OR
// longitude are filtered out (source L19).
//
// NATIVE ADAPTATION (contract rule 7 — browser-only behavior made native-safe):
//   • The XML SERIALIZATION (source L5-31, L37 filename) is 100% portable — it is
//     pure string + Date + Math + Intl work — and is ported VERBATIM into the
//     `buildDriveGpx` / `driveGpxFilename` pure helpers: every literal, the exact
//     indentation/newlines of the GPX template, the truthy lat/lon filter, the
//     `|| 0` fallbacks, `Math.round(duration_min)`, and the `.toISOString()`
//     timestamps are byte-for-byte identical to the web original.
//   • The FILE DOWNLOAD (source L33-41) is browser-only: Blob, URL.createObjectURL,
//     document.createElement('a'), a.download, a.click(), and document.body
//     mutation have NO React Native equivalent, and no file-system / sharing
//     dependency (expo-file-system, expo-sharing, react-native-share) is installed
//     in apps/native. The closest available native primitive is React Native's
//     built-in `Share` API (the OS share sheet), which lets the user route the GPX
//     payload to Files / mail / AirDrop / etc. — the native analog of "save this
//     file". The web `a.download` filename is surfaced as the share title / iOS
//     subject / Android dialog title so the GPX filename intent survives.
//     `exportDriveAsGPX` therefore becomes async (Share is promise-based) and
//     returns a structured `GpxExportResult` carrying the built `gpx` + `filename`
//     plus the delivery outcome. When the share sheet is dismissed the result is
//     `action: 'dismissed'`; when Share is unavailable / throws the result is the
//     EXPLICIT unavailable state `action: 'unavailable'` with `unavailableReason`
//     (contract rule 7) instead of the silent browser side effect.
//   • IMPORTS REMAP: the web file imports `formatDate` (./dateFormat) and
//     `fmtNumber` (./numberFormat). Those two parity siblings are NOT ported to
//     apps/native/src/web-parity/lib yet, and pre-creating them here would collide
//     with their own file-by-file conversion slots. The two helpers are therefore
//     inlined as module-private functions that reproduce the web logic the gpx
//     call sites exercise EXACTLY: `formatDate(start_date)` → the default
//     locale/timezone "Apr 4, 2026" path (dateFormat L65-72) with the universal
//     "—" fallback, and `fmtNumber(distance, 1)` → `safeNumber(v)` (numberFormat
//     L32-34) formatted at the explicit precision with the default global locale
//     'en-US' (numberFormat L50-65). The web `fmtNumber` global-precision /
//     global-locale mutability and the bad-locale try/catch fallback are
//     responsibilities of the future numberFormat parity module — the gpx call
//     always passes an explicit precision and never overrides the locale, so the
//     inline is output-identical for this file's usage. `getErrorMessage` is
//     reused from the already-ported ./errorMessage parity sibling.
//
// No DOM, window, Blob, URL, document, Recharts, Leaflet, or web-UI symbol reaches
// this native output. The only platform import is the React Native `Share`
// primitive (contract rule 5). The mechanical differences from the source are the
// native formatting conventions applied by prettier/eslint (semicolons +
// arrowParens:'avoid') and `Number.isNaN` / `Number.isFinite` in place of the
// global `isNaN` / `isFinite` — behavior and emitted GPX are identical.

import {Share} from 'react-native';

import {getErrorMessage} from './errorMessage';

/** Drive fields read by the GPX serializer (web source L11-16, L37). */
export interface GpxDrive {
  id: number | string;
  start_date: string;
  distance: number;
  duration_min: number;
}

/** Position-sample fields read per <trkpt> (web source L19-26). */
export interface GpxPosition {
  latitude?: number | null;
  longitude?: number | null;
  elevation?: number | null;
  created_at: string;
  speed?: number | null;
  battery_level?: number | null;
  power?: number | null;
}

/**
 * Outcome of `exportDriveAsGPX`. The web function returned `void` and relied on
 * the browser's forced download; the native port returns the built artifact plus
 * the share-sheet delivery result so callers (and tests) have an explicit, non
 * black-box outcome — including the `unavailable` state required by contract
 * rule 7 when no native share target exists.
 */
export interface GpxExportResult {
  /** Suggested filename: teslasync-drive-{id}-{YYYY-MM-DD}.gpx (web source L37). */
  filename: string;
  /** The serialized GPX 1.1 document (web source L5-31). */
  gpx: string;
  /** True when the OS share sheet reported the payload was shared. */
  delivered: boolean;
  /** Delivery outcome: shared, dismissed by the user, or no share target. */
  action: 'shared' | 'dismissed' | 'unavailable';
  /** Populated only when `action === 'unavailable'`. */
  unavailableReason?: string;
}

// ───────────────── inlined ./dateFormat + ./numberFormat parity ─────────────────
// Temporary module-private copies of the only two helpers the web gpx file uses,
// reproducing the web behavior the gpx call sites exercise (see header). They are
// replaced by imports from the ./dateFormat and ./numberFormat parity siblings
// once those files are ported.

/** numberFormat.ts L32-34 — finite number, else 0. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * numberFormat.ts L50-65 for the gpx call `fmtNumber(distance, 1)`: locale-aware
 * separators at an explicit precision using the default global locale 'en-US'.
 */
function fmtNumber(v: unknown, decimals: number): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * dateFormat.ts L65-72 for the gpx call `formatDate(start_date)`: date-only
 * "Apr 4, 2026" in the host locale/timezone, with the universal "—" placeholder
 * for nullish / unparseable input.
 */
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ──────────────────────────── pure serializers ────────────────────────────

/**
 * Serialize a drive + its position samples into a GPX 1.1 document. Pure (no
 * side effects) and a byte-for-byte port of web source L5-31, including the exact
 * template indentation, the truthy `latitude && longitude` filter, and the `|| 0`
 * fallbacks. Note (parity with the source): an invalid `start_date` / `created_at`
 * makes `new Date(...).toISOString()` throw "Invalid time value" exactly as on the
 * web — callers pass validated drives.
 */
export function buildDriveGpx(
  drive: GpxDrive,
  positions: GpxPosition[],
  vehicleName: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TeslaSync"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${vehicleName} - ${formatDate(drive.start_date)}</name>
    <desc>Drive exported from TeslaSync. Distance: ${fmtNumber(drive.distance, 1)} km, Duration: ${Math.round(drive.duration_min)} min</desc>
    <time>${new Date(drive.start_date).toISOString()}</time>
  </metadata>
  <trk>
    <name>Drive ${drive.id}</name>
    <trkseg>
${positions
  .filter(p => p.latitude && p.longitude)
  .map(
    p => `      <trkpt lat="${p.latitude}" lon="${p.longitude}">
        <ele>${p.elevation || 0}</ele>
        <time>${new Date(p.created_at).toISOString()}</time>
        <extensions>
          <speed>${p.speed || 0}</speed>
          <battery>${p.battery_level || 0}</battery>
          <power>${p.power || 0}</power>
        </extensions>
      </trkpt>`,
  )
  .join('\n')}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Build the download filename (web source L37):
 * `teslasync-drive-{id}-{YYYY-MM-DD}.gpx`.
 */
export function driveGpxFilename(drive: GpxDrive): string {
  return `teslasync-drive-${drive.id}-${new Date(drive.start_date)
    .toISOString()
    .slice(0, 10)}.gpx`;
}

// ───────────────────────────── native delivery ─────────────────────────────

/**
 * Export a drive as GPX. Builds the document (web source L5-31) and the filename
 * (web source L37), then delivers it through the OS share sheet — the React
 * Native analog of the browser file download (web source L33-41), which has no
 * native equivalent and no installed file/sharing dependency. The filename is
 * surfaced as the share title / subject / dialog title.
 *
 * Returns a `GpxExportResult` describing the built artifact and the delivery
 * outcome, including the explicit `unavailable` state (contract rule 7) when no
 * share target is available or `Share` rejects.
 */
export async function exportDriveAsGPX(
  drive: GpxDrive,
  positions: GpxPosition[],
  vehicleName: string,
): Promise<GpxExportResult> {
  const gpx = buildDriveGpx(drive, positions, vehicleName);
  const filename = driveGpxFilename(drive);

  try {
    const result = await Share.share(
      {title: filename, message: gpx},
      {subject: filename, dialogTitle: filename},
    );
    const shared = result.action === 'sharedAction';
    return {
      filename,
      gpx,
      delivered: shared,
      action: shared ? 'shared' : 'dismissed',
    };
  } catch (err) {
    return {
      filename,
      gpx,
      delivered: false,
      action: 'unavailable',
      unavailableReason: getErrorMessage(err),
    };
  }
}
