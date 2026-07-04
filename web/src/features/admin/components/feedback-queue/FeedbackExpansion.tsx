import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Code, Input, Label, MaskedValue, Select, Subhead, Text } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { AIFeedbackQueueTriage } from '@/components/ai/AIFeedbackQueueTriage'
import type { useUpdateFeedback } from '@/api/hooks/useFeedback'
import type { FeedbackEntry, FeedbackStatus } from '@/api/types'

interface FeedbackExpansionProps {
  row: FeedbackEntry
  bridgeEnabled: boolean
  onUpdate: ReturnType<typeof useUpdateFeedback>['mutate']
  updating: boolean
}

/** Row-drawer body for one feedback entry: report content, redacted metadata,
 *  captured errors, the deterministic triage controls, and the propose-only AI
 *  advisor. The manual controls remain the sole write path. */
export function FeedbackExpansion({ row, bridgeEnabled, onUpdate, updating }: FeedbackExpansionProps) {
  const { t } = useTranslation()
  const persistedUrl = row.github_issue_url ?? ''
  const [issueUrl, setIssueUrl] = useState(persistedUrl)

  // Keep the local draft aligned with the server-persisted URL: when a
  // mutation (Save URL / Forward to GitHub) round-trips and the parent
  // re-renders this row with a new github_issue_url, reset the field to that
  // value. The ref guards the reset so it fires only when the persisted value
  // actually changes — an in-progress edit is never clobbered by an unrelated
  // re-render.
  const lastPersistedUrl = useRef(persistedUrl)
  useEffect(() => {
    if (persistedUrl !== lastPersistedUrl.current) {
      lastPersistedUrl.current = persistedUrl
      setIssueUrl(persistedUrl)
    }
  }, [persistedUrl])

  const statusOptions = useMemo(
    () => [
      { value: 'new', label: t('feedback.queue.status.new', 'New') },
      { value: 'triaged', label: t('feedback.queue.status.triaged', 'Triaged') },
      { value: 'closed', label: t('feedback.queue.status.closed', 'Closed') },
    ],
    [t],
  )

  return (
    <div className="space-y-4 bg-[var(--surface-1)]/40 p-4">
      <div>
        <Subhead className="mb-1">{t('feedback.queue.expand.body', 'Report body')}</Subhead>
        <Text as="p" variant="body" className="whitespace-pre-wrap">{row.body || '—'}</Text>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ExpandField label={t('feedback.queue.expand.appVersion', 'App version')}>
          <Code>{row.app_version || '—'}</Code>
        </ExpandField>
        <ExpandField label={t('feedback.queue.expand.userAgent', 'User agent')}>
          <Text as="span" variant="bodySm" className="break-words">{row.user_agent || '—'}</Text>
        </ExpandField>
        <ExpandField label={t('feedback.queue.expand.submitter', 'Submitter')}>
          <Code>{row.submitter_subject || row.submitter_ip || '—'}</Code>
        </ExpandField>
        <ExpandField label={t('feedback.queue.expand.userEmail', 'Email')}>
          {row.user_email ? (
            <MaskedValue
              value={row.user_email}
              variant="email"
              ariaLabel={t('feedback.queue.maskedEmail', 'Reporter email, click to reveal')}
              copyable
              auditOnReveal
            />
          ) : (
            <Text as="span" variant="bodySm">—</Text>
          )}
        </ExpandField>
      </div>

      {row.recent_errors !== null && row.recent_errors !== undefined ? (
        <details>
          <Text as="summary" variant="bodySm" className="cursor-pointer">
            {t('feedback.queue.expand.recentErrors', 'Recent frontend errors')}
          </Text>
          <Text as="pre" variant="code" className="mt-2 max-h-64 overflow-auto rounded bg-[var(--surface-2)] p-2">
            {JSON.stringify(row.recent_errors, null, 2)}
          </Text>
        </details>
      ) : null}

      {row.console_tail ? (
        <details>
          <Text as="summary" variant="bodySm" className="cursor-pointer">
            {t('feedback.queue.expand.consoleTail', 'Console tail')}
          </Text>
          <Text as="pre" variant="code" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-2)] p-2">
            {row.console_tail}
          </Text>
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
          disabled={updating || issueUrl === persistedUrl}
        >
          {t('feedback.queue.action.saveUrl', 'Save URL')}
        </Button>
        {bridgeEnabled && !persistedUrl && (
          <Button
            type="button"
            size="sm"
            onClick={() => onUpdate({ id: row.id, update: { forward_to_github: true } })}
            disabled={updating}
          >
            <Icons.bug className="mr-1 h-4 w-4" aria-hidden="true" />
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

/** Small labelled field used in the row-expansion metadata grid. */
function ExpandField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Label className="mb-0.5 block">{label}</Label>
      <div className="text-[var(--text-primary)]">{children}</div>
    </div>
  )
}
