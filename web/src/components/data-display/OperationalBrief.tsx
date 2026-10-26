import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Drawer'
import { GlassPanel } from '../ui/GlassPanel'
import {
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '../ui/Typography'
import { cn } from '@/lib/cn'
import { Icons } from '@/lib/icons'
import { IconButton } from '@/components/ui/IconButton'
import type { OperationalNarrative } from '@/types/operationalNarrative'
import type { MetricRaw } from '@/lib/metric-reference'
import { OperationalNarrativeDetails } from './OperationalNarrativeDetails'
import { metricBanks } from './metricBanks'

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
  /** An independent source can override the Brief's shared loading state. */
  loading?: boolean
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
  analysisPeriod?: string | null
  narrative?: OperationalNarrative
  className?: string
  testId?: string
  metricColumns?: 2 | 3 | 4
  /** Maximum number of metric tiles per row; remaining rows are balanced. */
  maxPerRow?: 2 | 3 | 4
  /** Show a short scope chip on the card only when the range differs from the page filter. */
  showRange?: boolean
  /** Dense layout for pages where the evidence grid follows a compact page header. */
  compact?: boolean
  /** Keep the title for the details drawer while omitting a repeated inner heading. */
  hideHeading?: boolean
  /** Preserve the complete heading when user text scaling needs multiple lines. */
  wrapTitle?: boolean
  /** Render without a surface when this brief is already inside a card or widget. */
  variant?: 'standalone' | 'embedded'
  loading?: boolean
}

function BriefSurface({
  variant,
  className,
  children,
}: {
  variant: 'standalone' | 'embedded'
  className?: string
  children: ReactNode
}) {
  if (variant === 'embedded') {
    return <div data-operational-brief-surface="embedded" className={cn('min-w-0', className)}>{children}</div>
  }
  return (
    <GlassPanel
      data-operational-brief-surface="standalone"
      className={cn('overflow-hidden border-[var(--border-default)] bg-[var(--surface-1)] shadow-e1', className)}
    >
      {children}
    </GlassPanel>
  )
}

const TONE_TEXT: Record<OperationalTone, string> = {
  success: 'text-[var(--semantic-success)]',
  info: 'text-[var(--semantic-info)]',
  warning: 'text-[var(--semantic-warning)]',
  danger: 'text-[var(--semantic-danger)]',
  neutral: 'text-[var(--text-primary)]',
}

function metricState(metric: OperationalBriefMetric): NonNullable<OperationalBriefMetric['valueState']> {
  if (metric.valueState) return metric.valueState
  if (metric.value == null) return 'missing'
  if (typeof metric.value === 'string' && ['-', '\u2014', 'Not provided', 'No measurement supplied'].includes(metric.value.trim())) return 'missing'
  return 'value'
}

function hasMetricExplanation(detail: ReactNode): boolean {
  if (typeof detail !== 'string') return detail != null
  return ![
    'not provided',
    'no confidence basis was supplied.',
    'no measurement supplied',
    'no supporting records were supplied.',
    'calculation provenance was not supplied.',
  ].includes(detail.trim().toLowerCase())
}

