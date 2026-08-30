import type { TFunction } from 'i18next'

/**
 * Human age of a BACKEND OBSERVATION instant.
 *
 * Shared (not feature-local) because Fleet Posture, the fleet list and the
 * vehicle preview drawer all have to phrase the same fact identically: how old
 * the data actually is, measured from when the vehicle was observed — never
 * from when the HTTP request completed.
 *
 * Returns `null` when there is no observation, so callers render an explicit
 * "no verified observation" string instead of a fabricated "0s ago".
 */
export function formatObservationAge(
  observedAt: number | null | undefined,
  t: TFunction,
  now = Date.now(),
): string | null {
  if (observedAt == null || !Number.isFinite(observedAt)) return null
  const seconds = Math.max(0, Math.round((now - observedAt) / 1000))
  if (seconds < 60) {
    return t('freshness.age.seconds', '{{count}}s ago', { count: seconds })
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return t('freshness.age.minutes', '{{count}}m ago', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('freshness.age.hours', '{{count}}h ago', { count: hours })
  }
  const days = Math.floor(hours / 24)
  return t('freshness.age.days', '{{count}}d ago', { count: days })
}
