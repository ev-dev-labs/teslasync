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
import type { OperationalNarrative } from '@/types/operationalNarrative'
import type { MetricRaw } from '@/lib/metric-reference'
import { OperationalNarrativeDetails } from './OperationalNarrativeDetails'

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
  detail: ReactNode
  tone?: OperationalTone
  rawValue?: MetricRaw
  valueState?: 'value' | 'missing' | 'invalid'
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
  narrative?: OperationalNarrative
  className?: string
  testId?: string
  metricColumns?: 2 | 3 | 4
  /** Dense layout for pages where the evidence grid follows a compact page header. */
  compact?: boolean
  loading?: boolean
}

const TONE_TEXT: Record<OperationalTone, string> = {
  success: 'text-emerald-700 dark:text-emerald-300',
  info: 'text-sky-700 dark:text-sky-300',
  warning: 'text-amber-800 dark:text-amber-300',
  danger: 'text-rose-700 dark:text-rose-300',
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
  narrative,
  className,
  testId,
  metricColumns = 4,
  compact = false,
  loading = false,
}: OperationalBriefProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const primaryAttention = attention[0]
  const resolvedNarrative: OperationalNarrative = narrative ?? {
    whatChanged: description,
    whyItMatters: primaryAttention?.description ?? null,
    confidence: {
      label: 'not_scored',
      score: null,
      basis: [],
    },
    likelyCause: null,
    recommendedResponse: primaryAttention?.description ?? null,
    limitations: [],
    evidence: [],
    provenance: provenance ? [{ source: provenance }] : [],
  }

  return (
    <>
      <section aria-labelledby={titleId} data-testid={testId} data-operational-brief aria-busy={loading || undefined}>
        <GlassPanel
          className={cn(
            'overflow-hidden border-[var(--border-default)] bg-[var(--surface-1)] shadow-e1',
            className,
          )}
        >
          <div className={cn('border-s-2 border-[var(--theme-primary)]', compact ? 'p-3 sm:p-4' : 'p-4 sm:p-5')}>
            <div className={cn('flex flex-col xl:flex-row xl:justify-between', compact ? 'gap-2 xl:items-start' : 'gap-4 xl:items-start')}>
              <div className={cn('min-w-0', compact ? 'flex-1' : 'max-w-3xl')}>
                <div className={cn('flex flex-wrap items-center gap-2', !compact && 'mb-2')}>
                  <Text
                    as="span"
                    size="2xs"
                    weight="semibold"
                    color="muted"
                    className="tracking-[0.12em]"
                  >
                    {eyebrow}
                  </Text>
                  <Badge variant={statusTone} size="sm" dot>
                    {statusLabel}
                  </Badge>
                  {scope}
                  {freshness}
                </div>
                <PanelTitle id={titleId} className={compact ? 'mt-1 text-base' : undefined}>{title}</PanelTitle>
                <Text as="p" variant="bodySm" className={cn('mt-1', compact ? 'basis-full text-xs leading-snug' : 'max-w-2xl')}>
                  {description}
                </Text>
              </div>

              <div className={cn('flex flex-wrap items-center gap-2', compact && 'shrink-0 xl:flex-nowrap')}>
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
                compact ? 'mt-2 grid grid-cols-1 gap-px overflow-hidden rounded-shape-md border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-2' : 'mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-shape-md border border-[var(--border-subtle)] bg-[var(--border-subtle)]',
                compact ? 'md:grid-cols-3 min-[1920px]:grid-cols-6' : METRIC_COLUMNS[metricColumns],
              )}
            >
              {metrics.map((metric) => (
                <div
                  key={metric.key}
                  role="listitem"
                  data-operational-metric={metric.key}
                  data-value-state={metric.valueState}
                  className={cn('min-w-0 bg-[var(--surface-2)]', compact ? 'p-2.5 sm:p-3' : 'p-3 sm:p-4')}
                >
                  <div className={cn(compact && 'flex items-baseline justify-between gap-3')}>
                    <MetricLabel className={compact ? 'min-w-0 text-xs' : undefined}>{metric.label}</MetricLabel>
                    <MetricValue
                      data-operational-value={loading ? undefined : true}
                      className={cn(
                        compact ? 'min-w-0 break-words text-base sm:text-lg' : 'mt-1 break-words text-xl sm:text-2xl',
                        TONE_TEXT[metric.tone ?? 'neutral'],
                      )}
                    >
                      {loading ? (
                        <span aria-hidden="true" className="block h-5 w-20 max-w-full rounded bg-[var(--surface-3)] motion-safe:animate-pulse" />
                      ) : metric.value}
                    </MetricValue>
                  </div>
                  <Text as="div" size="2xs" color="muted" className="mt-1">
                    {metric.detail}
                  </Text>
                </div>
              ))}
            </div>

            {primaryAttention && (
              <div className={cn('flex flex-col rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] sm:flex-row sm:items-center', compact ? 'mt-2 gap-2 p-2.5' : 'mt-4 gap-3 p-3')}>
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
          <OperationalNarrativeDetails narrative={resolvedNarrative} />

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
                    aria-busy={loading || undefined}
                    className={cn('tabular-nums', TONE_TEXT[metric.tone ?? 'neutral'])}
                  >
                    {loading ? (
                      <span aria-hidden="true" className="block h-5 w-20 max-w-full rounded bg-[var(--surface-3)] motion-safe:animate-pulse" />
                    ) : metric.value}
                  </Text>
                </div>
                <Text as="div" size="xs" color="muted" className="mt-1">
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
        </div>
      </Drawer>
    </>
  )
}
