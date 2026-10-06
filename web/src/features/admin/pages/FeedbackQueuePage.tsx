import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Caption,
  Code,
  DataTable,
  GlassPanel,
  PanelTitle,
  Select,
  Text,
  type Column,
} from '@/components/ui'
import { PageLayout } from '@/components/layout'
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { UserCell, type StatMetric } from '@/components/data-display'
import { AdminSummary } from '../components/operationalbrief-a-g/AdminSummary'
import { Icons } from '@/lib/icons'
import { isFiniteNumber } from '@/lib/numberFormat'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useDataState } from '@/hooks/useDataState'
import {
  useBulkUpdateFeedback,
  useFeedbackList,
  useUpdateFeedback,
} from '@/api/hooks/useFeedback'
import type { FeedbackCategory, FeedbackEntry, FeedbackStatus } from '@/api/types'
import {
  BridgeStatus,
  CategoryBadge,
  CategoryMix,
  FeedbackExpansion,
  StatusBadge,
  StatusDistribution,
} from '../components/feedback-queue'
import { FeedbackFacetPanel } from '../components/feedback-queue/FeedbackFacetPanel'

// Admin feedback queue — modern-ui full-width redesign.
//
// A KPI overview band, a triage-progress / category-mix insights bento, and a
// full-width filterable + paged table whose rows expand to the report body,
// redacted metadata, captured errors, and the deterministic triage controls.
// Overview counts come from lightweight filtered list calls (limit:1) so the
// KPIs reflect the whole queue, independent of the table's active filter.

const PAGE_SIZE = 25

