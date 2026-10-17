import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';

export function LogConnectionBadge({ isConnected, paused, hasError, enabled }: {
  isConnected: boolean; paused: boolean; hasError: boolean; enabled: boolean;
}) {
  const { t } = useTranslation();
  if (hasError) return <Badge variant="danger" dot data-testid="livelogs-status-badge">{t('liveLogs.status.error', 'Connection error')}</Badge>;
  if (!enabled) return <Badge variant="neutral" dot data-testid="livelogs-status-badge">{t('liveLogs.status.disconnected', 'Disconnected')}</Badge>;
  if (!isConnected) return <Badge variant="info" dot data-testid="livelogs-status-badge">{t('liveLogs.status.connecting', 'Connecting…')}</Badge>;
  if (paused) return <Badge variant="warning" dot data-testid="livelogs-status-badge">{t('liveLogs.status.paused', 'Paused (still receiving)')}</Badge>;
  return <Badge variant="success" dot data-testid="livelogs-status-badge">{t('liveLogs.status.connected', 'Live')}</Badge>;
}
