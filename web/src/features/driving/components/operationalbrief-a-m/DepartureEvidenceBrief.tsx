import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DepartureForecastKpiBand } from '../departure-forecast/DepartureForecastKpiBand';
import { DepartureForecastQueryStatus } from '../departure-forecast/DepartureForecastQueryStatus';
import { departureClock, departureDateTime, departureEvidenceBandLabel, relativeDepartureLabel } from '../departure-forecast/labels';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof DepartureForecastKpiBand>;

export function DepartureEvidenceBrief({ forecast, state, locale, timeZone }: Props) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const ready = state.isResolved && !state.error;
  const hasEvidence = ready && forecast.totalDepartures > 0;
  const next = hasEvidence ? forecast.nextLikely : null;
  const peak = hasEvidence ? forecast.peak : null;
  const marker = hasEvidence && forecast.evidenceStrength.band !== 'thin' ? forecast.planningMarkerAtMs : null;
  const horizon = hasEvidence ? forecast.horizonLikelihood : null;
  const evidence = hasEvidence ? forecast.evidenceStrength : null;
  const pending = !state.vehicleSelected
    ? t('departure.states.selectVehicleKpi', 'Select a vehicle above to load departure evidence.')
    : state.isLoading ? t('departure.states.loadingKpi', 'Waiting for returned drive history…')
      : state.error ? t('departure.states.errorKpi', 'Departure history is unavailable; use the status below to retry.')
        : !state.isResolved ? t('departure.states.pendingKpi', 'Departure-history availability has not resolved.') : null;
  const percentDisplay = { formatter: (raw: number) => ({ value: fmtNumber(raw, undefined, locale), unit: '%' }) };
  const metrics: readonly StatMetric[] = [
    { metricId: 'text', occurrenceId: 'next-window', rawValue: next ? departureClock(next.startMs, locale, timeZone) : null,
      label: t('departure.kpis.nextWindow', 'Next supported departure window'),
      description: next
        ? t('departure.kpis.nextWindowHint', '{{date}} · {{relative}}', {
            date: departureDateTime(next.startMs, locale, timeZone), relative: relativeDepartureLabel(t, next.minutesFromNow),
          }) : pending ?? t('departure.kpis.nextWindowUnavailable', 'No supported slot crosses the model threshold') },
    { metricId: 'percent', occurrenceId: 'peak', rawValue: peak ? peak.p * 100 : null,
      label: t('departure.kpis.peakLikelihood', 'Peak modeled likelihood'),
      description: peak ? departureDateTime(peak.startMs, locale, timeZone)
        : pending ?? t('departure.kpis.peakUnavailable', 'No supported peak in the next 24 hours'),
      display: percentDisplay },
    { metricId: 'percent', occurrenceId: 'horizon', rawValue: horizon != null ? horizon * 100 : null,
      label: t('departure.kpis.horizonLikelihood', '24h modeled likelihood'),
      description: pending ?? (horizon != null
        ? t('departure.kpis.horizonHint', 'Poisson-derived estimate; not a calibrated probability')
        : t('departure.kpis.horizonUnavailable', 'Unavailable without qualifying departure evidence')),
      display: percentDisplay },
    { metricId: 'text', occurrenceId: 'marker', rawValue: marker != null ? departureClock(marker, locale, timeZone) : null,
      label: t('departure.kpis.planningMarker', 'Illustrative planning marker'),
      description: pending ?? (marker != null
        ? t('departure.kpis.planningMarkerHint', '20 minutes before the peak boundary; never triggers the vehicle')
        : t('departure.kpis.planningMarkerUnavailable', 'Needs a supported future peak and developing evidence')) },
    { metricId: 'count', occurrenceId: 'included', rawValue: ready ? forecast.accounting.includedRows : null,
      label: t('departure.kpis.includedDepartures', 'Included departures'),
      description: pending ?? t('departure.kpis.includedHint', 'Every recorded drive start is one event') },
    { metricId: 'percent', occurrenceId: 'strength', rawValue: evidence ? evidence.value * 100 : null,
      label: t('departure.kpis.evidenceStrength', 'Evidence strength'),
      description: evidence ? t('departure.kpis.evidenceHint', '{{band}} · {{capState}}', {
        band: departureEvidenceBandLabel(t, evidence.band),
        capState: forecast.accounting.historyCapReached
          ? t('departure.kpis.capReached', 'history may be capped')
          : t('departure.kpis.capNotReached', 'below the 1,000-row cap'),
      }) : pending ?? t('departure.kpis.evidenceUnavailable', 'Support index needs qualifying departures'),
      display: percentDisplay },
  ];
  return <section aria-label={t('departure.kpis.aria', 'Departure forecast evidence summary')} data-testid="departure-kpis">
    <DrivingSummaryBrief metrics={metrics} title={t('departure.kpis.title', 'Forecast evidence')}
      description={t('departure.brief.description', 'Next-24-hour modeled likelihood uses capped observed departure history; the support index is not a calibrated probability or confidence score.')}
      scope={t('departure.brief.window', 'Next 24 hours · {{timezone}}; history coverage is limited to returned rows', { timezone: timeZone })}
      provenance={t('departure.brief.source', 'Returned drive starts; Poisson-derived likelihood and illustrative planning marker, with no vehicle command.')}
      loading={state.isLoading} error={state.error} showError={false} retained={state.refreshError != null} onRetry={state.onRetry}
      statusLabel={!state.vehicleSelected ? t('driving.brief.selectVehicle', 'Select a vehicle')
        : !state.isResolved && !state.isLoading && !state.error ? t('driving.brief.awaiting', 'Awaiting evidence') : undefined} />
    <DepartureForecastQueryStatus forecast={forecast} state={state} />
  </section>;
}
