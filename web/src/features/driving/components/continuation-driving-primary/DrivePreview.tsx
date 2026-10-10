import { useTranslation } from 'react-i18next';
import { Activity, BatteryCharging, Bell, Car, MapPin, Wrench } from 'lucide-react';
import { EntityPreviewDrawer } from '@/components/data-display';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDateTime, formatDurationMinutes } from '@/lib/dateFormat';
import { buildContextHref } from '@/lib/contextNavigation';
import { getEfficiency, gradeFromEfficiency } from '@/lib/drivesAggregation';
import type { Drive } from '@/types/driving';

interface DrivePreviewProps {
  drive: Drive | null;
  onClose: () => void;
  onOpenDetails: (id: number) => void;
  timezone: string;
  from: string | null | undefined;
  to: string | null | undefined;
  toDistanceDisplay: (value: number) => number;
  toEfficiencyDisplay: (value: number) => number;
  formatEnergy: (value: number) => string;
  distanceUnit: string;
  efficiencyUnit: string;
}

export function DrivePreview({
  drive, onClose, onOpenDetails, timezone, from, to,
  toDistanceDisplay, toEfficiencyDisplay, formatEnergy, distanceUnit, efficiencyUnit,
}: DrivePreviewProps) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const efficiency = drive ? getEfficiency(drive) : null;
  const finite = (value: number | null | undefined) => value != null && Number.isFinite(value);
  return (
    <EntityPreviewDrawer
      open={drive !== null}
      onClose={onClose}
      eyebrow={t('drives.preview.eyebrow', 'Drive preview')}
      title={drive
        ? `${drive.startAddress ?? t('drives.unknownStart', 'Unknown start')} → ${
          drive.endAddress ?? t('drives.unknownEnd', 'Unknown destination')}`
        : t('drives.preview.title', 'Drive details')}
      description={drive ? formatDateTime(drive.startTs, { tz: timezone }) : undefined}
      statusLabel={drive?.endTs
        ? t('drives.preview.completed', 'Completed')
        : t('drives.inProgress', 'In progress')}
      statusTone={drive?.endTs ? 'success' : 'info'}
      fields={drive ? [
        {
          key: 'duration',
          label: t('drives.duration', 'Duration'),
          value: finite(drive.durationS) ? formatDurationMinutes(drive.durationS / 60) : '—',
        },
        {
          key: 'distance',
          label: t('drives.distance', 'Distance'),
          value: finite(drive.distanceM)
            ? `${fmtNumber(toDistanceDisplay(drive.distanceM))} ${distanceUnit}` : '—',
        },
        {
          key: 'energy',
          label: t('drives.energyUsed', 'Energy used'),
          value: drive.energyUsedWh != null && finite(drive.energyUsedWh) ? formatEnergy(drive.energyUsedWh) : '—',
        },
        {
          key: 'battery',
          label: t('drives.batteryChange', 'Battery change'),
          value: `${finite(drive.startBatteryPct) ? `${fmtNumber(drive.startBatteryPct!)}%` : '—'} → ${
            finite(drive.endBatteryPct) ? `${fmtNumber(drive.endBatteryPct!)}%` : '—'}`,
        },
        {
          key: 'efficiency',
          label: t('drives.efficiency', 'Energy intensity'),
          value: efficiency != null ? `${fmtInt(toEfficiencyDisplay(efficiency))} ${efficiencyUnit}` : '—',
        },
        {
          key: 'grade',
          label: t('drives.avgGrade', 'Efficiency grade'),
          value: gradeFromEfficiency(efficiency).label,
        },
      ] : []}
      primaryAction={drive ? {
        label: t('drives.preview.openDetails', 'Open drive details'),
        onClick: () => onOpenDetails(drive.id),
      } : undefined}
      relatedActions={drive ? [
        {
          key: 'vehicle',
          label: t('entityContext.vehicle', 'Vehicle'),
          to: `/vehicles/${drive.vehicleId}`,
          icon: <Car className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'charging',
          label: t('entityContext.charging', 'Charging sessions'),
          to: buildContextHref('/charging', { from, to }),
          icon: <BatteryCharging className="h-4 w-4" aria-hidden="true" />,
        },
        ...(drive.startAddress ? [{
          key: 'start-location',
          label: t('entityContext.startLocation', 'Start location'),
          to: buildContextHref('/locations', { q: drive.startAddress, from, to }),
          icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
        }] : []),
        ...(drive.endAddress && drive.endAddress !== drive.startAddress ? [{
          key: 'end-location',
          label: t('entityContext.endLocation', 'Destination'),
          to: buildContextHref('/locations', { q: drive.endAddress, from, to }),
          icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
        }] : []),
        {
          key: 'alerts',
          label: t('entityContext.alerts', 'Alerts'),
          to: buildContextHref('/notifications/inbox', { from, to }),
          icon: <Bell className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'service',
          label: t('entityContext.service', 'Service history'),
          to: '/maintenance',
          icon: <Wrench className="h-4 w-4" aria-hidden="true" />,
        },
        {
          key: 'telemetry',
          label: t('entityContext.telemetry', 'Telemetry evidence'),
          to: buildContextHref('/signals', { from, to, signals: ['VehicleSpeed', 'BatteryLevel'] }),
          icon: <Activity className="h-4 w-4" aria-hidden="true" />,
        },
      ] : []}
    />
  );
}
