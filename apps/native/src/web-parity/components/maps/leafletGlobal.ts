/**
 * Native parity for web/src/components/maps/leafletGlobal.ts.
 *
 * The web module mirrors Leaflet onto `window.L` so classical browser-script
 * plugins (`leaflet-draw`, `leaflet.markercluster`, `leaflet.heat`) that look up
 * the `window.L` global at evaluation time — instead of importing leaflet
 * themselves — can resolve it. Vite's ESM bundle imports leaflet locally and
 * never attaches it to `window`, so on the web those plugins are guarded by a
 * SIDE-EFFECT import of `leafletGlobal` placed above the plugin import.
 *
 * That shim is meaningful only inside a DOM / browser bundle. React Native has
 * no `window` global, no DOM, and no Leaflet, and the native conversion
 * contract forbids importing `leaflet` (a DOM-only module) here. The classical
 * Leaflet plugins this shim supports never run on React Native — native maps
 * use `react-native-maps` instead — so there is no global to mirror and nothing
 * to attach.
 *
 * This module is therefore a native-safe no-op. Importing it as a side effect
 * (`import './leafletGlobal';`) stays valid for converted native consumers such
 * as the GeofenceDrawer and MarkerCluster parity modules, but it intentionally
 * performs no work. The explicit unavailable reason below documents why the
 * `window.L` Leaflet shim is unavailable on native.
 */

export const LEAFLET_GLOBAL_UNAVAILABLE_REASON =
  'React Native has no window/DOM global and does not bundle Leaflet, so the window.L shim used by classical Leaflet plugins is unnecessary and unavailable. Native maps use react-native-maps; importing this module is a no-op.';
