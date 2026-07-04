import { useTranslation } from 'react-i18next'
import { Users, ShieldCheck, ShieldOff, UserCog, Clock, RefreshCw } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { Button } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { StatGridSkeleton } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { fmtInt } from '@/lib/numberFormat'
import { cn } from '@/lib/cn'
import {
  isImpersonationActive,
  isImpersonationOpenMode,
  useImpersonationCandidates,
  useImpersonationStatus,
} from '@/api/hooks/useImpersonation'
import { SubjectsTable } from '../components/SubjectsTable'
import { ImpersonationStatusPanel } from '../components/ImpersonationStatusPanel'
import { ImpersonationPolicyPanel } from '../components/ImpersonationPolicyPanel'

/**
 * Admin Subjects page — modern-UI, full-width cockpit for the impersonation
 * feature. TeslaSync has no `users` table, so the impersonation target is a
 * subject value read from active auth-session telemetry.
 *
 * Layout (mobile-first bento, reflows to more columns on wide screens):
 *   1. KPI band — available subjects / access mode / session status / limit.
 *   2. Bento — subjects table (hero, xl:col-span-2) + live session status.
 *   3. Full-width policy band explaining the security guarantees.
 *
 * Every data section owns its own loading / empty / error state; nothing is
 * gated behind a single flag. All data flows through the impersonation hooks
 * (GET /admin/impersonate, GET /admin/impersonate/candidates).
 */
export default function UsersPage() {
  const { t } = useTranslation()
  usePageTitle(t('impersonation.users.title', 'Subjects'))

  const status = useImpersonationStatus()
  const open = isImpersonationOpenMode(status.data)
  const active = isImpersonationActive(status.data)
  const candidates = useImpersonationCandidates({ enabled: !open })

  const subjects = candidates.data?.mode === 'session' ? candidates.data.candidates : []
  const targetSubject = status.data?.mode === 'active' ? status.data.target : null

  // The candidates query is disabled in open mode; treat that as "settled"
  // so the table shows the open-mode callout rather than a stuck skeleton.
  const subjectsLoading = !open && candidates.isLoading
  const subjectsError = !open && candidates.isError

  const refreshing = status.isFetching || (!open && candidates.isFetching)
  const onRefresh = () => {
    void status.refetch()
    if (!open) void candidates.refetch()
  }

  // A failed status fetch means we genuinely don't know the access mode or
  // session state — surface "—" rather than confidently claiming the
  // forward-auth/idle defaults the discriminated union falls through to.
  const statusUnknown = status.isLoading || status.isError

  const accessMode = statusUnknown
    ? '—'
    : open
      ? t('impersonation.users.kpi.modeOpen', 'Open')
      : t('impersonation.users.kpi.modeForwardAuth', 'Forward-auth')

  const sessionStatus = statusUnknown
    ? '—'
    : active
      ? t('impersonation.users.kpi.active', 'Active')
      : t('impersonation.users.kpi.idle', 'Idle')

  const actions = (
    <Button
      variant="secondary"
      size="sm"
      icon={<RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />}
      onClick={onRefresh}
      disabled={refreshing}
      aria-label={t('impersonation.users.refresh', 'Refresh')}
    >
      {t('impersonation.users.refresh', 'Refresh')}
    </Button>
  )

  return (
    <PageContainer
      title={t('impersonation.users.title', 'Subjects')}
      subtitle={t(
        'impersonation.users.subtitle',
        'Active subjects you can impersonate for support. Sessions are limited to 15 minutes and recorded in the audit log.',
      )}
      actions={actions}
      query={open ? status : candidates}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section aria-label={t('impersonation.users.kpiLabel', 'Impersonation summary')}>
          {status.isLoading || subjectsLoading ? (
            <StatGridSkeleton cards={4} className="lg:grid-cols-4" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <MetricCard
                label={t('impersonation.users.kpi.available', 'Available Subjects')}
                /* On a candidates-fetch error the count is unknown, not zero —
                   "—" avoids implying "0 subjects" next to the table's error. */
                value={open ? '0' : subjectsError ? '—' : fmtInt(subjects.length)}
                icon={<Users className="h-5 w-5" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('impersonation.users.kpi.accessMode', 'Access Mode')}
                value={accessMode}
                icon={
                  open ? (
                    <ShieldOff className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                  )
                }
                color={open ? 'amber' : 'blue'}
              />
              <MetricCard
                label={t('impersonation.users.kpi.session', 'Session Status')}
                value={sessionStatus}
                icon={<UserCog className="h-5 w-5" aria-hidden="true" />}
                color={active ? 'green' : 'cyan'}
              />
              <MetricCard
                label={t('impersonation.users.kpi.limit', 'Session Limit')}
                value={t('impersonation.users.kpi.limitValue', '15 min')}
                icon={<Clock className="h-5 w-5" aria-hidden="true" />}
                color="purple"
              />
            </div>
          )}
        </section>
      </FadeIn>

      {/* 2 — Subjects table (hero) + live session status */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('impersonation.users.mainLabel', 'Subjects and session status')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <div className="xl:col-span-2">
            <SubjectsTable
              subjects={subjects}
              open={open}
              active={active}
              targetSubject={targetSubject}
              isLoading={subjectsLoading}
              isError={subjectsError}
              error={candidates.error}
              onRetry={() => void candidates.refetch()}
            />
          </div>
          <div className="xl:col-span-1">
            <ImpersonationStatusPanel
              status={status.data}
              isLoading={status.isLoading}
              isError={status.isError}
            />
          </div>
        </section>
      </FadeIn>

      {/* 3 — Policy / how impersonation works */}
      <FadeIn delay={0.2}>
        <ImpersonationPolicyPanel />
      </FadeIn>
    </PageContainer>
  )
}
