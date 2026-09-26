/**
 * InboxPage — top-level Notifications inbox route.
 *
 * Full-width modern-ui layout: an active-backlog KPI band (`InboxSummary`) over
 * the shared `InboxBody` detail surface (`archived={false}`). The KPI band reads
 * the unfiltered active set so it stays a stable "backlog overview" while the
 * list below honours the user's URL-backed filters. Mirrors `ArchivedPage` for a
 * connected, consistent feel across the two notification surfaces.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Archive } from 'lucide-react';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useAlertRules,
  useNotificationLogs,
  type NotificationFilters,
} from '@/api/hooks/useNotifications';
import { InboxBody } from '../components/InboxBody';
import { InboxSummary } from '../components/InboxSummary';
import { NotificationReportPanel } from '../components/NotificationReportPanel';

export default function InboxPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.inbox.title', 'Inbox'));
  const { startInstant, endInstantExclusive } = useRangeState();

  const { data: vehicles = [] } = useVehicles();
  const { data: rules = [] } = useAlertRules();

  // The latest active notifications drive the recent KPI band; historical
  // period totals come from the report rather than this bounded list.
  const summaryFilters = useMemo<NotificationFilters>(() => ({ archived: false }), []);
  const summaryQuery = useNotificationLogs(summaryFilters);

  return (
    <PageContainer
      title={t('notifications.inbox.title', 'Inbox')}
      subtitle={t('notifications.inbox.subtitle', 'All system, alert, automation, and scheduled notifications in one place.')}
      copyLink
      query={summaryQuery}
      actions={
        <Link
          to="/notifications/archived"
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-2 transition-colors',
            typography.size.xs,
            typography.weight.medium,
            typography.color.secondary,
            'hover:bg-white/[0.04] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
          )}
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          {t('notifications.inbox.viewArchived', 'View archived')}
        </Link>
      }
    >
      <FadeIn>
        <NotificationReportPanel fromInstant={startInstant} toExclusive={endInstantExclusive} />
      </FadeIn>
      <FadeIn>
        <InboxSummary query={summaryQuery} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <InboxBody archived={false} vehicles={vehicles} rules={rules} />
      </FadeIn>
    </PageContainer>
  );
}
