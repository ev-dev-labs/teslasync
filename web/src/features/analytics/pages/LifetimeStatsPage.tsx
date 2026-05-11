import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Car, Zap, DollarSign, Leaf, Globe, Moon,
  Clock, Award, Flame, TreePine, Home,
  Trophy, Gauge, BatteryCharging,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, HelpTooltip, type HelpTooltipProps } from '@/components/ui';
import { StatCard, AnimatedNumber, ProgressRing, Currency, DataFreshnessAuto } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';

import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import { AchievementBadge } from '../components/AchievementBadge';
import { useMotionPreference } from '@/hooks/useMotionPreference';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;

/* ── Helpers ──────────────────────────────────────────────────────── */

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default function LifetimeStatsPage() {
  const { t } = useTranslation();
  usePageTitle(t('lifetime.title', 'Lifetime Stats'));
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  // backend `total_distance_km` and `longest_drive_record.value` are SI km;
  // `highest_speed_record.value` is SI km/h. Convert via meter/second floor.
  const fromKm = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);
  const fromKmh = (kmh: number) => convertSpeedFromSI((kmh * METERS_PER_KM) / SECONDS_PER_HOUR, speedUnit);

  const { vehicleId } = useSelectedVehicle();
  const lifetimeQuery = useLifetimeStats(vehicleId != null ? String(vehicleId) : undefined);
  const { data, isLoading, error } = lifetimeQuery;

  const stats = data;
  const achievements = stats?.achievements ?? [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;

  // ── Phase-40 / Prompt 63: deep-link `?achievement={id}` ──────────────────
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
      loading={isLoading}
      error={error instanceof Error ? error : error ? new Error(String(error)) : null}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <VehicleSelect />
          {/* Lifetime stats are cagg-driven; force amber after 6h. */}
          <DataFreshnessAuto query={lifetimeQuery} forceStaleAfterMs={6 * 60 * 60 * 1000} />
        </div>
      }
    >
      {/* ── Hero Section ─────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Car className="h-8 w-8 text-neon-cyan" />
            <span className="text-4xl md:text-5xl font-bold text-[var(--text-primary)]">
              <AnimatedNumber
                value={stats ? fromKm(stats.total_distance_km) : 0}
                duration={1.5}
                decimals={0}
              />
            </span>
            <span className="text-lg text-[var(--text-secondary)]">{distanceUnit}</span>
          </div>
          <p className="text-[var(--text-muted)] text-lg">
            {t('lifetime.heroSubtitle', 'driven across {{drives}} drives', {
              drives: fmtInt(stats?.total_drives ?? 0),
            })}
          </p>
          {stats && stats.earth_circumferences > 0 && (
            <p className="mt-2 text-neon-cyan/80 text-sm">
              🌎 {t('lifetime.earthCompare', "That's {{x}}x around the Earth!", {
                x: fmtNumber(stats.earth_circumferences, 2),
              })}
            </p>
          )}
          {stats && stats.ownership_days > 0 && (
            <p className="mt-1 text-[var(--text-muted)] text-xs">
              {t('lifetime.since', 'Tracking since {{date}} ({{days}} days)', {
                date: fmtDate(stats.first_drive_date),
                days: fmtInt(stats.ownership_days),
              })}
            </p>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Key Stats Grid ───────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <Grid cols={{ default: 2, md: 4 }} gap={4} className="mt-6">
          <StatCard
            label={t('lifetime.totalDrives', 'Total Drives')}
            value={fmtInt(stats?.total_drives ?? 0)}
            icon={<Car className="h-4 w-4" />}
            sublabel={`${fmtNumber(stats?.total_driving_hours ?? 0, 1)} ${t('lifetime.hours', 'hrs')}`}
          />
          <StatCard
            label={t('lifetime.totalDistance', 'Total Distance')}
            value={fmtNumber(stats ? fromKm(stats.total_distance_km) : 0, 0)}
            unit={distanceUnit}
            icon={<Gauge className="h-4 w-4" />}
          />
          <StatCard
            label={t('lifetime.totalEnergy', 'Total Energy')}
            value={fmtNumber(stats?.total_energy_kwh ?? 0, 1)}
            unit="kWh"
            icon={<Zap className="h-4 w-4" />}
            sublabel={`${fmtInt(stats?.total_charge_sessions ?? 0)} ${t('lifetime.sessions', 'sessions')}`}
          />
          <StatCard
            label={t('lifetime.totalSavings', 'Total Savings')}
            value={`$${fmtNumber(stats?.total_savings ?? 0, 0)}`}
            icon={<DollarSign className="h-4 w-4" />}
            sublabel={t('lifetime.vsGas', 'vs gasoline')}
          />
        </Grid>
      </FadeIn>

      {/* ── Fun Facts ────────────────────────────────────────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-400" />
            {t('lifetime.funFacts', 'Fun Facts')}
          </h2>
          {stats ? (
            <Grid cols={{ default: 2, md: 4 }} gap={4}>
              <FunFactCard
                icon={<Globe className="h-6 w-6 text-blue-400" />}
                value={fmtNumber(stats.earth_circumferences * 100, 1)}
                unit="%"
                label={t('lifetime.earthProgress', 'around the Earth')}
              />
              <FunFactCard
                icon={<Moon className="h-6 w-6 text-[var(--text-secondary)]" />}
                value={fmtNumber(stats.moon_trips * 100, 2)}
                unit="%"
                label={t('lifetime.moonProgress', 'to the Moon')}
              />
              <FunFactCard
                icon={<TreePine className="h-6 w-6 text-green-400" />}
                value={fmtInt(stats.trees_equivalent)}
                unit=""
                label={t('lifetime.treesPlanted', 'trees equivalent planted')}
              />
              <FunFactCard
                icon={<Home className="h-6 w-6 text-amber-400" />}
                value={fmtNumber(stats.homes_equivalent_days, 1)}
                unit={t('lifetime.days', 'days')}
                label={t('lifetime.homesPowered', 'of home energy used')}
              />
            </Grid>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('lifetime.noData', 'No driving data yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Savings Comparison ───────────────────────────────────── */}
      <FadeIn delay={0.15}>
        <GlassPanel className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-400" />
            {t('lifetime.savingsComparison', 'Savings vs Gasoline')}
          </h2>
          {stats && stats.gas_equivalent_cost > 0 ? (
            <SavingsBar
              evCost={stats.total_charging_cost}
              gasCost={stats.gas_equivalent_cost}
              savings={stats.total_savings}
              co2Kg={stats.co2_offset_kg}
            />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('lifetime.noSavingsData', 'Complete some drives to see savings')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Environmental Impact ─────────────────────────────────── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Leaf className="h-5 w-5 text-green-400" />
            {t('lifetime.environmentalImpact', 'Environmental Impact')}
          </h2>
          {stats ? (
            <Grid cols={{ default: 1, md: 3 }} gap={4}>
              <div className="flex items-center gap-4">
                <ProgressRing
                  value={Math.min((stats.co2_offset_kg / 1000) * 100, 100)}
                  size={64}
                  strokeWidth={5}
                  color="#22c55e"
                />
                <div>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">
                    <AnimatedNumber value={stats.co2_offset_kg} decimals={0} suffix=" kg" />
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">{t('lifetime.co2Offset', 'CO₂ offset')}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-4xl">🌳</span>
                <div>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">{fmtInt(stats.trees_equivalent)}</p>
                  <p className="text-sm text-[var(--text-muted)]">{t('lifetime.treesEquiv', 'trees equivalent')}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-4xl">☕</span>
                <div>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">
                    {fmtInt(Math.round(stats.total_savings / 5))}
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">{t('lifetime.coffeesEquiv', 'cups of coffee saved')}</p>
                </div>
              </div>
            </Grid>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('lifetime.noData', 'No driving data yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Personal Records ─────────────────────────────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Award className="h-5 w-5 text-yellow-400" />
            {t('lifetime.personalRecords', 'Personal Records')}
          </h2>
          {stats ? (
            <Grid cols={{ default: 1, md: 3 }} gap={4}>
              <RecordCard
                title={t('lifetime.longestDrive', 'Longest Drive')}
                value={`${fmtNumber(fromKm(stats.longest_drive_record?.value ?? 0), 1)} ${distanceUnit}`}
                date={stats.longest_drive_record?.date}
                icon={<Car className="h-5 w-5 text-cyan-400" />}
              />
              <RecordCard
                title={t('lifetime.highestSpeed', 'Highest Speed')}
                value={`${fmtNumber(fromKmh(stats.highest_speed_record?.value ?? 0), 0)} ${speedUnit}`}
                date={stats.highest_speed_record?.date}
                icon={<Gauge className="h-5 w-5 text-red-400" />}
              />
              <RecordCard
                title={t('lifetime.biggestCharge', 'Biggest Charge')}
                value={`${fmtNumber(stats.max_charge_record?.value ?? 0, 1)} kWh`}
                date={stats.max_charge_record?.date}
                icon={<BatteryCharging className="h-5 w-5 text-green-400" />}
              />
            </Grid>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('lifetime.noData', 'No driving data yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Activity Summary ─────────────────────────────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-sky-400" />
            {t('lifetime.activitySummary', 'Activity Summary')}
          </h2>
          {stats ? (
            <Grid cols={{ default: 2, md: 4 }} gap={4}>
              <MiniStat
                label={t('lifetime.mostActiveDay', 'Most Active Day')}
                value={stats.most_active_day_of_week || '—'}
              />
              <MiniStat
                label={t('lifetime.mostActiveHour', 'Peak Hour')}
                value={stats.most_active_hour != null
                  ? `${stats.most_active_hour}:00`
                  : '—'}
              />
              <MiniStat
                label={t('lifetime.daysOnRoad', 'Days on Road')}
                value={fmtNumber(stats.days_on_road, 1)}
              />
              <MiniStat
                label={t('lifetime.avgEfficiency', 'Avg Efficiency')}
                value={stats.avg_efficiency_wh_km > 0
                  ? `${fmtNumber(stats.avg_efficiency_wh_km, 0)} Wh/km`
                  : '—'}
                help={{
                  i18nKey: 'help.lifetime.avgEfficiency',
                  defaultValue:
                    'Average energy used per unit distance across the whole driving history (Wh/km). Lower is better — temperature, speed, and terrain are the main drivers.',
                }}
              />
            </Grid>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('lifetime.noData', 'No driving data yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Achievement Gallery ──────────────────────────────────── */}
      <FadeIn delay={0.35}>
        <GlassPanel className="mt-6 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-400" />
              {t('lifetime.achievements', 'Achievements')}
            </h2>
            <span className="text-sm text-[var(--text-muted)]">
              {unlockedCount}/{achievements.length} {t('lifetime.unlocked', 'unlocked')}
            </span>
          </div>
          {achievements.length > 0 ? (
            <StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
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
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('lifetime.noAchievements', 'Start driving to unlock achievements')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

/* ── Sub-components ───────────────────────────────────────────────── */

function FunFactCard({ icon, value, unit, label }: {
  icon: React.ReactNode; value: string; unit: string; label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-3">
      {icon}
      <div>
        <p className="text-xl font-bold text-[var(--text-primary)]">
          {value}<span className="text-sm text-[var(--text-muted)] ml-1">{unit}</span>
        </p>
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
      </div>
    </div>
  );
}

function SavingsBar({ evCost, gasCost, savings, co2Kg }: {
  evCost: number; gasCost: number; savings: number; co2Kg: number;
}) {
  const { t } = useTranslation();
  const maxCost = Math.max(evCost, gasCost, 1);
  const evPct = Math.round((evCost / maxCost) * 100);
  const gasPct = Math.round((gasCost / maxCost) * 100);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-green-400">{t('lifetime.electricCost', 'Electric Cost')}</span>
          <Currency value={evCost} className="text-[var(--text-secondary)]" />
        </div>
        <div className="h-6 rounded-full bg-white/[0.05] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-slow"
            style={{ width: `${evPct}%` }}
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-red-400">{t('lifetime.gasCost', 'Gasoline Equivalent')}</span>
          <Currency value={gasCost} className="text-[var(--text-secondary)]" />
        </div>
        <div className="h-6 rounded-full bg-white/[0.05] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-400 transition-all duration-slow"
            style={{ width: `${gasPct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
        <span className="text-green-400 font-semibold text-lg">
          {t('lifetime.youSaved', 'You saved')} <Currency value={savings} />
        </span>
        <span className="text-sm text-[var(--text-muted)]">
          {fmtNumber(co2Kg, 0)} kg CO₂ {t('lifetime.avoided', 'avoided')}
        </span>
      </div>
    </div>
  );
}

function RecordCard({ title, value, date, icon }: {
  title: string; value: string; date: string | null | undefined; icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg bg-white/[0.03] p-4">
      {icon}
      <div>
        <p className="text-xs text-[var(--text-muted)]">{title}</p>
        <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
        {date && (
          <p className="text-xs text-[var(--text-muted)]">{fmtDate(date)}</p>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, help }: { label: string; value: string; help?: HelpTooltipProps }) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-3 text-center">
      <p className="mb-1 inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <span>{label}</span>
        {help && (
          <HelpTooltip
            size="xs"
            {...help}
            ariaLabel={help.ariaLabel ?? `More info about ${label}`}
          />
        )}
      </p>
      <p className="text-lg font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
