import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { DriveDnaModel } from '../../lib/driveDNA';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface DriveDnaSignalCoverageGridProps { model: DriveDnaModel }

export function DriveDnaSignalCoverageGrid({ model }: DriveDnaSignalCoverageGridProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const channels = [
    { key: 'speed', coverage: model.coverage.speed, label: t('driveDna.coverage.speed', 'Speed availability') },
    { key: 'power', coverage: model.coverage.power, label: t('driveDna.coverage.power', 'Power availability') },
    { key: 'soc', coverage: model.coverage.soc, label: t('driveDna.coverage.soc', 'SoC availability') },
    { key: 'ambient', coverage: model.coverage.outsideTemp, label: t('driveDna.coverage.ambient', 'Ambient availability') },
    { key: 'elevation', coverage: model.coverage.elevation, label: t('driveDna.coverage.elevation', 'Elevation availability') },
  ];
  const metrics: StatMetric[] = channels.map(({ key, coverage, label }) => ({
    metricId: 'count', occurrenceId: key, label, rawValue: coverage.availableCount,
    display: { countTotal: model.sample.validRows },
    description: coverage.availablePct != null
      ? t('driveDna.coverage.channelPercent', '{{percent}}% available', { percent: fmtNumber(coverage.availablePct) })
      : t('driveDna.coverage.channelNoDenominator', 'No valid-row denominator'),
    context: t('driveDna.brief.coverageDenominator', 'Availability is measured against {{count}} valid timestamp rows, not expected emissions.', { count: model.sample.validRows }),
  }));
  return <NestedDrivingBrief metrics={metrics}
    title={t('driveDna.brief.signalCoverage', 'Signal coverage')}
    description={t('driveDna.brief.coverageScope', 'Per-signal availability in returned telemetry; missing readings are not zero measurements.')}
    period={{ kind: 'unknown', label: t('driveDna.brief.signalCoverage', 'Signal coverage'),
      reason: t('driveDna.brief.coverageDenominator', 'Availability is measured against {{count}} valid timestamp rows, not expected emissions.', { count: model.sample.validRows }) }} />;
}
