/**
 * Toolbar for the Vehicle Ingest Cost page — window preset picker + manual
 * refresh. Mounted in `PageContainer`'s `actions` slot so it sits beside the
 * data-freshness chip on desktop and wraps under the title on mobile.
 */
import { useCallback, useMemo, type ChangeEvent } from 'react';
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

  // The presets are static; only their translated labels change. Memoise the
  // mapped list so the `<Select>` isn't handed a fresh array (and four `t()`
  // calls) on every parent refetch tick.
  const options = useMemo(
    () =>
      WINDOW_OPTIONS.map((opt) => ({
        value: String(opt.days),
        label: t(opt.labelKey, opt.fallback),
      })),
    [t],
  );

  const handleWindowChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => onWindowChange(Number(e.target.value)),
    [onWindowChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <label className="flex items-center gap-2">
        <Caption>{t('admin.vehicleCost.windowLabel', 'Window')}</Caption>
        <Select value={String(windowDays)} onChange={handleWindowChange} options={options} />
      </label>
      <Button
        variant="ghost"
        onClick={onRefresh}
        disabled={refreshing}
        // Communicate the in-flight refresh to assistive tech. The visible
        // <RefreshCw> spins, but the icon is aria-hidden, so without this a
        // screen-reader user gets no signal the control is busy. We can't lean
        // on <Button loading> here — that swaps in its own spinner and would
        // double up with the icon we deliberately keep visible.
        aria-busy={refreshing || undefined}
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
