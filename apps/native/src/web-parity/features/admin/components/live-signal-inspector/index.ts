// Native parity port of
// web/src/features/admin/components/live-signal-inspector/index.ts.
//
// The web barrel is a single-line re-export surface:
//   export { LiveSignalsTable } from './LiveSignalsTable';  (web L1)
//
// LiveSignalsTable is a DOM-bound table widget (web DataTable + Input +
// EmptyState + TimeStamp + lucide-react Search icon) that has not yet been
// ported into this React Native parity tree, and neither have its building
// blocks (DataTable, Input's web variant, useSortToggle, the Column type, and
// TimeStamp). In the file-by-file web-to-native conversion a barrel may only
// re-export siblings already present under this directory; pointing at a
// not-yet-ported sibling would break the native typecheck. There is therefore
// no live re-export yet — the single web export is enumerated in
// `nativeLiveSignalInspectorBarrelCapabilities.pending.exports` with an
// explicit unavailable reason so the source public API stays documented and
// discoverable, matching the capability-record convention already used by the
// native feedback and charts barrels. When LiveSignalsTable is converted by the
// loop this barrel will be revisited and the symbol promoted from `pending` to
// a live re-export.
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

export const NATIVE_LIVE_SIGNAL_INSPECTOR_PENDING_REASON =
  'This web live-signal-inspector export has not yet been ported into the ' +
  'React Native parity tree. It will be re-exported from this barrel once its ' +
  'source module (and its DataTable/Input/TimeStamp dependencies) are converted ' +
  'by the file-by-file web-to-native loop; until then importing it from the ' +
  'native live-signal-inspector barrel is intentionally unavailable.';

/**
 * Explicit availability record for the native live-signal-inspector barrel.
 *
 * `available` lists the web exports already ported into this parity tree (and
 * therefore re-exported from this barrel). `pending.exports` enumerates every
 * identifier exported by
 * web/src/features/admin/components/live-signal-inspector/index.ts that has not
 * yet been converted. Each is intentionally absent from the live re-exports
 * until its own source module is ported, so this record documents the
 * unavailable state instead of silently dropping the symbol.
 */
export const nativeLiveSignalInspectorBarrelCapabilities = {
  available: [],
  pending: {
    reason: NATIVE_LIVE_SIGNAL_INSPECTOR_PENDING_REASON,
    exports: ['LiveSignalsTable'],
  },
} as const;
