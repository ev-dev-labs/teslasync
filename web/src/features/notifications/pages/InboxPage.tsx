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
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useAlertRules,
  useNotificationLogs,
  type NotificationFilters,
} from '@/api/hooks/useNotifications';
import { InboxBody } from '../components/InboxBody';
import { InboxSummary } from '../components/InboxSummary';

export default function InboxPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.inbox.title', 'Inbox'));

  const { data: vehicles = [] } = useVehicles();
  const { data: rules = [] } = useAlertRules();

  // Unfiltered active backlog drives the KPI summary band. Passing the bare
  // `{ archived: false }` key lets TanStack Query dedupe this with InboxBody's
  // own flat-view fetch whenever no filters are active — so the summary costs
  // no extra request in that case, yet always reflects the full active backlog.
  const summaryFilters = useMemo<NotificationFilters>(() => ({ archived: false }), []);
  const summaryQuery = useNotificationLogs(summaryFilters);

  return (
    <PageContainer
      title={t('notifications.inbox.title', 'Inbox')}
      subtitle={t('notifications.inbox.subtitle', 'Recent notifications from your alert rules.')}
      copyLink
      query={summaryQuery}
      actions={
        <Link
          to="/notifications/archived"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          {t('notifications.inbox.viewArchived', 'View archived')}
        </Link>
      }
    >
      <FadeIn>
        <InboxSummary query={summaryQuery} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <InboxBody archived={false} vehicles={vehicles} rules={rules} />
      </FadeIn>
    </PageContainer>
  );
}
