import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Drawer,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { Icons } from '@/lib/icons'

export type OperationalTone =
  | 'success'
  | 'info'
  | 'warning'
  | 'danger'
  | 'neutral'

export interface OperationalBriefMetric {
  key: string
  label: string
  value: ReactNode
  detail: string
  tone?: OperationalTone
}

export interface OperationalAttention {
  key: string
  title: string
  description: string
  tone?: OperationalTone
}

export interface OperationalBriefProps {
  eyebrow: string
  title: string
  description: string
  statusLabel: string
  statusTone?: OperationalTone
  metrics: readonly OperationalBriefMetric[]
  attention?: readonly OperationalAttention[]
  scope?: ReactNode
  freshness?: ReactNode
  actions?: ReactNode
  provenance?: string
  className?: string
  testId?: string
  metricColumns?: 2 | 3 | 4
}

const TONE_TEXT: Record<OperationalTone, string> = {
  success: 'text-emerald-300',
  info: 'text-cyan-300',
  warning: 'text-amber-300',
  danger: 'text-rose-300',
  neutral: 'text-[var(--text-primary)]',
}

const METRIC_COLUMNS: Record<NonNullable<OperationalBriefProps['metricColumns']>, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
}

export function OperationalBrief({
  eyebrow,
  title,
  description,
  statusLabel,
  statusTone = 'neutral',
  metrics,
  attention = [],
  scope,
  freshness,
  actions,
  provenance,
  className,
  testId,
  metricColumns = 4,
}: OperationalBriefProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const primaryAttention = attention[0]

  return (
    <>
      <section aria-labelledby={titleId} data-testid={testId}>
        <GlassPanel
          className={cn(
            'overflow-hidden border-[var(--border-default)] bg-[var(--surface-1)] shadow-e1',
            className,
          )}
        >
          <div className="border-s-2 border-[var(--theme-primary)] p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 max-w-3xl">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Text
                    as="span"
                    size="2xs"
                    weight="semibold"
                    color="muted"
                    className="uppercase tracking-[0.12em]"
                  >
                    {eyebrow}
                  </Text>
                  <Badge variant={statusTone} size="sm" dot>
                    {statusLabel}
                  </Badge>
                  {scope}
                  {freshness}
                </div>
                <PanelTitle id={titleId}>{title}</PanelTitle>
                <Text as="p" variant="bodySm" className="mt-1 max-w-2xl">
                  {description}
                </Text>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {actions}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  icon={<Icons.activity className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => setDetailsOpen(true)}
                >
                  {t('operations.reviewDetails', 'Review details')}
                </Button>
              </div>
            </div>

            <div
              role="list"
              className={cn(
                'mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-shape-md border border-[var(--border-subtle)] bg-[var(--border-subtle)]',
                METRIC_COLUMNS[metricColumns],
              )}
            >
              {metrics.map((metric) => (
                <div
                  key={metric.key}
                  role="listitem"
                  className="min-w-0 bg-[var(--surface-2)] p-3 sm:p-4"
                >
                  <MetricLabel>{metric.label}</MetricLabel>
                  <MetricValue
                    className={cn(
                      'mt-1 truncate text-xl sm:text-2xl',
                      TONE_TEXT[metric.tone ?? 'neutral'],
                    )}
                  >
                    {metric.value}
                  </MetricValue>
                  <Text as="p" size="2xs" color="muted" className="mt-1 line-clamp-2">
                    {metric.detail}
                  </Text>
                </div>
              ))}
            </div>

            {primaryAttention && (
              <div className="mt-4 flex flex-col gap-3 rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 sm:flex-row sm:items-center">
                <Icons.alertCircle
                  className={cn(
                    'h-4 w-4 shrink-0',
                    TONE_TEXT[primaryAttention.tone ?? 'info'],
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <Text as="p" size="sm" weight="semibold" color="primary">
                    {primaryAttention.title}
                  </Text>
                  <Text as="p" size="xs" color="muted">
                    {primaryAttention.description}
                  </Text>
                </div>
                {attention.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={<Icons.forward className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setDetailsOpen(true)}
                  >
                    {t('operations.reviewAll', 'Review all')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </GlassPanel>
      </section>

      <Drawer
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={t('operations.detailTitle', '{{title}} details', { title })}
        description={description}
        headerMeta={<Badge variant={statusTone} dot>{statusLabel}</Badge>}
      >
        <div className="space-y-6">
          <div className="space-y-3">
            <PanelTitle>{t('operations.metrics', 'Operational metrics')}</PanelTitle>
            {metrics.map((metric) => (
              <div
                key={metric.key}
                className="rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <MetricLabel>{metric.label}</MetricLabel>
                  <Text
                    as="span"
                    size="sm"
                    weight="bold"
                    className={cn('tabular-nums', TONE_TEXT[metric.tone ?? 'neutral'])}
                  >
                    {metric.value}
                  </Text>
                </div>
                <Text as="p" size="xs" color="muted" className="mt-1">
                  {metric.detail}
                </Text>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <PanelTitle>{t('operations.attention', 'Attention')}</PanelTitle>
            {attention.length > 0 ? (
              attention.map((item) => (
                <div
                  key={item.key}
                  className="rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <Text
                    as="p"
                    size="sm"
                    weight="semibold"
                    className={TONE_TEXT[item.tone ?? 'info']}
                  >
                    {item.title}
                  </Text>
                  <Text as="p" size="xs" color="muted" className="mt-1">
                    {item.description}
                  </Text>
                </div>
              ))
            ) : (
              <Text as="p" variant="bodySm">
                {t('operations.noAttention', 'No current attention items.')}
              </Text>
            )}
          </div>

          {provenance && (
            <div className="border-t border-[var(--border-subtle)] pt-4">
              <Text
                as="p"
                size="xs"
                color="muted"
                className="flex items-start gap-2"
              >
                <Icons.database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {provenance}
              </Text>
            </div>
          )}
        </div>
      </Drawer>
    </>
  )
}
