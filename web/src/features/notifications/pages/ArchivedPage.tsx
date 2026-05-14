/**
 * ArchivedPage — Notifications inbox scoped to archived items only.
 * Reuses `<InboxBody/>` with `archived={true}` so the bulk-action set
 * automatically swaps Archive for Restore.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useAlertRules } from '@/api/hooks/useNotifications';
import { InboxBody } from '../components/InboxBody';

export default function ArchivedPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.archived.title', 'Archived notifications'));
  const { data: vehicles = [] } = useVehicles();
  const { data: rules = [] } = useAlertRules();

  return (
    <PageContainer
      title={t('notifications.archived.title', 'Archived notifications')}
      subtitle={t('notifications.archived.subtitle', 'Notifications you previously archived. Restore to bring them back.')}
      copyLink
      actions={
        <Link
          to="/notifications/inbox"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('notifications.archived.backToInbox', 'Back to inbox')}
        </Link>
      }
    >
      <InboxBody archived={true} vehicles={vehicles} rules={rules} />
    </PageContainer>
  );
}
