import type { ConsentState } from '@/lib/cookieConsent'
import type { NeonColor } from '@/lib/tokens'

/**
 * Minimal shape of the `t()` accessor these helpers need. The return type is
 * widened to `string | null | undefined` on purpose: a translator configured
 * with i18next's `returnNull` / `returnEmptyString` options — or one consulted
 * before its resource bundle has finished loading — can hand those back for a
 * missing key even when a default value is supplied. {@link localize} normalises
 * that away so the consent copy is never rendered blank.
 */
type Translate = (key: string, defaultValue: string) => string | null | undefined

/**
 * Resolve a localized string, guaranteeing a non-empty result. Falls back to the
 * English `defaultValue` whenever the injected translator returns a nullish or
 * empty string, so the KPI card and status pill never surface an unlabelled
 * status — a blank state the user must never see.
 */
function localize(t: Translate, key: string, defaultValue: string): string {
  const value = t(key, defaultValue)
  return value != null && value !== '' ? value : defaultValue
}

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
 *
 * Any unrecognised `state` — a value from an older schema, a corrupt
 * localStorage entry, or an untyped JS caller — collapses onto the neutral
 * `unknown` presentation rather than throwing, so bad input can never break the
 * privacy UI.
 */
export function describeConsent(state: ConsentState, t: Translate): ConsentPresentation {
  switch (state) {
    case 'accepted':
      return {
        detail: localize(t, 'consent.state.accepted', 'Accepted — performance & error reporting on'),
        short: localize(t, 'consent.short.accepted', 'Accepted'),
        color: 'green',
        dot: 'bg-emerald-400',
      }
    case 'declined':
      return {
        detail: localize(t, 'consent.state.declined', 'Declined — only essential storage in use'),
        short: localize(t, 'consent.short.declined', 'Declined'),
        color: 'amber',
        dot: 'bg-amber-400',
      }
    case 'unknown':
    default:
      return {
        detail: localize(t, 'consent.state.unknown', 'Not decided — banner will appear on next visit'),
        short: localize(t, 'consent.short.unknown', 'Not decided'),
        color: 'blue',
        dot: 'bg-slate-400',
      }
  }
}
