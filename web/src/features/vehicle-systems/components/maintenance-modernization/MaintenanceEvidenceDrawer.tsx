import { useTranslation } from 'react-i18next';
import {
  Activity, BatteryCharging, Bell, Car, MapPin, Route, ShieldCheck,
} from 'lucide-react';
import { EntityPreviewDrawer } from '@/components/data-display';
import { buildContextHref } from '@/lib/contextNavigation';
import { formatDateTime } from '@/lib/dateFormat';
import { localDayKey } from '@/lib/drivesAggregation';
import type { DistanceFormatter, ServiceRecord } from './maintenanceModel';

/** Existing evidence navigation and business-day bounds, not CRUD or an
 * attachment upload flow. The shared drawer owns focus, dismissal and links. */
export function MaintenanceEvidenceDrawer({
  record,
  onClose,
  formatDistance,
  formatCurrency,
}: {
  record: ServiceRecord | null;
  onClose: () => void;
  formatDistance: DistanceFormatter;
  formatCurrency: (amount: number) => string;
}) {
  const { t } = useTranslation();
  const day = localDayKey(record?.date);
  return (
    <EntityPreviewDrawer
      open={record !== null}
      onClose={onClose}
      eyebrow={t('maintenance.preview.eyebrow', 'Service evidence')}
      title={record?.description || t('maintenance.preview.title', 'Service record')}
      description={record?.notes || undefined}
      statusLabel={t('maintenance.preview.completed', 'Completed')}
      statusTone="success"
      fields={record ? [
        {
          key: 'date',
          label: t('maintenance.col.date', 'Date'),
          value: formatDateTime(record.date),
        },
        {
          key: 'mileage',
          label: t('maintenance.col.mileage', 'Mileage'),
          value: formatDistance(record.mileage),
        },
        {
          key: 'cost',
          label: t('maintenance.col.cost', 'Cost'),
          value: formatCurrency(record.cost),
        },
        {
          key: 'provider',
          label: t('maintenance.col.provider', 'Provider'),
          value: record.provider || '—',
        },
        {
          key: 'id',
          label: t('maintenance.preview.recordId', 'Record ID'),
          value: String(record.id),
        },
        {
          key: 'vehicle_id',
          label: t('entityContext.vehicle', 'Vehicle'),
          value: String(record.vehicle_id),
        },
        {
          key: 'created_at',
          label: t('maintenance.details.createdAt', 'Created'),
          value: record.created_at ? formatDateTime(record.created_at) : '—',
        },
      ] : []}
      relatedActions={record ? [
        {
          key: 'vehicle',
          label: t('entityContext.vehicle', 'Vehicle'),
          to: `/vehicles/${record.vehicle_id}`,
          icon: <Car className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'drives',
          label: t('entityContext.drives', 'Drive history'),
          to: buildContextHref('/drives', { from: day, to: day }),
          icon: <Route className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'charging',
          label: t('entityContext.charging', 'Charging sessions'),
          to: buildContextHref('/charging', { from: day, to: day }),
          icon: <BatteryCharging className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'locations',
          label: t('entityContext.locations', 'Visited locations'),
          to: buildContextHref('/locations', { from: day, to: day }),
          icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'alerts',
          label: t('entityContext.alerts', 'Alerts'),
          to: buildContextHref('/notifications/inbox', { from: day, to: day }),
          icon: <Bell className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'telemetry',
          label: t('entityContext.telemetry', 'Telemetry evidence'),
          to: buildContextHref('/signals', { from: day, to: day }),
          icon: <Activity className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'evidence-pack',
          label: t('entityContext.evidencePack', 'Build service evidence pack'),
          to: '/diagnostics/service-evidence',
          icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
        },
      ] : []}
    />
  );
}
