import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Caption } from '@/components/ui';

interface VehicleAccessCompactProps {
  driverCount: number | null;
  mobileEnabled: boolean | null;
}

export function VehicleAccessCompact({ driverCount, mobileEnabled }: VehicleAccessCompactProps) {
  const { t } = useTranslation('dashboard');
  const mobileLabel = mobileEnabled === true
    ? t('widget.vehicleAccessMobileOn', 'Mobile access enabled')
    : mobileEnabled === false
      ? t('widget.vehicleAccessMobileOff', 'Mobile access disabled')
      : t('widget.vehicleAccessMobileUnknown', 'Mobile access unknown');

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        <Users className="h-4 w-4 flex-shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
        <Caption className="min-w-0 [overflow-wrap:anywhere]">
          {driverCount ?? '—'} {t('widget.vehicleAccessDrivers', 'drivers')}
        </Caption>
      </div>
      <span
        role="img"
        aria-label={mobileLabel}
        className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
          mobileEnabled === true
            ? 'bg-emerald-400'
            : mobileEnabled === false ? 'bg-red-400' : 'bg-[var(--surface-2)]'
        }`}
        title={mobileLabel}
      />
    </div>
  );
}
