import { useDensitySync } from '@/hooks/useDensitySync'

/**
 * Mounts `useDensitySync()` so the user's `ui_density` setting is applied
 * to `document.body.dataset.density`. Renders nothing — this is purely a
 * side-effect carrier so it can sit underneath the QueryClientProvider
 * (where `useSettings()` works) without forcing every page or layout to
 * import the hook.
 *
 * Density-aware utilities then read the body data attribute via CSS:
 *   body[data-density="compact"]  { --density-row-h: 32px; ... }
 *   body[data-density="spacious"] { --density-row-h: 56px; ... }
 *
 * See `web/src/index.css` and `web/tailwind.config.js` for the tokens.
 */
export function DensityApplier(): null {
  useDensitySync()
  return null
}
