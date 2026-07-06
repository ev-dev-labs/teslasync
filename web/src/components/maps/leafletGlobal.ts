/**
 * Mirror Leaflet onto `window.L` so classical plugins can find it.
 *
 * Plugins like `leaflet-draw`, `leaflet.markercluster`, and `leaflet.heat`
 * are written as classical browser scripts that look up `window.L` at
 * evaluation time instead of importing leaflet themselves. Vite's ESM
 * bundle imports leaflet locally and never attaches it to `window`, so the
 * plugins crash with `ReferenceError: L is not defined` the moment any
 * route that touches the maps barrel is loaded.
 *
 * Importing this module via a SIDE-EFFECT import BEFORE the plugin import
 * is the canonical fix:
 *
 *   import './leafletGlobal'; // hoisted, but evaluated first
 *   import 'leaflet.markercluster'; // can now resolve window.L
 *
 * ES module imports are evaluated in source order, so listing this above
 * the plugin guarantees `window.L` exists by the time the plugin runs.
 */
import L from 'leaflet';

// Write to — and guard on — the SAME object the plugins read (`window`). In
// browsers `window === globalThis`, so this matches the previous `globalThis`
// target there, but keeping both the check and the assignment on `window`
// honors the documented `window.L` contract above and avoids a silent
// mismatch in the rare environments where the two diverge (a bare `globalThis`
// write would leave `window.L` undefined and the plugin still broken).
//
// The `!w.L` guard keeps the mirror idempotent and, crucially, never clobbers
// a leaflet already installed by a CDN `<script>` tag or an earlier evaluation
// of this module.
if (typeof window !== 'undefined') {
  const w = window as unknown as { L?: typeof L };
  if (!w.L) {
    w.L = L;
  }
}

export {};
