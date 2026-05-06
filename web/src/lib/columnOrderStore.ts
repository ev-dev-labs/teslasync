/**
 * Phase-46 / Prompt 45 — DataTable column reorder + visibility
 *
 * Persistent store for per-table column layout (order + hidden set), keyed
 * by `tableId` in localStorage. Supersedes the legacy
 * `teslasync.table.${tableId}.visible` key (kept readable for migration so
 * existing users don't lose their visibility prefs on first load after
 * upgrade).
 *
 * The store is intentionally framework-agnostic — DataTable owns the React
 * state + persistence-on-change call sites; this module is pure
 * read/write/transform helpers so it can be unit-tested without a DOM.
 */

const STORAGE_PREFIX = 'teslasync.table'

export interface ColumnLayout {
  /** Column-key order. Keys not present here keep their default position
   *  AFTER any keys that are present (in source-column order). */
  order: string[]
  /** Column keys hidden by the user. */
  hidden: string[]
}

export const EMPTY_LAYOUT: Readonly<ColumnLayout> = Object.freeze({
  order: Object.freeze([]) as readonly string[] as string[],
  hidden: Object.freeze([]) as readonly string[] as string[],
})

export function columnLayoutStorageKey(tableId: string): string {
  return `${STORAGE_PREFIX}.${tableId}.columns`
}

export function legacyVisibleStorageKey(tableId: string): string {
  return `${STORAGE_PREFIX}.${tableId}.visible`
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** Read the layout for `tableId`, or null if nothing stored / unparseable. */
export function getColumnLayout(tableId: string): ColumnLayout | null {
  if (typeof window === 'undefined') return null
  let raw: string | null
  try {
    raw = window.localStorage.getItem(columnLayoutStorageKey(tableId))
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ColumnLayout>
    const order = isStringArray(parsed.order) ? parsed.order : []
    const hidden = isStringArray(parsed.hidden) ? parsed.hidden : []
    return { order, hidden }
  } catch {
    return null
  }
}

/** Persist `layout` for `tableId`. Silent on quota / disabled storage. */
export function setColumnLayout(tableId: string, layout: ColumnLayout): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      columnLayoutStorageKey(tableId),
      JSON.stringify({ order: layout.order, hidden: layout.hidden }),
    )
  } catch {
    /* quota / disabled — ignore */
  }
}

/** Mirror the user's currently-visible column keys to the legacy
 *  `teslasync.table.${tableId}.visible` storage key. The new layout (`.columns`)
 *  is the source of truth post-Phase-46 / Prompt 45, but we keep the legacy
 *  array in lock-step so any external readers (or the prior storage shape's
 *  tests) continue to work without modification. */
export function writeLegacyVisibleArray(
  tableId: string,
  visibleKeys: readonly string[],
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      legacyVisibleStorageKey(tableId),
      JSON.stringify([...visibleKeys]),
    )
  } catch {
    /* ignore */
  }
}

/** Remove the stored layout for `tableId`, if any. Also clears the legacy
 *  `.visible` key so a "Reset to defaults" click really resets everything. */
export function resetColumnLayout(tableId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(columnLayoutStorageKey(tableId))
    window.localStorage.removeItem(legacyVisibleStorageKey(tableId))
  } catch {
    /* ignore */
  }
}

/** One-shot migration helper: read the legacy `.visible` array (a list of
 *  visible column keys) and convert it to a {order, hidden} layout, given
 *  the full column-key universe. Returns null when no legacy entry exists
 *  or the entry is unparseable.
 *
 *  We intentionally do NOT auto-write the migrated layout back — the
 *  caller (DataTable) does that on the next user-initiated change so a
 *  user who's never touched the menu won't see their localStorage
 *  rewritten just by visiting the page. */
export function readLegacyVisibleLayout(
  tableId: string,
  columnKeys: readonly string[],
): ColumnLayout | null {
  if (typeof window === 'undefined') return null
  let raw: string | null
  try {
    raw = window.localStorage.getItem(legacyVisibleStorageKey(tableId))
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isStringArray(parsed)) return null
  if (parsed.length === 0) return null
  const known = new Set(columnKeys)
  const visible = parsed.filter((k) => known.has(k))
  if (visible.length === 0) return null
  const hidden = columnKeys.filter((k) => !visible.includes(k))
  return { order: visible, hidden }
}

