/**
 * useActiveFilterChips — convenience wrapper that turns a record of active
 * filter values into the chip descriptor array consumed by
 * `<ActiveFilterChips>`.
 *
 * The hook deliberately stays UI-agnostic: it knows nothing about
 * `useSearchParams`, TanStack Query, or any specific URL contract. Pages
 * pass the current filter snapshot in `state` plus per-key configuration
 * (i18n'd label, optional value formatter, the remover callback). The
 * hook drops empty / default values and returns descriptors in the same
 * iteration order as `config`.
 *
 * Phase-46 / Prompt 06.
 */

import { useMemo } from 'react';
import type { FilterChipDescriptor } from '@/components/forms/ActiveFilterChips';

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
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
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
