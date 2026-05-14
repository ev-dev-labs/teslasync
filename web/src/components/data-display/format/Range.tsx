import { useTranslation } from 'react-i18next'
import { useUnits } from '@/hooks/useUnits'
import { usePreferredRange, type PreferredRangeFields } from '@/hooks/usePreferredRange'

interface RangeProps {
  /** Vehicle/charge state snapshot with `rated_range` + `ideal_range` in SI metres. */
  state: PreferredRangeFields | null | undefined
  /** Optional decimal precision override for the value. */
  precision?: number
  className?: string
}

/**
 * Reusable "primary range" renderer that respects both the user's
 * distance-unit preference (km vs mi via `useUnits`) and the user's
 * `preferred_range` preference (rated vs ideal via `usePreferredRange`).
 *
 * Use on surfaces that show "the range" generically — Glance, vehicle
 * list cards, fleet summary, charge status, the dashboard hero. Do NOT
 * use on explicit comparison surfaces (RangeBarWidget,
 * RangeEstimateWidget, BatteryRangePanel) which render BOTH ranges
 * side-by-side regardless of preference.
 */
export function Range({ state, precision = 0, className }: RangeProps) {
  const { formatDistance } = useUnits()
  const { meters } = usePreferredRange(state)

  if (meters == null) return <span className={className}>—</span>

  return <span className={className}>{formatDistance(meters, { precision })}</span>
}

/**
 * Companion hook returning the localized "Rated Range" / "Ideal Range"
 * label honoring the user's `preferred_range` preference. Use when you
 * need the label separate from the value — e.g. inside a stat tile that
 * renders the label and value in different elements.
 */
export function useRangeLabel(state: PreferredRangeFields | null | undefined): string {
  const { t } = useTranslation()
  const { labelKey, defaultLabel } = usePreferredRange(state)
  return t(`common.${labelKey}`, defaultLabel)
}

