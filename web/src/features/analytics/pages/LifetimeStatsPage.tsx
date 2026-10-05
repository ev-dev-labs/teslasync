import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Car, DollarSign, Leaf, Globe, Moon,
  Clock, Award, Flame, TreePine, Home,
  Trophy, Gauge, BatteryCharging,
} from 'lucide-react';

import { Grid } from '@/components/layout';
import { PageLayout, Section, CardGrid } from '@/components/layout/layout-reference';
import {
  GlassPanel, SectionTitle, Text, Caption,
} from '@/components/ui';
import {
  AnimatedNumber, ProgressRing, DataFreshnessAuto,
} from '@/components/data-display';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';


import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

import { cn } from '@/lib/cn';

import {
  SectionCard, HeroChip, FunFactCard, SavingsBar, EnvStat, RecordCard,
  MiniStat, LifetimeKeyStats, lifetimeSectionState,
} from '../components/lifetime-modernization';
import { AchievementBadge } from '../components/AchievementBadge';
import { AILifetimeStatsQA } from '@/components/ai/AILifetimeStatsQA';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
const SAVINGS_PER_COFFEE = 5;

/* Semantic chart/accent colors (toned, color-blind friendly). */
const CO2_COLOR = '#22c55e';

/* ── Page ─────────────────────────────────────────────────────────── */

