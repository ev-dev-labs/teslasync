import { useMemo } from 'react'
import { useSettings } from './useSettings'
import {
  selectPreferredRange,
  type PreferredRangeFields,
  type PreferredRangeResult,
  type RangeType,
} from '@/lib/preferredRange'

export type { RangeType, PreferredRangeFields, PreferredRangeResult }

/**
 * React hook returning the rangeType-aware range value + label for a
 * given vehicle/charge state snapshot. Reads `useSettings().rangeType`.
 *
 * Pass `null`/`undefined` for `state` when the data is still loading;
 * `meters` will be `null` and the helper returns the labels for the
 * preferred type so loading states render a stable label.
 */
export function usePreferredRange(
  state: PreferredRangeFields | null | undefined,
): PreferredRangeResult {
  const { rangeType } = useSettings()
  return useMemo(() => selectPreferredRange(state, rangeType), [state, rangeType])
}
