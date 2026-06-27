// Native parity port of web/src/lib/report.ts.
//
// PURPOSE (web, source L1-95): two helpers that build a printable HTML report
// and hand it to the browser's print dialog —
//   • generateDriveReport(drive, vehicle)  (source L4-57): a single-drive report
//     with a four-tile stat strip (distance / duration / max speed / battery
//     delta) and a details table (start/end time, distance, duration h/m,
//     average speed, max speed, battery used, start/end range), wrapped in an
//     inline-styled print stylesheet and a generated-at footer.
//   • generateMonthlyReport(stats, vehicles)  (source L59-95): a fleet monthly
//     summary table (total vehicles / distance / drives / energy / cost / avg
//     efficiency) with the same footer.
// Both follow the identical browser recipe: window.open('', '_blank') (source
// L5, L60), bail out if the popup was blocked (source L6, L61),
// document.write(<full html document>) (source L8-54, L63-92),
// document.close() (source L55, L93), then window.print() (source L56, L94).
//
// NATIVE ADAPTATION (contract rule 7 — browser-only behavior made native-safe):
//   • The HTML SERIALIZATION (source L8-54, L63-92) is 100% portable — it is
//     pure string + Date + Math + Intl work — and is ported VERBATIM into the
//     `buildDriveReportHtml` / `buildMonthlyReportHtml` pure helpers: every
//     literal, the exact indentation/newlines of the document template, the
//     inline <style> block, the `!= null` / `??` / `|| 0` / `|| 1` fallbacks,
//     the `Math.round` / `Math.floor` arithmetic, and the `· ${new
//     Date().toLocaleString()}` footer are byte-for-byte identical to the web
//     original. The legacy unit-suffixed field names the web report reads
//     (`duration_min`, `speed_max`, `start_range_km`, `end_range_km`,
//     `total_distance_km`, `total_energy_kwh`, `avg_efficiency_wh_km`) are
//     PRESERVED verbatim for data-shape parity with the web API — this is a
//     faithful port of existing fields, NOT new SI-suffixed model fields.
//   • The DELIVERY (source L5-6, L55-56, L60-61, L93-94) is browser-only:
//     window.open, document.write, document.close, and window.print have NO
//     React Native equivalent, and no print / file / sharing dependency
//     (expo-print, react-native-print, expo-sharing, react-native-share) is
//     installed in apps/native. The closest available native primitive is React
//     Native's built-in `Share` API (the OS share sheet) — the same analog the
//     already-ported gpx parity sibling uses — which lets the user route the
//     report HTML to Files / mail / a printer app / etc., the native stand-in
//     for "print this document". The web document `<title>` (source L12, L67)
//     is surfaced as the share title / iOS subject / Android dialog title so the
//     document-name intent survives. The two helpers therefore become async
//     (Share is promise-based) and return a structured `ReportResult` carrying
//     the built `html` + `title` plus the delivery outcome. The web's
//     popup-blocked early return (`if (!printWindow) return`, source L6/L61)
//     maps to the EXPLICIT unavailable state `action: 'unavailable'` (contract
//     rule 7): when `Share` is unavailable / throws (no share target) the result
//     is `action: 'unavailable'` with `unavailableReason` instead of a silent
//     no-op, and a dismissed share sheet maps to `action: 'dismissed'`.
//   • IMPORTS: the web file imports `fmtNumber` (./numberFormat) and
//     `formatDate` + `formatDateTime` (./dateFormat). `./numberFormat` is
//     ALREADY ported to this web-parity/lib directory and exports `fmtNumber`
//     with the identical signature/globals, so it is imported directly (source
//     L2 preserved). `./dateFormat` is NOT ported yet and pre-creating it here
//     would collide with its own file-by-file conversion slot, so the two
//     date helpers the report exercises are inlined as module-private functions
//     that reproduce the web logic EXACTLY: `formatDate` → dateFormat L65-72
//     (date-only "Apr 4, 2026", host locale/timezone, "—" nullish/unparseable
//     fallback) and `formatDateTime` → dateFormat L54-62 (date + "2-digit"
//     time, same fallback). They are replaced by imports from the ./dateFormat
//     parity sibling once it is ported. `getErrorMessage` is reused from the
//     already-ported ./errorMessage parity sibling for the unavailable reason.
//
// No DOM, window, document, Recharts, Leaflet, or web-UI symbol reaches this
// native output. The only platform import is the React Native `Share` primitive
// (contract rule 5). The mechanical differences from the source are the native
// formatting conventions applied by prettier/eslint (semicolons +
// arrowParens:'avoid') and `Number.isNaN` in place of the global `isNaN` in the
// inlined date helpers — behavior and emitted HTML are identical.

import {Share} from 'react-native';

import {getErrorMessage} from './errorMessage';
import {fmtNumber} from './numberFormat';

