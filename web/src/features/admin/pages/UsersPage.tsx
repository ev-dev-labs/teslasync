import { useTranslation } from 'react-i18next'
import { PageContainer } from '@/components/layout/PageContainer'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorDisplay } from '@/components/feedback/ErrorDisplay'
import { Spinner } from '@/components/feedback/Spinner'
import {
  isImpersonationActive,
  isImpersonationOpenMode,
  useImpersonationCandidates,
  useImpersonationStatus,
} from '@/api/hooks/useImpersonation'
import { UserImpersonateButton } from '../components/UserImpersonateButton'

/**
 * Phase-46 / Prompt 46 — Admin Subjects page.
 *
 * Minimal list of distinct subjects that have an active session in
 * `auth_sessions`. This is the admin counterpart to the missing
 * UsersPage — TeslaSync has no `users` table, so the impersonation
 * target is a subject value selected from the auth-session telemetry
 * (a stand-in for the future `auth_subjects` table from prompt 57).
 *
 * Per the prompt's "Blocked Path" guidance: this page ships
 * unrouted because routeRegistry.ts is OUTSIDE the gate's allowed
 * files. A follow-up prompt will register the route. For now the
 * page is reachable only by directly importing UsersPage from
 * another bootstrap point, which keeps the impersonation feature
 * deliverable without pulling routeRegistry into a security-
 * sensitive change.
 *
 * Open mode: renders an inline placeholder explaining the feature
 * requires forward-auth, with no candidate fetch.
 *
 * Single-subject install: candidates list returns an empty array
 * (the actor is excluded), so the page surfaces an EmptyState
 * explaining there is no one to impersonate.
 */
export default function UsersPage() {
  const { t } = useTranslation()
  const status = useImpersonationStatus()
  const open = isImpersonationOpenMode(status.data)
  const active = isImpersonationActive(status.data)
  const candidates = useImpersonationCandidates({ enabled: !open })

  const subjects = candidates.data?.mode === 'session' ? candidates.data.candidates : []

  return (
    <PageContainer
      title={t('impersonation.users.title', 'Subjects')}
      subtitle={t(
        'impersonation.users.subtitle',
        'Active subjects you can impersonate for support. Sessions are limited to 15 minutes and recorded in the audit log.',
      )}
    >
      <GlassPanel>
        {open ? (
          <div className="p-6 text-sm text-[var(--text-secondary)]" data-testid="users-page-open-mode">
            {t(
              'impersonation.users.openMode',
              'Impersonation requires forward-auth mode. This install is in open mode, so per-user identity is not available.',
            )}
          </div>
        ) : candidates.isLoading ? (
          <div className="flex items-center justify-center p-8" data-testid="users-page-loading">
            <Spinner />
          </div>
        ) : candidates.isError ? (
          <ErrorDisplay error={candidates.error} onRetry={() => void candidates.refetch()} />
        ) : subjects.length === 0 ? (
          // no-action: there is no admin remediation for "no other subjects active" — the user must wait for someone else to sign in
          <EmptyState
            title={t('impersonation.users.emptyTitle', 'No other subjects')}
            message={t(
              'impersonation.users.emptyMessage',
              'No other subjects have an active session right now. Sign someone else in to enable impersonation.',
            )}
          />
        ) : (
          <ul className="divide-y divide-white/[0.06]" data-testid="users-page-list">
            {subjects.map((c) => (
              <li
                key={c.subject}
                className="flex items-center justify-between gap-4 px-4 py-3"
                data-testid={`users-page-row-${c.subject}`}
              >
                <span className="text-sm text-[var(--text-primary)] font-mono break-all">
                  {c.subject}
                </span>
                <UserImpersonateButton subject={c.subject} disabled={active} />
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </PageContainer>
  )
}
