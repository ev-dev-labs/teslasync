import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { QueryError } from '@/components/feedback';
import type { SeasonalSectionProps } from '../seasonal-efficiency/types';
import {
  fitStatusLabel, formatDecimal, formatIntensityWhPerM,
  formatSignedIntensityWhPerMPerYear, supportBandLabel,
} from '../seasonal-efficiency/formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

export function SeasonalSummaryBrief({ analysis, state, locale, units, timeZone }: SeasonalSectionProps) {
  useNumberFormatting();
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const visibleError = state.error ?? state.refreshError;
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'seasonal.includedDrives', occurrenceId: 'seasonal-included',
      rawValue: resolved ? analysis.includedCount : null,
      label: t('seasonalEfficiency.kpis.included', 'Included drives'),
      context: resolved ? t('seasonalEfficiency.kpis.returned', '{{count}} returned · {{excluded}} excluded', {
        count: analysis.returnedCount, excluded: analysis.excludedCount,
      }) : undefined,
    },
    {
      metricId: 'seasonal.observedIntensity', occurrenceId: 'seasonal-intensity',
      rawValue: resolved ? analysis.actualEnergyIntensityWhPerM : null,
      label: t('seasonalEfficiency.kpis.actual', 'Observed intensity'),
      display: { formatter: (raw) => ({ value: formatIntensityWhPerM(raw, units.unitPrefs), unit: '' }) },
      context: resolved ? t('seasonalEfficiency.kpis.distance', '{{distance}} observed distance', {
        distance: units.formatDistance(analysis.totalDistanceM),
      }) : undefined,
    },
    {
      metricId: 'seasonal.fitStatus', occurrenceId: 'seasonal-fit',
      rawValue: resolved ? fitStatusLabel(analysis.fit.status, t) : null,
      label: t('seasonalEfficiency.kpis.fit', 'Fit status'),
      context: resolved ? t('seasonalEfficiency.kpis.support', '{{ratio}} samples / 6 parameters', {
        ratio: formatDecimal(analysis.fit.sampleToParameterRatio, locale),
      }) : undefined,
    },
    {
      metricId: 'rate', occurrenceId: 'seasonal-trend',
      rawValue: resolved ? analysis.trendWhPerMPerYear : null,
      label: t('seasonalEfficiency.kpis.trend', 'Descriptive trend'),
      description: t('seasonalEfficiency.kpis.trendHint', 'deseasonalized Wh/m per year'),
      display: { formatter: (raw) => ({ value: formatSignedIntensityWhPerMPerYear(raw, units.unitPrefs), unit: '' }) },
    },
    {
      metricId: 'seasonal.inSampleRSquared', occurrenceId: 'seasonal-r-squared',
      rawValue: resolved ? analysis.rSquaredInSample : null,
      label: t('seasonalEfficiency.kpis.rSquared', 'In-sample R²'),
      description: t('seasonalEfficiency.kpis.rSquaredHint', 'descriptive fit, not a forward claim'),
      display: { formatter: (raw) => ({ value: formatDecimal(raw, locale), unit: '' }) },
    },
    {
      metricId: 'count', occurrenceId: 'seasonal-local-months',
      rawValue: resolved ? analysis.localMonthCoverage : null,
      display: { countTotal: 12 },
      label: t('seasonalEfficiency.kpis.coverage', 'Local coverage'),
      context: resolved ? t('seasonalEfficiency.kpis.coverageHint', '{{days}} days · {{weeks}} weeks · {{years}} years', {
        days: analysis.activeLocalDays, weeks: analysis.activeLocalWeeks, years: analysis.distinctYears,
      }) : undefined,
    },
  ];
  return (
    <section data-testid="seasonal-kpis" aria-label={t('seasonalEfficiency.kpis.aria', 'Seasonal efficiency evidence summary')}>
      <DrivingSummaryBrief
        id="seasonal-evidence-brief"
        title={t('seasonalEfficiency.kpis.title', 'Observed seasonal evidence')}
        description={t('seasonalEfficiency.kpis.subtitle', 'Canonical intensity is Wh/m; display conversion follows the selected distance and energy preferences.')}
        metrics={metrics}
        loading={state.isLoading}
        unavailable={!resolved}
        retained={state.refreshError != null}
        scope={<>
          {t('seasonalEfficiency.kpis.timeZone', 'Vehicle timezone: {{timeZone}}', { timeZone })} · {resolved ? t(
            analysis.accounting.historyCapReached ? 'seasonalEfficiency.kpis.capReached' : 'seasonalEfficiency.kpis.capNotReached',
            analysis.accounting.historyCapReached ? 'Latest returned 1,000-row window reached' : 'Returned window below the 1,000-row cap',
          ) : t('seasonalEfficiency.brief.coveragePending', 'Returned-history coverage has not resolved.')}
        </>}
        freshness={resolved ? <>
          {t('seasonalEfficiency.kpis.evidenceBand', 'Evidence band: {{band}} ({{index}}/100)', {
            band: supportBandLabel(analysis.support.band, t), index: analysis.support.index,
          })} · {t('seasonalEfficiency.kpis.recency', 'Latest included: {{days}} days ago', {
            days: analysis.daysSinceLatestIncluded == null ? '—' : formatDecimal(analysis.daysSinceLatestIncluded, locale),
          })}
        </> : undefined}
        provenance={t('seasonalEfficiency.brief.provenance', 'Returned vehicle history; descriptive local-calendar fit, not a forecast.')}
        actions={visibleError ? <QueryError error={visibleError} onRetry={state.onRetry} /> : undefined}
      />
    </section>
  );
}
