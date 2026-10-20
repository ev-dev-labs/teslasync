import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { AlertBanner } from '@/components/feedback';
import { Text } from '@/components/ui';
import { SeasonalSectionBody } from '../seasonal-efficiency/SeasonalSectionBody';
import { SeasonalEmpty } from '../seasonal-efficiency/SeasonalEmpty';
import type { SeasonalSectionProps } from '../seasonal-efficiency/types';
import { fitStatusLabel, formatDecimal, formatInteger, formatLocalDate, supportBandLabel } from '../seasonal-efficiency/formatters';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface SeasonalCoverageBriefProps extends SeasonalSectionProps {
  kind: 'calendar' | 'support' | 'accounting';
}

export function SeasonalCoverageBrief({ kind, analysis, state, locale, timeZone, units }: SeasonalCoverageBriefProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const calendarResolved = resolved && analysis.includedCount > 0;
  const categories = [
    ['included', t('seasonalEfficiency.accounting.included', 'Included')],
    ['incompleteLive', t('seasonalEfficiency.accounting.incompleteLive', 'Incomplete / live')],
    ['invalidTimestampOrder', t('seasonalEfficiency.accounting.invalidTimestampOrder', 'Invalid timestamp / order')],
    ['future', t('seasonalEfficiency.accounting.future', 'Future')],
    ['invalidDuration', t('seasonalEfficiency.accounting.invalidDuration', 'Invalid duration')],
    ['invalidDistance', t('seasonalEfficiency.accounting.invalidDistance', 'Invalid / too-short distance')],
    ['missingEnergy', t('seasonalEfficiency.accounting.missingEnergy', 'Missing energy')],
    ['invalidEnergy', t('seasonalEfficiency.accounting.invalidEnergy', 'Invalid / non-positive energy')],
    ['implausibleIntensity', t('seasonalEfficiency.accounting.implausibleIntensity', 'Implausible intensity')],
  ] as const;
  const factors = [
    ['volume', t('seasonalEfficiency.support.volume', 'Included volume'), analysis.support.volumeScore],
    ['months', t('seasonalEfficiency.support.months', 'Calendar-month coverage'), analysis.support.calendarMonthScore],
    ['weeks', t('seasonalEfficiency.support.weeks', 'Active local weeks'), analysis.support.activeWeekScore],
    ['years', t('seasonalEfficiency.support.years', 'Active local years'), analysis.support.activeYearScore],
    ['ratio', t('seasonalEfficiency.support.ratio', 'Sample / parameter support'), analysis.support.sampleParameterScore],
  ] as const;
  const bands = {
    calendar: {
      id: 'seasonal-calendar-coverage',
      title: t('seasonalEfficiency.calendar.title', 'Vehicle-local calendar coverage'),
      description: t('seasonalEfficiency.calendar.subtitle', 'Month and date fields use the vehicle IANA timezone, including DST boundaries.'),
      metrics: [
        {
          metricId: 'count', occurrenceId: 'calendar-months', rawValue: calendarResolved ? analysis.localMonthCoverage : null,
          label: t('seasonalEfficiency.calendar.months', 'Calendar months'),
          description: t('seasonalEfficiency.calendar.monthHint', 'distinct months of year'),
          display: { countTotal: 12 },
        },
        {
          metricId: 'duration', occurrenceId: 'observed-span', rawValue: calendarResolved ? analysis.spanDays * 86400 : null,
          label: t('seasonalEfficiency.calendar.span', 'Observed span'),
          description: t('seasonalEfficiency.calendar.spanHint', 'first to last included start'),
          display: { formatter: (raw: number) => ({ value: formatInteger(raw / 86400, locale), unit: 'd' }) },
        },
        {
          metricId: 'count', occurrenceId: 'active-local-periods', rawValue: calendarResolved ? analysis.activeLocalDays : null,
          label: t('seasonalEfficiency.calendar.active', 'Active local periods'),
          description: t('seasonalEfficiency.calendar.activeHint', 'days / weeks'),
          display: { formatter: (raw: number) => ({ value: `${raw} / ${analysis.activeLocalWeeks}`, unit: '' }) },
        },
        {
          metricId: 'text', occurrenceId: 'timezone', rawValue: calendarResolved ? timeZone : null,
          label: t('seasonalEfficiency.calendar.zone', 'Timezone'),
          context: calendarResolved ? t('seasonalEfficiency.calendar.rows', '{{count}} included rows', { count: analysis.includedCount }) : undefined,
        },
      ],
    },
    support: {
      id: 'seasonal-evidence-support',
      title: t('seasonalEfficiency.support.title', 'Evidence support and fit eligibility'),
      description: t('seasonalEfficiency.support.subtitle', 'Support describes the amount and breadth of evidence separately from the fitted seasonal magnitude.'),
      metrics: [
        {
          metricId: 'score', occurrenceId: 'evidence-index', rawValue: resolved ? analysis.support.index : null,
          label: t('seasonalEfficiency.support.index', 'Evidence support index'),
          display: { formatter: (raw: number) => ({ value: `${raw} / 100`, unit: '' }) },
          context: resolved ? <>
            {supportBandLabel(analysis.support.band, t)} · {t('seasonalEfficiency.support.ratioValue', '{{ratio}} samples per parameter', {
              ratio: formatDecimal(analysis.fit.sampleToParameterRatio, locale),
            })}
          </> : undefined,
        },
        ...factors.map(([id, label, raw]): StatMetric => ({
          metricId: 'percent', occurrenceId: `support-${id}`, rawValue: resolved ? raw * 100 : null,
          label, display: { formatter: (value) => ({ value: `${Math.round(value)}%`, unit: '' }) },
        })),
      ],
    },
    accounting: {
      id: 'seasonal-accounting',
      title: t('seasonalEfficiency.accounting.title', 'Returned-row accounting and recency'),
      description: t('seasonalEfficiency.accounting.subtitle', 'Categories are mutually exclusive and reconcile exactly across the latest returned history window.'),
      metrics: categories.map(([id, label]): StatMetric => ({
        metricId: 'count', occurrenceId: `accounting-${id}`,
        rawValue: resolved ? analysis.accounting.counts[id] : null, label,
        display: { notation: 'source' },
      })),
    },
  } satisfies Record<string, { id: string; title: string; description: string; metrics: readonly StatMetric[] }>;
  const band = bands[kind];
  return (
    <section data-testid={band.id}>
      <DrivingSummaryBrief
        id={`${band.id}-brief`} title={band.title} description={band.description}
        metrics={band.metrics} loading={state.isLoading} unavailable={!resolved}
        retained={state.refreshError != null}
        scope={timeZone}
        provenance={t('seasonalEfficiency.brief.provenance', 'Returned vehicle history; descriptive local-calendar fit, not a forecast.')}
      />
      <SeasonalSectionBody state={state}>
        {kind === 'calendar' && analysis.includedCount === 0 && <SeasonalEmpty message={t(
          analysis.returnedCount === 0 ? 'seasonalEfficiency.states.empty' : 'seasonalEfficiency.states.noQualified',
          analysis.returnedCount === 0 ? 'No drives were returned for this vehicle.' : 'No returned rows met the completed-drive and Wh/m eligibility rules.',
        )} />}
        {kind === 'support' && <Text as="p" variant="caption" className="mt-4">{t('seasonalEfficiency.support.gate',
          'Fit status: {{status}} — {{reason}}. Eligibility requires at least 24 included samples, about 300 observed days, and 9 local calendar months by default.',
          { status: fitStatusLabel(analysis.fit.status, t), reason: analysis.fit.reason })}</Text>}
        {kind === 'accounting' && <div className="mt-4 space-y-2">
          <Text variant="bodySm" as="p">{t('seasonalEfficiency.accounting.totals', '{{returned}} returned = {{included}} included + {{excluded}} excluded', {
            returned: analysis.accounting.returnedRows, included: analysis.accounting.includedRows, excluded: analysis.accounting.excludedRows,
          })}</Text>
          <Text variant="caption" as="p">{t('seasonalEfficiency.accounting.window', 'History window limit: {{limit}} rows', { limit: analysis.accounting.historyLimit })}</Text>
          <Text variant="caption" as="p">{t('seasonalEfficiency.accounting.first', 'First included local date: {{date}}', {
            date: formatLocalDate(analysis.firstIncludedTimestampMs, locale, timeZone),
          })}</Text>
          <Text variant="caption" as="p">{t('seasonalEfficiency.accounting.last', 'Last included local date: {{date}}', {
            date: formatLocalDate(analysis.lastIncludedTimestampMs, locale, timeZone),
          })}</Text>
          <Text variant="caption" as="p">{t('seasonalEfficiency.accounting.energy', '{{energy}} total energy · {{distance}} total distance', {
            energy: units.formatEnergy(analysis.totalEnergyWh), distance: units.formatDistance(analysis.totalDistanceM),
          })}</Text>
          {analysis.accounting.historyCapReached && <AlertBanner className="mt-4" variant="warning">
            {t('seasonalEfficiency.accounting.capWarning', 'Exactly the latest 1,000-row return window is represented; findings are not established lifetime history.')}
          </AlertBanner>}
        </div>}
      </SeasonalSectionBody>
    </section>
  );
}