export default function LifetimeStatsPage() {
  const { fmtInt, fmtNumber, precision: displayPrecision } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDate: fmtDate } = useDateFormat();
  usePageTitle(t('lifetime.title', 'Lifetime stats'));
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  // backend `total_distance_km` and `longest_drive_record.value` are SI km;
  // `highest_speed_record.value` is SI km/h. Convert via meter/second floor.
  const fromKm = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);
  const fromKmh = (kmh: number) => convertSpeedFromSI((kmh * METERS_PER_KM) / SECONDS_PER_HOUR, speedUnit);

  const { vehicleId } = useSelectedVehicle();
  const lifetimeQuery = useLifetimeStats(vehicleId != null ? String(vehicleId) : undefined);
  const { data: stats, isLoading, isError, error } = lifetimeQuery;
  const retry = () => { void lifetimeQuery.refetch(); };

  const achievements = stats?.achievements ?? [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;

  // Per-section state resolver — one query feeds the page, but every panel
  // renders its own loading / error / empty independently (never gate the
  // whole page behind a single `{data && …}`).
  const hasData = stats != null;
  const fatalError = isError && !hasData;
  const initialLoading = isLoading && !hasData;
  const sectionState = (empty: boolean) => lifetimeSectionState({
    hasData, isLoading, isError, empty,
  });

  const heroDistance = stats ? fromKm(stats.total_distance_km) : 0;

  // Deep-link `?achievement={id}`.
  // When the lifetime page mounts (or the query param changes) with a target
  // achievement id, scroll the matching badge into view and apply a 3-second
  // pulse highlight. After the pulse, strip the query param via `replace`
  // navigation so refreshes don't re-pulse and so the address bar matches the
  // user's mental model ("I'm just looking at the page now").
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const targetAchievementId = searchParams.get('achievement');
  const { reduce: reduceMotion } = useMotionPreference();
  const [pulsedId, setPulsedId] = useState<string | null>(null);
  const badgeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!targetAchievementId) return;
    if (achievements.length === 0) return; // wait for data

    // Defer one frame so the achievement section is in the DOM before we
    // try to scroll to it (achievements live inside `<FadeIn>` which mounts
    // children after a brief animation tick).
    const raf = requestAnimationFrame(() => {
      const node = badgeRefs.current.get(targetAchievementId);
      if (node) {
        node.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        });
      }
      setPulsedId(targetAchievementId);
    });

    // Strip the query param + clear the pulse after 3 seconds. We do BOTH in
    // the same timeout so the URL bar and the visual cue stay in sync.
    const timeout = window.setTimeout(() => {
      setPulsedId(null);
      navigate(location.pathname, { replace: true });
    }, 3000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [targetAchievementId, achievements.length, navigate, location.pathname, reduceMotion]);

  return (
    <PageLayout
      title={t('lifetime.title', 'Lifetime stats')}
      subtitle={t('lifetime.subtitle', 'Your all-time driving achievements and milestones')}
      metadataActions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* Lifetime stats are cagg-driven; force amber after 6h. */}
          <DataFreshnessAuto query={lifetimeQuery} forceStaleAfterMs={6 * 60 * 60 * 1000} />
        </div>
      }
    >
      {/* ── Hero — headline lifetime distance ────────────────────── */}
      <FadeIn>
        <section aria-label={t('lifetime.title', 'Lifetime stats')}>
          <GlassPanel className="p-6 sm:p-8">
            {hasData && isError && <QueryError error={error} onRetry={retry} />}
            {fatalError ? (
              <QueryError error={error} onRetry={retry} />
            ) : initialLoading ? (
              <Skeleton height={96} />
            ) : (
              <div className="flex flex-col items-center gap-6 text-center xl:flex-row xl:justify-between xl:text-left">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-center gap-3 xl:justify-start">
                    <Car className="h-8 w-8 shrink-0 text-cyan-300" aria-hidden="true" />
                    <span className="flex min-w-0 flex-wrap items-baseline justify-center gap-2 xl:justify-start">
                      <Text
                        as="span"
                        size="3xl"
                        weight="bold"
                        color="primary"
                        className="tabular-nums sm:text-4xl xl:text-5xl"
                      >
                        <AnimatedNumber value={heroDistance} duration={1.5} decimals={displayPrecision} />
                      </Text>
                      <Text as="span" size="lg" color="secondary">{distanceUnit}</Text>
                    </span>
                  </div>
                  <Text as="p" size="lg" color="muted" className="mt-2">
                    {t('lifetime.heroSubtitle', 'driven across {{drives}} drives', {
                      drives: fmtInt(stats?.total_drives ?? 0),
                    })}
                  </Text>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 xl:justify-end">
                  {stats && stats.earth_circumferences > 0 && (
                    <HeroChip icon={<Globe className="h-3.5 w-3.5" aria-hidden="true" />}>
                      {t('lifetime.earthCompare', "That's {{x}}x around the Earth!", {
                        x: fmtNumber(stats.earth_circumferences),
                      })}
                    </HeroChip>
                  )}
                  {stats && stats.ownership_days > 0 && (
                    <HeroChip icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}>
                      {t('lifetime.since', 'Tracking since {{date}} ({{days}} days)', {
                        date: fmtDate(stats.first_drive_date),
                        days: fmtInt(stats.ownership_days),
                      })}
                    </HeroChip>
                  )}
                </div>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── KPI band — core lifetime metrics ─────────────────────── */}
      <FadeIn delay={0.05}>
        <Section id="lifetime-key-stats" title={t('lifetime.keyStats', 'Key stats')}>
          <LifetimeKeyStats
            stats={stats}
            loading={isLoading}
            fatalError={fatalError}
            error={error}
            onRetry={retry}
          />
        </Section>
      </FadeIn>

      {/* ── AI Q&A (opt-in; absent when AI is off) ───────────────── */}
      <FadeIn delay={0.1}>
        <section aria-label={t('lifetime.aiQA.title', 'Ask about your lifetime stats')}>
          <AILifetimeStatsQA vehicleId={vehicleId ?? undefined} />
        </section>
      </FadeIn>

      {/* ── Bento A — Fun Facts (hero) + Savings comparison ──────── */}
      <FadeIn delay={0.15}>
        <CardGrid label={t('lifetime.funFacts', 'Fun facts')} items={[
          { id: 'lifetime-fun-facts', size: 'half', content: (
          <SectionCard
            title={t('lifetime.funFacts', 'Fun facts')}
            icon={<Flame className="h-5 w-5 text-amber-300" aria-hidden="true" />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={140}
          >
            <div className="grid grid-cols-1 gap-3 @[320px]:grid-cols-2 @[640px]:grid-cols-4 @[640px]:gap-4">
              <FunFactCard
                icon={<Globe className="h-6 w-6 shrink-0 text-indigo-300" aria-hidden="true" />}
                value={fmtNumber((stats?.earth_circumferences ?? 0) * 100)}
                unit="%"
                label={t('lifetime.earthProgress', 'around the Earth')}
              />
              <FunFactCard
                icon={<Moon className="h-6 w-6 shrink-0 text-slate-300" aria-hidden="true" />}
                value={fmtNumber((stats?.moon_trips ?? 0) * 100)}
                unit="%"
                label={t('lifetime.moonProgress', 'to the Moon')}
              />
              <FunFactCard
                icon={<TreePine className="h-6 w-6 shrink-0 text-emerald-300" aria-hidden="true" />}
                value={fmtInt(stats?.trees_equivalent ?? 0)}
                unit=""
                label={t('lifetime.treesPlanted', 'trees equivalent planted')}
              />
              <FunFactCard
                icon={<Home className="h-6 w-6 shrink-0 text-amber-300" aria-hidden="true" />}
                value={fmtNumber(stats?.homes_equivalent_days ?? 0)}
                unit={t('lifetime.days', 'days')}
                label={t('lifetime.homesPowered', 'of home energy used')}
              />
            </div>
          </SectionCard>
          ) },
          { id: 'lifetime-savings-comparison', size: 'half', content: (
          <SectionCard
            title={t('lifetime.savingsComparison', 'Savings vs gasoline')}
            icon={<DollarSign className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
            state={sectionState(!stats || (stats.gas_equivalent_cost ?? 0) <= 0)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noSavingsData', 'Complete some drives to see savings')}
            skeletonHeight={160}
          >
            <SavingsBar
              evCost={stats?.total_charging_cost ?? 0}
              gasCost={stats?.gas_equivalent_cost ?? 0}
              savings={stats?.total_savings ?? 0}
              co2Kg={stats?.co2_offset_kg ?? 0}
            />
          </SectionCard>
          ) },
        ]} />
      </FadeIn>

      {/* ── Bento B — Environmental / Records / Activity ─────────── */}
      <FadeIn delay={0.2}>
        <CardGrid label={t('lifetime.activitySummary', 'Activity summary')} items={[
          { id: 'lifetime-environmental-impact', size: 'third', content: (
          <SectionCard
            title={t('lifetime.environmentalImpact', 'Environmental impact')}
            icon={<Leaf className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={200}
          >
            <Grid minItemWidth="standard" gap={4}>
              <EnvStat
                visual={
                  <ProgressRing
                    value={Math.min(((stats?.co2_offset_kg ?? 0) / 1000) * 100, 100)}
                    size={64}
                    strokeWidth={5}
                    color={CO2_COLOR}
                  />
                }
                value={<AnimatedNumber value={stats?.co2_offset_kg ?? 0} decimals={displayPrecision} suffix=" kg" />}
                label={t('lifetime.co2Offset', 'CO₂ offset')}
              />
              <EnvStat
                visual={<span className="text-4xl" aria-hidden="true">🌳</span>}
                value={fmtInt(stats?.trees_equivalent ?? 0)}
                label={t('lifetime.treesEquiv', 'trees equivalent')}
              />
              <EnvStat
                visual={<span className="text-4xl" aria-hidden="true">☕</span>}
                value={fmtInt(Math.round((stats?.total_savings ?? 0) / SAVINGS_PER_COFFEE))}
                label={t('lifetime.coffeesEquiv', 'cups of coffee saved')}
              />
            </Grid>
          </SectionCard>
          ) },
          { id: 'lifetime-personal-records', size: 'third', content: (
          <SectionCard
            title={t('lifetime.personalRecords', 'Personal records')}
            icon={<Award className="h-5 w-5 text-amber-300" aria-hidden="true" />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={200}
          >
            <Grid minItemWidth="standard" gap={3}>
              <RecordCard
                title={t('lifetime.longestDrive', 'Longest drive')}
                value={`${fmtNumber(fromKm(stats?.longest_drive_record?.value ?? 0))} ${distanceUnit}`}
                date={stats?.longest_drive_record?.date}
                icon={<Car className="h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />}
              />
              <RecordCard
                title={t('lifetime.highestSpeed', 'Highest speed')}
                value={`${fmtNumber(fromKmh(stats?.highest_speed_record?.value ?? 0))} ${speedUnit}`}
                date={stats?.highest_speed_record?.date}
                icon={<Gauge className="h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />}
              />
              <RecordCard
                title={t('lifetime.biggestCharge', 'Biggest charge')}
                value={`${fmtNumber(stats?.max_charge_record?.value ?? 0)} kWh`}
                date={stats?.max_charge_record?.date}
                icon={<BatteryCharging className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />}
              />
            </Grid>
          </SectionCard>
          ) },
          { id: 'lifetime-activity-summary', size: 'third', content: (
          <SectionCard
            title={t('lifetime.activitySummary', 'Activity summary')}
            icon={<Clock className="h-5 w-5 text-sky-300" aria-hidden="true" />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={200}
          >
            <div className="grid grid-cols-1 gap-3 @[320px]:grid-cols-2 @[640px]:grid-cols-4">
              <MiniStat
                label={t('lifetime.mostActiveDay', 'Most active day')}
                value={stats?.most_active_day_of_week || '—'}
              />
              <MiniStat
                label={t('lifetime.mostActiveHour', 'Peak hour')}
                value={stats?.most_active_hour != null ? `${stats.most_active_hour}:00` : '—'}
              />
              <MiniStat
                label={t('lifetime.daysOnRoad', 'Days on road')}
                value={fmtNumber(stats?.days_on_road ?? 0)}
              />
              <MiniStat
                label={t('lifetime.avgEfficiency', 'Avg efficiency')}
                value={(stats?.avg_efficiency_wh_km ?? 0) > 0
                  ? `${fmtNumber(stats?.avg_efficiency_wh_km ?? 0)} Wh/km`
                  : '—'}
                help={{
                  i18nKey: 'help.lifetime.avgEfficiency',
                  defaultValue:
                    'Average energy used per unit distance across the whole driving history (Wh/km). Lower is better — temperature, speed, and terrain are the main drivers.',
                }}
              />
            </div>
          </SectionCard>
          ) },
        ]} />
      </FadeIn>

      {/* ── Achievement Gallery — full-width detail band ─────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <SectionTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-300" aria-hidden="true" />
              {t('lifetime.achievements', 'Achievements')}
            </SectionTitle>
            <Caption>
              {unlockedCount}/{achievements.length} {t('lifetime.unlocked', 'unlocked')}
            </Caption>
          </div>
          {hasData && isError && <QueryError error={error} onRetry={retry} />}
          {initialLoading ? (
            <Skeleton height={200} />
          ) : fatalError ? (
            <QueryError error={error} onRetry={retry} />
          ) : achievements.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when the vehicle has no unlocked or in-progress achievements yet */
              message={t('lifetime.noAchievements', 'Start driving to unlock achievements')}
            />
          ) : (
            <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 3xl:grid-cols-8">
              {achievements.map(a => {
                const isPulsing = pulsedId === a.id;
                return (
                  <StaggerItem key={a.id}>
                    <div
                      ref={node => {
                        if (node) badgeRefs.current.set(a.id, node);
                        else badgeRefs.current.delete(a.id);
                      }}
                      className={cn(
                        'rounded-xl',
                        isPulsing && 'ring-2 ring-yellow-400/80',
                        isPulsing && !reduceMotion && 'animate-pulse',
                      )}
                      data-achievement-id={a.id}
                    >
                      <AchievementBadge achievement={a} size="md" />
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
