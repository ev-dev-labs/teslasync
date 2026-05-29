import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, DataTable, GlassPanel, Input, MaskedValue, Select, type Column } from '@/components/ui'
import { PageContainer } from '@/components/layout'
import { EmptyState, QueryError, Spinner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { UserCell } from '@/components/data-display'
import { Icons } from '@/lib/icons'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useFeedbackList, useUpdateFeedback } from '@/api/hooks/useFeedback'
import { useDateFormat } from '@/hooks/useDateFormat'
import { AIFeedbackQueueTriage } from '@/components/ai/AIFeedbackQueueTriage'
import type {
  FeedbackCategory,
  FeedbackEntry,
  FeedbackStatus,
} from '@/api/types'

// admin feedback queue page.
//
// Lists user_feedback rows with filter (status, category) + paged.
// Row click expands to show body + recent_errors JSON. Inline actions:
// - Change status (new → triaged → closed)
// - Paste GitHub issue URL manually (or use Forward to GitHub when
//   the server-side bridge is configured).

const PAGE_SIZE = 25

export default function FeedbackQueuePage() {
  const { t } = useTranslation()
  usePageTitle(t('feedback.queue.title', 'Feedback queue'))
  const { formatDateTime } = useDateFormat()

  const [statusFilter, setStatusFilter] = useState<'' | FeedbackStatus>('')
  const [categoryFilter, setCategoryFilter] = useState<'' | FeedbackCategory>('')
  const [page, setPage] = useState(0)

  const { data, isLoading, isError, error, refetch, isFetching } = useFeedbackList({
    status: statusFilter || undefined,
    category: categoryFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const update = useUpdateFeedback()

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const bridgeEnabled = Boolean(data?.github_bridge_enabled)

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
        render: (row: FeedbackEntry) => formatDateTime(row.created_at),
        sortable: true,
      },
      {
        key: 'category',
        header: t('feedback.queue.col.category', 'Category'),
        render: (row: FeedbackEntry) => <CategoryBadge category={row.category} />,
        sortable: true,
      },
      {
        key: 'title',
        header: t('feedback.queue.col.title', 'Title'),
        render: (row: FeedbackEntry) => (
          <span className="text-[var(--text-primary)]">{row.title || '—'}</span>
        ),
        sortable: true,
      },
      {
        key: 'page_route',
        header: t('feedback.queue.col.pageRoute', 'Page'),
        render: (row: FeedbackEntry) =>
          row.page_route ? (
            <code className="text-xs text-[var(--text-secondary)]">{row.page_route}</code>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">—</span>
          ),
      },
      {
        key: 'reporter',
        header: t('feedback.queue.col.reporter', 'Reporter'),
        render: (row: FeedbackEntry) => (
          <UserCell
            user={{
              id: row.submitter_subject || null,
              email: row.user_email || null,
            }}
          />
        ),
      },
      {
        key: 'status',
        header: t('feedback.queue.col.status', 'Status'),
        render: (row: FeedbackEntry) => <StatusBadge status={row.status} />,
        sortable: true,
      },
      {
        key: 'github_issue_url',
        header: t('feedback.queue.col.github', 'GitHub'),
        render: (row: FeedbackEntry) =>
          row.github_issue_url ? (
            <a
              href={row.github_issue_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-cyan-300 underline hover:text-cyan-200"
            >
              {t('feedback.queue.openIssue', 'Open issue')}
            </a>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">—</span>
          ),
      },
    ],
    [t, formatDateTime],
  )

  const renderExpanded = (row: FeedbackEntry) => (
    <FeedbackExpansion row={row} bridgeEnabled={bridgeEnabled} onUpdate={update.mutate} updating={update.isPending} />
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <PageContainer title={t('feedback.queue.title', 'Feedback queue')}>
      <FadeIn>
        <GlassPanel>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="min-w-[180px] flex-1">
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
            <div className="min-w-[180px] flex-1">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label={t('common.refresh', 'Refresh')}
            >
              {isFetching ? <Spinner size="sm" /> : <Icons.refresh className="h-4 w-4" />}
              <span className="ml-1">{t('common.refresh', 'Refresh')}</span>
            </Button>
            {!bridgeEnabled && (
              <p className="basis-full text-xs text-[var(--text-muted)]">
                {t(
                  'feedback.queue.bridgeDisabled',
                  'GitHub Issues bridge is not configured on this server (set TESLASYNC_GITHUB_REPO + TESLASYNC_GITHUB_TOKEN to enable forwarding).',
                )}
              </p>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : isError ? (
            <QueryError error={error} onRetry={() => refetch()} />
          ) : items.length === 0 ? (
            // no-action: feedback arrives by user submission, no admin CTA possible
            <EmptyState
              icon={<Icons.bug className="h-10 w-10 text-[var(--text-muted)]" />}
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
                renderExpanded={renderExpanded}
                compact
              />
              <div className="flex items-center justify-between mt-3 text-xs text-[var(--text-secondary)]">
                <span>
                  {t('feedback.queue.pageOf', 'Page {{page}} of {{total}} ({{count}} entries)', {
                    page: page + 1,
                    total: totalPages,
                    count: total,
                  })}
                </span>
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

function CategoryBadge({ category }: { category: FeedbackCategory }) {
  const { t } = useTranslation()
  const variant: Record<FeedbackCategory, 'danger' | 'info' | 'neutral'> = {
    bug: 'danger',
    feature: 'info',
    other: 'neutral',
  }
  const label: Record<FeedbackCategory, string> = {
    bug: t('feedback.category.bug', 'Bug report'),
    feature: t('feedback.category.feature', 'Feature request'),
    other: t('feedback.category.other', 'Other / question'),
  }
  return <Badge variant={variant[category]}>{label[category]}</Badge>
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const { t } = useTranslation()
  const variant: Record<FeedbackStatus, 'success' | 'warning' | 'neutral'> = {
    new: 'warning',
    triaged: 'success',
    closed: 'neutral',
  }
  const label: Record<FeedbackStatus, string> = {
    new: t('feedback.queue.status.new', 'New'),
    triaged: t('feedback.queue.status.triaged', 'Triaged'),
    closed: t('feedback.queue.status.closed', 'Closed'),
  }
  return <Badge variant={variant[status]}>{label[status]}</Badge>
}

interface FeedbackExpansionProps {
  row: FeedbackEntry
  bridgeEnabled: boolean
  onUpdate: ReturnType<typeof useUpdateFeedback>['mutate']
  updating: boolean
}

function FeedbackExpansion({ row, bridgeEnabled, onUpdate, updating }: FeedbackExpansionProps) {
  const { t } = useTranslation()
  const [issueUrl, setIssueUrl] = useState(row.github_issue_url ?? '')

  const statusOptions = [
    { value: 'new', label: t('feedback.queue.status.new', 'New') },
    { value: 'triaged', label: t('feedback.queue.status.triaged', 'Triaged') },
    { value: 'closed', label: t('feedback.queue.status.closed', 'Closed') },
  ]

  return (
    <div className="space-y-4 p-4 bg-[var(--surface-1)]/40">
      <div>
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
          {t('feedback.queue.expand.body', 'Report body')}
        </h4>
        <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{row.body || '—'}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-xs text-[var(--text-secondary)]">
        <div>
          <span className="font-semibold">{t('feedback.queue.expand.appVersion', 'App version')}: </span>
          <code className="text-[var(--text-primary)]">{row.app_version || '—'}</code>
        </div>
        <div>
          <span className="font-semibold">{t('feedback.queue.expand.userAgent', 'User agent')}: </span>
          <span className="text-[var(--text-primary)]">{row.user_agent || '—'}</span>
        </div>
        <div>
          <span className="font-semibold">{t('feedback.queue.expand.submitter', 'Submitter')}: </span>
          <code className="text-[var(--text-primary)]">{row.submitter_subject || row.submitter_ip || '—'}</code>
        </div>
        <div>
          <span className="font-semibold">{t('feedback.queue.expand.userEmail', 'Email')}: </span>
          {row.user_email ? (
            <MaskedValue
              value={row.user_email}
              variant="email"
              ariaLabel={t('feedback.queue.maskedEmail', 'Reporter email, click to reveal')}
              copyable
              auditOnReveal
            />
          ) : (
            <span className="text-[var(--text-primary)]">—</span>
          )}
        </div>
      </div>

      {row.recent_errors !== null && row.recent_errors !== undefined ? (
        <details>
          <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
            {t('feedback.queue.expand.recentErrors', 'Recent frontend errors')}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--surface-2)] p-2 text-xs text-[var(--text-primary)]">
            {JSON.stringify(row.recent_errors, null, 2)}
          </pre>
        </details>
      ) : null}

      {row.console_tail ? (
        <details>
          <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
            {t('feedback.queue.expand.consoleTail', 'Console tail')}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--surface-2)] p-2 text-xs text-[var(--text-primary)] whitespace-pre-wrap">
            {row.console_tail}
          </pre>
        </details>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 border-t border-[var(--glass-border)] pt-3">
        <div className="min-w-[160px]">
          <Select
            label={t('feedback.queue.action.changeStatus', 'Status')}
            value={row.status}
            onChange={(e) => onUpdate({ id: row.id, update: { status: e.target.value as FeedbackStatus } })}
            options={statusOptions}
            disabled={updating}
          />
        </div>
        <div className="min-w-[260px] flex-1">
          <Input
            label={t('feedback.queue.action.githubUrl', 'GitHub issue URL')}
            value={issueUrl}
            onChange={(e) => setIssueUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/issues/123"
            disabled={updating}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onUpdate({ id: row.id, update: { github_issue_url: issueUrl } })}
          disabled={updating || issueUrl === (row.github_issue_url ?? '')}
        >
          {t('feedback.queue.action.saveUrl', 'Save URL')}
        </Button>
        {bridgeEnabled && !row.github_issue_url && (
          <Button
            type="button"
            size="sm"
            onClick={() => onUpdate({ id: row.id, update: { forward_to_github: true } })}
            disabled={updating}
          >
            <Icons.bug className="h-4 w-4 mr-1" />
            {t('feedback.queue.action.forward', 'Forward to GitHub')}
          </Button>
        )}
      </div>

      {/* Feedback queue triage AI advisor.
          Renders only when ai_mode is on AND the feedback-queue-triage
          toggle is enabled. Propose-only: never persists; the manual
          controls above remain the sole write path (ADR-015 §I3 + §I8). */}
      <AIFeedbackQueueTriage feedbackId={row.id} />
    </div>
  )
}
