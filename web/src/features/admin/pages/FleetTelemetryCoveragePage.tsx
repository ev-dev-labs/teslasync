/**
 * FleetTelemetryCoveragePage — modern-ui redesign.
 *
 * Operator-facing view of the package-derived Fleet Telemetry routing
 * snapshot. Renders, full-bleed:
 *
 * • a responsive KPI band (categories / routed / subscribed /
 *   routed-not-subscribed / orphans / subscription-coverage %)
 * • a primary bento — the destination-distribution bar chart (hero,
 *   spanning two columns on wide screens) beside a "reading this page"
 *   legend panel
 * • a conditional orphan-fields drift-warning band
 * • a filter toolbar with a live result count
 * • one responsive card per protomodel Category, each with a per-field
 *   DataTable: field name, destination, column, also_signal_log
 *   dual-write flag, subscribed flag
 *
 * Data source: GET /tesla/fleet-telemetry/coverage — package-derived
 * (router.LoadMap + protomodel.Signals + teslaconfig.Builder), DB-free,
 * per ADR-004 #2. This page deliberately does NOT show per-vehicle "last
 * payload at" or "fields seen in last 24h" — those are properties of the
 * runtime telemetry stream and would need a separate signal_log-backed
 * endpoint at a different URL.
 *
 * `destination_totals` counts dual-written fields under BOTH their primary
 * destination AND signal_log, matching the runtime fan-out semantics of
 * the router — the legend calls this out so totals exceeding the unique
 * routed-fields count don't look like a bug.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  RefreshCw,
  Layers,
  Route as RouteIcon,
  Radio,
  Unplug,
  Unlink,
  Gauge,
  Database,
  BookOpen,
} from 'lucide-react'

import { PageContainer, Masonry } from '@/components/layout'
import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  Input,
  PanelTitle,
  Text,
  Caption,
  type Column,
} from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import {
  ChartSkeleton,
  EmptyState,
  ListSkeleton,
  QueryError,
  Skeleton,
} from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
  ChartTooltip,
  axisTick,
  EmbeddedChart,
} from '@/components/charts'
import { useFleetTelemetryCoverage } from '@/api/hooks/useFleetTelemetry'
import type {
  FleetTelemetryCategoryCoverage,
  FleetTelemetryFieldCoverage,
  FleetTelemetryCoverageResponse,
} from '@/api/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { fmtInt, fmtPercent } from '@/lib/numberFormat'
import { chartTokens, severityTokens, type NeonColor } from '@/lib/tokens'
import { cn } from '@/lib/cn'

export interface FleetTelemetryCoveragePageProps {
  /** Override the live hook for Storybook / tests. */
  testHookOverride?: ReturnType<typeof useFleetTelemetryCoverage>
}

interface SummaryStats {
  totalCategories: number
  totalRoutedFields: number
  subscribedFields: number
  unsubscribedRoutedFields: number
  orphanFields: number
  /** subscribed / routed, as a 0–100 percentage. */
  subscriptionCoverage: number
}

interface Kpi {
  id: string
  testId: string
  label: string
  value: string
  icon: ReactNode
  color: NeonColor
}

function summarise(data: FleetTelemetryCoverageResponse | undefined): SummaryStats {
  const empty: SummaryStats = {
    totalCategories: 0,
    totalRoutedFields: 0,
    subscribedFields: 0,
    unsubscribedRoutedFields: 0,
    orphanFields: 0,
    subscriptionCoverage: 0,
  }
  if (!data) return empty
  const categories = data.categories ?? []
  let totalRoutedFields = 0
  let subscribedFields = 0
  for (const cat of categories) {
    const fields = cat.fields ?? []
    totalRoutedFields += fields.length
    for (const f of fields) {
      if (f.subscribed) subscribedFields += 1
    }
  }
  return {
    totalCategories: categories.length,
    totalRoutedFields,
    subscribedFields,
    unsubscribedRoutedFields: totalRoutedFields - subscribedFields,
    orphanFields: (data.orphan_fields ?? []).length,
    subscriptionCoverage:
      totalRoutedFields > 0 ? (subscribedFields / totalRoutedFields) * 100 : 0,
  }
}

