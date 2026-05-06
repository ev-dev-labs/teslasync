/**
 * SystemPage — Phase-46 / Prompt 40.
 *
 * New admin page that aggregates "infrastructure-budget" panels —
 * starting with RateLimitStatusPanel. Sibling system pages
 * (SystemStatusPage, ApiLogsPage, DiagnosticPage) already cover
 * health, request logs, and self-test; this page is focused on the
 * "how close are we to throttle limits" question that previously
 * had no surface.
 *
 * Route wiring (App.tsx + routeRegistry.ts) is intentionally deferred
 * to a follow-up prompt — the gate's allowed-files regex for prompt
 * 40 only covers this page file plus the panel + its hook; mounting
 * the page on a route would require edits outside that regex. Once
 * routed, the same nav-entry pattern Phase-46/33 used for the
 * Diagnostic page can be reused here.
 */

import { useTranslation } from 'react-i18next'

import { PageContainer, Stack } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'

import { RateLimitStatusPanel } from '@/features/admin/components/RateLimitStatusPanel'
import { QueueStatusPanel } from '@/features/admin/components/QueueStatusPanel'

export const SYSTEM_PAGE_PATH = '/admin/system'

export default function SystemPage() {
  const { t } = useTranslation()
  const title = t('system.page.title', 'System budgets')
  usePageTitle(title)

  return (
    <PageContainer
      title={title}
      subtitle={t(
        'system.page.subtitle',
        'Operator dashboard for the throttles and budgets that bound this TeslaSync deployment.',
      )}
    >
      <FadeIn>
        <Stack className="gap-6" data-testid="system-page-stack">
          <RateLimitStatusPanel />
          <QueueStatusPanel />
        </Stack>
      </FadeIn>
    </PageContainer>
  )
}
