/**
 * FleetTelemetryCoveragePage — Phase-43a / Prompt 0002.
 *
 * Operator-facing view of the package-derived Fleet Telemetry routing
 * snapshot. Renders one section per protomodel Category with:
 *
 *   • category name + total routed fields
 *   • per-destination counts within the category
 *   • a per-field DataTable: field name, destination, column,
 *     also_signal_log dual-write flag, subscribed flag
 *
 * The page also surfaces global summary stats (total categories /
 * fields / subscribed / unsubscribed-routed / orphans) and a warning
 * panel when `orphan_fields` is non-empty (a non-empty list is a
 * routing.yaml drift alert).
 *
 * The data source is `GET /api/v1/tesla/fleet-telemetry/coverage` —
 * package-derived (router.LoadMap + protomodel.Signals +
 * teslaconfig.Builder), DB-free, per ADR-004 #2. This page deliberately
 * does NOT show per-vehicle "last payload at" or "fields seen in last
 * 24h" — those are properties of the runtime telemetry stream and would
 * need a separate signal_log-backed endpoint at a different URL.
 *
 * `destination_totals` counts dual-written fields under both their
 * primary destination AND `signal_log`, matching the runtime fan-out
 * semantics of the router. The page calls this out via helper text so
 * "destination_totals.signal_log > sum(per_dest)" doesn't look like a
 * bug.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  Input,
  type Column,
} from '@/components/ui'
import { Heading, Text, Caption } from '@/components/ui/Typography'
import { StatCard } from '@/components/data-display'
import { Spinner, EmptyState } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useFleetTelemetryCoverage } from '@/api/hooks/useFleetTelemetry'
import type {
  FleetTelemetryCategoryCoverage,
  FleetTelemetryFieldCoverage,
  FleetTelemetryCoverageResponse,
} from '@/api/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { fmtInt } from '@/lib/numberFormat'

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
}

function summarise(data: FleetTelemetryCoverageResponse | undefined): SummaryStats {
  if (!data) {
    return {
      totalCategories: 0,
      totalRoutedFields: 0,
      subscribedFields: 0,
      unsubscribedRoutedFields: 0,
      orphanFields: 0,
    }
  }
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
        <span className="font-mono text-sm text-[var(--text-primary)]">{row.field}</span>
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
          <span className="font-mono text-xs text-[var(--text-secondary)]">{row.column}</span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">—</span>
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
          <span className="text-xs text-[var(--text-muted)]">—</span>
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
      className="p-5"
      data-testid={`coverage-category-${category.category}`}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading level="panel" className="mb-1">
            {category.category}
          </Heading>
          <Caption>
            {t('coverage.category.totalFields', '{{count}} routed fields', {
              count: category.total_fields,
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
        <Text variant="bodySm" className="italic text-[var(--text-muted)]">
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

  return (
    <PageContainer
      title={t('coverage.pageTitle', 'Fleet Telemetry Coverage')}
      subtitle={t(
        'coverage.subtitle',
        'Package-derived snapshot of which Tesla proto fields the build routes and which the current subscription pushes. Sourced from routing.yaml and teslaconfig.Builder — no per-vehicle telemetry counts.',
      )}
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
      <FadeIn>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div data-testid="coverage-stat-categories">
            <StatCard
              label={t('coverage.stat.categories', 'Categories')}
              value={fmtInt(stats.totalCategories)}
            />
          </div>
          <div data-testid="coverage-stat-routed">
            <StatCard
              label={t('coverage.stat.routedFields', 'Routed fields')}
              value={fmtInt(stats.totalRoutedFields)}
            />
          </div>
          <div data-testid="coverage-stat-subscribed">
            <StatCard
              label={t('coverage.stat.subscribed', 'Subscribed')}
              value={fmtInt(stats.subscribedFields)}
            />
          </div>
          <div data-testid="coverage-stat-unsubscribed">
            <StatCard
              label={t('coverage.stat.routedNotSubscribed', 'Routed, not subscribed')}
              value={fmtInt(stats.unsubscribedRoutedFields)}
            />
          </div>
          <div data-testid="coverage-stat-orphans">
            <StatCard
              label={t('coverage.stat.orphans', 'Orphan fields')}
              value={fmtInt(stats.orphanFields)}
            />
          </div>
        </div>
      </FadeIn>

      <FadeIn>
        <GlassPanel className="p-5" data-testid="coverage-destinations-panel">
          <Heading level="panel" className="mb-1">
            {t('coverage.destinations.title', 'Destination breakdown')}
          </Heading>
          <Caption className="mb-3 block">
            {t(
              'coverage.destinations.help',
              'Counts how many routed fields land in each storage destination. Fields routed with also_signal_log:true are counted under both their primary destination and signal_log, matching the runtime fan-out — totals may exceed the unique routed-fields count.',
            )}
          </Caption>
          {sortedDestinations.length === 0 ? (
            <Text
              variant="bodySm"
              className="italic text-[var(--text-muted)]"
              data-testid="coverage-destinations-empty"
            >
              {t('coverage.destinations.empty', 'No destinations reported.')}
            </Text>
          ) : (
            <div
              className="flex flex-wrap gap-2"
              data-testid="coverage-destinations-list"
            >
              {sortedDestinations.map(([dest, count]) => (
                <Badge
                  key={dest}
                  variant="info"
                  size="md"
                  data-testid={`coverage-dest-${dest}`}
                >
                  {dest}: {fmtInt(count)}
                </Badge>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {orphans.length > 0 ? (
        <FadeIn>
          <GlassPanel
            className="border border-amber-500/30 bg-amber-500/5 p-5"
            data-testid="coverage-orphans-panel"
          >
            <div className="mb-2 flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                aria-hidden
              />
              <div>
                <Heading level="panel" className="mb-1 text-amber-200">
                  {t('coverage.orphans.title', 'Orphan fields detected')}
                </Heading>
                <Caption>
                  {t(
                    'coverage.orphans.help',
                    'These routing.yaml entries reference Field names not present in protomodel.SignalsByName and not a strict prefix-extension of a compound parent. This is a deployment drift between the vendored Tesla proto and routing.yaml — investigate before relying on the affected destinations.',
                  )}
                </Caption>
              </div>
            </div>
            <ul className="ml-6 list-disc space-y-0.5">
              {orphans.map((orphan) => (
                <li key={orphan} className="font-mono text-sm text-amber-100">
                  {orphan}
                </li>
              ))}
            </ul>
          </GlassPanel>
        </FadeIn>
      ) : null}

      <FadeIn>
        <GlassPanel className="p-5" data-testid="coverage-filter-panel">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t(
              'coverage.filter.placeholder',
              'Filter by field name, destination, or column…',
            )}
            data-testid="coverage-filter-input"
          />
        </GlassPanel>
      </FadeIn>

      {isLoading ? (
        <div
          className="flex items-center gap-3 py-6 text-[var(--text-secondary)]"
          data-testid="coverage-loading"
        >
          <Spinner size="sm" />
          <Text variant="bodySm">
            {t('coverage.loading', 'Loading routing snapshot…')}
          </Text>
        </div>
      ) : error ? (
        <GlassPanel
          className="border border-rose-500/30 bg-rose-500/5 p-4"
          data-testid="coverage-error"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-rose-300"
              aria-hidden
            />
            <Text variant="bodySm" className="text-rose-200">
              {t(
                'coverage.error',
                'Could not load Fleet Telemetry coverage. Check API logs and try again.',
              )}
            </Text>
          </div>
        </GlassPanel>
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
          {/* no-action: filter is right above the panel — clearing it is the only recovery */}
          <EmptyState
            message={t('coverage.filterEmpty', 'No categories match the current filter.')}
          />
        </div>
      ) : (
        <div className="space-y-4" data-testid="coverage-categories">
          {filteredCategories.map((cat) => (
            <FadeIn key={cat.category}>
              <CategorySection category={cat} filter={filter} />
            </FadeIn>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
