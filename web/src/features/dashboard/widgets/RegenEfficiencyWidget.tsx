import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useRegenEfficiency } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';

export default function RegenEfficiencyWidget({ vehicleId, size, config }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatEnergy } = useUnits();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const query = useRegenEfficiency(vehicleIdStr, undefined, undefined, undefined, config?.timeRange);
  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = query;
  const trust = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

  const isCompact = size.cols <= 1;
  const regenPct = knownNumber(data?.regenRatio);
  const recoveredWh = knownNumber(data?.totalRegenWh);
  const driveWh = knownNumber(data?.totalDriveWh);
  const headline = (
    <WidgetBigNumber value={regenPct == null ? null : fmtInt(regenPct)} unit="%"
      subtitle={t('widget.regenEfficiency.energyRecovered', 'Energy recovered')} align="center" />
  );
  const details = (
    <WidgetStatGrid cols={2} maxPerRow={2} stats={[
      { label: t('widget.regenEfficiency.totalKwh', 'Total recovered'), value: recoveredWh == null ? null : formatEnergy(recoveredWh) },
      { label: t('widget.regenEfficiency.driveEnergy', 'Drive energy'), value: driveWh == null ? null : formatEnergy(driveWh) },
    ]} />
  );
  const empty = (
    <EmptyState variant="informational" icon={<RotateCcw className="h-5 w-5" />}
      message={t('widget.regenEfficiency.noData', 'No regen data')} className="py-4" />
  );

  const shellProps = {
    loading: isLoading,
    dataState: data != null || isLoading || isError || error ? trust : undefined,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  return (
    <WidgetShell
      title={t('widget.regenEfficiency.title', 'Regen braking')}
      icon={isCompact ? undefined : <RotateCcw className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      help={isCompact ? undefined : {
        i18nKey: 'help.regenEfficiency.body',
        defaultValue:
          'Energy recovered through regenerative braking divided by total energy used during driving. Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving.',
      }}
      {...shellProps}
    >
      <InstrumentPresentation family="ring" compact={isCompact} headline={data ? headline : empty}
        reading={{ value: regenPct, max: 100, label: t('widget.regenEfficiency.energyRecovered', 'Energy recovered'), unit: '%' }}
        icon={<RotateCcw />} details={data ? details : undefined}>
      {data ? (
        <div className="flex h-full min-w-0 flex-col justify-center gap-3">
          {headline}
          {details}
        </div>
      ) : empty}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
