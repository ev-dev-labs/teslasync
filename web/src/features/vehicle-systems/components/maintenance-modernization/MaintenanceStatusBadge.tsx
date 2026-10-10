import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import type { MaintenanceStatus } from './maintenanceModel';
import { STATUS_BADGES } from './maintenancePresentation';

/** Keep domain status labels separate from category color and progress. */
export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  const { t } = useTranslation();
  const badge = STATUS_BADGES[status];
  return <Badge variant={badge.variant} size="sm">{t(badge.labelKey, badge.fallback)}</Badge>;
}