/** Drive fields read by the report serializer (web source L12, L29-48). */
export interface ReportDrive {
  start_date: string;
  end_date?: string | null;
  distance?: number | null;
  duration_min?: number | null;
  speed_max?: number | null;
  start_battery_level?: number | null;
  end_battery_level?: number | null;
  start_range_km?: number | null;
  end_range_km?: number | null;
}

/** Vehicle field read for the drive-report header (web source L29). */
export interface ReportVehicle {
  display_name?: string | null;
}

/** Fleet aggregate fields read by the monthly report (web source L83-87). */
export interface ReportStats {
  total_distance_km?: number | null;
  total_drives?: number | null;
  total_energy_kwh?: number | null;
  total_cost?: number | null;
  avg_efficiency_wh_km?: number | null;
}

/**
 * Outcome of `generateDriveReport` / `generateMonthlyReport`. The web functions
 * returned `void` and relied on the browser print dialog; the native port
 * returns the built document plus the share-sheet delivery result so callers
 * (and tests) have an explicit, non black-box outcome — including the
 * `unavailable` state required by contract rule 7 when no native share target
 * exists (the analog of the web popup-blocked early return, source L6/L61).
 */
export interface ReportResult {
  /** Document title — the web `<title>` (web source L12, L67). */
  title: string;
  /** The serialized HTML report document (web source L8-54, L63-92). */
  html: string;
  /** True when the OS share sheet reported the document was shared. */
  delivered: boolean;
  /** Delivery outcome: shared, dismissed by the user, or no share target. */
  action: 'shared' | 'dismissed' | 'unavailable';
  /** Populated only when `action === 'unavailable'`. */
  unavailableReason?: string;
}

// ───────────────── inlined ./dateFormat parity ─────────────────
// Temporary module-private copies of the only two date helpers the web report
// uses, reproducing the web behavior its call sites exercise (see header). They
// are replaced by imports from the ./dateFormat parity sibling once it is
// ported. The universal "—" placeholder and the host locale/timezone default
// (no FormatOptions are ever passed by the report) match dateFormat exactly.

/** dateFormat.ts L65-72 — date-only "Apr 4, 2026" in the host locale/timezone. */
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

/** dateFormat.ts L54-62 — date + time "Apr 4, 2026, 2:30 AM" in the host zone. */
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ──────────────────────────── pure serializers ────────────────────────────

/**
 * Serialize a single drive into the printable HTML report document. Pure (no
 * side effects) and a byte-for-byte port of web source L8-54, including the
 * inline print stylesheet, the four-tile stat strip, the details table, the
 * `!= null` / `??` / `|| 0` / `|| 1` fallbacks, and the generated-at footer.
 */
