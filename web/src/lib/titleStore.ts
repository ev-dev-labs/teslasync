/**
 * titleStore — single owner of `document.title`.
 *
 * Three independent contributors compose into the final title:
 *   - `baseTitle`   — the canonical page title (set by `usePageTitle`)
 *   - `basePrefix`  — unread-count badge (e.g. "(3) ", set by `useTitleBadge`)
 *   - `flashPrefix` — critical-alert flash (e.g. "(!) ALERT — ",
 *                     set by `useCriticalAlertFlash`)
 *
 * The flash prefix takes priority over the unread badge so that, while
 * an alert is flashing, the page does not "fight" with the badge for
 * which prefix to display. When the flash ends and `flashPrefix` is
 * cleared back to `''`, the unread badge re-appears automatically.
 *
 * This module is a runtime-singleton (module-level state) by design;
 * it represents the global window's title bar, of which there is
 * exactly one. Tests can call `__resetTitleStoreForTests()` between
 * runs to restore defaults.
 */

let basePrefix = ''
let flashPrefix = ''
let baseTitle = 'TeslaSync'

function apply() {
  if (typeof document === 'undefined') return
  const prefix = flashPrefix || basePrefix
  document.title = `${prefix}${baseTitle}`
}

export function setBaseTitle(title: string): void {
  baseTitle = title
  apply()
}

export function setBasePrefix(prefix: string): void {
  basePrefix = prefix
  apply()
}

export function setFlashPrefix(prefix: string): void {
  flashPrefix = prefix
  apply()
}

export function getBaseTitle(): string {
  return baseTitle
}

export function getBasePrefix(): string {
  return basePrefix
}

export function getFlashPrefix(): string {
  return flashPrefix
}

/**
 * Test-only helper to restore module state between tests. Not exported
 * from any barrel and intentionally underscore-prefixed.
 */
export function __resetTitleStoreForTests(): void {
  basePrefix = ''
  flashPrefix = ''
  baseTitle = 'TeslaSync'
  apply()
}
