/**
 * Toolbar for the Vehicle Ingest Cost page — window preset picker + manual
 * refresh. Mounted in `PageContainer`'s `actions` slot so it sits beside the
 * data-freshness chip on desktop and wraps under the title on mobile.
 */
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { Button, Select, Caption } from '@/components/ui';
import { WINDOW_OPTIONS } from './constants';

interface VehicleCostToolbarProps {
  windowDays: number;
  onWindowChange: (days: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function VehicleCostToolbar({
  windowDays,
  onWindowChange,
  onRefresh,
  refreshing,
}: VehicleCostToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <label className="flex items-center gap-2">
        <Caption>{t('admin.vehicleCost.windowLabel', 'Window')}</Caption>
        <Select
          value={String(windowDays)}
          onChange={(e) => onWindowChange(Number(e.target.value))}
          options={WINDOW_OPTIONS.map((opt) => ({
            value: String(opt.days),
            label: t(opt.labelKey, opt.fallback),
          }))}
        />
      </label>
      <Button
        variant="ghost"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={t('admin.vehicleCost.refresh', 'Refresh vehicle cost data')}
      >
        <RefreshCw
          className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
          aria-hidden="true"
        />
      </Button>
    </div>
  );
}
