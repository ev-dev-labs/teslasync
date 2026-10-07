import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { MetricPreferences } from '@/lib/metric-reference';
import type { SharedSessionData } from '@/types/sharing';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import { PublicReportBrief } from './PublicReportBrief';

interface Props {
  readonly session: SharedSessionData['session'];
  readonly preferences: MetricPreferences;
  readonly formatEnergy: (value: number) => string;
  readonly formatPower: (value: number) => string;
  readonly fmtNumber: (value: unknown) => string;
}

export function PublicSessionBrief({ session, preferences, formatEnergy, formatPower, fmtNumber }: Props) {
  const { t } = useTranslation();
  const source = t('share.publicBrief.sessionSource', 'Owner-shared charging session payload');
  const socDelta = session.start_soc_pct != null && session.end_soc_pct != null
    ? Math.round((session.end_soc_pct - session.start_soc_pct) * 10) / 10 : null;
  const endSoc = session.end_soc_pct;
  const metrics: StatMetric[] = [];
  if (session.energy_added_wh != null) metrics.push({
    metricId: 'energy', occurrenceId: 'public-session-energy', rawValue: session.energy_added_wh,
    label: t('share.energyAdded', 'Energy added'),
    description: t('share.publicBrief.energyDetail', 'Recorded energy added; source energy_added_wh in Wh.'),
    display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) },
  });
  metrics.push({
    metricId: 'duration', occurrenceId: 'public-session-duration', rawValue: session.duration_s,
    label: t('share.duration', 'Duration'),
    description: t('share.publicBrief.durationDetail', 'Recorded elapsed seconds, displayed with the existing rounded-minute formatter.'),
    display: { formatter: raw => ({ value: formatDurationSecondsAsMinutes(raw), unit: '' }) },
  });
  if (session.start_soc_pct != null && endSoc != null) metrics.push({
    metricId: 'percent', occurrenceId: 'public-session-battery', rawValue: session.start_soc_pct,
    label: t('share.battery', 'Battery'),
    description: t('share.publicBrief.sessionBatteryDetail', 'Start and end state of charge are separately recorded percentages; each endpoint retains its existing whole-percent display rounding.'),
    display: { formatter: raw => ({
      value: `${Math.round(raw)}% → ${Math.round(endSoc)}%`, unit: '',
    }) },
  });
  if (session.peak_power_w != null) metrics.push({
    metricId: 'power', occurrenceId: 'public-session-peak-power', rawValue: session.peak_power_w,
    label: t('share.peakPower', 'Peak power'),
    description: t('share.publicBrief.peakPowerDetail', 'Recorded peak charging power; source peak_power_w in W, not average power.'),
    display: { formatter: raw => ({ value: formatPower(raw), unit: '' }) },
  });
  if (socDelta != null && socDelta > 0 && session.energy_added_wh != null) metrics.push({
    metricId: 'rate', occurrenceId: 'public-session-efficiency',
    rawValue: session.energy_added_wh / 1000 / (socDelta / 100),
    label: t('share.efficiency', 'Efficiency'),
    description: t('share.publicBrief.sessionEfficiencyDetail', 'Existing report calculation: (energy_added_wh / 1000) / (rounded SoC change / 100). SoC change is rounded to one decimal; the existing kWh/% label is retained.'),
    display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kWh/%' }) },
  });
  if (session.cost != null) metrics.push({
    metricId: 'currency', occurrenceId: 'public-session-cost', rawValue: session.cost,
    label: t('share.cost', 'Cost'),
    description: t('share.publicBrief.costDetail', 'Recorded cost uses the source cost_currency exactly as shared; no workspace currency or currency conversion is applied.'),
    display: { formatter: raw => ({
      value: `${session.cost_currency ?? ''} ${fmtNumber(raw)}`.trim(), unit: '',
    }) },
  });
  return (
    <PublicReportBrief
      title={t('share.publicBrief.sessionTitle', 'Shared charging measurements')}
      description={t('share.publicBrief.sessionDescription', 'Energy, elapsed time, battery endpoints, peak power, the existing efficiency calculation and recorded cost retain their public report display contracts.')}
      eventDate={session.date}
      source={source}
      metrics={metrics}
      preferences={preferences}
      testId="public-session-brief"
      evidence={[
        { field: 'energy_added_wh', value: session.energy_added_wh, unit: 'Wh' },
        { field: 'duration_s', value: session.duration_s, unit: 's' },
        { field: 'start_soc_pct', value: session.start_soc_pct, unit: '%' },
        { field: 'end_soc_pct', value: session.end_soc_pct, unit: '%' },
        { field: 'peak_power_w', value: session.peak_power_w, unit: 'W' },
        { field: t('share.publicBrief.roundedSocDelta', 'Rounded SoC change (derived)'), value: socDelta, unit: '%' },
        { field: 'cost', value: session.cost, unit: session.cost_currency ?? '' },
      ]}
    />
  );
}