export function buildDriveReportHtml(
  drive: ReportDrive,
  vehicle: ReportVehicle | null | undefined,
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Drive Report - ${formatDate(drive.start_date)}</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 40px; color: #1a1a2e; }
        h1 { color: #0077b6; border-bottom: 2px solid #0077b6; padding-bottom: 8px; }
        h2 { color: #059669; margin-top: 24px; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th { background: #f3f4f6; text-align: left; padding: 8px 12px; font-size: 12px; text-transform: uppercase; }
        td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
        .stat { display: inline-block; width: 23%; text-align: center; margin: 8px 1%; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; }
        .stat-value { font-size: 24px; font-weight: 700; color: #0077b6; }
        .stat-label { font-size: 11px; color: #6b7280; margin-top: 4px; }
        .footer { margin-top: 40px; text-align: center; color: #9ca3af; font-size: 11px; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <h1>TeslaSync — Drive Report</h1>
      <p><strong>Vehicle:</strong> ${vehicle?.display_name || 'N/A'} | <strong>Date:</strong> ${formatDateTime(drive.start_date)}</p>

      <div>
        <div class="stat"><div class="stat-value">${drive.distance != null ? fmtNumber(drive.distance, 1) : '—'}</div><div class="stat-label">km Distance</div></div>
        <div class="stat"><div class="stat-value">${Math.round(drive.duration_min || 0)}</div><div class="stat-label">min Duration</div></div>
        <div class="stat"><div class="stat-value">${drive.speed_max != null ? fmtNumber(drive.speed_max, 0) : '—'}</div><div class="stat-label">km/h Max Speed</div></div>
        <div class="stat"><div class="stat-value">${drive.start_battery_level ?? '?'}→${drive.end_battery_level ?? '?'}</div><div class="stat-label">% Battery</div></div>
      </div>

      <h2>Details</h2>
      <table>
        <tr><td>Start Time</td><td>${formatDateTime(drive.start_date)}</td></tr>
        <tr><td>End Time</td><td>${drive.end_date ? formatDateTime(drive.end_date) : 'In progress'}</td></tr>
        <tr><td>Distance</td><td>${fmtNumber(drive.distance, 1)} km</td></tr>
        <tr><td>Duration</td><td>${Math.floor((drive.duration_min || 0) / 60)}h ${Math.round((drive.duration_min || 0) % 60)}m</td></tr>
        <tr><td>Average Speed</td><td>${fmtNumber((drive.distance || 0) / ((drive.duration_min || 1) / 60), 0)} km/h</td></tr>
        <tr><td>Max Speed</td><td>${drive.speed_max != null ? fmtNumber(drive.speed_max, 0) : '—'} km/h</td></tr>
        <tr><td>Battery Used</td><td>${(drive.start_battery_level || 0) - (drive.end_battery_level || 0)}%</td></tr>
        <tr><td>Start Range</td><td>${drive.start_range_km != null ? fmtNumber(drive.start_range_km, 0) : '—'} km</td></tr>
        <tr><td>End Range</td><td>${drive.end_range_km != null ? fmtNumber(drive.end_range_km, 0) : '—'} km</td></tr>
      </table>

      <div class="footer">Generated by TeslaSync · ${new Date().toLocaleString()}</div>
    </body>
    </html>
  `;
}

/**
 * Serialize the fleet monthly summary into a printable HTML report document.
 * Pure (no side effects) and a byte-for-byte port of web source L63-92,
 * including the metric table and the `?.length || 0` / `|| 0` fallbacks.
 */
export function buildMonthlyReportHtml(
  stats: ReportStats | null | undefined,
  vehicles: ReportVehicle[] | null | undefined,
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>TeslaSync Monthly Report</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 40px; color: #1a1a2e; }
        h1 { color: #0077b6; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th { background: #f3f4f6; text-align: left; padding: 8px; font-size: 12px; text-transform: uppercase; }
        td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
        .footer { margin-top: 40px; text-align: center; color: #9ca3af; font-size: 11px; }
      </style>
    </head>
    <body>
      <h1>TeslaSync — Monthly Summary</h1>
      <p>Generated: ${new Date().toLocaleString()}</p>
      <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Total Vehicles</td><td>${vehicles?.length || 0}</td></tr>
        <tr><td>Total Distance</td><td>${fmtNumber(stats?.total_distance_km, 0)} km</td></tr>
        <tr><td>Total Drives</td><td>${stats?.total_drives || 0}</td></tr>
        <tr><td>Total Energy</td><td>${fmtNumber(stats?.total_energy_kwh, 0)} kWh</td></tr>
        <tr><td>Total Cost</td><td>$${fmtNumber(stats?.total_cost, 2)}</td></tr>
        <tr><td>Avg Efficiency</td><td>${fmtNumber(stats?.avg_efficiency_wh_km, 0)} Wh/km</td></tr>
      </table>
      <div class="footer">Generated by TeslaSync · ${new Date().toLocaleString()}</div>
    </body>
    </html>
  `;
}

// ───────────────────────────── native delivery ─────────────────────────────

/**
 * Deliver a built report document through the OS share sheet — the React Native
 * analog of the browser print dialog (web source L5-6, L55-56, L60-61, L93-94),
 * which has no native equivalent and no installed print/sharing dependency. The
 * document title is surfaced as the share title / subject / dialog title.
 * Returns the explicit `unavailable` state (contract rule 7) when no share
 * target is available or `Share` rejects — the analog of the web's
 * popup-blocked early return.
 */
async function deliverReport(
  title: string,
  html: string,
): Promise<ReportResult> {
  try {
    const result = await Share.share(
      {title, message: html},
      {subject: title, dialogTitle: title},
    );
    const shared = result.action === 'sharedAction';
    return {
      title,
      html,
      delivered: shared,
      action: shared ? 'shared' : 'dismissed',
    };
  } catch (err) {
    return {
      title,
      html,
      delivered: false,
      action: 'unavailable',
      unavailableReason: getErrorMessage(err),
    };
  }
}

/**
 * Generate a single-drive report (web source L4-57). Builds the HTML document
 * (web source L8-54) and delivers it through the OS share sheet. Returns a
 * `ReportResult` describing the built document and the delivery outcome.
 */
export async function generateDriveReport(
  drive: ReportDrive,
  vehicle: ReportVehicle | null | undefined,
): Promise<ReportResult> {
  const html = buildDriveReportHtml(drive, vehicle);
  const title = `Drive Report - ${formatDate(drive.start_date)}`;
  return deliverReport(title, html);
}

/**
 * Generate a fleet monthly summary report (web source L59-95). Builds the HTML
 * document (web source L63-92) and delivers it through the OS share sheet.
 * Returns a `ReportResult` describing the built document and the delivery
 * outcome.
 */
export async function generateMonthlyReport(
  stats: ReportStats | null | undefined,
  vehicles: ReportVehicle[] | null | undefined,
): Promise<ReportResult> {
  const html = buildMonthlyReportHtml(stats, vehicles);
  return deliverReport('TeslaSync Monthly Report', html);
}
