import {
  BatteryMedium,
  Gauge,
  Mountain,
  Thermometer,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type {
  DriveDnaChannelCoverage,
  DriveDnaModel,
} from '../../lib/driveDNA';

const COVERAGE_COLUMNS = { default: 2, md: 3, xl: 5 } as const;

interface DriveDnaSignalCoverageGridProps {
  model: DriveDnaModel;
}

export function DriveDnaSignalCoverageGrid({
  model,
}: DriveDnaSignalCoverageGridProps) {
  const { t } = useTranslation();
  const value = (coverage: DriveDnaChannelCoverage): string =>
    t('driveDna.coverage.channelValue', '{{available}} / {{valid}}', {
      available: fmtInt(coverage.availableCount),
      valid: fmtInt(model.sample.validRows),
    });
  const subtitle = (coverage: DriveDnaChannelCoverage): string =>
    coverage.availablePct != null
      ? t('driveDna.coverage.channelPercent', '{{percent}}% available', {
          percent: fmtNumber(coverage.availablePct, 1),
        })
      : t('driveDna.coverage.channelNoDenominator', 'No valid-row denominator');

  return (
    <Grid cols={COVERAGE_COLUMNS} gap={3}>
      <MetricCard
        label={t('driveDna.coverage.speed', 'Speed availability')}
        value={value(model.coverage.speed)}
        subtitle={subtitle(model.coverage.speed)}
        icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('driveDna.coverage.power', 'Power availability')}
        value={value(model.coverage.power)}
        subtitle={subtitle(model.coverage.power)}
        icon={<Zap className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('driveDna.coverage.soc', 'SoC availability')}
        value={value(model.coverage.soc)}
        subtitle={subtitle(model.coverage.soc)}
        icon={<BatteryMedium className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('driveDna.coverage.ambient', 'Ambient availability')}
        value={value(model.coverage.outsideTemp)}
        subtitle={subtitle(model.coverage.outsideTemp)}
        icon={<Thermometer className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('driveDna.coverage.elevation', 'Elevation availability')}
        value={value(model.coverage.elevation)}
        subtitle={subtitle(model.coverage.elevation)}
        icon={<Mountain className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
    </Grid>
  );
}
