/**
 * InboxPage — top-level Notifications inbox route.
 * Hosts the shared `<InboxBody/>` for the active (non-archived) inbox.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Archive } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useAlertRules } from '@/api/hooks/useNotifications';
import { InboxBody } from '../components/InboxBody';

export default function InboxPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.inbox.title', 'Inbox'));
  const { data: vehicles = [] } = useVehicles();
  const { data: rules = [] } = useAlertRules();

  return (
    <PageContainer
      title={t('notifications.inbox.title', 'Inbox')}
      subtitle={t('notifications.inbox.subtitle', 'Recent notifications from your alert rules.')}
      copyLink
      actions={
        <Link
          to="/notifications/archived"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          <Archive className="h-3.5 w-3.5" />
          {t('notifications.inbox.viewArchived', 'View archived')}
        </Link>
      }
    >
      <InboxBody archived={false} vehicles={vehicles} rules={rules} />
    </PageContainer>
  );
}
