import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, Table, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';

import type { DriveDetail } from '@/types/driving';
import type { ChartDataPoint, DriveStats } from './types';
import { driveEnergyEvidence } from './energyEvidence';
import { driveOdometerEvidence } from './odometerEvidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { asFiniteNumber } from '@/lib/typeGuards';

/**
 * Evidence, not another dashboard: source and estimation remain attached to
 * the reading. In particular energyUsedWh may already be signed/net; subtracting
 * recovered energy again would fabricate "net consumption".
 */
export function MoreDetailsPanel({ drive, stats, chartData }: { drive: DriveDetail; stats: DriveStats; chartData?: ChartDataPoint[] }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const evidence = driveEnergyEvidence(drive, stats);
  const { energyWh: used, regenWh: recovered } = evidence;
  const odometer = driveOdometerEvidence(drive, stats, unitPrefs.distance, chartData);
  const reported = t('driveDetail.report.persisted', 'Persisted drive aggregate');
  const sampled = t('driveDetail.report.sampled', 'Recorded telemetry samples');
  const odometerSource = odometer.source === 'aggregate' ? reported : odometer.source === 'sampled' ? sampled
    : t('driveDetail.report.odometerMixed', 'Recorded endpoints with telemetry fallback');
  const missing = t('common.unknown', 'Unknown');
  const rangePair = stats.startRange != null
    ? `${fmtNumber(stats.startRange)} → ${stats.endRange != null ? fmtNumber(stats.endRange) : '—'} ${unitPrefs.distance}` : '—';
  // Do not subtract ideal-at-departure from rated-at-arrival. The original
  // merged fallback stats remain supported for leaf callers, while the report
  // supplies samples and keeps each estimator's endpoints independent.
  const ranges = [
    { key: 'idealRange', label: t('driveDetail.report.idealRangeEndpoints', 'Range (ideal, start → end)') },
    { key: 'ratedRange', label: t('driveDetail.report.ratedRangeEndpoints', 'Range (rated, start → end)') },
    { key: 'estRange', label: t('driveDetail.report.estimatedRangeEndpoints', 'Range (estimated, start → end)') },
  ] as const;
  const rangeRows = ranges.map((series) => {
    const readings = (chartData ?? []).map((point) => point[series.key])
      .filter((value): value is number => value != null && Number.isFinite(value));
    const start = readings[0] ?? null;
    const end = readings.length > 1 ? readings[readings.length - 1] : null;
    return {
      id: series.key, label: series.label, start, end,
      value: start != null ? `${fmtNumber(start)} → ${end != null ? fmtNumber(end) : '—'} ${unitPrefs.distance}` : '—',
      source: t('driveDetail.report.rangeSeriesSource', 'First/last recorded values of this range estimator; gaps are not zero'),
    };
  });
  const selectedRange = rangeRows.find((row) => row.id === 'idealRange' && row.start != null)
    ?? rangeRows.find((row) => row.id === 'ratedRange' && row.start != null);
  const rows = [
    {
      id: 'used', label: t('driveDetail.energyConsumed', 'Energy consumed'),
      value: used != null ? formatEnergy(used) : '—',
      source: evidence.energySource === 'observed' ? reported
        : used != null ? asFiniteNumber(drive.avgPowerW) != null
          ? t('driveDetail.report.energyEstimate', 'Estimate: signed average power × duration; not metered energy')
          : t('driveDetail.report.observedEnergyEstimate', 'Estimate: signed power integrated over observed elapsed intervals; uncovered intervals remain unknown')
          : missing,
    },
    {
      id: 'regen', label: t('driveDetail.energyRecovered', 'Energy recovered'),
      value: recovered != null ? formatEnergy(recovered) : '—',
      source: evidence.regenSource === 'observed' ? reported
        : recovered != null ? t('driveDetail.report.regenEstimate', 'Estimate: negative power integrated over observed elapsed intervals; uncovered intervals remain unknown') : missing,
    },
    {
      id: 'odometer', label: drive.endTs == null
        ? t('driveDetail.report.ongoingOdometer', 'Odometer (start → latest)')
        : t('driveDetail.odometer', 'Odometer (from → to)'),
      value: odometer.start != null || odometer.end != null
        ? `${odometer.start != null ? fmtNumber(odometer.start) : '—'} → ${odometer.end != null ? fmtNumber(odometer.end) : '—'} ${unitPrefs.distance}` : '—',
      source: odometerSource,
    },
    ...(chartData != null ? rangeRows : [{
      id: 'range', label: t('driveDetail.rangeStartEnd', 'Range (start → end)'),
      value: rangePair,
      source: t('driveDetail.report.rangeSource', 'First/last available ideal range; rated range is the fallback'),
    }]),
    {
      id: 'range-used', label: t('driveDetail.rangeUsed', 'Range used'),
      value: chartData != null
        ? selectedRange?.start != null && selectedRange.end != null
          ? `${fmtNumber(selectedRange.start - selectedRange.end)} ${unitPrefs.distance}` : '—'
        : stats.startRange != null && stats.endRange != null
          ? `${fmtNumber(stats.startRange - stats.endRange)} ${unitPrefs.distance}` : '—',
      source: chartData != null
        ? `${selectedRange?.label ?? missing} · ${t('driveDetail.report.rangeDelta', 'Difference of available range estimates, not distance travelled')}`
        : t('driveDetail.report.rangeDelta', 'Difference of available range estimates, not distance travelled'),
    },
    {
      id: 'battery-used', label: t('driveDetail.batteryUsed', 'Battery used'),
      value: drive.startBatteryPct != null && drive.endBatteryPct != null
        ? `${fmtNumber(drive.startBatteryPct - drive.endBatteryPct)}%` : '—',
      source: t('driveDetail.report.batteryDelta', 'Endpoint SOC difference, not a measured energy total'),
    },
  ];
  return (
    <FadeIn className="h-full">
      <Card layout padding="none" className="h-full p-4 sm:p-5" data-testid="drive-energy-evidence">
        <CardHeader title={t('driveDetail.report.energyEvidence', 'Energy and range evidence')} />
        <CardContent>
        <Table variant="embedded" aria-label={t('driveDetail.report.energyEvidence', 'Energy and range evidence')}>
          <thead><tr>
            <th scope="col">{t('driveDetail.report.metric', 'Metric')}</th>
            <th scope="col">{t('driveDetail.whyEnded.signal.cols.value', 'Value')}</th>
            <th scope="col">{t('driveDetail.report.source', 'Source and method')}</th>
          </tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              <td className="whitespace-nowrap tabular-nums">{row.value}</td>
              <td className="min-w-48 text-[var(--text-muted)]">{row.source}</td>
            </tr>
          ))}</tbody>
        </Table>
        {evidence.powerObservationCount != null && evidence.powerSampleCount != null && <Text as="p" variant="caption">
          {sampled}: {fmtNumber(evidence.powerObservationCount, 0)} / {fmtNumber(evidence.powerSampleCount, 0)}
          {' · '}{t('driveDetail.report.powerMethod', 'Power samples preserve sign: positive draw, negative regeneration. Peak values require observations.')}
        </Text>}
        <Text as="p" variant="caption">
          {t('driveDetail.report.noNet', 'Consumed and recovered energy retain their original source semantics. No additional net-energy total is inferred.')}
        </Text>
        </CardContent>
      </Card>
    </FadeIn>
  );
}
