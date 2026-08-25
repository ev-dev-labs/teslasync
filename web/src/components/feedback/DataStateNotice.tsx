import { type HTMLAttributes, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleSlash2, Clock3, ServerOff, TriangleAlert } from 'lucide-react'
import { AlertBanner, type AlertVariant } from './AlertBanner'

export type DataStateKind = 'stale' | 'partial' | 'unavailable' | 'unsupported'

export interface DataStateNoticeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  state: DataStateKind
  title?: string
  message?: ReactNode
  children?: ReactNode
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
  ...props
}: DataStateNoticeProps) {
  const { t } = useTranslation()
  const config = stateConfig[state]
  const Icon = config.Icon
  const content =
    children ?? message ?? t(config.messageKey, config.message)

  return (
    <AlertBanner
      {...props}
      variant={config.variant}
      icon={<Icon className="h-5 w-5" />}
      title={title ?? t(config.titleKey, config.title)}
      data-data-state={state}
    >
      {content}
    </AlertBanner>
  )
}
