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
import { PageContainer } from '@/components/layout'
import { EmptyState, QueryError, Skeleton, Spinner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { UserCell } from '@/components/data-display'
import { Icons } from '@/lib/icons'
import { type NeonColor } from '@/lib/tokens'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useFeedbackList, useUpdateFeedback } from '@/api/hooks/useFeedback'
import type { FeedbackCategory, FeedbackEntry, FeedbackStatus } from '@/api/types'
import {
  BridgeStatus,
  CategoryBadge,
  CategoryMix,
  FeedbackExpansion,
  FeedbackStatTile,
  StatusBadge,
  StatusDistribution,
} from '../components/feedback-queue'

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

  const listQuery = useFeedbackList({
    status: statusFilter || undefined,
    category: categoryFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const { data, isLoading, isError, error, refetch, isFetching } = listQuery
  const update = useUpdateFeedback()

  // Whole-queue counts (independent of the table filter). Each call is a cheap
  // limit:1 read whose `.total` is the count for that facet.
  const newQ = useFeedbackList({ status: 'new', limit: 1 })
  const triagedQ = useFeedbackList({ status: 'triaged', limit: 1 })
  const closedQ = useFeedbackList({ status: 'closed', limit: 1 })
  const bugQ = useFeedbackList({ category: 'bug', limit: 1 })
  const featureQ = useFeedbackList({ category: 'feature', limit: 1 })
  const otherQ = useFeedbackList({ category: 'other', limit: 1 })

  const counts = {
    new: newQ.data?.total,
    triaged: triagedQ.data?.total,
    closed: closedQ.data?.total,
    bug: bugQ.data?.total,
    feature: featureQ.data?.total,
    other: otherQ.data?.total,
  }
  const statusTotal = (counts.new ?? 0) + (counts.triaged ?? 0) + (counts.closed ?? 0)
  const categoryTotal = (counts.bug ?? 0) + (counts.feature ?? 0) + (counts.other ?? 0)
  const statusLoading = newQ.isLoading || triagedQ.isLoading || closedQ.isLoading
  const statusError = newQ.error || triagedQ.error || closedQ.error
  const categoryLoading = bugQ.isLoading || featureQ.isLoading || otherQ.isLoading
  const categoryError = bugQ.error || featureQ.error || otherQ.error

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

  const statTiles = useMemo(
    () => [
      { key: 'total', label: t('feedback.queue.kpi.total', 'Total feedback'), icon: <Icons.fileText className="h-5 w-5" />, color: 'cyan' as NeonColor, value: statusTotal, loading: statusLoading },
      { key: 'new', label: t('feedback.queue.status.new', 'New'), icon: <Icons.sparkles className="h-5 w-5" />, color: 'amber' as NeonColor, value: counts.new, loading: newQ.isLoading },
      { key: 'triaged', label: t('feedback.queue.status.triaged', 'Triaged'), icon: <Icons.success className="h-5 w-5" />, color: 'green' as NeonColor, value: counts.triaged, loading: triagedQ.isLoading },
      { key: 'closed', label: t('feedback.queue.status.closed', 'Closed'), icon: <Icons.archive className="h-5 w-5" />, color: 'blue' as NeonColor, value: counts.closed, loading: closedQ.isLoading },
      { key: 'bug', label: t('feedback.category.bug', 'Bug report'), icon: <Icons.bug className="h-5 w-5" />, color: 'red' as NeonColor, value: counts.bug, loading: bugQ.isLoading },
      { key: 'feature', label: t('feedback.category.feature', 'Feature request'), icon: <Icons.lightbulb className="h-5 w-5" />, color: 'purple' as NeonColor, value: counts.feature, loading: featureQ.isLoading },
    ],
    [t, statusTotal, statusLoading, counts.new, counts.triaged, counts.closed, counts.bug, counts.feature, newQ.isLoading, triagedQ.isLoading, closedQ.isLoading, bugQ.isLoading, featureQ.isLoading],
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

  const actions = (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleRefreshAll}
      disabled={isRefreshing}
      aria-label={t('common.refresh', 'Refresh')}
    >
      {isRefreshing ? <Spinner size="sm" /> : <Icons.refresh className="h-4 w-4" aria-hidden="true" />}
      <span className="ml-1">{t('common.refresh', 'Refresh')}</span>
    </Button>
  )

  return (
    <PageContainer
      title={t('feedback.queue.title', 'Feedback queue')}
      subtitle={t('feedback.queue.subtitle', 'Triage user-submitted bug reports and feature requests')}
      actions={actions}
    >
      {/* 1 — KPI band: whole-queue counts, reflows 2 → 3 → 6 columns */}
      <FadeIn>
        <section
          aria-label={t('feedback.queue.kpis', 'Queue overview')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6"
        >
          {statTiles.map((tile) => (
            <FeedbackStatTile
              key={tile.key}
              label={tile.label}
              icon={tile.icon}
              color={tile.color}
              value={tile.value}
              loading={tile.loading}
            />
          ))}
        </section>
      </FadeIn>

      {/* 2 — Insights bento: triage progress (hero) + category mix / bridge */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Icons.workflow className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('feedback.queue.triageProgress', 'Triage progress')}
            </PanelTitle>
            {statusLoading ? (
              <Skeleton height={140} />
            ) : statusError ? (
              <QueryError error={statusError} onRetry={handleRetryStatusCounts} />
            ) : statusTotal === 0 ? (
              // no-action: mirrors the queue table below — a refetch can't
              // manufacture feedback rows that were never submitted.
              <EmptyState
                icon={<Icons.workflow className="h-8 w-8" aria-hidden="true" />}
                message={t('feedback.queue.noStatusData', 'No feedback to triage yet.')}
              />
            ) : (
              <StatusDistribution counts={counts} total={statusTotal} />
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Icons.pieChart className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('feedback.queue.categoryMix', 'Category mix')}
            </PanelTitle>
            {categoryLoading ? (
              <Skeleton height={120} />
            ) : categoryError ? (
              <QueryError error={categoryError} onRetry={handleRetryCategoryCounts} />
            ) : categoryTotal === 0 ? (
              // no-action: derived from the same user-submitted feedback rows
              // as the triage panel — none submitted yet means nothing to chart.
              <EmptyState
                icon={<Icons.pieChart className="h-8 w-8" aria-hidden="true" />}
                message={t('feedback.queue.noCategoryData', 'No categories to show yet.')}
              />
            ) : (
              <CategoryMix counts={counts} />
            )}
            <BridgeStatus enabled={bridgeEnabled} repo={bridgeRepo} loading={isLoading} />
          </GlassPanel>
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

          {isLoading ? (
            <Skeleton height={44} lines={6} />
          ) : isError ? (
            <QueryError error={error} onRetry={() => refetch()} />
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
                columns={columns}
                data={items}
                keyExtractor={(r) => r.id}
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
    </PageContainer>
  )
}