function buildFieldColumns(
  t: (key: string, fb: string) => string,
): Column<FleetTelemetryFieldCoverage>[] {
  return [
    {
      key: 'field',
      header: t('coverage.col.field', 'Field'),
      sortable: true,
      render: (row) => (
        <Text as="span" mono size="sm" color="primary">
          {row.field}
        </Text>
      ),
    },
    {
      key: 'destination',
      header: t('coverage.col.destination', 'Destination'),
      sortable: true,
      render: (row) => (
        <Badge variant="info" size="sm">
          {row.destination}
        </Badge>
      ),
    },
    {
      key: 'column',
      header: t('coverage.col.column', 'Column'),
      sortable: true,
      render: (row) =>
        row.column ? (
          <Text as="span" mono size="xs" color="secondary">
            {row.column}
          </Text>
        ) : (
          <Text as="span" size="xs" color="muted">
            —
          </Text>
        ),
    },
    {
      key: 'also_signal_log',
      header: t('coverage.col.dualWrite', 'Dual write'),
      render: (row) =>
        row.also_signal_log ? (
          <Badge variant="warning" size="sm">
            {t('coverage.dualWrite.yes', 'signal_log')}
          </Badge>
        ) : (
          <Text as="span" size="xs" color="muted">
            —
          </Text>
        ),
    },
    {
      key: 'subscribed',
      header: t('coverage.col.subscribed', 'Subscribed'),
      sortable: true,
      render: (row) =>
        row.subscribed ? (
          <Badge variant="success" size="sm">
            {t('coverage.subscribed.yes', 'yes')}
          </Badge>
        ) : (
          <Badge variant="neutral" size="sm">
            {t('coverage.subscribed.no', 'no')}
          </Badge>
        ),
    },
  ]
}

/** One protomodel Category: header + destination chips + a per-field table. */
function CategorySection({
  category,
  filter,
}: {
  category: FleetTelemetryCategoryCoverage
  filter: string
}) {
  const { t } = useTranslation()
  const fields = category.fields ?? []
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return fields
    return fields.filter(
      (f) =>
        f.field.toLowerCase().includes(q) ||
        f.destination.toLowerCase().includes(q) ||
        (f.column ?? '').toLowerCase().includes(q),
    )
  }, [fields, filter])
  const columns = useMemo(() => buildFieldColumns(t), [t])
  const destinations = category.destinations ?? {}
  const destEntries = Object.entries(destinations).sort((a, b) => b[1] - a[1])

  return (
    <GlassPanel
      className="h-full p-4 sm:p-5"
      data-testid={`coverage-category-${category.category}`}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <PanelTitle className="mb-1 truncate">{category.category}</PanelTitle>
          <Caption>
            {t('coverage.category.totalFields', '{{count}} routed fields', {
              count: category.total_fields ?? 0,
            })}
          </Caption>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {destEntries.map(([dest, count]) => (
            <Badge
              key={dest}
              variant="neutral"
              size="sm"
              data-testid={`coverage-cat-dest-${category.category}-${dest}`}
            >
              {dest}: {fmtInt(count)}
            </Badge>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <Text as="p" size="sm" color="muted" className="italic">
          {t('coverage.category.noMatch', 'No fields match the current filter.')}
        </Text>
      ) : (
        <div data-testid={`coverage-fields-${category.category}`}>
          <DataTable<FleetTelemetryFieldCoverage>
            tableId={`coverage:fields:${category.category}`}
            data={filtered}
            columns={columns}
            keyExtractor={(row) => `${category.category}:${row.field}`}
            emptyMessage={t('coverage.category.empty', 'This category has no routed fields.')}
          />
        </div>
      )}
    </GlassPanel>
  )
}

