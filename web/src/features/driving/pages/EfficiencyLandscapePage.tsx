import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Mountain } from 'lucide-react';

import { PageLayout, LayoutCard, SourceContent } from '@/components/layout';
import { Text, HelpTooltip } from '@/components/ui';
import { RangePicker } from '@/components/forms';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { Skeleton, EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import {
  buildLandscape,
  lerpHex,
  scalePosition,
  MIN_CELL_DISTANCE_M,
  SPEED_BANDS_KPH,
  TEMP_BANDS_C,
  type LandscapeCell,
} from '../lib/efficiencyLandscape';
import { DrivingSummaryBrief } from '../components/operationalbrief-a-m/DrivingSummaryBrief';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

/** Sequential scale endpoints from the shared palette (emerald → rose). */
const SCALE_FROM = chartTokens.series[1];
const SCALE_TO = chartTokens.series[3];

export default function EfficiencyLandscapePage() {
  const { t } = useTranslation();
  usePageTitle(t('landscape.title', 'Efficiency Landscape'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatTemperature, unitPrefs } = useUnits();

  const { start, end, setRange } = useRangeState({
    persistKey: 'efficiency-landscape.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr);
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const landscape = useMemo(() => buildLandscape(drives), [drives]);

  const isMiles = unitPrefs.distance === 'mi';
  const speedUnit = isMiles ? t('landscape.mph', 'mph') : t('landscape.kmh', 'km/h');
  const effUnit = isMiles ? t('landscape.whPerMi', 'Wh/mi') : t('landscape.whPerKm', 'Wh/km');
  const toSpeed = (kph: number) => Math.round(isMiles ? kph / KM_PER_MILE : kph);
  const toEff = (whPerKm: number) => Math.round(isMiles ? whPerKm * KM_PER_MILE : whPerKm);

  const speedLabel = (i: number) => {
    const b = SPEED_BANDS_KPH[i]!;
    return b.to === Infinity ? `${toSpeed(b.from)}+` : `${toSpeed(b.from)}–${toSpeed(b.to)}`;
  };
  const tempLabel = (i: number) => {
    const b = TEMP_BANDS_C[i]!;
    if (b.from === -Infinity) return `< ${formatTemperature(b.to)}`;
    if (b.to === Infinity) return `≥ ${formatTemperature(b.from)}`;
    return `${formatTemperature(b.from)}–${formatTemperature(b.to)}`;
  };

  const cellDescription = (cell: LandscapeCell): string =>
    cell.whPerKm != null
      ? `${tempLabel(cell.tempBand)} · ${speedLabel(cell.speedBand)} ${speedUnit} · ${toEff(cell.whPerKm)} ${effUnit} (${cell.drives})`
      : `${tempLabel(cell.tempBand)} · ${speedLabel(cell.speedBand)} ${speedUnit} · —`;
  const available = drivesState.data != null;
  const briefMetrics: readonly StatMetric[] = [
    { metricId: 'efficiency', occurrenceId: 'best',
      rawValue: available && landscape.best?.whPerKm != null ? landscape.best.whPerKm / 1000 : null,
      label: t('landscape.sweetCell', 'Happiest Conditions'),
      description: t('landscape.brief.best', 'Lowest distance-weighted consumption among supported condition cells.'),
      context: landscape.best ? `${tempLabel(landscape.best.tempBand)} · ${speedLabel(landscape.best.speedBand)} ${speedUnit}` : undefined,
      display: { formatter: (raw) => ({ value: String(toEff(raw * 1000)), unit: effUnit }) } },
    { metricId: 'efficiency', occurrenceId: 'worst',
      rawValue: available && landscape.worst?.whPerKm != null ? landscape.worst.whPerKm / 1000 : null,
      label: t('landscape.painCell', 'Harshest Conditions'),
      description: t('landscape.brief.worst', 'Highest distance-weighted consumption among supported condition cells.'),
      context: landscape.worst ? `${tempLabel(landscape.worst.tempBand)} · ${speedLabel(landscape.worst.speedBand)} ${speedUnit}` : undefined,
      display: { formatter: (raw) => ({ value: String(toEff(raw * 1000)), unit: effUnit }) } },
    { metricId: 'percent', occurrenceId: 'spread',
      rawValue: available && landscape.best?.whPerKm != null && landscape.worst?.whPerKm != null && landscape.best.whPerKm > 0
        ? Math.round(((landscape.worst.whPerKm - landscape.best.whPerKm) / landscape.best.whPerKm) * 100) : null,
      label: t('landscape.spread', 'Condition Spread'),
      description: t('landscape.spreadHint', 'harshest vs happiest'), display: { precision: 0 } },
    { metricId: 'count', occurrenceId: 'mapped', rawValue: available ? landscape.analyzed : null,
      label: t('landscape.analyzed', 'Drives Mapped'),
      description: t('landscape.brief.mapped', 'Returned drives with speed, temperature, distance and energy evidence.') },
  ];

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('landscape.title', 'Efficiency Landscape')} />;
  }

  const isLoading = drivesState.status === 'initial';
  const isError = drivesState.fatalError != null;
  const hasScale = landscape.minWhPerKm != null && landscape.maxWhPerKm != null;

  return (
    <PageLayout
      title={t('landscape.title', 'Efficiency Landscape')}
      subtitle={t('landscape.subtitle', 'Your car’s real consumption across speed and temperature')}
      query={drivesQuery}
      contextActions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="efficiency-landscape-range"
          />
        </div>
      }
    >
      <StaleRefreshWarning state={drivesState} label={t('landscape.title', 'Efficiency Landscape')} />
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('landscape.kpis', 'Landscape summary metrics')}
        >
          <DrivingSummaryBrief metrics={briefMetrics}
            title={t('landscape.kpis', 'Landscape summary metrics')}
            description={t('landscape.brief.description', 'Observed distance-weighted consumption across speed and temperature cells; thin evidence remains visible in the field.')}
            scope={t('driving.brief.window', '{{start}}–{{end}}; returned drive subset, not a server-wide aggregate', { start, end })}
            provenance={t('landscape.brief.source', 'Returned drive history; distance-weighted speed × temperature cells.')}
            loading={isLoading} error={drivesState.fatalError}
            retained={drivesState.status === 'stale' || drivesState.refreshError != null}
            onRetry={() => void drivesQuery.refetch()} />
        </section>
      </FadeIn>

      {/* 2 — The field */}
      <FadeIn delay={0.1}>
        <LayoutCard
          title={t('landscape.field', 'Consumption Field')}
          actions={<>
            <Mountain className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <HelpTooltip
              size="sm"
              i18nKey="help.efficiencyLandscape.body"
              defaultValue="Every drive lands in one speed × temperature cell; color encodes distance-weighted consumption from green (thriftiest) to red (thirstiest). Cells with thin evidence show their number but stay uncolored until they earn 10 km of driving."
              ariaLabel={t('help.efficiencyLandscape.iconLabel', 'More info about the field map')}
            />
          </>}
        >
          <SourceContent
            state={isError ? 'error' : isLoading ? 'loading' : landscape.analyzed === 0 ? 'empty' : 'ready'}
            label={t('landscape.field', 'Consumption Field')}
            error={drivesState.fatalError}
            errorMessage={t('drivingSecondary.states.historyError', 'Could not load drive history.')}
            errorRecovery={{ onRetry: () => void drivesQuery.refetch() }}
            loadingContent={<Skeleton height={280} />}
            emptyMessage={t('landscape.noData', 'No drives with speed, temperature, and energy data in this period.')}
            emptyContent={<EmptyState
              icon={<Mountain className="h-8 w-8" />}
              message={t('landscape.noData', 'No drives with speed, temperature, and energy data in this period.')}
              actionTo={{ label: t('landscape.browseDrives', 'Browse drives'), to: '/drives' }}
            />}
          >
            <div className="overflow-x-auto">
              <div
                role="img"
                aria-label={t('landscape.field.aria', 'Grid of consumption by speed band and temperature band; best {{best}}, worst {{worst}}', {
                  best: landscape.best != null ? cellDescription(landscape.best) : '—',
                  worst: landscape.worst != null ? cellDescription(landscape.worst) : '—',
                })}
                className="grid min-w-[640px] gap-1"
                style={{ gridTemplateColumns: `7rem repeat(${SPEED_BANDS_KPH.length}, 1fr)` }}
              >
                <div />
                {SPEED_BANDS_KPH.map((_, si) => (
                  <Text key={si} variant="caption" className="text-center tabular-nums">
                    {speedLabel(si)} {si === 0 ? speedUnit : ''}
                  </Text>
                ))}
                {[...landscape.cells].reverse().map((row, revTi) => {
                  const ti = TEMP_BANDS_C.length - 1 - revTi;
                  return (
                    <Fragment key={ti}>
                      <Text variant="caption" className="self-center tabular-nums">{tempLabel(ti)}</Text>
                      {row.map((cell) => {
                        const trusted = cell.whPerKm != null && cell.distanceM >= MIN_CELL_DISTANCE_M;
                        const bg =
                          trusted && hasScale
                            ? lerpHex(SCALE_FROM, SCALE_TO, scalePosition(cell.whPerKm!, landscape.minWhPerKm!, landscape.maxWhPerKm!))
                            : 'var(--surface-2)';
                        return (
                          <div
                            key={cell.speedBand}
                            title={cellDescription(cell)}
                            className="flex h-14 flex-col items-center justify-center rounded-lg border border-[var(--border-subtle)]"
                            style={{ background: bg, opacity: trusted ? 0.9 : 1 }}
                          >
                            {cell.whPerKm != null ? (
                              <>
                                <Text variant="bodySm" weight="semibold"
                                  className="font-mono tabular-nums"
                                  style={{ color: trusted ? '#0b1220' : 'var(--text-secondary)' }}
                                >
                                  {toEff(cell.whPerKm)}
                                </Text>
                                <Text variant="caption"
                                  className="tabular-nums"
                                  style={{ color: trusted ? '#0b1220' : 'var(--text-muted)', opacity: 0.75 }}
                                >
                                  ×{cell.drives}
                                </Text>
                              </>
                            ) : (
                              <Text variant="caption">—</Text>
                            )}
                          </div>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>

              {hasScale && (
                <div className="mt-3 flex items-center gap-2">
                  <Text variant="caption" className="font-mono tabular-nums">
                    {toEff(landscape.minWhPerKm!)} {effUnit}
                  </Text>
                  <span
                    className="h-2 w-40 rounded-full"
                    style={{ background: `linear-gradient(90deg, ${SCALE_FROM}, ${SCALE_TO})` }}
                    aria-hidden="true"
                  />
                  <Text variant="caption" className="font-mono tabular-nums">
                    {toEff(landscape.maxWhPerKm!)} {effUnit}
                  </Text>
                </div>
              )}
            </div>
          </SourceContent>
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
