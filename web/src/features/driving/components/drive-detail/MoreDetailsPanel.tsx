import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, Table, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';

import type { DriveDetail } from '@/types/driving';
import type { ChartDataPoint, DriveStats } from './types';
import { driveEnergyEvidence } from './energyEvidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * Evidence, not another dashboard: source and estimation remain attached to
 * the reading. In particular energyUsedWh may already be signed/net; subtracting
 * recovered energy again would fabricate "net consumption".
 */
export function MoreDetailsPanel({ drive, stats, chartData }: { drive: DriveDetail; stats: DriveStats; chartData?: ChartDataPoint[] }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { energyWh: used, regenWh: recovered } = driveEnergyEvidence(drive, stats);
  const reported = t('driveDetail.report.persisted', 'Persisted drive aggregate');
  const sampled = t('driveDetail.report.sampled', 'Recorded telemetry samples');
  const missing = t('common.unknown', 'Unknown');
  const rangePair = stats.startRange != null
    ? `${fmtNumber(stats.startRange)} → ${stats.endRange != null ? fmtNumber(stats.endRange) : '—'} ${unitPrefs.distance}` : '—';
  // Do not subtract ideal-at-departure from rated-at-arrival. The original
  // merged fallback stats remain supported for leaf callers, while the report
  // supplies samples and keeps each estimator's endpoints independent.
  const ranges = [
    { key: 'idealRange', label: t('driveDetail.rangeIdeal', 'Range (ideal)') },
    { key: 'ratedRange', label: t('driveDetail.report.ratedRange', 'Range (rated)') },
    { key: 'estRange', label: t('driveDetail.rangeEst', 'Range (est.)') },
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
      source: drive.energyUsedWh != null ? reported
        : used != null ? t('driveDetail.report.energyEstimate', 'Estimate: absolute average power × duration; not metered energy') : missing,
    },
    {
      id: 'regen', label: t('driveDetail.energyRecovered', 'Energy recovered'),
      value: recovered != null ? formatEnergy(recovered) : '—',
      source: drive.regenEnergyWh != null ? reported
        : recovered != null ? t('driveDetail.report.regenEstimate', 'Estimate: negative-power sample mean × duration; assumes uniform sampling') : missing,
    },
    {
      id: 'odometer', label: t('driveDetail.odometer', 'Odometer (from → to)'),
      value: stats.odometerStart > 0 || stats.odometerEnd > 0
        ? `${stats.odometerStart > 0 ? fmtNumber(stats.odometerStart) : '—'} → ${stats.odometerEnd > 0 ? fmtNumber(stats.odometerEnd) : '—'} ${unitPrefs.distance}` : '—',
      source: sampled,
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
      <GlassPanel className="h-full space-y-3 p-4 sm:p-5" data-testid="drive-energy-evidence">
        <PanelTitle>{t('driveDetail.report.energyEvidence', 'Energy and range evidence')}</PanelTitle>
        <Table aria-label={t('driveDetail.report.energyEvidence', 'Energy and range evidence')}>
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
        <Text as="p" variant="caption">
          {t('driveDetail.report.noNet', 'Consumed and recovered energy retain their original source semantics. No additional net-energy total is inferred.')}
        </Text>
      </GlassPanel>
    </FadeIn>
  );
}
