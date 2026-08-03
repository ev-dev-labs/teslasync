import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Milestone, Flag, Gauge, CalendarClock } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, Input, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useStoredNumber } from '@/hooks/useStoredNumber';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';

import { computeMilestones } from '../lib/odometerMilestones';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

export default function MilestonesPage() {
  const { t } = useTranslation();
  usePageTitle(t('milestones.title', 'Odometer Milestones'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance, unitPrefs } = useUnits();

  // Calibration: odometer reading BEFORE the first logged drive, stored in km.
  const [baseOdometerKm, setBaseOdometerKm] = useStoredNumber('teslasync:milestones-base-km:v1', 0);

  const drivesQuery = useDrives(vehicleIdStr);

  const summary = useMemo(
    () => computeMilestones(drivesQuery.data ?? [], baseOdometerKm, Date.now()),
    [drivesQuery.data, baseOdometerKm],
  );

  const perMile = unitPrefs.distance === 'mi';
  const distUnitLabel = perMile ? t('milestones.mi', 'mi') : t('milestones.km', 'km');
  const baseDisplay = Math.round(perMile ? baseOdometerKm / KM_PER_MILE : baseOdometerKm);

  function handleBaseChange(text: string): void {
    if (text === '') return;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return;
    setBaseOdometerKm(perMile ? n * KM_PER_MILE : n);
  }

  const fmtKm = (km: number) => formatDistance(km * 1000, { precision: 0 });

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('milestones.title', 'Odometer Milestones')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;
  const next = summary.upcoming[0];

  return (
    <PageContainer
      title={t('milestones.title', 'Odometer Milestones')}
      subtitle={t('milestones.subtitle', 'Round-number birthdays for your odometer, dated and forecast')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={100}
            aria-label={t('milestones.baseInput', 'Odometer before first logged drive')}
            key={`base-${unitPrefs.distance}`}
            defaultValue={baseDisplay}
            onChange={(e) => handleBaseChange(e.target.value)}
            suffix={<span className="whitespace-nowrap">{distUnitLabel}</span>}
            className="max-w-[10rem]"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('milestones.kpis', 'Milestone summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('milestones.current', 'Odometer')}
                value={fmtKm(summary.currentKm)}
                subtitle={t('milestones.calibrated', 'incl. calibration offset')}
                icon={<Gauge className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('milestones.pace', 'Pace')}
                value={summary.paceKmPerDay != null ? `${fmtKm(summary.paceKmPerDay)}/${t('milestones.day', 'day')}` : '—'}
                subtitle={t('milestones.trailing', 'trailing 90 days')}
                icon={<CalendarClock className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('milestones.next', 'Next Milestone')}
                value={next ? fmtKm(next.km) : '—'}
                subtitle={next ? t('milestones.toGo', '{{dist}} to go', { dist: fmtKm(next.remainingKm) }) : undefined}
                icon={<Flag className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('milestones.eta', 'Next ETA')}
                value={next?.etaMs != null ? formatDateShort(new Date(next.etaMs).toISOString()) : '—'}
                subtitle={t('milestones.atPace', 'at current pace')}
                icon={<Milestone className="h-5 w-5" />}
                color="green"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Passed + upcoming ladder */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Flag className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('milestones.passed', 'Milestones Reached')}
              <HelpTooltip
                size="sm"
                i18nKey="help.milestones.body"
                defaultValue="TeslaSync logs per-drive distance rather than absolute odometer, so set the calibration field to your odometer reading from before the first logged drive. Every ladder step (each 10k, then each 50k past 100k) is then dated by the drive that crossed it."
                ariaLabel={t('help.milestones.iconLabel', 'More info about milestone math')}
              />
            </PanelTitle>
            {isError ? (
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            ) : isLoading ? (
              <Skeleton height={200} />
            ) : summary.passed.length === 0 ? (
              <EmptyState /* no-action: fills in automatically as the odometer crosses each ladder step; calibration is in the header. */
                icon={<Flag className="h-8 w-8" />}
                message={t('milestones.nonePassed', 'No ladder milestones crossed in the logged history yet.')}
              />
            ) : (
              <ul className="space-y-2">
                {[...summary.passed].reverse().map((m) => (
                  <li
                    key={m.km}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                  >
                    <span className="flex items-center gap-2">
                      <Badge variant="success">{fmtKm(m.km)}</Badge>
                      <Text variant="bodySm">{t('milestones.reachedOn', 'reached {{date}}', { date: formatDateShort(m.date) })}</Text>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Milestone className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('milestones.upcoming', 'Coming Up')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={200} />
            ) : summary.upcoming.length === 0 ? (
              <EmptyState /* no-action: the ladder always extends ahead; empty only without any drive history, and the vehicle picker is the recovery surface. */
                icon={<Milestone className="h-8 w-8" />}
                message={t('milestones.noUpcoming', 'No drive history yet to project milestones from.')}
              />
            ) : (
              <ul className="space-y-2">
                {summary.upcoming.map((m) => (
                  <li
                    key={m.km}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                  >
                    <span className="flex items-center gap-2">
                      <Badge variant="info">{fmtKm(m.km)}</Badge>
                      <Text variant="bodySm">{t('milestones.toGo', '{{dist}} to go', { dist: fmtKm(m.remainingKm) })}</Text>
                    </span>
                    <Text variant="caption" className="font-mono tabular-nums">
                      {m.etaMs != null
                        ? t('milestones.etaAround', '~{{date}}', { date: formatDateShort(new Date(m.etaMs).toISOString()) })
                        : '—'}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
