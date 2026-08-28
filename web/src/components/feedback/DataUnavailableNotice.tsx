import { useTranslation } from 'react-i18next'

import {
  explainUnavailability,
  type UnavailabilityEvidence,
  type UnavailabilityReason,
  classifyUnavailability,
} from '@/lib/dataUnavailability'
import { MaybeLink } from './_MaybeLink'
import { DataStateNotice } from './DataStateNotice'

/**
 * Explains WHY data is unavailable (HELP-04).
 *
 * A thin adapter over `<DataStateNotice>`, which now owns the classification
 * and the body/what-to-do copy. Keeping the explanation in one place means the
 * shared data-state surface and this convenience wrapper cannot drift apart —
 * and the six causes still render through the four data states the app already
 * defines, so users do not have to learn a second visual language.
 *
 * Renders nothing when no evidence explains the emptiness. That is deliberate
 * — an invented cause is worse than none, and the caller falls back to the
 * governed empty-state guidance.
 */
export interface DataUnavailableNoticeProps {
  /** Pre-classified reason. Takes priority over `evidence`. */
  reason?: UnavailabilityReason
  /** Evidence to classify when `reason` is not supplied. */
  evidence?: UnavailabilityEvidence
  className?: string
}

export function DataUnavailableNotice({
  reason,
  evidence,
  className,
}: DataUnavailableNoticeProps) {
  const { t } = useTranslation()
  const resolved = reason ?? (evidence ? classifyUnavailability(evidence) : null)
  if (!resolved) return null

  const explanation = explainUnavailability(resolved)

  return (
    <DataStateNotice
      // `state` is a required prop but is overridden by the resolved reason
      // inside DataStateNotice; passing the taxonomy's own mapping keeps the
      // two in agreement even if that precedence ever changes.
      state={explanation.dataState}
      reason={resolved}
      className={className}
    >
      {explanation.actionTo && explanation.actionLabelKey && (
        <MaybeLink
          to={explanation.actionTo}
          className="inline-flex text-xs font-medium text-[var(--theme-primary)] underline-offset-2 hover:underline"
          data-testid="data-unavailable-action"
        >
          {t(explanation.actionLabelKey, explanation.actionLabelFallback ?? '')}
        </MaybeLink>
      )}
    </DataStateNotice>
  )
}
