import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Car, DollarSign, Globe,
  Clock, Award,
  Gauge, BatteryCharging,
} from 'lucide-react';

import { Grid, PageLayout, Section, CardGrid, LayoutCard, SourceContent } from '@/components/layout';
import {
  GlassPanel, Text, Caption, HelpTooltip, Icon,
} from '@/components/ui';
import {
  AnimatedNumber, FreshnessDotAuto, Currency, KVList,
} from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';


import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { deriveDataState } from '@/api/dataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

import { cn } from '@/lib/cn';
import { neonColorMap, typography } from '@/lib/tokens';

import {
  SectionCard, HeroChip, SavingsBar, RecordCard, lifetimeSectionState,
} from '../components/lifetime-modernization';
import { LifetimeBrief as LifetimeKeyStats } from '../components/operationalbrief-a-m/LifetimeBrief';
import { LifetimeContextBrief } from '../components/operationalbrief-a-m/LifetimeContextBrief';
import { AchievementBadge } from '../components/AchievementBadge';
import { AILifetimeStatsQA } from '@/components/ai';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
const LIFETIME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const hasReading = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

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
  const { data: stats, isLoading, error } = lifetimeQuery;
  const source = deriveDataState({ ...lifetimeQuery, data: stats ?? (lifetimeQuery.isSuccess ? null : undefined) }, {
    provenance: 'historical', maxAgeMs: LIFETIME_MAX_AGE_MS,
    unavailable: lifetimeQuery.isSuccess && stats == null,
  });
  const retry = () => { void lifetimeQuery.refetch(); };

  const achievements = stats?.achievements ?? [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;

  // Per-section state resolver — one query feeds the page, but every panel
  // renders its own loading / error / empty independently (never gate the
  // whole page behind a single `{data && …}`).
  const hasData = stats != null;
  const fatalError = source.fatalError != null;
  const sectionState = (empty: boolean) => lifetimeSectionState({
    hasData, isLoading: isLoading && !hasData,
    isError: fatalError || source.status === 'stale', empty,
  });

  const heroDistance = hasReading(stats?.total_distance_km) ? fromKm(stats.total_distance_km) : null;
  const hasSavingsComparison = hasReading(stats?.total_charging_cost)
    && hasReading(stats?.gas_equivalent_cost) && hasReading(stats?.total_savings)
    && hasReading(stats?.co2_offset_kg)
    && stats.total_charging_cost >= 0 && stats.gas_equivalent_cost > 0;

  // Deep-link `?achievement={id}`.
  // When the lifetime page mounts (or the query param changes) with a target
  // achievement id, scroll the matching badge into view and apply a 3-second
  // static highlight. After the cue, strip only that query param via `replace`
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

    // Strip the query param + clear the cue after 3 seconds. We do BOTH in
    // the same timeout so the URL bar and the visual cue stay in sync.
    const timeout = window.setTimeout(() => {
      setPulsedId(null);
      const remainingParams = new URLSearchParams(location.search);
      remainingParams.delete('achievement');
      const search = remainingParams.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
    }, 3000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [targetAchievementId, achievements.length, navigate, location.pathname, location.search, location.hash, reduceMotion]);

  return (
    <PageLayout
      title={t('lifetime.title', 'Lifetime stats')}
      subtitle={t('lifetime.subtitle', 'Your all-time driving achievements and milestones')}
      metadataActions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* Lifetime stats are cagg-driven; force amber after 6h. */}
          <FreshnessDotAuto query={lifetimeQuery} forceStaleAfterMs={LIFETIME_MAX_AGE_MS} />
          <HelpTooltip
            i18nKey="lifetime.brief.description"
            defaultValue="Server lifetime aggregates with recorded driving hours, charging sessions, and savings versus gasoline."
            ariaLabel={t('lifetime.title', 'Lifetime stats')}
          />
        </div>
      }
    >
      {/* ── Hero — headline lifetime distance ────────────────────── */}
      <FadeIn>
        <section aria-label={t('lifetime.title', 'Lifetime stats')}>
          <GlassPanel className="p-6 sm:p-8">
            <SourceContent state={sectionState(!stats)}
              label={t('lifetime.title', 'Lifetime stats')}
              emptyMessage={t('lifetime.noData', 'No driving data yet')}
              errorMessage={t('error.loadFailed', 'Failed to load data')}
              error={error} errorRecovery={{ onRetry: retry }}
              loadingContent={<Skeleton height={96} />}
              emptyContent={
                <div className="text-center">
                  <EmptyState
                    message={t('lifetime.noData', 'No driving data yet')}
                    action={{ label: t('common.refresh', 'Refresh'), onClick: retry }}
                  />
                  <Text as="p" size="lg" color="muted">
                    {t('lifetime.heroSubtitle', 'driven across {{drives}} drives', {
                      drives: '—',
                    })}
                  </Text>
                </div>
              }
            >
              <div className="flex flex-col items-center gap-6 text-center xl:flex-row xl:justify-between xl:text-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-center gap-3 xl:justify-start">
                    <Icon icon={Car} size="xl" className={neonColorMap.cyan.text} />
                    <span className="flex min-w-0 flex-wrap items-baseline justify-center gap-2 xl:justify-start">
                      <Text
                        as="span"
                        variant="metricValue"
                      >
                        {heroDistance != null
                          ? <AnimatedNumber value={heroDistance} duration={1.5} decimals={displayPrecision} />
                          : '—'}
                      </Text>
                      <Text as="span" size="lg" color="secondary">{distanceUnit}</Text>
                    </span>
                  </div>
                  <Text as="p" size="lg" color="muted" className="mt-2">
                    {t('lifetime.heroSubtitle', 'driven across {{drives}} drives', {
                      drives: hasReading(stats?.total_drives) ? fmtInt(stats.total_drives) : '—',
                    })}
                  </Text>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 xl:justify-end">
                  {stats && stats.earth_circumferences > 0 && (
                    <HeroChip icon={<Icon icon={Globe} size="sm" />}>
                      {t('lifetime.earthCompare', "That's {{x}}x around the Earth!", {
                        x: fmtNumber(stats.earth_circumferences),
                      })}
                    </HeroChip>
                  )}
                  {stats && stats.ownership_days > 0 && (
                    <HeroChip icon={<Icon icon={Clock} size="sm" />}>
                      {t('lifetime.since', 'Tracking since {{date}} ({{days}} days)', {
                        date: fmtDate(stats.first_drive_date),
                        days: fmtInt(stats.ownership_days),
                      })}
                    </HeroChip>
                  )}
                </div>
              </div>
            </SourceContent>
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
          <LifetimeContextBrief mode="funfacts" stats={stats} source={source} onRetry={retry} />
          ) },
          { id: 'lifetime-savings-comparison', size: 'half', content: (
          <SectionCard
            title={t('lifetime.savingsComparison', 'Savings vs gasoline')}
            icon={<Icon icon={DollarSign} size="lg" className={typography.color.secondary} />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noSavingsData', 'Complete some drives to see savings')}
            skeletonHeight={160}
          >
            {hasSavingsComparison && stats ? (
              <SavingsBar
                evCost={stats.total_charging_cost}
                gasCost={stats.gas_equivalent_cost}
                savings={stats.total_savings}
                co2Kg={stats.co2_offset_kg}
              />
            ) : (
              <div className="space-y-4">
                <KVList layout="responsive" items={[
                  { id: 'electric-cost', label: t('lifetime.electricCost', 'Electric cost'), value: <Currency value={stats?.total_charging_cost} precision={displayPrecision} /> },
                  { id: 'gas-cost', label: t('lifetime.gasCost', 'Gasoline equivalent'), value: <Currency value={stats?.gas_equivalent_cost} precision={displayPrecision} /> },
                  { id: 'savings', label: t('lifetime.youSaved', 'You saved'), value: <Currency value={stats?.total_savings} precision={displayPrecision} /> },
                  { id: 'co2', label: t('lifetime.co2Offset', 'CO₂ offset'), value: hasReading(stats?.co2_offset_kg) ? `${fmtNumber(stats.co2_offset_kg)} kg` : '—' },
                ]} />
                {stats?.gas_equivalent_cost === 0 && (
                  <Text as="p" color="muted">
                    {t('carbon.evidence.netUnavailable', 'Baseline comparison unavailable')}
                    {' — '}{t('lifetime.gasCost', 'Gasoline equivalent')}{': '}
                    <Currency value={stats.gas_equivalent_cost} precision={displayPrecision} />
                  </Text>
                )}
              </div>
            )}
          </SectionCard>
          ) },
        ]} />
      </FadeIn>

      {/* ── Bento B — Environmental / Records / Activity ─────────── */}
      <FadeIn delay={0.2}>
        <CardGrid label={t('lifetime.activitySummary', 'Activity summary')} items={[
          { id: 'lifetime-environmental-impact', size: 'third', content: (
          <LifetimeContextBrief mode="environment" stats={stats} source={source} onRetry={retry} />
          ) },
          { id: 'lifetime-personal-records', size: 'third', content: (
          <SectionCard
            title={t('lifetime.personalRecords', 'Personal records')}
            icon={<Icon icon={Award} size="lg" className={typography.color.secondary} />}
            state={sectionState(!stats)}
            error={error}
            onRetry={retry}
            emptyMessage={t('lifetime.noData', 'No driving data yet')}
            skeletonHeight={200}
          >
            <Grid minItemWidth="standard" gap={3}>
              <RecordCard
                title={t('lifetime.longestDrive', 'Longest drive')}
                value={hasReading(stats?.longest_drive_record?.value) ? `${fmtNumber(fromKm(stats.longest_drive_record.value))} ${distanceUnit}` : '—'}
                date={stats?.longest_drive_record?.date}
                icon={<Icon icon={Car} size="lg" className={typography.color.secondary} />}
              />
              <RecordCard
                title={t('lifetime.highestSpeed', 'Highest speed')}
                value={hasReading(stats?.highest_speed_record?.value) ? `${fmtNumber(fromKmh(stats.highest_speed_record.value))} ${speedUnit}` : '—'}
                date={stats?.highest_speed_record?.date}
                icon={<Icon icon={Gauge} size="lg" className={typography.color.secondary} />}
              />
              <RecordCard
                title={t('lifetime.biggestCharge', 'Biggest charge')}
                value={hasReading(stats?.max_charge_record?.value) ? `${fmtNumber(stats.max_charge_record.value)} kWh` : '—'}
                date={stats?.max_charge_record?.date}
                icon={<Icon icon={BatteryCharging} size="lg" className={typography.color.secondary} />}
              />
            </Grid>
          </SectionCard>
          ) },
          { id: 'lifetime-activity-summary', size: 'third', content: (
          <LifetimeContextBrief mode="activity" stats={stats} source={source} onRetry={retry} />
          ) },
        ]} />
      </FadeIn>

      {/* ── Achievement Gallery — full-width detail band ─────────── */}
      <FadeIn delay={0.25}>
        <LayoutCard title={t('lifetime.achievements', 'Achievements')}
          actions={<Caption>
            {stats?.achievements != null ? `${unlockedCount}/${achievements.length}` : '—/—'} {t('lifetime.unlocked', 'unlocked')}
          </Caption>}
        >
          <SourceContent state={sectionState(achievements.length === 0)}
            label={t('lifetime.achievements', 'Achievements')}
            emptyMessage={t('lifetime.noAchievements', 'Start driving to unlock achievements')}
            errorMessage={t('error.loadFailed', 'Failed to load data')}
            error={error} errorRecovery={{ onRetry: retry }}
            loadingContent={<Skeleton height={200} />}
          >
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
                        isPulsing && cn('ring-2', neonColorMap.cyan.ring),
                      )}
                      data-achievement-id={a.id}
                    >
                      <AchievementBadge achievement={a} size="md" />
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          </SourceContent>
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
