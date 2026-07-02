/**
 * ArchivedPage — Notifications inbox scoped to archived items only.
 *
 * Full-width modern-ui layout: an archived-backlog KPI band (`ArchivedSummary`)
 * over the shared `InboxBody` detail surface (`archived={true}` swaps the
 * bulk-action set from Archive to Restore). The KPI band reads the unfiltered
 * archived set so it stays a stable "backlog overview" while the list below
 * honours the user's URL-backed filters.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
import { ArchivedSummary } from '../components/ArchivedSummary';

export default function ArchivedPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.archived.title', 'Archived notifications'));

  const { data: vehicles = [] } = useVehicles();
  const { data: rules = [] } = useAlertRules();

  // Unfiltered archived backlog drives the KPI summary band. Passing the bare
  // `{ archived: true }` key lets TanStack Query dedupe this with InboxBody's
  // own default fetch whenever no filters are active — so the summary costs no
  // extra request in the common case, yet always reflects the full backlog.
  const archivedFilters = useMemo<NotificationFilters>(() => ({ archived: true }), []);
  const summaryQuery = useNotificationLogs(archivedFilters);

  return (
    <PageContainer
      title={t('notifications.archived.title', 'Archived notifications')}
      subtitle={t(
        'notifications.archived.subtitle',
        'Notifications you previously archived. Restore to bring them back.',
      )}
      copyLink
      query={summaryQuery}
      actions={
        <Link
          to="/notifications/inbox"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t('notifications.archived.backToInbox', 'Back to inbox')}
        </Link>
      }
    >
      <FadeIn>
        <ArchivedSummary query={summaryQuery} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <InboxBody archived={true} vehicles={vehicles} rules={rules} />
      </FadeIn>
    </PageContainer>
  );
}
