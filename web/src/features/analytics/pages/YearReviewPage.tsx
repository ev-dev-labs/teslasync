import { useEffect, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car, Route as RouteIcon, Zap, BatteryCharging, DollarSign, Leaf,
  ChevronLeft, ChevronRight, X, Mountain, Sprout, Timer, TrendingDown,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Select, SectionTitle, Text } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, StatGridSkeleton, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AIYearReviewNarration } from '@/components/ai/AIYearReviewNarration';

import {
  YearMonthlyChart, YearChargingBreakdown, YearSavingsPanel, YearEnvironmentPanel,
  YearPatternsPanel, YearDriveHighlight, YearExtremes, YearComparisons, YearSummaryCard,
} from '../components/review';

import { useYearReview } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';

/** Full-width "year in review" dashboard — a bento recap of the driving year. */
export default function YearReviewPage() {
  const { t } = useTranslation();
  const { year: yearParam } = useParams<{ year: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const currentYear = new Date().getFullYear();
  const year = Number(yearParam) || currentYear;
  usePageTitle(t('yearReview.pageTitle', { year, defaultValue: '{{year}} Year in Review' }));

  const { formatDistance, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();

  const vehicleIdParam = searchParams.get('vehicle_id') ?? '';
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const vehicleList = vehicles ?? [];
  const vehicleOptions = useMemo(
    () => vehicleList.map((v) => ({ value: String(v.id), label: v.display_name || v.vin })),
    [vehicleList],
  );

  // Default the URL to the first vehicle so deep links, the freshness chip, and
  // the AI narration all resolve without a manual pick. URL sync only — not a
  // data-loading effect.
  useEffect(() => {
    if (!vehicleIdParam && vehicleList.length > 0) {
      setSearchParams({ vehicle_id: String(vehicleList[0].id) }, { replace: true });
    }
  }, [vehicleIdParam, vehicleList, setSearchParams]);

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

  // Per-section state gate: skeleton while loading, QueryError on failure,
  // EmptyState when no vehicle/data, else the resolved content.
  const gate = (skeleton: ReactNode, content: (d: YearReview) => ReactNode): ReactNode => {
    if (isLoading || resolvingVehicle) return skeleton;
    if (isError) return <QueryError error={error as Error} onRetry={refetch} />;
    if (data) return content(data);
    return (
      <GlassPanel className="p-4 sm:p-5">
        <EmptyState message={t('yearReview.selectVehiclePrompt', 'Select a vehicle to view its year in review')} />
      </GlassPanel>
    );
  };

  const panelSkeleton = (h: number) => (
    <GlassPanel className="p-4 sm:p-5"><Skeleton height={h} /></GlassPanel>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {vehicleList.length > 1 && (
        <Select
          options={vehicleOptions}
          value={vehicleIdParam}
          onChange={(e) => setSearchParams({ vehicle_id: e.target.value }, { replace: true })}
          aria-label={t('yearReview.selectVehicle', 'Select vehicle')}
          size="sm"
        />
      )}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => goYear(year - 1)} aria-label={t('yearReview.prevYear', 'Previous year')}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Text size="sm" weight="semibold" color="primary" className="min-w-[3.5ch] text-center tabular-nums">{year}</Text>
        <Button variant="ghost" size="sm" onClick={() => goYear(year + 1)} disabled={year >= currentYear} aria-label={t('yearReview.nextYear', 'Next year')}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label={t('yearReview.close', 'Close')}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  const subtitle = data?.vehicle
    ? t('yearReview.subtitleVehicle', { name: data.vehicle.display_name, model: data.vehicle.model, defaultValue: '{{name}} · {{model}}' })
    : t('yearReview.subtitle', 'Your electric year, summarized');

  return (
    <PageContainer
      title={t('yearReview.pageTitle', { year, defaultValue: '{{year}} Year in Review' })}
      subtitle={subtitle}
      actions={actions}
      query={query}
    >
      {noActivity && (
        <AlertBanner variant="info">
          {t('yearReview.noActivity', { year, defaultValue: 'No drives or charges were recorded for {{year}} — try another year.' })}
        </AlertBanner>
      )}

      {/* 1 — KPI band */}
      <FadeIn>
        <section aria-label={t('yearReview.highlights', 'Year highlights')} className="space-y-4">
          <SectionTitle>{t('yearReview.highlights', 'Year highlights')}</SectionTitle>
          {gate(
            <StatGridSkeleton cards={6} />,
            (d) => (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
                <MetricCard label={t('yearReview.distance', 'Distance')} value={formatDistance((d.total_distance_km ?? 0) * 1000)} icon={<RouteIcon className="h-4 w-4" aria-hidden="true" />} color="cyan" />
                <MetricCard label={t('yearReview.drives', 'Drives')} value={fmtInt(d.total_drives ?? 0)} icon={<Car className="h-4 w-4" aria-hidden="true" />} color="green" />
                <MetricCard label={t('yearReview.energy', 'Energy')} value={formatEnergy((d.total_energy_kwh ?? 0) * 1000)} icon={<Zap className="h-4 w-4" aria-hidden="true" />} color="amber" />
                <MetricCard label={t('yearReview.charges', 'Charges')} value={fmtInt(d.total_charge_sessions ?? 0)} icon={<BatteryCharging className="h-4 w-4" aria-hidden="true" />} color="blue" />
                <MetricCard label={t('yearReview.youSaved', 'You saved')} value={formatCurrency(d.gas_savings ?? 0, 0)} icon={<DollarSign className="h-4 w-4" aria-hidden="true" />} color="green" />
                <MetricCard label={t('yearReview.co2Offset', 'CO₂ offset')} value={`${fmtNumber(d.co2_offset_kg ?? 0)} kg`} icon={<Leaf className="h-4 w-4" aria-hidden="true" />} color="purple" />
              </div>
            ),
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero: monthly activity (wide) + charging mix */}
      <FadeIn delay={0.05}>
        <section aria-label={t('yearReview.activity', 'Activity')} className="space-y-4">
          <SectionTitle>{t('yearReview.activity', 'Activity')}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              {gate(panelSkeleton(340), (d) => <YearMonthlyChart data={d} />)}
            </div>
            <div>
              {gate(panelSkeleton(340), (d) => <YearChargingBreakdown data={d} />)}
            </div>
          </div>
        </section>
      </FadeIn>

      {/* 3 — Impact bento: savings + environment + patterns */}
      <FadeIn delay={0.1}>
        <section aria-label={t('yearReview.impact', 'Impact')} className="space-y-4">
          <SectionTitle>{t('yearReview.impact', 'Impact')}</SectionTitle>
          {gate(
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {panelSkeleton(240)}{panelSkeleton(240)}{panelSkeleton(240)}
            </div>,
            (d) => (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <YearSavingsPanel data={d} />
                <YearEnvironmentPanel data={d} />
                <YearPatternsPanel data={d} />
              </div>
            ),
          )}
        </section>
      </FadeIn>

      {/* 4 — Drives of the year + extremes */}
      <FadeIn delay={0.15}>
        <section aria-label={t('yearReview.drivesOfYear', 'Drives of the year')} className="space-y-4">
          <SectionTitle>{t('yearReview.drivesOfYear', 'Drives of the year')}</SectionTitle>
          {gate(
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {panelSkeleton(200)}{panelSkeleton(200)}{panelSkeleton(200)}{panelSkeleton(200)}
            </div>,
            (d) => (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
                  <YearDriveHighlight drive={d.longest_drive} label={t('yearReview.longestDrive', 'Longest drive')} icon={Mountain} />
                  <YearDriveHighlight drive={d.most_efficient_drive} label={t('yearReview.mostEfficient', 'Most efficient drive')} icon={Sprout} />
                  <YearDriveHighlight drive={d.shortest_drive} label={t('yearReview.shortestDrive', 'Shortest drive')} icon={Timer} />
                  <YearDriveHighlight drive={d.least_efficient_drive} label={t('yearReview.leastEfficient', 'Least efficient drive')} icon={TrendingDown} />
                </div>
                <YearExtremes data={d} />
              </div>
            ),
          )}
        </section>
      </FadeIn>

      {/* 5 — Fun facts */}
      <FadeIn delay={0.2}>
        <section aria-label={t('yearReview.funFacts', 'Fun facts about your year')} className="space-y-4">
          <SectionTitle>{t('yearReview.funFacts', 'Fun facts about your year')}</SectionTitle>
          {gate(panelSkeleton(160), (d) => <YearComparisons comparisons={d.comparisons} />)}
        </section>
      </FadeIn>

      {/* 6 — Shareable recap + AI narration */}
      <FadeIn delay={0.25}>
        <section aria-label={t('yearReview.recap', 'Recap')} className="space-y-4">
          <SectionTitle>{t('yearReview.recap', 'Recap')}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              {gate(panelSkeleton(300), (d) => <YearSummaryCard data={d} />)}
            </div>
            <div>
              <AIYearReviewNarration vehicleId={vehicleIdParam ? Number(vehicleIdParam) : undefined} />
            </div>
          </div>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
