import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DriveDnaKpiBand } from '../drive-dna/DriveDnaKpiBand';
import { DriveDnaKpiNotices } from '../drive-dna/DriveDnaKpiNotices';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof DriveDnaKpiBand>;

export function DriveDnaEvidenceBrief({ drive, model, state, units, capReached }: Props) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const metadataReady = state.list.isResolved && !state.list.error;
  const telemetryReady = state.hasDrive && state.telemetry.isResolved && !state.telemetry.error;
  const metrics: readonly StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'distance', rawValue: metadataReady ? drive?.distanceM : null,
      label: t('driveDna.kpis.distance', 'Drive distance'),
      description: t('driveDna.kpis.distanceHint', 'Aggregate drive metadata'),
      display: { formatter: (raw) => ({ value: units.formatDistance(raw), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'duration', rawValue: metadataReady ? drive?.durationS : null,
      label: t('driveDna.kpis.duration', 'Drive duration'),
      description: t('driveDna.kpis.durationHint', 'Aggregate drive metadata'),
      display: { formatter: (raw) => ({ value: units.formatDuration(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'rows', rawValue: telemetryReady ? model.sample.returnedRows : null,
      label: t('driveDna.kpis.rows', 'Telemetry rows returned'),
      description: t('driveDna.kpis.rowsHint', 'Selected drive only') },
    { metricId: 'speed', occurrenceId: 'top-speed', rawValue: telemetryReady ? model.stats.topSpeedMps : null,
      label: t('driveDna.kpis.topSpeed', 'Sampled top speed'),
      description: t('driveDna.kpis.topSpeedHint', 'Maximum available speed value'),
      display: { formatter: (raw) => ({ value: units.formatSpeed(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'regen-share',
      rawValue: telemetryReady && model.stats.regenEmissionShare != null ? model.stats.regenEmissionShare * 100 : null,
      label: t('driveDna.kpis.regenShare', 'Regen-observed emissions'),
      description: t('driveDna.kpis.regenShareHint', 'Power-available rows after forward fold, not time share') },
    { metricId: 'number', occurrenceId: 'soc-change', rawValue: telemetryReady ? model.stats.socDeltaPct : null,
      label: t('driveDna.kpis.socChange', 'Sampled SoC change'),
      description: t('driveDna.kpis.socChangeHint', 'Last available minus first available'),
      display: { formatter: (raw) => ({
        value: `${raw > 0 ? '+' : ''}${fmtNumber(raw)}`, unit: 'pp',
      }) } },
  ];
  return <section aria-label={t('driveDna.kpis.aria', 'Selected-drive summary evidence')} data-testid="drive-dna-kpis">
    <DrivingSummaryBrief metrics={metrics} title={t('driveDna.kpis.title', 'Selected-drive evidence')}
      description={t('driveDna.brief.description', 'Aggregate drive totals and sampled telemetry are independent sources; regen emissions are sample share, not time share.')}
      scope={drive ? t('driveDna.brief.window', 'Drive {{id}} · {{start}}–{{end}}; sampled coverage may be incomplete', {
        id: drive.id, start: drive.startTs, end: drive.endTs ?? t('driveDna.brief.open', 'ongoing'),
      }) : t('driveDna.brief.noDrive', 'No selected drive')}
      provenance={t('driveDna.brief.source', 'Selected drive metadata and returned telemetry emissions after the existing forward fold.')}
      loading={state.list.isLoading && !drive}
      retained={state.list.refreshError != null || state.telemetry.refreshError != null}
      statusLabel={!state.vehicleSelected ? t('driving.brief.selectVehicle', 'Select a vehicle')
        : state.list.error || state.telemetry.error ? t('driving.brief.partial', 'Partial evidence')
          : state.telemetry.isLoading ? t('driveDna.brief.telemetryLoading', 'Telemetry loading')
            : undefined}
      onRetry={state.telemetry.onRetry} />
    <DriveDnaKpiNotices model={model} state={state} capReached={capReached} />
  </section>;
}
