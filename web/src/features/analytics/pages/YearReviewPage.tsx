import { type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import { PageLayout, Section, CardGrid, LayoutCard } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { Skeleton, EmptyState, QueryError, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AIYearReviewNarration } from '@/components/ai';

import {
  YearMonthlyActivity, YearChargingMix,
  YearDriveRecord, YearFunFacts, YearRecap,
} from '../components/year-review-modernization';
import { YearSavingsBrief as YearSavings } from '../components/operationalbrief-n-z/YearSavingsBrief';
import { YearEnvironmentBrief as YearEnvironment } from '../components/operationalbrief-n-z/YearEnvironmentBrief';
import { YearPatternsBrief as YearPatterns } from '../components/operationalbrief-n-z/YearPatternsBrief';

import { useYearReview } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import type { YearReview } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatPeriod } from '@/lib/metric-reference';

/** Calendar-year recap. The shell owns vehicle selection; this year is an
 * independent business date, not a second workspace analysis-range picker. */
export default function YearReviewPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { year: yearParam } = useParams<{ year: string }>();
  const navigate = useNavigate();

  const currentYear = new Date().getFullYear();
  const year = Number(yearParam) || currentYear;
  usePageTitle(t('yearReview.pageTitle', { year, defaultValue: '{{year}} Year in review' }));

  const { unitPrefs } = useUnits();
  const { currencySymbol } = useFormatting();

  const { isLoading: vehiclesLoading } = useVehicles();
  const { vehicleId, vehicles: vehicleList } = useSelectedVehicle();
  const vehicleIdParam = vehicleId == null ? '' : String(vehicleId);

  const query = useYearReview(year, vehicleIdParam || undefined);
  const { data, isLoading, isError, error, refetch } = query;

  const goYear = (y: number) => {
    navigate(`/year-review/${y}${vehicleIdParam ? `?vehicle_id=${vehicleIdParam}` : ''}`);
  };

  const noActivity = !!data && (data.total_drives ?? 0) === 0 && (data.total_charge_sessions ?? 0) === 0;

  // We don't yet know which vehicle to show while the fleet list is still
  // loading, nor in the render frame before the auto-select effect fires.
  // Both are loading states — surfacing the "pick a vehicle" empty prompt
  // here would be misleading, so the gate treats them as a skeleton. The
  // genuine empty prompt is reserved for a resolved-but-empty fleet.
  const resolvingVehicle = vehiclesLoading || (!vehicleIdParam && vehicleList.length > 0);

  // Each card retains its shell. A refresh error must not discard retained
  // source measurements, chart controls, records or the screenshot recap.
  const gate = (skeleton: ReactNode, content: (d: YearReview) => ReactNode): ReactNode => {
    if (isLoading || resolvingVehicle) return skeleton;
    if (data) return content(data);
    if (isError) return <QueryError error={error} onRetry={refetch} />;
    return (
      <EmptyState
        message={t('yearReview.selectVehiclePrompt', 'Select a vehicle to view its year in review')}
        actionTo={{ label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' }}
      />
    );
  };

  const panelSkeleton = <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /></div>;
  const sectionLoading = isLoading || resolvingVehicle;
  const fatalError = !data && isError ? error : undefined;
  const emptyChartMessage = data
    ? t('chart.noData', 'No data available')
    : t('yearReview.selectVehiclePrompt', 'Select a vehicle to view its year in review');
  // The server accepts a calendar year, not start/end instants. Do not invent
  // a timezone or claim an analysis window/coverage absent from this response.
  const period: StatPeriod = { kind: 'event', label: String(year), eventId: `year-review:${year}`,
    start: `${year}-01-01`, end: `${year}-12-31`, provenance: t('yearReview.title', 'Year in review') };
  const preferences = { units: { ...unitPrefs, precision: unitPrefs.precision },
    currency: { kind: 'symbol' as const, value: currencySymbol } };

  const highlightMetrics: StatMetric[] = [
    { metricId: 'distance', rawValue: data?.total_distance_km == null ? null : data.total_distance_km * 1000,
      label: t('yearReview.distance', 'Distance'), display: { precision: unitPrefs.precision ?? 1 } },
    { metricId: 'count', rawValue: data?.total_drives, label: t('yearReview.drives', 'Drives') },
    { metricId: 'energy', rawValue: data?.total_energy_kwh == null ? null : data.total_energy_kwh * 1000,
      label: t('yearReview.energy', 'Energy'), display: { precision: unitPrefs.precision ?? 2 } },
    { metricId: 'count', rawValue: data?.total_charge_sessions, label: t('yearReview.charges', 'Charges') },
    { metricId: 'currency', rawValue: data?.gas_savings, label: t('yearReview.youSaved', 'You saved') },
    { metricId: 'mass', rawValue: data?.co2_offset_kg, label: t('yearReview.co2Offset', 'CO₂ offset'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kg' }) } },
  ];
  const rawSpeedKmh = data?.fastest_speed_kmh;
  const topSpeedMps = typeof rawSpeedKmh === 'number'
    ? (rawSpeedKmh * 1000) / 3600 : null;
  const extremeMetrics: StatMetric[] = [
    { metricId: 'speed', rawValue: topSpeedMps, label: t('yearReview.topSpeed', 'Top speed'),
      display: { precision: unitPrefs.precision ?? 0 } },
    { metricId: 'temperature', rawValue: data?.hottest_drive_temp_c, label: t('yearReview.hottestDrive', 'Hottest drive'),
      display: { precision: unitPrefs.precision ?? 1 } },
    { metricId: 'temperature', rawValue: data?.coldest_drive_temp_c, label: t('yearReview.coldestDrive', 'Coldest drive'),
      display: { precision: unitPrefs.precision ?? 1 } },
  ];
  const highlightOperationalMetrics = useOperationalMetrics(highlightMetrics, preferences);
  const extremeOperationalMetrics = useOperationalMetrics(extremeMetrics, preferences);
  const briefStatus = sectionLoading ? t('yearReview.brief.loading', 'Loading year evidence')
    : isError ? data ? t('yearReview.brief.retained', 'Retained year evidence') : t('yearReview.brief.unavailable', 'Year evidence unavailable')
    : data ? t('yearReview.brief.available', 'Recorded year evidence') : t('yearReview.brief.selection', 'Vehicle selection required');
  const briefMetadata = {
    compact: true,
    eyebrow: t('yearReview.title', 'Year in review'),
    description: t('yearReview.brief.description', 'Calendar-year totals and records from the year-review response. Observation coverage is not reported.'),
    statusLabel: briefStatus,
    statusTone: isError ? 'warning' as const : 'neutral' as const,
    scope: String(year),
    provenance: t('yearReview.title', 'Year in review'),
    loading: sectionLoading,
  };

  const yearControls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={() => goYear(year - 1)} aria-label={t('yearReview.prevYear', 'Previous year')}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Text size="sm" weight="semibold" color="primary" className="min-w-[3.5ch] text-center tabular-nums">{year}</Text>
        <Button variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={() => goYear(year + 1)} disabled={year >= currentYear} aria-label={t('yearReview.nextYear', 'Next year')}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );

  const subtitle = data?.vehicle
    ? t('yearReview.subtitleVehicle', { name: data.vehicle.display_name, model: data.vehicle.model, defaultValue: '{{name}} · {{model}}' })
    : t('yearReview.subtitle', 'Your electric year, summarized');

  return (
    <PageLayout
      title={t('yearReview.pageTitle', { year, defaultValue: '{{year}} Year in review' })}
      subtitle={t('yearReview.subtitle', 'Your electric year, summarized')}
      metadataActions={data?.vehicle ? <Text variant="caption">{subtitle}</Text> : undefined}
      contextActions={yearControls}
      secondaryActions={
        <Button variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={() => navigate(-1)} aria-label={t('yearReview.close', 'Close')}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
      query={query}
      busy={sectionLoading}
    >
      {isError && data && <QueryError error={error} onRetry={refetch} compact />}
      {noActivity && (
        <AlertBanner variant="info">
          {t('yearReview.noActivity', { year, defaultValue: 'No drives or charges were recorded for {{year}} — try another year.' })}
        </AlertBanner>
      )}

      {/* 1 — KPI band */}
      <FadeIn>
        <Section id="year-review-highlights" title={t('yearReview.highlights', 'Year highlights')}>
          <OperationalBrief {...briefMetadata} testId="year-review-highlights-stats"
            title={t('yearReview.brief.highlights', 'Calendar-year highlights')} metrics={highlightOperationalMetrics} />
          {!data && !sectionLoading && gate(panelSkeleton, () => null)}
        </Section>
      </FadeIn>

      {/* 2 — Two chart peers, using the same shared plot-height contract. */}
      <FadeIn delay={0.05}>
        <Section id="year-review-activity" title={t('yearReview.activity', 'Activity')}>
          <CardGrid label={t('yearReview.activity', 'Activity')} items={[
            { id: 'monthly', size: 'half', content: <YearMonthlyActivity data={data} loading={sectionLoading}
              error={fatalError} onRetry={refetch} emptyMessage={emptyChartMessage} /> },
            { id: 'charging', size: 'half', content: <YearChargingMix data={data} loading={sectionLoading}
              error={fatalError} onRetry={refetch} emptyMessage={emptyChartMessage} /> },
          ]} />
          {!data && !sectionLoading && !isError && <Button variant="outline" className="min-h-11" onClick={() => navigate('/vehicles')}>
            {t('yearReview.goToVehicles', 'Go to vehicles')}
          </Button>}
        </Section>
      </FadeIn>

      {/* 3 — Impact bento: savings + environment + patterns */}
      <FadeIn delay={0.1}>
        <Section id="year-review-impact" title={t('yearReview.impact', 'Impact')}>
          <CardGrid label={t('yearReview.impact', 'Impact')} items={[
            { id: 'savings', size: 'third', content: <LayoutCard title={t('yearReview.youSaved', 'You saved')}>
              {gate(panelSkeleton, d => <YearSavings data={d} period={period} retained={Boolean(data && isError)} />)}
            </LayoutCard> },
            { id: 'environment', size: 'third', content: <LayoutCard title={t('yearReview.co2Offset', 'CO₂ offset')}>
              {gate(panelSkeleton, d => <YearEnvironment data={d} period={period} retained={Boolean(data && isError)} />)}
            </LayoutCard> },
            { id: 'patterns', size: 'third', content: <LayoutCard title={t('yearReview.drivingPatterns', 'Your driving patterns')}>
              {gate(panelSkeleton, d => <YearPatterns data={d} period={period} retained={Boolean(data && isError)} />)}
            </LayoutCard> },
          ]} />
        </Section>
      </FadeIn>

      {/* 4 — Drives of the year + extremes */}
      <FadeIn delay={0.15}>
        <Section id="year-review-records" title={t('yearReview.drivesOfYear', 'Drives of the year')}>
          <CardGrid label={t('yearReview.drivesOfYear', 'Drives of the year')} items={[
            { id: 'longest', size: 'quarter', content: <LayoutCard title={t('yearReview.longestDrive', 'Longest drive')}>
              {gate(panelSkeleton, d => <YearDriveRecord drive={d.longest_drive} id="year-review-longest" period={period} />)}
            </LayoutCard> },
            { id: 'most-efficient', size: 'quarter', content: <LayoutCard title={t('yearReview.mostEfficient', 'Most efficient drive')}>
              {gate(panelSkeleton, d => <YearDriveRecord drive={d.most_efficient_drive} id="year-review-most-efficient" period={period} />)}
            </LayoutCard> },
            { id: 'shortest', size: 'quarter', content: <LayoutCard title={t('yearReview.shortestDrive', 'Shortest drive')}>
              {gate(panelSkeleton, d => <YearDriveRecord drive={d.shortest_drive} id="year-review-shortest" period={period} />)}
            </LayoutCard> },
            { id: 'least-efficient', size: 'quarter', content: <LayoutCard title={t('yearReview.leastEfficient', 'Least efficient drive')}>
              {gate(panelSkeleton, d => <YearDriveRecord drive={d.least_efficient_drive} id="year-review-least-efficient" period={period} />)}
            </LayoutCard> },
          ]} />
          <OperationalBrief {...briefMetadata} testId="year-review-extremes"
            title={t('yearReview.brief.extremes', 'Year extremes')} metrics={extremeOperationalMetrics} />
          {!data && !sectionLoading && gate(panelSkeleton, () => null)}
        </Section>
      </FadeIn>

      {/* 5 — Fun facts */}
      <FadeIn delay={0.2}>
        <Section id="year-review-facts" title={t('yearReview.funFacts', 'Fun facts about your year')}>
          {data && !sectionLoading
            ? <YearFunFacts comparisons={data.comparisons} />
            : <LayoutCard title={t('yearReview.funFacts', 'Fun facts about your year')}>
              {gate(panelSkeleton, d => <YearFunFacts comparisons={d.comparisons} />)}
            </LayoutCard>}
        </Section>
      </FadeIn>

      {/* 6 — Shareable recap + AI narration */}
      <FadeIn delay={0.25}>
        <Section id="year-review-recap-section" title={t('yearReview.recap', 'Recap')}>
          <CardGrid label={t('yearReview.recap', 'Recap')} items={[
            { id: 'recap', size: 'full', content: <LayoutCard title={t('yearReview.title', 'Year in review')}>
              {gate(panelSkeleton, d => <YearRecap data={d} period={period} />)}
            </LayoutCard> },
          ]} />
          {/* Read-only AI surface owns its shell/availability/stream controls.
              Preserve its independent previous-calendar-year body policy. */}
          <AIYearReviewNarration vehicleId={vehicleIdParam ? Number(vehicleIdParam) : undefined} />
        </Section>
      </FadeIn>
    </PageLayout>
  );
}
