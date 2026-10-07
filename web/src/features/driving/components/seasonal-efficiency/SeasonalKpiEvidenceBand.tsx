import { CalendarDays, Database, Gauge, Layers3, Sigma, Waves } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { QueryError } from '@/components/feedback';
import { MetricCard } from '@/components/data-display';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { SeasonalSectionProps } from './types';
import { fitStatusLabel, formatDecimal, formatInteger, formatIntensityWhPerM, formatSignedIntensityWhPerMPerYear, supportBandLabel } from './formatters';

export function SeasonalKpiEvidenceBand({
  analysis,
  state,
  locale,
  units,
  timeZone,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const visibleError = state.error ?? state.refreshError;
  const value = (rendered: string) => (resolved ? rendered : '—');
  return (
    <section data-testid="seasonal-kpis" aria-label={t(
      'seasonalEfficiency.kpis.aria',
      'Seasonal efficiency evidence summary',
    )}>
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('seasonalEfficiency.kpis.title', 'Observed seasonal evidence')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'seasonalEfficiency.kpis.subtitle',
            'Canonical intensity is Wh/m; display conversion follows the selected distance and energy preferences.',
          )}
        </Text>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label={t('seasonalEfficiency.kpis.included', 'Included drives')}
            value={value(formatInteger(analysis.includedCount, locale))}
            subtitle={t('seasonalEfficiency.kpis.returned', '{{count}} returned · {{excluded}} excluded', {
              count: analysis.returnedCount,
              excluded: analysis.excludedCount,
            })}
            icon={<Database className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('seasonalEfficiency.kpis.actual', 'Observed intensity')}
            value={value(formatIntensityWhPerM(analysis.actualEnergyIntensityWhPerM, units.unitPrefs))}
            subtitle={t('seasonalEfficiency.kpis.distance', '{{distance}} observed distance', {
              distance: units.formatDistance(analysis.totalDistanceM, { precision: 0 }),
            })}
            icon={<Gauge className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('seasonalEfficiency.kpis.fit', 'Fit status')}
            value={resolved ? fitStatusLabel(analysis.fit.status, t) : '—'}
            subtitle={t('seasonalEfficiency.kpis.support', '{{ratio}} samples / 6 parameters', {
              ratio: formatDecimal(analysis.fit.sampleToParameterRatio, locale, 1),
            })}
            icon={<Sigma className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('seasonalEfficiency.kpis.trend', 'Descriptive trend')}
            value={value(formatSignedIntensityWhPerMPerYear(analysis.trendWhPerMPerYear, units.unitPrefs))}
            subtitle={t('seasonalEfficiency.kpis.trendHint', 'deseasonalized Wh/m per year')}
            icon={<Waves className="h-5 w-5" />}
            color={analysis.trendWhPerMPerYear != null && analysis.trendWhPerMPerYear > 0 ? 'amber' : 'blue'}
          />
          <MetricCard
            label={t('seasonalEfficiency.kpis.rSquared', 'In-sample R²')}
            value={value(formatDecimal(analysis.rSquaredInSample, locale, 2))}
            subtitle={t('seasonalEfficiency.kpis.rSquaredHint', 'descriptive fit, not a forward claim')}
            icon={<Layers3 className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('seasonalEfficiency.kpis.coverage', 'Local coverage')}
            value={value(`${formatInteger(analysis.localMonthCoverage, locale)} / 12`)}
            subtitle={t('seasonalEfficiency.kpis.coverageHint', '{{days}} days · {{weeks}} weeks · {{years}} years', {
              days: analysis.activeLocalDays,
              weeks: analysis.activeLocalWeeks,
              years: analysis.distinctYears,
            })}
            icon={<CalendarDays className="h-5 w-5" />}
            color="blue"
          />
        </div>
        <div className="mt-4 grid gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-2 xl:grid-cols-4">
          <span>{t('seasonalEfficiency.kpis.timeZone', 'Vehicle timezone: {{timeZone}}', { timeZone })}</span>
          <span>{t('seasonalEfficiency.kpis.evidenceBand', 'Evidence band: {{band}} ({{index}}/100)', {
            band: supportBandLabel(analysis.support.band, t),
            index: analysis.support.index,
          })}</span>
          <span>{t('seasonalEfficiency.kpis.recency', 'Latest included: {{days}} days ago', {
            days: analysis.daysSinceLatestIncluded == null ? '—' : formatDecimal(analysis.daysSinceLatestIncluded, locale, 1),
          })}</span>
          <span>{t(
            analysis.accounting.historyCapReached
              ? 'seasonalEfficiency.kpis.capReached'
              : 'seasonalEfficiency.kpis.capNotReached',
            analysis.accounting.historyCapReached
              ? 'Latest returned 1,000-row window reached'
              : 'Returned window below the 1,000-row cap',
          )}</span>
        </div>
        {visibleError ? (
          <div className="mt-4">
            <QueryError error={visibleError} onRetry={state.onRetry} />
          </div>
        ) : null}
      </GlassPanel>
    </section>
  );
}