function renderMetadata(value: ReactNode): ReactNode {
  return typeof value === 'number' || (typeof value === 'string' && value !== '')
    ? <span>{value}</span>
    : value
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
  analysisPeriod,
  narrative,
  className,
  testId,
  showRange = false,
  compact = false,
  hideHeading = false,
  wrapTitle = false,
  variant = 'standalone',
  metricColumns,
  maxPerRow,
  loading = false,
}: OperationalBriefProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const primaryAttention = attention[0]
  const metricStates = metrics.map(metricState)
  const visibleMetrics = metrics.filter((metric, index) => (metric.loading ?? loading) || metricStates[index] === 'value')
  const resolvedMaxPerRow = maxPerRow ?? metricColumns ?? 3
  const metricRows = metricBanks(visibleMetrics, resolvedMaxPerRow)
  const emptyMetrics = metrics.length > 0 && visibleMetrics.length === 0
  const hiddenMetricCount = metrics.length - visibleMetrics.length
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
      <section aria-labelledby={hideHeading ? undefined : titleId} data-testid={testId} data-operational-brief aria-busy={loading || undefined}>
        <BriefSurface variant={variant} className={className}>
          <div className={cn(variant === 'embedded' ? 'min-w-0' : compact ? 'p-3 sm:p-4' : 'p-4 sm:p-5')}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              {!hideHeading && <PanelTitle id={titleId} className={cn('min-w-0 flex-1', wrapTitle ? 'whitespace-normal break-words' : 'truncate', compact ? 'text-base' : undefined)} title={title}>{title}</PanelTitle>}
              {showRange && scope && <span className="shrink-0 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{scope}</span>}
              <div className="flex shrink-0 items-center gap-2">
                {actions}
                <IconButton
                  icon={<Icons.activity className="h-4 w-4" aria-hidden="true" />}
                  label={t('operations.reviewDetails', 'Review details')}
                  aria-label={t('operations.reviewDetails', 'Review details')}
                  variant="ghost"
                  onClick={() => setDetailsOpen(true)}
                />
              </div>
            </div>

            <div
              className={cn('flex min-w-0 flex-col gap-y-3', compact ? 'mt-2' : 'mt-4')}
              data-max-per-row={resolvedMaxPerRow}
            >
              {emptyMetrics ? (
                <div className="min-w-0 flex-[1_1_200px] py-2" role="listitem">
                  <Text as="p" size="sm" weight="medium">{t('operations.noMetricValues', 'No metric values are available yet.')}</Text>
                  <Text as="p" size="xs" color="muted" className="mt-1">{t('operations.metricValuesAppear', 'Values will appear when the source provides measurements.')}</Text>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {metrics.map((metric) => <span key={metric.key} className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{metric.label}</span>)}
                  </div>
                </div>
              ) : metricRows.map((row, rowIndex) => (
                <div key={rowIndex} role="list" className="flex min-w-0 flex-wrap gap-x-5 gap-y-3"
                  data-operational-metric-bank data-columns={row.length}>
                  {row.map((metric) => (
                    <div
                      key={metric.key}
                      role="listitem"
                      data-operational-metric={metric.key}
                      data-value-state={metric.valueState}
                      className="min-w-0 flex-[1_1_200px] py-1"
                    >
                      <MetricLabel>{metric.label}</MetricLabel>
                      <MetricValue
                        data-operational-value={(metric.loading ?? loading) ? undefined : true}
                        aria-busy={(metric.loading ?? loading) || undefined}
                        className={cn(
                          compact ? 'mt-1 min-w-0 text-base sm:text-lg' : 'mt-1 text-xl sm:text-2xl',
                          '[overflow-wrap:normal] break-normal',
                          TONE_TEXT[metric.tone ?? 'neutral'],
                        )}
                      >
                        {(metric.loading ?? loading) ? (
                          <span aria-hidden="true" className="block h-5 w-20 max-w-full rounded bg-[var(--surface-3)]" />
                        ) : metric.value}
                      </MetricValue>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {primaryAttention && (
              <div className={cn('flex min-w-0 flex-col border-t border-[var(--border-subtle)] pt-3 sm:flex-row sm:items-center', compact ? 'mt-2 gap-2' : 'mt-4 gap-3')}>
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
                    wrapLabel
                    className="min-h-11 md:min-h-9"
                    icon={<Icons.forward className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setDetailsOpen(true)}
                  >
                    {t('operations.reviewAll', 'Review all')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </BriefSurface>
      </section>

      <Drawer
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={t('operations.detailTitle', '{{title}} details', { title })}
        eyebrow={eyebrow !== title ? eyebrow : undefined}
        description={description}
        headerMeta={
          <>
            <Badge variant={statusTone} dot>{statusLabel}</Badge>
            {renderMetadata(scope)}
            {renderMetadata(freshness)}
          </>
        }
      >
        <div className="space-y-6">
          <OperationalNarrativeDetails narrative={resolvedNarrative} analysisPeriod={analysisPeriod} />

          <div className="space-y-3">
            <PanelTitle>{t('operations.metrics', 'Operational metrics')}</PanelTitle>
            {emptyMetrics ? (
              <div className="space-y-2">
                <Text as="p" size="sm">{t('operations.noMetricValues', 'No metric values are available yet.')}</Text>
                <Text as="p" size="xs" color="muted">{t('operations.metricValuesAppear', 'Values will appear when the source provides measurements.')}</Text>
                <div className="flex flex-wrap gap-1.5">{metrics.map((metric) => <span key={metric.key} className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{metric.label}</span>)}</div>
              </div>
            ) : visibleMetrics.map((metric) => (
              <div
                key={metric.key}
                role="group"
                aria-label={metric.label}
                className="rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
                  <MetricLabel>{metric.label}</MetricLabel>
                  <Text
                    as="span"
                    size="sm"
                    weight="bold"
                    aria-busy={(metric.loading ?? loading) || undefined}
                    className={cn('min-w-0 break-words tabular-nums', TONE_TEXT[metric.tone ?? 'neutral'])}
                  >
                    {(metric.loading ?? loading) ? (
                      <span aria-hidden="true" className="block h-5 w-20 max-w-full rounded bg-[var(--surface-3)]" />
                    ) : metric.value}
                  </Text>
                </div>
                {hasMetricExplanation(metric.detail) && (
                  <Text as="div" size="xs" color="muted" className="mt-1">
                    {metric.detail}
                  </Text>
                )}
              </div>
            ))}
            {hiddenMetricCount > 0 && (
              <Text as="p" size="xs" color="muted">
                {t('operations.emptyFieldsHidden', '{{count}} empty fields are hidden.', {
                  count: hiddenMetricCount,
                  defaultValue_one: '{{count}} empty field is hidden.',
                  defaultValue_other: '{{count}} empty fields are hidden.',
                })}
              </Text>
            )}
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