/** Compute the effective ordered visible columns for rendering.
 *
 *  Rules:
 *  - When `layout` is null:
 *      * Hide columns whose `defaultVisible` is `false`.
 *      * Render in source order.
 *  - When `layout` is set:
 *      * Drop hidden keys.
 *      * Place keys in `layout.order` first (in that order, ignoring keys
 *        no longer present).
 *      * Append any remaining columns in source order so a brand-new
 *        column shows up at the end of the table without a manual
 *        intervention.
 *  - If the result would be empty (e.g. user hid everything via stored
 *    layout that's now stale), fall back to the default-visible set so
 *    the table never renders zero columns.
 */
export function applyColumnLayout<C extends { key: string; defaultVisible?: boolean }>(
  columns: readonly C[],
  layout: ColumnLayout | null,
): C[] {
  if (!layout) {
    return columns.filter((c) => c.defaultVisible !== false)
  }
  const knownKeys = new Set(columns.map((c) => c.key))
  const hiddenSet = new Set(layout.hidden.filter((k) => knownKeys.has(k)))
  const orderedKeys: string[] = []
  const seen = new Set<string>()
  for (const k of layout.order) {
    if (knownKeys.has(k) && !seen.has(k)) {
      orderedKeys.push(k)
      seen.add(k)
    }
  }
  for (const c of columns) {
    if (!seen.has(c.key)) {
      orderedKeys.push(c.key)
      seen.add(c.key)
    }
  }
  const visibleKeys = orderedKeys.filter((k) => !hiddenSet.has(k))
  if (visibleKeys.length === 0) {
    return columns.filter((c) => c.defaultVisible !== false)
  }
  const byKey = new Map(columns.map((c) => [c.key, c] as const))
  return visibleKeys.map((k) => byKey.get(k)).filter((c): c is C => Boolean(c))
}

/** Build the full ordered key list (visible + hidden) the menu uses to
 *  render rows in their effective layout order. Mirrors the order rules
 *  used by `applyColumnLayout` but doesn't drop hidden keys. */
export function effectiveColumnOrder<C extends { key: string }>(
  columns: readonly C[],
  layout: ColumnLayout | null,
): string[] {
  if (!layout || layout.order.length === 0) {
    return columns.map((c) => c.key)
  }
  const knownKeys = new Set(columns.map((c) => c.key))
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const k of layout.order) {
    if (knownKeys.has(k) && !seen.has(k)) {
      ordered.push(k)
      seen.add(k)
    }
  }
  for (const c of columns) {
    if (!seen.has(c.key)) {
      ordered.push(c.key)
      seen.add(c.key)
    }
  }
  return ordered
}

/** Move `key` to position `toIndex` in `currentOrder`, returning the new
 *  full order array. Caller is responsible for first calling
 *  `effectiveColumnOrder()` so that "currentOrder" already covers every
 *  known column key. Out-of-range or missing keys are clamped/ignored. */
export function moveColumn(currentOrder: readonly string[], key: string, toIndex: number): string[] {
  const fromIndex = currentOrder.indexOf(key)
  if (fromIndex < 0) return currentOrder.slice()
  const next = currentOrder.slice()
  next.splice(fromIndex, 1)
  const clamped = Math.max(0, Math.min(toIndex, next.length))
  next.splice(clamped, 0, key)
  return next
}

/** Toggle a column's hidden state, returning a fresh layout. The order
 *  array is preserved (we don't drop unhidden keys from order — they
 *  reappear in their previously-set position). */
export function toggleHiddenColumn(layout: ColumnLayout, key: string): ColumnLayout {
  const isHidden = layout.hidden.includes(key)
  return {
    order: layout.order.slice(),
    hidden: isHidden ? layout.hidden.filter((k) => k !== key) : [...layout.hidden, key],
  }
}

/** Build the initial layout for a table the first time the user opens
 *  the column menu (so toggling a single checkbox writes a complete
 *  picture, not a partial). We seed `hidden` from each column's
 *  `defaultVisible: false` so unchanged defaults survive a round-trip. */
export function defaultColumnLayout<C extends { key: string; defaultVisible?: boolean }>(
  columns: readonly C[],
): ColumnLayout {
  return {
    order: columns.map((c) => c.key),
    hidden: columns.filter((c) => c.defaultVisible === false).map((c) => c.key),
  }
}
