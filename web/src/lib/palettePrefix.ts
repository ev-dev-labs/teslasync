/**
 * Command-palette prefix parsing.
 * Power-user shortcut: typing a single recognized character at the start of
 * the search box locks the palette to one scope (commands, pages, vehicles,
 * settings) — matches the muscle memory of VS Code / Raycast / Linear.
 *   `>` → commands       (e.g. `> wake`        → only Wake Up Vehicle)
 *   `/` → pages          (e.g. `/ drives`      → only the Drives page)
 *   `@` → vehicles       (e.g. `@ model y`     → only vehicle-switch entries)
 *   `:` → settings       (e.g. `: theme dark`  → only registry/theme actions)
 * The prefix must be the very first character. A single optional space after
 * the prefix is consumed so `> wake` and `>wake` both work.
 * Pure module — no React, no DOM, fully unit-tested.
 */

import type { ReactNode } from 'react';

/** All paletteable item types that map to a scope. */
export type PaletteScope = 'command' | 'navigate' | 'vehicle-switch' | 'registry';

/** Per-scope display metadata, kept here so the parser owns the prefix → scope mapping. */
export interface PaletteScopeMeta {
  /** Single-char trigger. */
  prefix: string;
  /** Human-readable scope name (i18n fallback). */
  label: string;
  /** Placeholder hint when this scope is active. */
  placeholder: string;
  /** Item types that belong to this scope. */
  types: ReadonlyArray<PaletteScope>;
}

/**
 * Canonical prefix → scope table. The order is the order shown in the
 * footer hint chip strip.
 */
export const PALETTE_SCOPE_TABLE: ReadonlyArray<readonly [PaletteScope, PaletteScopeMeta]> = [
  ['command',        { prefix: '>', label: 'Commands', placeholder: 'Search commands…', types: ['command'] }],
  ['navigate',       { prefix: '/', label: 'Pages',    placeholder: 'Search pages…',    types: ['navigate'] }],
  ['vehicle-switch', { prefix: '@', label: 'Vehicles', placeholder: 'Switch vehicle…',  types: ['vehicle-switch'] }],
  ['registry',       { prefix: ':', label: 'Settings', placeholder: 'Search settings…', types: ['registry'] }],
];

const PREFIX_TO_SCOPE: Record<string, PaletteScope> = Object.fromEntries(
  PALETTE_SCOPE_TABLE.map(([scope, meta]) => [meta.prefix, scope]),
);

const SCOPE_TO_META: Record<PaletteScope, PaletteScopeMeta> = Object.fromEntries(
  PALETTE_SCOPE_TABLE,
) as Record<PaletteScope, PaletteScopeMeta>;

/** All recognized prefix characters, in display order. */
export const PALETTE_PREFIX_CHARS: ReadonlyArray<string> =
  PALETTE_SCOPE_TABLE.map(([, m]) => m.prefix);

/** Parsed result of a raw input string. */
export interface ParsedPrefix {
  /** The active scope, or `null` when the user hasn't typed a recognized prefix. */
  scope: PaletteScope | null;
  /** The remainder of the query after the prefix (and one optional space) is stripped. */
  term: string;
}

/**
 * Parse a raw palette input into `{ scope, term }`.
 * Rules:
 *  - The prefix MUST be the very first character of the (un-trimmed) input.
 *    Mid-string `>` or `/` are NOT treated as prefixes — they're search text.
 *  - One optional space immediately after the prefix is consumed.
 *  - Unknown leading characters are treated as part of the search term;
 *    the result is `{ scope: null, term: <input> }`.
 *  - An empty input returns `{ scope: null, term: '' }`.
 */
export function parsePrefix(input: string): ParsedPrefix {
  if (!input) return { scope: null, term: '' };
  const head = input.charAt(0);
  const scope = PREFIX_TO_SCOPE[head];
  if (!scope) return { scope: null, term: input };
  // Strip the prefix; consume exactly one trailing space if present so the
  // user's typed term doesn't accidentally start with a leading space.
  let rest = input.slice(1);
  if (rest.startsWith(' ')) rest = rest.slice(1);
  return { scope, term: rest };
}

/** Look up the scope metadata. */
export function getScopeMeta(scope: PaletteScope): PaletteScopeMeta {
  return SCOPE_TO_META[scope];
}

/** Type-test helper — keeps the call sites free of `as` casts. */
export function isPaletteScope(value: string | null | undefined): value is PaletteScope {
  return value !== null && value !== undefined && value in SCOPE_TO_META;
}

/**
 * Helper used by the palette's filter step: returns true when an item's
 * `type` belongs to the active scope. When `scope` is null, every item
 * passes.
 */
export function itemMatchesScope(
  itemType: string | undefined,
  scope: PaletteScope | null,
): boolean {
  if (scope === null) return true;
  if (!itemType) return false;
  const meta = SCOPE_TO_META[scope];
  return (meta.types as ReadonlyArray<string>).includes(itemType);
}

/**
 * Re-exported for the palette's footer hint, so the rendering stays pure
 * data-driven and the table above is the single source of truth.
 */
export interface PaletteScopeHint {
  scope: PaletteScope;
  prefix: string;
  label: string;
}

export const PALETTE_SCOPE_HINTS: ReadonlyArray<PaletteScopeHint> = PALETTE_SCOPE_TABLE.map(
  ([scope, meta]) => ({ scope, prefix: meta.prefix, label: meta.label }),
);

// Re-export ReactNode so call sites that only need scope types don't need
// to import from React directly. Kept as a `type` re-export to avoid a
// runtime dependency.
export type { ReactNode };
