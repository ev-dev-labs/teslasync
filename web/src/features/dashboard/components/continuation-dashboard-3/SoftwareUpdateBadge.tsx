import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';

export type UpdateStatus =
  | 'unknown'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'installed';

export function SoftwareUpdateBadge({ status }: { status: UpdateStatus }) {
  const { t } = useTranslation('dashboard');
  const config: Record<UpdateStatus, { variant: 'success' | 'info' | 'warning' | 'neutral'; label: string }> = {
    unknown: { variant: 'neutral', label: t('common:unknown', 'Unknown') },
    'up-to-date': { variant: 'success', label: t('widget.statusUpToDate', 'Up to date') },
    available: { variant: 'info', label: t('widget.statusAvailable', 'Available') },
    downloading: { variant: 'warning', label: t('widget.statusDownloading', 'Downloading') },
    ready: { variant: 'info', label: t('widget.statusReady', 'Ready') },
    installing: { variant: 'warning', label: t('widget.statusInstalling', 'Installing') },
    installed: { variant: 'success', label: t('widget.statusInstalled', 'Installed') },
  };
  const { variant, label } = config[status];
  return <Badge variant={variant} size="sm" dot>{label}</Badge>;
}
