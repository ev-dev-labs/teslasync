/**
 * FleetTelemetryCoveragePage — modern-ui redesign.
 *
 * Operator-facing view of the package-derived Fleet Telemetry routing
 * snapshot. Renders, full-bleed:
 *
 * • the shared OperationalBrief (categories / routed / subscribed /
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

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'

import { PageLayout, LayoutCard, Masonry } from '@/components/layout'
import {
  GlassPanel,
  Badge,
  Button,
  Input,
  PanelTitle,
  Text,
  Caption,
} from '@/components/ui'
import {
  ChartSkeleton,
  EmptyState,
  ListSkeleton,
  QueryError,
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
import { usePageTitle } from '@/hooks/usePageTitle'

import { chartTokens, severityTokens } from '@/lib/tokens'
import { cn } from '@/lib/cn'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';
import { CoverageCategory } from '../components/continuation-admin-3/CoverageCategory';
import { CoverageOperationalBrief } from '../components/statstrip-coverage-flags-secrets/CoverageOperationalBrief';

export interface FleetTelemetryCoveragePageProps {
  /** Override the live hook for Storybook / tests. */
  testHookOverride?: ReturnType<typeof useFleetTelemetryCoverage>
}

export default function FleetTelemetryCoveragePage({
  testHookOverride,
}: FleetTelemetryCoveragePageProps = {}) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation()
  usePageTitle(t('coverage.pageTitle', 'Fleet Telemetry coverage'))

  const liveQuery = useFleetTelemetryCoverage()
  const query = testHookOverride ?? liveQuery
  const { data, isLoading, isFetching, refetch } = query
  const source = deriveDataState(query)
  const error = source.fatalError

  const [filter, setFilter] = useState('')

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

  return (
    <PageLayout
      title={t('coverage.pageTitle', 'Fleet Telemetry coverage')}
      subtitle={t(
        'coverage.subtitle',
        'Package-derived snapshot of which Tesla proto fields the build routes and which the current subscription pushes. Sourced from routing.yaml and teslaconfig.Builder — no per-vehicle telemetry counts.',
      )}
      query={query}
      dataSources={[{ id: 'fleet-telemetry-coverage', label: t('coverage.pageTitle', 'Fleet Telemetry coverage'), query }]}
      secondaryActions={
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
        <CoverageOperationalBrief query={query} />
      </FadeIn>

      {/* 2 — Primary bento: destination-distribution hero + reading legend */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('coverage.routing', 'Destination routing')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <div
            className="min-w-0 xl:col-span-2"
            data-testid="coverage-destinations-panel"
          >
          <LayoutCard title={t('coverage.destinations.title', 'Destination breakdown')}>
            <Caption className="mb-3 block">
              {t(
                'coverage.destinations.help',
                'Counts how many routed fields land in each storage destination. Fields routed with also_signal_log:true are counted under both their primary destination and signal_log, matching the runtime fan-out — totals may exceed the unique routed-fields count.',
              )}
            </Caption>
            {error ? <QueryError error={error} onRetry={() => void refetch()} /> : firstLoad ? (
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
                        <Badge variant="info" size="md" className="max-w-full whitespace-normal break-all" data-testid={`coverage-dest-${dest}`}>
                          {dest}: {fmtInt(count)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </LayoutCard>
          </div>

          <div className="min-w-0" data-testid="coverage-legend-panel">
          <LayoutCard title={t('coverage.legend.title', 'Reading this page')}>
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
          </LayoutCard>
          </div>
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
                  <Badge variant="warning" size="sm" className="max-w-full whitespace-normal break-all font-mono">
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
              <CoverageCategory key={cat.category} category={cat} filter={filter} />
            ))}
          </Masonry>
        </FadeIn>
      )}
    </PageLayout>
  )
}
