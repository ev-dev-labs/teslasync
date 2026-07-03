import type { ConsentState } from '@/lib/cookieConsent'
import type { NeonColor } from '@/lib/tokens'

/** Minimal shape of the `t()` accessor these helpers need. */
type Translate = (key: string, defaultValue: string) => string

export interface ConsentPresentation {
  /** Long, descriptive status line — the existing `consent.state.*` copy. */
  detail: string
  /** Short KPI / pill-friendly status label. */
  short: string
  /** KPI accent color. */
  color: NeonColor
  /** StatusPill dot color class (color is never the only signal). */
  dot: string
}

/**
 * Resolve display metadata for a cookie-consent state in one place so the KPI
 * card, the status pill, and the control panel stay in lock-step. Consumers
 * pass their own `t` so the strings localize through the caller's namespace.
 */
export function describeConsent(state: ConsentState, t: Translate): ConsentPresentation {
  switch (state) {
    case 'accepted':
      return {
        detail: t('consent.state.accepted', 'Accepted — performance & error reporting on'),
        short: t('consent.short.accepted', 'Accepted'),
        color: 'green',
        dot: 'bg-emerald-400',
      }
    case 'declined':
      return {
        detail: t('consent.state.declined', 'Declined — only essential storage in use'),
        short: t('consent.short.declined', 'Declined'),
        color: 'amber',
        dot: 'bg-amber-400',
      }
    case 'unknown':
    default:
      return {
        detail: t('consent.state.unknown', 'Not decided — banner will appear on next visit'),
        short: t('consent.short.unknown', 'Not decided'),
        color: 'blue',
        dot: 'bg-slate-400',
      }
  }
}
