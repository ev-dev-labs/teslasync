import { type HTMLAttributes, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleSlash2, Clock3, ServerOff, TriangleAlert } from 'lucide-react'
import { AlertBanner, type AlertVariant } from './AlertBanner'
import {
  classifyUnavailability,
  explainUnavailability,
  type UnavailabilityEvidence,
  type UnavailabilityReason,
} from '@/lib/dataUnavailability'

export type DataStateKind = 'stale' | 'partial' | 'unavailable' | 'unsupported'

export interface DataStateNoticeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  state: DataStateKind
  title?: string
  message?: ReactNode
  children?: ReactNode
  /**
   * HELP-04. Why the data is unavailable, so the notice can say something
   * more useful than "a required service is unavailable".
   *
   * Pass a pre-classified `reason`, or `evidence` for the shared classifier
   * to interpret. When a reason resolves it overrides `state`: the taxonomy
   * already maps each cause onto the correct data-state kind, and a caller
   * that guessed `unavailable` for a sleeping vehicle would otherwise
   * contradict its own explanation.
   *
   * Omitting both keeps the previous behaviour exactly.
   */
  reason?: UnavailabilityReason
  evidence?: UnavailabilityEvidence
  /**
   * Keep the caller's `state` (and its generic title) while still rendering
   * the resolved cause in the body.
   *
   * Needed when usable data is still on screen. A failed background refresh
   * is `stale` — cached rows are visible and the page works — but its cause
   * may classify as `service_outage`, whose data-state is `unavailable`.
   * Letting the cause escalate severity there would turn a quiet amber "Data
   * may be stale" band into a red alert over a perfectly usable page.
   */
  preserveSeverity?: boolean
}

const stateConfig = {
  stale: {
    Icon: Clock3,
    variant: 'warning',
    titleKey: 'dataState.stale.title',
    title: 'Data may be stale',
    messageKey: 'dataState.stale.message',
    message: 'The latest values are temporarily unavailable. Previously loaded data remains visible.',
  },
  partial: {
    Icon: TriangleAlert,
    variant: 'warning',
    titleKey: 'dataState.partial.title',
    title: 'Partial data',
    messageKey: 'dataState.partial.message',
    message: 'Some sources did not respond. Available results remain visible and are not treated as complete.',
  },
  unavailable: {
    Icon: ServerOff,
    variant: 'danger',
    titleKey: 'dataState.unavailable.title',
    title: 'Service unavailable',
    messageKey: 'dataState.unavailable.message',
    message: 'A required service is unavailable. This section will recover when the dependency returns.',
  },
  unsupported: {
    Icon: CircleSlash2,
    variant: 'info',
    titleKey: 'dataState.unsupported.title',
    title: 'Feature not supported',
    messageKey: 'dataState.unsupported.message',
    message: 'This feature is not enabled by the current deployment configuration.',
  },
} satisfies Record<
  DataStateKind,
  {
    Icon: typeof Clock3
    variant: AlertVariant
    titleKey: string
    title: string
    messageKey: string
    message: string
  }
>

/** Non-fatal data-quality state that keeps any usable content on screen. */
export function DataStateNotice({
  state,
  title,
  message,
  children,
  reason,
  evidence,
  preserveSeverity = false,
  ...props
}: DataStateNoticeProps) {
  const { t } = useTranslation()

  // A resolved cause is strictly better information than the caller's guess,
  // so it wins — unless the caller still has usable content on screen and has
  // asked to keep its own severity.
  const resolvedReason =
    reason ?? (evidence ? classifyUnavailability(evidence) : null)
  const explanation = resolvedReason ? explainUnavailability(resolvedReason) : null

  const effectiveState =
    preserveSeverity ? state : (explanation?.dataState ?? state)
  const config = stateConfig[effectiveState]
  const Icon = config.Icon

  const explainedBody = explanation ? (
    <div className="space-y-1.5">
      <span className="block">{t(explanation.bodyKey, explanation.bodyFallback)}</span>
      <span className="block text-[var(--text-muted)]">
        <span className="font-medium">{t('dataUnavailable.whatToDo', 'What to do')}: </span>
        {t(explanation.whatToDoKey, explanation.whatToDoFallback)}
      </span>
      {children ?? message}
    </div>
  ) : null

  const content =
    explainedBody ?? children ?? message ?? t(config.messageKey, config.message)

  const resolvedTitle =
    title ??
    (explanation && !preserveSeverity
      ? t(explanation.titleKey, explanation.titleFallback)
      : t(config.titleKey, config.title))

  return (
    <AlertBanner
      {...props}
      variant={config.variant}
      icon={<Icon className="h-5 w-5" />}
      title={resolvedTitle}
      data-data-state={effectiveState}
      data-unavailable-reason={resolvedReason ?? undefined}
    >
      {content}
    </AlertBanner>
  )
}
