// Native parity port of web/src/hooks/useActiveFilterChips.ts.
//
// The web module is a pure, UI-agnostic React hook: a `useMemo` over plain
// JavaScript objects that turns a record of active filter values into the chip
// descriptor array consumed by `<ActiveFilterChips>`. It contains no JSX, no
// DOM element, no Recharts/Leaflet, and no browser-only API, so the logic ports
// 1:1 to React Native. Hermes runs the exact same `useMemo` / `Object.keys` /
// `Array.isArray` / `String()` primitives, so behaviour (drop empty/default
// values, preserve `config` iteration order, wire `onRemove -> setter(undefined)`)
// is identical to web.
//
// The single web import — the `FilterChipDescriptor` *type* from
// `@/components/forms/ActiveFilterChips` — is a pure type declaration with no
// runtime or DOM dependency. The native ActiveFilterChips component is not yet
// ported, so (following the established parity convention of inlining types
// from not-yet-available modules, e.g. validateImport.ts) the interface is
// declared module-locally and re-exported here, keeping the public
// `useActiveFilterChips` return contract structurally identical to web.

import {useMemo} from 'react';

/**
 * Description of one chip — typically derived from a single URL search-param.
 *
 * `key` should match the URL search-param name so chips are stable and
 * uniquely keyable. `label` is the i18n'd field name (e.g. "Vehicle"),
 * `value` is the user-facing value (e.g. "Model 3"). `onRemove` should
 * delete the param (commonly `setFilter(undefined)`).
 *
 * Mirrors the web `FilterChipDescriptor` exported from
 * `@/components/forms/ActiveFilterChips` (inlined here: pure type, native
 * ActiveFilterChips component not yet ported).
 */
export interface FilterChipDescriptor {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

/**
 * Per-key configuration for one filter.
 *
 * `label` is the i18n'd display name shown before the colon (e.g. "Vehicle").
 * `format` turns the raw filter value into the user-facing string. When
 *   omitted, the raw value is rendered via `String(value)`.
 * `setter` is the page-supplied remover. The hook calls it with `undefined`
 *   when the chip's X is clicked. Pages typically wire this to the URL-state
 *   setter (e.g. `setVehicleId(undefined)`).
 * `isEmpty` is an optional override for "no filter applied". Defaults to
 *   `value == null || value === '' || (Array.isArray(value) && value.length === 0)`.
 */
export interface ChipConfig<V = unknown> {
  label: string;
  format?: (value: V) => string;
  setter: (next: undefined) => void;
  isEmpty?: (value: V) => boolean;
}

export type ChipConfigRecord = Record<string, ChipConfig<never>>;

function defaultIsEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function defaultFormat(value: unknown): string {
  if (Array.isArray(value)) return value.map(v => String(v)).join(', ');
  return String(value);
}

/**
 * Convert a `{ key: ChipConfig }` map plus a `{ key: value }` snapshot into
 * an ordered array of `FilterChipDescriptor`s, omitting keys whose value
 * is empty / default.
 *
 * Order follows `Object.keys(config)` so pages can lay out chips in the
 * same order as the underlying filter controls.
 */
export function useActiveFilterChips(
  config: ChipConfigRecord,
  state: Record<string, unknown>,
): FilterChipDescriptor[] {
  return useMemo(() => {
    const chips: FilterChipDescriptor[] = [];
    for (const key of Object.keys(config)) {
      const cfg = config[key] as ChipConfig<unknown>;
      const value = state[key];
      const empty = (cfg.isEmpty ?? defaultIsEmpty)(value);
      if (empty) continue;
      const value_ = (cfg.format ?? defaultFormat)(value);
      chips.push({
        key,
        label: cfg.label,
        value: value_,
        onRemove: () => cfg.setter(undefined),
      });
    }
    return chips;
  }, [config, state]);
}
