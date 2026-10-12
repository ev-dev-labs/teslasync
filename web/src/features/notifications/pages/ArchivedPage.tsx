/**
 * ArchivedPage — Notifications inbox scoped to archived items only.
 *
 * Data-first layout: a compact archived-backlog strip (`InboxSummary`)
 * over the shared `InboxBody` detail surface (`archived={true}` swaps the
 * bulk-action set from Archive to Restore). The KPI band reads the unfiltered
 * archived set so it stays a stable "backlog overview" while the list below
 * honours the user's URL-backed filters.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PageLayout } from '@/components/layout';
import { BUTTON_BASE, BUTTON_VARIANTS, Icon, Text } from '@/components/ui';
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

export default function ArchivedPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.archived.title', 'Archived notifications'));

  const { data: vehicles = [] } = useVehicles();
  const { data: rules = [] } = useAlertRules();

  // This bounded, all-time sample is independent of the workspace-scoped
  // server-paginated list. Keep its scope explicit instead of claiming a total.
  const archivedFilters = useMemo<NotificationFilters>(() => ({ archived: true }), []);
  const summaryQuery = useNotificationLogs(archivedFilters);

  return (
    <PageLayout
      title={t('notifications.archived.title', 'Archived notifications')}
      subtitle={t(
        'notifications.archived.subtitle',
        'Notifications you previously archived. Restore to bring them back.',
      )}
      copyLink
      query={summaryQuery}
      secondaryActions={
        <Link
          to="/notifications/inbox"
          className={cn(
            BUTTON_BASE,
            BUTTON_VARIANTS.ghost,
            'min-h-11 min-w-11 max-w-full px-3 py-2 md:min-h-9',
          )}
        >
          <Icon icon={ArrowLeft} size="sm" className="rtl:rotate-180" />
          <Text as="span" variant="bodySm" className="min-w-0 break-words">
            {t('notifications.archived.backToInbox', 'Back to inbox')}
          </Text>
        </Link>
      }
    >
      <FadeIn>
        <InboxSummary query={summaryQuery} archived />
      </FadeIn>
      <FadeIn delay={0.05}>
        <InboxBody archived={true} vehicles={vehicles} rules={rules} />
      </FadeIn>
    </PageLayout>
  );
}
