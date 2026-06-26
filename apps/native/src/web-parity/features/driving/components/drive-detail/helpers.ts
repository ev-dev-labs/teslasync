// Native parity port of
// web/src/features/driving/components/drive-detail/helpers.ts.
//
// Shared helpers for the single-drive deep dive (DriveDetailPage):
//   - `formatDuration(min)` turns a duration in minutes into a compact
//     "{h}h {m}m" / "{m}m" label (consumed by DriveStatCards + DriveTimeline).
//   - `LEGEND_STYLE` is the chart-legend text style object used by the web
//     Recharts `<Legend wrapperStyle={LEGEND_STYLE}>` on the Elevation,
//     Temperature and Tire-Pressure sections.
//
// ## Native conversion (contract rule 6)
//
// This is non-visual utility/constant code: a pure numeric/string formatter and
// a plain style record. It touches no DOM, no browser globals, and no
// Recharts/Leaflet/old-web-UI imports, so the logic and the constant port 1:1 to
// React Native-compatible TypeScript with behaviour preserved verbatim.
//
// `formatDuration` is identical to the web source (same Math.floor/Math.round,
// same h>0 branch, same backtick templates). `LEGEND_STYLE` keeps its exact
// `{ fontSize: 10, color: '#9ca3af' }` shape and `as const` literal typing; the
// `fontSize`/`color` pair is also a valid React Native `TextStyle`, so when the
// chart consumers are ported they can feed it straight into a native legend's
// text style without any reshaping.

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const LEGEND_STYLE = {fontSize: 10, color: '#9ca3af'} as const;
