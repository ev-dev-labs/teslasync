/**
 * Admin page that aggregates "infrastructure-budget" panels —
 * starting with RateLimitStatusPanel. Sibling system pages
 * (SystemStatusPage, ApiLogsPage, DiagnosticPage) already cover
 * health, request logs, and self-test; this page is focused on the
 * "how close are we to throttle limits" question that previously
 * had no surface.
 *
 * Route wiring lives in App.tsx + routeRegistry.ts. Reuse the same
 * nav-entry pattern as the Diagnostic page when adding new system panels.
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
