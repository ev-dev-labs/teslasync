import {
  BatteryMedium,
  Clock3,
  Gauge,
  MapPinned,
  Rows3,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { Drive } from '@/types/driving';
import type { DriveDnaModel } from '../../lib/driveDNA';
import { DriveDnaKpiNotices } from './DriveDnaKpiNotices';
import type { DriveDnaSectionState } from './types';

const KPI_COLUMNS = { default: 2, md: 3, xl: 6 } as const;

interface DriveDnaKpiBandProps {
  drive: Drive | null;
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  units: UseUnitsResult;
  capReached: boolean;
}

export function DriveDnaKpiBand({
  drive,
  model,
  state,
  units,
  capReached,
}: DriveDnaKpiBandProps) {
  const { t } = useTranslation();
  const listLoading = state.list.isLoading;
  const telemetryLoading = state.telemetry.isLoading && state.hasDrive;
  const listValue = (value: string): string =>
    listLoading ? t('driveDna.states.loadingShort', 'Loading…') : value;
  const telemetryValue = (value: string): string =>
    telemetryLoading
      ? t('driveDna.states.loadingShort', 'Loading…')
      : state.telemetry.isResolved
        ? value
        : '—';
  const regenShare =
    model.stats.regenEmissionShare != null
      ? `${fmtNumber(model.stats.regenEmissionShare * 100, 1)}%`
      : '—';
  const socDelta =
    model.stats.socDeltaPct != null
      ? t('driveDna.kpis.percentagePoints', '{{value}} pp', {
          value: `${model.stats.socDeltaPct > 0 ? '+' : ''}${fmtNumber(model.stats.socDeltaPct, 1)}`,
        })
      : '—';

  return (
    <section
      aria-label={t(
        'driveDna.kpis.aria',
        'Selected-drive summary evidence',
      )}
      data-testid="drive-dna-kpis"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveDna.kpis.title', 'Selected-drive evidence')}
        </PanelTitle>
        <Grid cols={KPI_COLUMNS} gap={3}>
          <MetricCard
            label={t('driveDna.kpis.distance', 'Drive distance')}
            value={listValue(
              drive ? units.formatDistance(drive.distanceM, { precision: 1 }) : '—',
            )}
            subtitle={t(
              'driveDna.kpis.distanceHint',
              'Aggregate drive metadata',
            )}
            icon={<MapPinned className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('driveDna.kpis.duration', 'Drive duration')}
            value={listValue(
              drive ? units.formatDuration(drive.durationS, { precision: 2 }) : '—',
            )}
            subtitle={t(
              'driveDna.kpis.durationHint',
              'Aggregate drive metadata',
            )}
            icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('driveDna.kpis.rows', 'Telemetry rows returned')}
            value={telemetryValue(fmtInt(model.sample.returnedRows))}
            subtitle={t(
              'driveDna.kpis.rowsHint',
              'Selected drive only',
            )}
            icon={<Rows3 className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('driveDna.kpis.topSpeed', 'Sampled top speed')}
            value={telemetryValue(
              units.formatSpeed(model.stats.topSpeedMps, { precision: 1 }),
            )}
            subtitle={t(
              'driveDna.kpis.topSpeedHint',
              'Maximum available speed value',
            )}
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t(
              'driveDna.kpis.regenShare',
              'Regen-observed emissions',
            )}
            value={telemetryValue(regenShare)}
            subtitle={t(
              'driveDna.kpis.regenShareHint',
              'Power-available rows after forward fold, not time share',
            )}
            icon={<Zap className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('driveDna.kpis.socChange', 'Sampled SoC change')}
            value={telemetryValue(socDelta)}
            subtitle={t(
              'driveDna.kpis.socChangeHint',
              'Last available minus first available',
            )}
            icon={<BatteryMedium className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
        </Grid>

        <DriveDnaKpiNotices
          model={model}
          state={state}
          capReached={capReached}
        />
      </GlassPanel>
    </section>
  );
}