export default function FeedbackQueuePage() {
  const { t } = useTranslation()
  usePageTitle(t('feedback.queue.title', 'Feedback queue'))
  const { formatDateTime } = useDateFormat()

  const [statusFilter, setStatusFilter] = useState<'' | FeedbackStatus>('')
  const [categoryFilter, setCategoryFilter] = useState<'' | FeedbackCategory>('')
  const [page, setPage] = useState(0)
  // DataTable expansion is controlled — without this wiring the row-drawer
  // triage controls (status change, GitHub URL, forward) are unreachable.
  const [expandedRows, setExpandedRows] = useState<(string | number)[]>([])
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([])
  const [bulkTargetStatus, setBulkTargetStatus] = useState<FeedbackStatus | null>(null)

  const listQuery = useFeedbackList({
    status: statusFilter || undefined,
    category: categoryFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const { data, isLoading, refetch, isFetching } = listQuery
  const listState = useDataState(listQuery)
  const update = useUpdateFeedback()
  const bulkUpdate = useBulkUpdateFeedback()

  // Whole-queue counts (independent of the table filter). Each call is a cheap
  // limit:1 read whose `.total` is the count for that facet.
  const newQ = useFeedbackList({ status: 'new', limit: 1 })
  const triagedQ = useFeedbackList({ status: 'triaged', limit: 1 })
  const closedQ = useFeedbackList({ status: 'closed', limit: 1 })
  const bugQ = useFeedbackList({ category: 'bug', limit: 1 })
  const featureQ = useFeedbackList({ category: 'feature', limit: 1 })
  const otherQ = useFeedbackList({ category: 'other', limit: 1 })
  const newState = useDataState(newQ)
  const triagedState = useDataState(triagedQ)
  const closedState = useDataState(closedQ)
  const bugState = useDataState(bugQ)
  const featureState = useDataState(featureQ)
  const otherState = useDataState(otherQ)

  const counts = {
    new: newQ.data?.total,
    triaged: triagedQ.data?.total,
    closed: closedQ.data?.total,
    bug: bugQ.data?.total,
    feature: featureQ.data?.total,
    other: otherQ.data?.total,
  }
  const statusTotal = isFiniteNumber(counts.new) && isFiniteNumber(counts.triaged) && isFiniteNumber(counts.closed)
    ? counts.new + counts.triaged + counts.closed : undefined
  const statusLoading = (newQ.isLoading && !newState.hasData) ||
    (triagedQ.isLoading && !triagedState.hasData) || (closedQ.isLoading && !closedState.hasData)

  // A page-level refresh reloads the table AND the six whole-queue count
  // queries so the KPI band + insights stay consistent with the table
  // (they are independent queries, so refetching only the list left them stale).
  const isRefreshing =
    isFetching ||
    newQ.isFetching ||
    triagedQ.isFetching ||
    closedQ.isFetching ||
    bugQ.isFetching ||
    featureQ.isFetching ||
    otherQ.isFetching

  const handleRefreshAll = useCallback(() => {
    refetch()
    newQ.refetch()
    triagedQ.refetch()
    closedQ.refetch()
    bugQ.refetch()
    featureQ.refetch()
    otherQ.refetch()
  }, [
    refetch,
    newQ.refetch,
    triagedQ.refetch,
    closedQ.refetch,
    bugQ.refetch,
    featureQ.refetch,
    otherQ.refetch,
  ])

  // The triage-progress / category-mix panels are fed by the count queries, not
  // the table query — so their retry must refetch those facet counts, otherwise
  // clicking "Retry" silently reloads the list and leaves the panel broken.
  const handleRetryStatusCounts = useCallback(() => {
    newQ.refetch()
    triagedQ.refetch()
    closedQ.refetch()
  }, [newQ.refetch, triagedQ.refetch, closedQ.refetch])

  const handleRetryCategoryCounts = useCallback(() => {
    bugQ.refetch()
    featureQ.refetch()
    otherQ.refetch()
  }, [bugQ.refetch, featureQ.refetch, otherQ.refetch])

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const bridgeEnabled = Boolean(data?.github_bridge_enabled)
  const bridgeRepo = data?.github_repo ?? ''
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const statTiles = useMemo<StatMetric[]>(
    () => [
      { metricId: 'count', occurrenceId: 'total', label: t('feedback.queue.kpi.total', 'Total feedback'), rawValue: statusTotal },
      { metricId: 'count', occurrenceId: 'new', label: t('feedback.queue.status.new', 'New'), rawValue: counts.new },
      { metricId: 'count', occurrenceId: 'triaged', label: t('feedback.queue.status.triaged', 'Triaged'), rawValue: counts.triaged },
      { metricId: 'count', occurrenceId: 'closed', label: t('feedback.queue.status.closed', 'Closed'), rawValue: counts.closed },
      { metricId: 'count', occurrenceId: 'bug', label: t('feedback.category.bug', 'Bug report'), rawValue: counts.bug },
      { metricId: 'count', occurrenceId: 'feature', label: t('feedback.category.feature', 'Feature request'), rawValue: counts.feature },
    ],
    [t, statusTotal, statusLoading, counts.new, counts.triaged, counts.closed, counts.bug, counts.feature, newQ.isLoading, triagedQ.isLoading, closedQ.isLoading, bugQ.isLoading, featureQ.isLoading, newState.hasData, triagedState.hasData, closedState.hasData, bugState.hasData, featureState.hasData],
  )

  const statusOptions = useMemo(
    () => [
      { value: '', label: t('feedback.queue.filter.allStatuses', 'All statuses') },
      { value: 'new', label: t('feedback.queue.status.new', 'New') },
      { value: 'triaged', label: t('feedback.queue.status.triaged', 'Triaged') },
      { value: 'closed', label: t('feedback.queue.status.closed', 'Closed') },
    ],
    [t],
  )
  const categoryOptions = useMemo(
    () => [
      { value: '', label: t('feedback.queue.filter.allCategories', 'All categories') },
      { value: 'bug', label: t('feedback.category.bug', 'Bug report') },
      { value: 'feature', label: t('feedback.category.feature', 'Feature request') },
      { value: 'other', label: t('feedback.category.other', 'Other / question') },
    ],
    [t],
  )

  const columns = useMemo<Column<FeedbackEntry>[]>(
    () => [
      {
        key: 'created_at',
        header: t('feedback.queue.col.created', 'Created'),
        render: (row) => (
          <Text variant="body" className="whitespace-nowrap">{formatDateTime(row.created_at)}</Text>
        ),
        sortable: true,
      },
      {
        key: 'category',
        header: t('feedback.queue.col.category', 'Category'),
        render: (row) => <CategoryBadge category={row.category} />,
        sortable: true,
      },
      {
        key: 'title',
        header: t('feedback.queue.col.title', 'Title'),
        render: (row) => <Text variant="body">{row.title || '—'}</Text>,
        sortable: true,
      },
      {
        key: 'page_route',
        header: t('feedback.queue.col.pageRoute', 'Page'),
        render: (row) => (row.page_route ? <Code>{row.page_route}</Code> : <Caption>—</Caption>),
      },
      {
        key: 'reporter',
        header: t('feedback.queue.col.reporter', 'Reporter'),
        render: (row) => (
          <UserCell user={{ id: row.submitter_subject || null, email: row.user_email || null }} />
        ),
      },
      {
        key: 'status',
        header: t('feedback.queue.col.status', 'Status'),
        render: (row) => <StatusBadge status={row.status} />,
        sortable: true,
      },
      {
        key: 'github_issue_url',
        header: t('feedback.queue.col.github', 'GitHub'),
        render: (row) =>
          row.github_issue_url ? (
            <a
              href={row.github_issue_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
            >
              <Icons.externalLink className="h-3 w-3" aria-hidden="true" />
              {t('feedback.queue.openIssue', 'Open issue')}
            </a>
          ) : (
            <Caption>—</Caption>
          ),
      },
    ],
    [t, formatDateTime],
  )

  const handleBulkStatus = useCallback(
    async (rows: FeedbackEntry[], status: FeedbackStatus) => {
      setBulkTargetStatus(status)
      try {
        await bulkUpdate.mutateAsync({
          ids: rows.map((row) => row.id),
          update: { status },
        })
        setSelectedKeys([])
      } catch {
        // The mutation surfaces the error and refreshes partial results. Keep
        // selection intact so the operator can retry only the intended rows.
      } finally {
        setBulkTargetStatus(null)
      }
    },
    [bulkUpdate],
  )

  const renderBulkActions = useCallback(
    (rows: FeedbackEntry[]) => (
      <>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<Icons.success className="h-4 w-4" aria-hidden="true" />}
          loading={bulkTargetStatus === 'triaged'}
          disabled={bulkUpdate.isPending || rows.every((row) => row.status === 'triaged')}
          onClick={() => void handleBulkStatus(rows, 'triaged')}
        >
          {t('feedback.queue.bulk.triage', 'Mark triaged')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<Icons.archive className="h-4 w-4" aria-hidden="true" />}
          loading={bulkTargetStatus === 'closed'}
          disabled={bulkUpdate.isPending || rows.every((row) => row.status === 'closed')}
          onClick={() => void handleBulkStatus(rows, 'closed')}
        >
          {t('feedback.queue.bulk.close', 'Close selected')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<Icons.undo className="h-4 w-4" aria-hidden="true" />}
          loading={bulkTargetStatus === 'new'}
          disabled={bulkUpdate.isPending || rows.every((row) => row.status === 'new')}
          onClick={() => void handleBulkStatus(rows, 'new')}
        >
          {t('feedback.queue.bulk.reopen', 'Reopen selected')}
        </Button>
      </>
    ),
    [bulkTargetStatus, bulkUpdate.isPending, handleBulkStatus, t],
  )

  const actions = (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleRefreshAll}
      loading={isRefreshing}
      aria-label={t('common.refresh', 'Refresh')}
      icon={<Icons.refresh className="h-4 w-4" aria-hidden="true" />}
    >
      {t('common.refresh', 'Refresh')}
    </Button>
  )

  return (
    <PageLayout
      title={t('feedback.queue.title', 'Feedback queue')}
      subtitle={t('feedback.queue.subtitle', 'Triage user-submitted bug reports and feature requests')}
      secondaryActions={actions}
    >
      {/* 1 — KPI band: whole-queue counts, reflows 2 → 3 → 6 columns */}
      <FadeIn>
        <AdminSummary metrics={statTiles} testId="feedback-queue-summary"
          eyebrow={t('feedback.queue.title', 'Feedback queue')} title={t('feedback.queue.kpis', 'Queue overview')}
          description={t('feedback.queue.summary.source', 'Whole-queue counts come from independent status and category queries, unaffected by the table filters. Total feedback sums new, triaged and closed counts only when all three are available.')}
          scope={t('feedback.queue.summary.scope', 'Independent queue facet snapshots; no shared observation time or date bounds are reported.')}
          sourceStatus={[newState, triagedState, closedState, bugState, featureState].some(source => source.status === 'stale')
            ? 'stale' : [newState, triagedState, closedState, bugState, featureState].some(source => source.isRefreshing) ? 'refreshing'
              : [newState, triagedState, closedState, bugState, featureState].every(source => source.hasData) ? 'ready' : 'partial'}
          loading={statTiles.every(metric => metric.rawValue == null) &&
            (statusLoading || (bugQ.isLoading && !bugState.hasData) || (featureQ.isLoading && !featureState.hasData))} />
      </FadeIn>

      {/* 2 — Insights bento: triage progress (hero) + category mix / bridge */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <FeedbackFacetPanel
              title={t('feedback.queue.triageProgress', 'Triage progress')}
              icon={<Icons.workflow className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
              emptyIcon={<Icons.workflow className="h-8 w-8" aria-hidden="true" />}
              counts={[
                { id: 'new', label: t('feedback.queue.status.new', 'New'), value: counts.new },
                { id: 'triaged', label: t('feedback.queue.status.triaged', 'Triaged'), value: counts.triaged },
                { id: 'closed', label: t('feedback.queue.status.closed', 'Closed'), value: counts.closed },
              ]}
              sources={[newState, triagedState, closedState]}
              onRetry={handleRetryStatusCounts}
              emptyMessage={t('feedback.queue.noStatusData', 'No feedback to triage yet.')}
              skeletonHeight={140}
            >
              <StatusDistribution counts={counts} total={statusTotal ?? 0} />
            </FeedbackFacetPanel>
          </div>
          <FeedbackFacetPanel
            title={t('feedback.queue.categoryMix', 'Category mix')}
            icon={<Icons.pieChart className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            emptyIcon={<Icons.pieChart className="h-8 w-8" aria-hidden="true" />}
            counts={[
              { id: 'bug', label: t('feedback.category.bug', 'Bug report'), value: counts.bug },
              { id: 'feature', label: t('feedback.category.feature', 'Feature request'), value: counts.feature },
              { id: 'other', label: t('feedback.category.other', 'Other / question'), value: counts.other },
            ]}
            sources={[bugState, featureState, otherState]}
            onRetry={handleRetryCategoryCounts}
            emptyMessage={t('feedback.queue.noCategoryData', 'No categories to show yet.')}
            skeletonHeight={120}
            footer={
              <BridgeStatus
                enabled={bridgeEnabled}
                repo={bridgeRepo}
                loading={isLoading && !listState.hasData}
                unknown={!listState.hasData}
              />
            }
          >
            <CategoryMix counts={counts} />
          </FeedbackFacetPanel>
        </section>
      </FadeIn>

      {/* 3 — Detail band: filterable + paged queue table (full width) */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <PanelTitle className="mr-auto self-center">
              {t('feedback.queue.tableTitle', 'Queue')}
            </PanelTitle>
            <div className="min-w-[160px] flex-1 sm:max-w-[220px]">
              <Select
                label={t('feedback.queue.filter.status', 'Status')}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as '' | FeedbackStatus)
                  setPage(0)
                }}
                options={statusOptions}
              />
            </div>
            <div className="min-w-[160px] flex-1 sm:max-w-[220px]">
              <Select
                label={t('feedback.queue.filter.category', 'Category')}
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value as '' | FeedbackCategory)
                  setPage(0)
                }}
                options={categoryOptions}
              />
            </div>
          </div>

          <StaleRefreshWarning state={listState} label={t('feedback.queue.tableTitle', 'Queue')} hideRetry />
          {isLoading && !listState.hasData ? (
            <Skeleton height={44} lines={6} />
          ) : listState.fatalError ? (
            <QueryError error={listState.fatalError} onRetry={() => refetch()} />
          ) : items.length === 0 ? (
            // no-action: feedback arrives by user submission, no admin CTA possible
            <EmptyState
              icon={<Icons.bug className="h-10 w-10" aria-hidden="true" />}
              title={t('feedback.queue.empty', 'No feedback yet')}
              message={t('feedback.queue.emptyMessage', 'User-submitted bug reports and feature requests will appear here.')}
            />
          ) : (
            <>
              <DataTable<FeedbackEntry>
                tableId="admin:feedback"
                enableValueFilters={false}
                columns={columns}
                mobileColumns={['title', 'status', 'created_at']}
                data={items}
                keyExtractor={(r) => r.id}
                selectable="multi"
                // A11Y: without this every checkbox announces the same
                // "Select row"; the first column is a timestamp, which
                // is not distinguishing on a busy queue.
                rowLabel={(r) =>
                  t('feedback.queue.rowLabel', '{{category}}: {{title}}', {
                    category: r.category,
                    title: r.title || t('feedback.queue.untitled', 'Untitled feedback'),
                  })
                }
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
                bulkActions={renderBulkActions}
                emptyMessage={t('feedback.queue.empty', 'No feedback yet')}
                expandable
                expandedKeys={expandedRows}
                onExpandedChange={(next) => setExpandedRows(next)}
                renderExpanded={(row) => (
                  <FeedbackExpansion
                    row={row}
                    bridgeEnabled={bridgeEnabled}
                    onUpdate={update.mutate}
                    updating={update.isPending}
                  />
                )}
                compact
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Caption>
                  {t('feedback.queue.pageOf', 'Page {{page}} of {{total}} ({{count}} entries)', {
                    page: page + 1,
                    total: totalPages,
                    count: total,
                  })}
                </Caption>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0 || isFetching}
                  >
                    {t('common.previous', 'Previous')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page + 1 >= totalPages || isFetching}
                  >
                    {t('common.next', 'Next')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  )
}
