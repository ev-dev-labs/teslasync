// Native parity port of web/src/components/ui/DensityApplier.tsx.
//
// The web component (source L16-19) mounts useDensitySync() purely for its side
// effect and renders null, so the user's `ui_density` setting is applied to a
// single global location the rest of the UI reads. On the web (source docblock
// L3-15) that location is `document.body.dataset.density`, consumed by the
// `body[data-density="..."]` CSS selectors in web/src/index.css + the Tailwind
// tokens in web/tailwind.config.js. The web component imports `useDensitySync`
// from `@/hooks/useDensitySync` (source L1).
//
// Mirroring that web module boundary, this carrier imports the native parity
// `useDensitySync` from ../../hooks/useDensitySync (the port of
// web/src/hooks/useDensitySync.ts) instead of inlining the hook. That hook owns
// the native-safe seams for the browser-only behaviour:
//   - document.body.dataset.density  -> an in-memory, subscribable density store.
//     Native screens read the applied density via getCurrentDensity() /
//     subscribeDensity() and map it to spacing tokens.
//   - localStorage flash-prevention persistence -> unavailable (AsyncStorage is
//     not a dependency), so the persist write is a no-op; the value still applies
//     for the JS runtime's lifetime. The `teslasync-density` key namespace is
//     retained for traceability (see nativeDensitySyncCapabilities).
// The source docblock's QueryClientProvider-placement note still holds: this
// carrier must render under the React Query provider so useSettings() works.
//
// The density type, store accessors, the hook, and the capability flags are
// re-exported below (the flags under their original
// `nativeDensityApplierCapabilities` name) so existing native importers of this
// module keep working unchanged.

import {
  useDensitySync,
  getCurrentDensity,
  subscribeDensity,
  nativeDensitySyncCapabilities,
  type Density,
} from '../../hooks/useDensitySync';

export type {Density};
export {
  useDensitySync,
  getCurrentDensity,
  subscribeDensity,
  nativeDensitySyncCapabilities as nativeDensityApplierCapabilities,
};

/**
 * Mounts useDensitySync() so the user's `ui_density` setting is applied to the
 * native in-memory density store. Renders nothing — a pure side-effect carrier
 * that must sit underneath the React Query provider (where useSettings() works)
 * without forcing every screen to import the hook.
 */
export function DensityApplier(): null {
  useDensitySync();
  return null;
}
