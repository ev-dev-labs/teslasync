import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Car, Zap, DollarSign, Leaf, Globe, Moon,
  Clock, Award, Flame, TreePine, Home,
  Trophy, Gauge, BatteryCharging,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, HelpTooltip, SectionTitle, Text, Caption, HelperText,
  type HelpTooltipProps,
} from '@/components/ui';
import {
  StatCard, AnimatedNumber, ProgressRing, MetricBar, Currency, DataFreshnessAuto,
} from '@/components/data-display';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';

import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

import { AchievementBadge } from '../components/AchievementBadge';
import { AILifetimeStatsQA } from '@/components/ai/AILifetimeStatsQA';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useDateFormat } from '@/hooks/useDateFormat';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
const SAVINGS_PER_COFFEE = 5;

/* Semantic chart/accent colors (toned, color-blind friendly). */
const EV_COLOR = '#10b981';
const GAS_COLOR = '#f43f5e';
const CO2_COLOR = '#22c55e';

type SectionState = 'loading' | 'error' | 'empty' | 'ready';

/* ── Page ─────────────────────────────────────────────────────────── */

export default function LifetimeStatsPage() {
  const { t } = useTranslation();
  const { formatDate: fmtDate } = useDateFormat();
  usePageTitle(t('lifetime.title', 'Lifetime Stats'));
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
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
  const sectionState = (empty: boolean): SectionState =>
    isLoading ? 'loading' : isError ? 'error' : empty ? 'empty' : 'ready';

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
    <PageContainer
      title={t('lifetime.title', 'Lifetime Stats')}
      subtitle={t('lifetime.subtitle', 'Your all-time driving achievements and milestones')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <VehicleSelect />
          {/* Lifetime stats are cagg-driven; force amber after 6h. */}
          <DataFreshnessAuto query={lifetimeQuery} forceStaleAfterMs={6 * 60 * 60 * 1000} />
        </div>
      }
    >
      {/* ── Hero — headline lifetime distance ────────────────────── */}
      <FadeIn>
        <section aria-label={t('lifetime.title', 'Lifetime Stats')}>
          <GlassPanel className="p-6 sm:p-8">
            {isError ? (
              <QueryError error={error} onRetry={retry} />
            ) : isLoading ? (
              <Skeleton height={96} />
            ) : (
              <div className="flex flex-col items-center gap-6 text-center xl:flex-row xl:justify-between xl:text-left">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-center gap-3 xl:justify-start">
                    <Car className="h-8 w-8 shrink-0 text-cyan-300" aria-hidden="true" />
                    <span className="flex items-baseline gap-2">
                      <Text
                        as="span"
                        size="3xl"
                        weight="bold"
                        color="primary"
                        className="tabular-nums sm:text-4xl xl:text-5xl"
                      >
                        <AnimatedNumber value={heroDistance} duration={1.5} decimals={0} />
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
                        x: fmtNumber(stats.earth_circumferences, 2),
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
        <section
          aria-label={t('lifetime.keyStats', 'Key stats')}
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {isError ? (
            <div className="col-span-2 lg:col-span-4">
              <GlassPanel className="p-4 sm:p-5">
                <QueryError error={error} onRetry={retry} />
              </GlassPanel>
            </div>
          ) : (
            <>
              <StatCard
                loading={isLoading}
                label={t('lifetime.totalDrives', 'Total Drives')}
                value={fmtInt(stats?.total_drives ?? 0)}
                icon={<Car className="h-4 w-4" aria-hidden="true" />}
                sublabel={`${fmtNumber(stats?.total_driving_hours ?? 0, 1)} ${t('lifetime.hours', 'hrs')}`}
              />
              <StatCard
                loading={isLoading}
                label={t('lifetime.totalDistance', 'Total Distance')}
                value={fmtNumber(heroDistance, 0)}
                unit={distanceUnit}
                icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
              />
              <StatCard
                loading={isLoading}
                label={t('lifetime.totalEnergy', 'Total Energy')}
                value={fmtNumber(stats?.total_energy_kwh ?? 0, 1)}
                unit="kWh"
                icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                sublabel={`${fmtInt(stats?.total_charge_sessions ?? 0)} ${t('lifetime.sessions', 'sessions')}`}
              />
              <StatCard
                loading={isLoading}
                label={t('lifetime.totalSavings', 'Total Savings')}
                value={formatCurrency(stats?.total_savings ?? 0, 0)}
                icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
                sublabel={t('lifetime.vsGas', 'vs gasoline')}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* ── AI Q&A (opt-in; absent when AI is off) ───────────────── */}
      <FadeIn delay={0.1}>
        <section aria-label={t('lifetime.aiQA.title', 'Ask about your lifetime stats')}>
          <AILifetimeStatsQA vehicleId={vehicleId ?? undefined} />
        </section>
      </FadeIn>

      {/* ── Bento A — Fun Facts (hero) + Savings comparison ──────── */}
      <FadeIn delay={0.15}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <SectionCard
            className="xl:col-span-2"
            title={t('lifetime.funFacts', 'Fun Facts')}
            icon={<Flame className="h-5 w-5 text-amber-300" aria-hidden="true" />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={140}
          >
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
              <FunFactCard
                icon={<Globe className="h-6 w-6 shrink-0 text-indigo-300" aria-hidden="true" />}
                value={fmtNumber((stats?.earth_circumferences ?? 0) * 100, 1)}
                unit="%"
                label={t('lifetime.earthProgress', 'around the Earth')}
              />
              <FunFactCard
                icon={<Moon className="h-6 w-6 shrink-0 text-slate-300" aria-hidden="true" />}
                value={fmtNumber((stats?.moon_trips ?? 0) * 100, 2)}
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
                value={fmtNumber(stats?.homes_equivalent_days ?? 0, 1)}
                unit={t('lifetime.days', 'days')}
                label={t('lifetime.homesPowered', 'of home energy used')}
              />
            </div>
          </SectionCard>

          <SectionCard
            title={t('lifetime.savingsComparison', 'Savings vs Gasoline')}
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
        </div>
      </FadeIn>

      {/* ── Bento B — Environmental / Records / Activity ─────────── */}
      <FadeIn delay={0.2}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3 xl:gap-5">
          <SectionCard
            title={t('lifetime.environmentalImpact', 'Environmental Impact')}
            icon={<Leaf className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={200}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 2xl:grid-cols-1">
              <EnvStat
                visual={
                  <ProgressRing
                    value={Math.min(((stats?.co2_offset_kg ?? 0) / 1000) * 100, 100)}
                    size={64}
                    strokeWidth={5}
                    color={CO2_COLOR}
                  />
                }
                value={<AnimatedNumber value={stats?.co2_offset_kg ?? 0} decimals={0} suffix=" kg" />}
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
            </div>
          </SectionCard>

          <SectionCard
            title={t('lifetime.personalRecords', 'Personal Records')}
            icon={<Award className="h-5 w-5 text-amber-300" aria-hidden="true" />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={200}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 2xl:grid-cols-1">
              <RecordCard
                title={t('lifetime.longestDrive', 'Longest Drive')}
                value={`${fmtNumber(fromKm(stats?.longest_drive_record?.value ?? 0), 1)} ${distanceUnit}`}
                date={stats?.longest_drive_record?.date}
                icon={<Car className="h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />}
              />
              <RecordCard
                title={t('lifetime.highestSpeed', 'Highest Speed')}
                value={`${fmtNumber(fromKmh(stats?.highest_speed_record?.value ?? 0), 0)} ${speedUnit}`}
                date={stats?.highest_speed_record?.date}
                icon={<Gauge className="h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />}
              />
              <RecordCard
                title={t('lifetime.biggestCharge', 'Biggest Charge')}
                value={`${fmtNumber(stats?.max_charge_record?.value ?? 0, 1)} kWh`}
                date={stats?.max_charge_record?.date}
                icon={<BatteryCharging className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />}
              />
            </div>
          </SectionCard>

          <SectionCard
            title={t('lifetime.activitySummary', 'Activity Summary')}
            icon={<Clock className="h-5 w-5 text-sky-300" aria-hidden="true" />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={200}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-2">
              <MiniStat
                label={t('lifetime.mostActiveDay', 'Most Active Day')}
                value={stats?.most_active_day_of_week || '—'}
              />
              <MiniStat
                label={t('lifetime.mostActiveHour', 'Peak Hour')}
                value={stats?.most_active_hour != null ? `${stats.most_active_hour}:00` : '—'}
              />
              <MiniStat
                label={t('lifetime.daysOnRoad', 'Days on Road')}
                value={fmtNumber(stats?.days_on_road ?? 0, 1)}
              />
              <MiniStat
                label={t('lifetime.avgEfficiency', 'Avg Efficiency')}
                value={(stats?.avg_efficiency_wh_km ?? 0) > 0
                  ? `${fmtNumber(stats?.avg_efficiency_wh_km ?? 0, 0)} Wh/km`
                  : '—'}
                help={{
                  i18nKey: 'help.lifetime.avgEfficiency',
                  defaultValue:
                    'Average energy used per unit distance across the whole driving history (Wh/km). Lower is better — temperature, speed, and terrain are the main drivers.',
                }}
              />
            </div>
          </SectionCard>
        </div>
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
          {isLoading ? (
            <Skeleton height={200} />
          ) : isError ? (
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
                      className={
                        isPulsing
                          ? (reduceMotion
                              ? 'rounded-xl ring-2 ring-yellow-400/80'
                              : 'rounded-xl ring-2 ring-yellow-400/80 animate-pulse')
                          : 'rounded-xl'
                      }
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
    </PageContainer>
  );
}

/* ── Sub-components (page-local, single-export rule preserved) ─────── */

/** Consistent panel shell with a titled header and self-owned
 *  loading / error / empty states so each section is independent. */
function SectionCard({
  title, icon, state, error, onRetry, emptyMessage,
  skeletonHeight = 132, className, headerExtra, children,
}: {
  title: string;
  icon: ReactNode;
  state: SectionState;
  error?: unknown;
  onRetry?: () => void;
  emptyMessage: string;
  skeletonHeight?: number;
  className?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle className="flex items-center gap-2">
          {icon}
          {title}
        </SectionTitle>
        {headerExtra}
      </div>
      {state === 'loading' ? (
        <Skeleton height={skeletonHeight} />
      ) : state === 'error' ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : state === 'empty' ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          message={emptyMessage}
        />
      ) : (
        children
      )}
    </GlassPanel>
  );
}

/** Rounded pill used in the hero for at-a-glance context facts. */
function HeroChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-cyan-300">
      {icon}
      <Text as="span" size="xs" color="secondary">{children}</Text>
    </span>
  );
}

function FunFactCard({ icon, value, unit, label }: {
  icon: ReactNode; value: string; unit: string; label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.03] p-3">
      {icon}
      <div className="min-w-0">
        <p className="flex items-baseline gap-1">
          <Text as="span" size="xl" weight="bold" color="primary" className="tabular-nums">{value}</Text>
          {unit && <Caption>{unit}</Caption>}
        </p>
        <HelperText className="truncate">{label}</HelperText>
      </div>
    </div>
  );
}

function SavingsBar({ evCost, gasCost, savings, co2Kg }: {
  evCost: number; gasCost: number; savings: number; co2Kg: number;
}) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const maxCost = Math.max(evCost, gasCost, 1);

  return (
    <div className="space-y-4">
      <MetricBar
        label={t('lifetime.electricCost', 'Electric Cost')}
        value={evCost}
        max={maxCost}
        color={EV_COLOR}
        sublabel={formatCurrency(evCost, 0)}
      />
      <MetricBar
        label={t('lifetime.gasCost', 'Gasoline Equivalent')}
        value={gasCost}
        max={maxCost}
        color={GAS_COLOR}
        sublabel={formatCurrency(gasCost, 0)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <Text as="span" size="lg" weight="semibold" className="text-emerald-300">
          {t('lifetime.youSaved', 'You saved')}{' '}
          <Currency value={savings} precision={0} className="text-emerald-300" />
        </Text>
        <Caption>
          {fmtNumber(co2Kg, 0)} kg CO₂ {t('lifetime.avoided', 'avoided')}
        </Caption>
      </div>
    </div>
  );
}

function EnvStat({ visual, value, label }: {
  visual: ReactNode; value: ReactNode; label: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="shrink-0">{visual}</span>
      <div className="min-w-0">
        <Text as="p" size="2xl" weight="bold" color="primary" className="tabular-nums">{value}</Text>
        <HelperText>{label}</HelperText>
      </div>
    </div>
  );
}

function RecordCard({ title, value, date, icon }: {
  title: string; value: string; date: string | null | undefined; icon: ReactNode;
}) {
  const { formatDate: fmtDate } = useDateFormat();
  return (
    <div className="flex items-center gap-4 rounded-lg border border-white/[0.05] bg-white/[0.03] p-4">
      {icon}
      <div className="min-w-0">
        <Caption>{title}</Caption>
        <Text as="p" size="lg" weight="bold" color="primary" className="truncate">{value}</Text>
        {date && <HelperText>{fmtDate(date)}</HelperText>}
      </div>
    </div>
  );
}

function MiniStat({ label, value, help }: {
  label: string; value: string; help?: HelpTooltipProps;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.03] p-3 text-center">
      <span className="mb-1 inline-flex items-center gap-1">
        <Caption>{label}</Caption>
        {help && (
          <HelpTooltip
            size="xs"
            {...help}
            ariaLabel={help.ariaLabel ?? t('lifetime.moreInfoAbout', 'More info about {{label}}', { label })}
          />
        )}
      </span>
      <Text as="p" size="lg" weight="semibold" color="primary">{value}</Text>
    </div>
  );
}