export default function FleetTelemetryCoveragePage({
  testHookOverride,
}: FleetTelemetryCoveragePageProps = {}) {
  const { t } = useTranslation()
  usePageTitle(t('coverage.pageTitle', 'Fleet Telemetry Coverage'))

  const liveQuery = useFleetTelemetryCoverage()
  const query = testHookOverride ?? liveQuery
  const { data, isLoading, isFetching, error, refetch } = query

  const [filter, setFilter] = useState('')

  const stats = useMemo(() => summarise(data), [data])
  const destinationTotals = data?.destination_totals ?? {}
  const sortedDestinations = useMemo(
    () => Object.entries(destinationTotals).sort((a, b) => b[1] - a[1]),
    [destinationTotals],
  )
  const destChartData = useMemo(
    () => sortedDestinations.map(([dest, count]) => ({ dest, count })),
    [sortedDestinations],
  )
  // Horizontal bars need height proportional to the bar count so labels stay
  // legible; clamp to a sane floor for one or two destinations.
  const destChartHeight = Math.max(200, destChartData.length * 44)
  const orphans = data?.orphan_fields ?? []
  const categories = data?.categories ?? []

  const filteredCategories = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return categories
    return categories.filter((cat) => {
      if (cat.category.toLowerCase().includes(q)) return true
      return (cat.fields ?? []).some(
        (f) =>
          f.field.toLowerCase().includes(q) ||
          f.destination.toLowerCase().includes(q) ||
          (f.column ?? '').toLowerCase().includes(q),
      )
    })
  }, [categories, filter])

  // Only the first paint (no data yet) shows skeletons; background refetches
  // keep the last snapshot on screen so the layout never jumps.
  const firstLoad = isLoading && !data

  const kpis: Kpi[] = [
    {
      id: 'categories',
      testId: 'coverage-stat-categories',
      label: t('coverage.stat.categories', 'Categories'),
      value: fmtInt(stats.totalCategories),
      icon: <Layers className="h-5 w-5" aria-hidden />,
      color: 'cyan',
    },
    {
      id: 'routed',
      testId: 'coverage-stat-routed',
      label: t('coverage.stat.routedFields', 'Routed fields'),
      value: fmtInt(stats.totalRoutedFields),
      icon: <RouteIcon className="h-5 w-5" aria-hidden />,
      color: 'blue',
    },
    {
      id: 'subscribed',
      testId: 'coverage-stat-subscribed',
      label: t('coverage.stat.subscribed', 'Subscribed'),
      value: fmtInt(stats.subscribedFields),
      icon: <Radio className="h-5 w-5" aria-hidden />,
      color: 'green',
    },
    {
      id: 'unsubscribed',
      testId: 'coverage-stat-unsubscribed',
      label: t('coverage.stat.routedNotSubscribed', 'Routed, not subscribed'),
      value: fmtInt(stats.unsubscribedRoutedFields),
      icon: <Unplug className="h-5 w-5" aria-hidden />,
      color: 'amber',
    },
    {
      id: 'orphans',
      testId: 'coverage-stat-orphans',
      label: t('coverage.stat.orphans', 'Orphan fields'),
      value: fmtInt(stats.orphanFields),
      icon: <Unlink className="h-5 w-5" aria-hidden />,
      color: stats.orphanFields > 0 ? 'red' : 'green',
    },
    {
      id: 'coverage',
      testId: 'coverage-stat-coverage',
      label: t('coverage.stat.subscriptionCoverage', 'Subscription coverage'),
      value: fmtPercent(stats.subscriptionCoverage, 0),
      icon: <Gauge className="h-5 w-5" aria-hidden />,
      color: 'purple',
    },
  ]

  return (
    <PageContainer
      title={t('coverage.pageTitle', 'Fleet Telemetry Coverage')}
      subtitle={t(
        'coverage.subtitle',
        'Package-derived snapshot of which Tesla proto fields the build routes and which the current subscription pushes. Sourced from routing.yaml and teslaconfig.Builder — no per-vehicle telemetry counts.',
      )}
      query={query}
      actions={
        <Button
          variant="ghost"
          onClick={() => {
            void refetch()
          }}
          loading={isFetching && !isLoading}
          disabled={isFetching}
          icon={<RefreshCw className="h-4 w-4" aria-hidden />}
          data-testid="coverage-refresh-button"
        >
          {t('coverage.refresh', 'Refresh')}
        </Button>
      }
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('coverage.kpis', 'Coverage summary')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
        >
          {firstLoad
            ? Array.from({ length: 6 }).map((_, i) => (
                <GlassPanel key={i} className="space-y-2 p-4">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-7 w-24" />
                </GlassPanel>
              ))
            : kpis.map((k) => (
                <div key={k.id} data-testid={k.testId}>
                  <MetricCard label={k.label} value={k.value} icon={k.icon} color={k.color} />
                </div>
              ))}
        </section>
      </FadeIn>

      {/* 2 — Primary bento: destination-distribution hero + reading legend */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('coverage.routing', 'Destination routing')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <GlassPanel
            className="p-4 sm:p-5 xl:col-span-2"
            data-testid="coverage-destinations-panel"
          >
            <PanelTitle className="mb-1 flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-300" aria-hidden />
              {t('coverage.destinations.title', 'Destination breakdown')}
            </PanelTitle>
            <Caption className="mb-3 block">
              {t(
                'coverage.destinations.help',
                'Counts how many routed fields land in each storage destination. Fields routed with also_signal_log:true are counted under both their primary destination and signal_log, matching the runtime fan-out — totals may exceed the unique routed-fields count.',
              )}
            </Caption>
            {firstLoad ? (
              <ChartSkeleton />
            ) : (
              <>
                <EmbeddedChart
                  title={t('coverage.destinations.title', 'Destination breakdown')}
                  ariaLabel={t('coverage.destinations.aria', 'Horizontal bar chart showing routed field counts per destination')}
                  empty={sortedDestinations.length === 0}
                  emptyMessage={t('coverage.destinations.empty', 'No destinations reported.')}
                  fluid={false}
                  height={destChartHeight}
                  data={destChartData}
                  dataColumns={[
                    { key: 'dest', label: t('coverage.col.destination', 'Destination') },
                    { key: 'count', label: t('coverage.destinations.routedFields', 'Routed fields') },
                  ]}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={destChartData}
                      layout="vertical"
                      margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
                    >
                      <CartesianGrid
                        horizontal={false}
                        stroke={chartTokens.gridStroke}
                        strokeOpacity={0.4}
                      />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={axisTick}
                      />
                      <YAxis
                        type="category"
                        dataKey="dest"
                        width={148}
                        tick={axisTick}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        content={<ChartTooltip />}
                      />
                      <Bar
                        dataKey="count"
                        name={t('coverage.destinations.routedFields', 'Routed fields')}
                        radius={[0, 4, 4, 0]}
                      >
                        {destChartData.map((entry, i) => (
                          <Cell
                            key={entry.dest}
                            fill={chartTokens.series[i % chartTokens.series.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </EmbeddedChart>
                {/* Color-independent, testable fallback for the chart above. */}
                {sortedDestinations.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2" data-testid="coverage-destinations-list">
                    {sortedDestinations.map(([dest, count]) => (
                      <li key={dest}>
                        <Badge variant="info" size="md" data-testid={`coverage-dest-${dest}`}>
                          {dest}: {fmtInt(count)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5" data-testid="coverage-legend-panel">
            <PanelTitle className="mb-1 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden />
              {t('coverage.legend.title', 'Reading this page')}
            </PanelTitle>
            <Caption className="mb-3 block">
              {t(
                'coverage.legend.intro',
                'Each row is one Tesla telemetry field declared in routing.yaml. The dashes below mean "not applicable" for that field — they are expected, not missing data.',
              )}
            </Caption>
            <ul className="space-y-3">
              <li data-testid="coverage-legend-column">
                <Text as="span" size="sm" weight="semibold" color="primary">
                  {t('coverage.legend.columnLabel', 'Column')}
                </Text>{' '}
                <Text as="span" size="sm" color="secondary">
                  {t(
                    'coverage.legend.columnHelp',
                    '— the typed destination column. A dash means the field is stored in signal_log, a generic key/value table where the field name itself is the key — there is no per-field column.',
                  )}
                </Text>
              </li>
              <li data-testid="coverage-legend-dual-write">
                <Text as="span" size="sm" weight="semibold" color="primary">
                  {t('coverage.legend.dualWriteLabel', 'Dual write')}
                </Text>{' '}
                <Text as="span" size="sm" color="secondary">
                  {t(
                    'coverage.legend.dualWriteHelp',
                    '— marks fields written to both their primary table AND signal_log (for replay and historical reconstruction). A dash means single-write only, which is the normal case.',
                  )}
                </Text>
              </li>
              <li data-testid="coverage-legend-subscribed">
                <Text as="span" size="sm" weight="semibold" color="primary">
                  {t('coverage.legend.subscribedLabel', 'Subscribed')}
                </Text>{' '}
                <Text as="span" size="sm" color="secondary">
                  {t(
                    'coverage.legend.subscribedHelp',
                    '— whether Tesla Fleet Telemetry is currently pushing this field to us. "No" means the writer is wired but the subscription request omits the field.',
                  )}
                </Text>
              </li>
            </ul>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Orphan-fields drift warning (only when routing.yaml has drifted) */}
      {orphans.length > 0 ? (
        <FadeIn delay={0.15}>
          <GlassPanel
            className={cn('p-4 sm:p-5', severityTokens.warn.bg, severityTokens.warn.border)}
            data-testid="coverage-orphans-panel"
          >
            <div className="mb-3 flex items-start gap-2">
              <AlertTriangle
                className={cn('mt-0.5 h-4 w-4 shrink-0', severityTokens.warn.fg)}
                aria-hidden
              />
              <div>
                <PanelTitle className="mb-1">
                  {t('coverage.orphans.title', 'Orphan fields detected')}
                </PanelTitle>
                <Caption>
                  {t(
                    'coverage.orphans.help',
                    'These routing.yaml entries reference Field names not present in protomodel.SignalsByName and not a strict prefix-extension of a compound parent. This is a deployment drift between the vendored Tesla proto and routing.yaml — investigate before relying on the affected destinations.',
                  )}
                </Caption>
              </div>
            </div>
            <ul className="flex flex-wrap gap-2">
              {orphans.map((orphan) => (
                <li key={orphan}>
                  <Badge variant="warning" size="sm" className="font-mono">
                    {orphan}
                  </Badge>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </FadeIn>
      ) : null}

      {/* 4 — Filter toolbar with a live result count */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5" data-testid="coverage-filter-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t(
                  'coverage.filter.placeholder',
                  'Filter by field name, destination, or column…',
                )}
                aria-label={t(
                  'coverage.filter.placeholder',
                  'Filter by field name, destination, or column…',
                )}
                data-testid="coverage-filter-input"
              />
            </div>
            <Caption className="shrink-0">
              {t('coverage.filter.results', 'Showing {{shown}} of {{total}} categories', {
                shown: filteredCategories.length,
                total: categories.length,
              })}
            </Caption>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* 5 — Categories detail band: full-width, reflows to more columns wide */}
      {firstLoad ? (
        <ListSkeleton
          rows={5}
          label={t('coverage.loading', 'Loading routing snapshot…')}
          testId="coverage-loading"
        />
      ) : error ? (
        <div data-testid="coverage-error">
          <QueryError
            error={error}
            onRetry={() => {
              void refetch()
            }}
          />
        </div>
      ) : categories.length === 0 ? (
        <div data-testid="coverage-empty">
          {/* no-action: package-derived snapshot — no user action recovers an empty routing.yaml */}
          <EmptyState
            message={t(
              'coverage.empty',
              'No categories returned. The embedded routing.yaml may be empty or the loader failed silently.',
            )}
          />
        </div>
      ) : filteredCategories.length === 0 ? (
        <div data-testid="coverage-filter-empty">
          {/* no-action: filter is right above the band — clearing it is the only recovery */}
          <EmptyState
            message={t('coverage.filterEmpty', 'No categories match the current filter.')}
          />
        </div>
      ) : (
        <FadeIn delay={0.3}>
          <Masonry
            className="columns-1 2xl:columns-2 3xl:columns-3"
            data-testid="coverage-categories"
          >
            {filteredCategories.map((cat) => (
              <CategorySection key={cat.category} category={cat} filter={filter} />
            ))}
          </Masonry>
        </FadeIn>
      )}
    </PageContainer>
  )
}
