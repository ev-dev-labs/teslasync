import { useTranslation } from 'react-i18next';
import type { NotificationLog } from '@/api/types';

/** Preserve DND as an acronym and never infer a successful delivery from absence. */
export function NotificationInboxDelivery({ status }: { status: NotificationLog['status'] | null | undefined }) {
  const { t } = useTranslation();
  const labels = {
    triggered: t('notifications.inbox.delivery.triggered', 'Triggered'),
    pending: t('notifications.inbox.delivery.pending', 'Pending'),
    sent: t('notifications.inbox.delivery.sent', 'Sent'),
    failed: t('notifications.inbox.delivery.failed', 'Failed'),
    deferred_dnd: t('notifications.inbox.delivery.deferred_dnd', 'Deferred by DND'),
  };
  return <>{status ? labels[status] ?? status : '—'}</>;
}
