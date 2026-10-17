import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Gauge, Search, Scale, Waypoints } from 'lucide-react';

import { PageLayout, LayoutCard, ChartCard } from '@/components/layout';
import { Text, Badge, HelpTooltip } from '@/components/ui';

import { VehicleOperationalBrief } from '../components/operationalbrief-all/VehicleOperationalBrief';
import { Skeleton, EmptyState, EmptyStateGuidanceDetails } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { getEmptyStateGuidance } from '@/lib/emptyStateGuidance';
import {
  ChartTooltip, ChartLegend,
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useTirePressureAnalysisHistory } from '@/api/hooks/useVehicleSystems';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { convertPressureFromSI } from '@/lib/unitConversion';

import { chartTokens } from '@/lib/tokens';

import { summarizeTireDifferentialDrift, TIRE_CORNERS, type TireCorner } from '../lib/tireDifferentialDrift';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useRangeState } from '@/hooks/useRangeState';
import { deriveDataState } from '@/api/dataState';
import { VehicleSourceContent } from '../components/VehicleSourceContent';

const CORNER_FALLBACK: Record<TireCorner, string> = {
  fl: 'Front left', fr: 'Front right', rl: 'Rear left', rr: 'Rear right',
};
const CORNER_COLOR: Record<TireCorner, string> = {
  fl: chartTokens.series[0]!, fr: chartTokens.series[1]!, rl: chartTokens.series[2]!, rr: chartTokens.series[3]!,
};

export default function TireDifferentialDriftPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('tireDifferentialDrift.title', 'Tire differential drift'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleSelected = vehicleId != null;
  const { formatDateTime, tz } = useDateFormat();
  const { startInstant, endInstantExclusive, timezone } = useRangeState({ timezone: tz });
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const { unitPrefs, formatPressure } = useUnits();
  const residualHidden = useHiddenSeries('tire-differential-drift-residuals');

  const historyQuery = useTirePressureAnalysisHistory(vehicleIdStr, 30, {
    start: startInstant, end: endInstantExclusive,
  });
  const historySource = deriveDataState(historyQuery, { provenance: 'historical' });
  const summary = useMemo(
    () => summarizeTireDifferentialDrift(vehicleSelected ? historyQuery.data ?? [] : []),
    [historyQuery.data, vehicleSelected],
  );

  // A resolved array is source evidence, but model fallback zeros are not readings.
  const hasUsableEvidence = vehicleSelected && summary.usableSamples > 0;
  const retained = vehicleSelected && historySource.hasData
    && (historySource.refreshError != null || historySource.isRefreshBlocked);
  const noVehicleMessage = t('common.noVehicleSelected.desc', 'Add a vehicle to your fleet to see data on this page.');
  const noDataMessage = t('tireDifferentialDrift.noData', 'No usable four-corner TPMS history yet. Each row needs a plausible reading on all four tires to compute the common-mode median.');

  const cornerLabel = (corner: TireCorner) =>
    t(`tireDifferentialDrift.corner.${corner}`, CORNER_FALLBACK[corner]);

  // Pa → kPa (SI floor) → the user's display unit. Purely multiplicative,
  // so this is valid for both absolute residuals and per-day slopes alike.
  const toDisplay = useCallback((pa: number) => convertPressureFromSI(pa / 1000, unitPrefs.pressure), [unitPrefs.pressure]);

  const residualSeries = useMemo(
    () =>
      summary.residuals.map((r) => ({
        timestamp: new Date(r.ms).toISOString(),
        time: formatDateTime(new Date(r.ms)) + ' (' + timezone + ')',
        fl: toDisplay(r.fl),
        fr: toDisplay(r.fr),
        rl: toDisplay(r.rl),
        rr: toDisplay(r.rr),
      })),
    [summary.residuals, toDisplay, formatDateTime, timezone],
  );

  const slopeBars = useMemo(
    () =>
      summary.corners.filter((c) => c.samples >= 2).map((c) => ({
        corner: c.corner === summary.leakCorner
          ? t('tireDifferentialDrift.leakCornerLabel', '{{corner}} · {{status}}', { corner: t(`tireDifferentialDrift.corner.${c.corner}`, CORNER_FALLBACK[c.corner]), status: t('tireDifferentialDrift.suspect', 'Leak suspect') })
          : t(`tireDifferentialDrift.corner.${c.corner}`, CORNER_FALLBACK[c.corner]),
        key: c.corner,
        slope: toDisplay(c.slopePaPerDay),
        confidence: c.confidence,
      })),
    [summary.corners, summary.leakCorner, toDisplay, t],
  );

  const leakDaysToThreshold = summary.leakCorner != null
    ? (summary.corners.find(c => c.corner === summary.leakCorner)?.daysToThreshold ?? null)
    : null;

  const isLoading = vehicleSelected && historyQuery.isLoading && !historySource.hasData;
  const leakCard = summary.leakCorner != null ? cornerLabel(summary.leakCorner) : null;
  const imbalanceCard = hasUsableEvidence && summary.imbalanceCorner != null ? cornerLabel(summary.imbalanceCorner) : null;
  return (
    <PageLayout
      title={t('tireDifferentialDrift.title', 'Tire differential drift')}
      subtitle={t(
        'tireDifferentialDrift.subtitle',
        'Removes the four-tire common mode at every sample, so what remains is how each corner moves relative to its peers — an inference, not a manufacturer reading',
      )}
      query={historyQuery}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <LayoutCard title={t('tireDifferentialDrift.kpis', 'Differential drift metrics')}>
          <VehicleSourceContent source={historySource} enabled={vehicleSelected} label={t('tireDifferentialDrift.kpis', 'Differential drift metrics')}>
            {!vehicleSelected && <>
              <EmptyState
                icon={<Car className="h-8 w-8" aria-hidden="true" />}
                title={t('common.noVehicleSelected.title', 'No vehicle selected')}
                message={noVehicleMessage}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: getEmptyStateGuidance('vehicles.list')?.action.to ?? '/onboarding' }}
              />
              <EmptyStateGuidanceDetails guidanceId="vehicles.list" />
            </>}
            <VehicleOperationalBrief embedded id="tire-differential-drift-summary" loading={isLoading}
              title={t('tireDifferentialDrift.kpis', 'Differential drift metrics')}
              available={vehicleSelected && historySource.hasData}
              retained={retained}
              period={{ kind: 'unknown', label: t('tireDifferentialDrift.title', 'Tire differential drift'),
                reason: t('tireDifferentialDrift.brief.scope', 'Returned four-corner pressure history only; fitted leak and imbalance inferences are not manufacturer readings.') }}
              metrics={[
                {
                  metricId: 'text', occurrenceId: 'leak-corner',
                  label: t('tireDifferentialDrift.leakCorner', 'Likely leak corner'),
                  rawValue: hasUsableEvidence ? leakCard ?? t('tireDifferentialDrift.none', 'None detected') : null,
                  description: t('help.tireDifferentialDrift.leakCorner', 'Each corner residual (reading minus the four-tire median) gets its own Theil-Sen slope over time. The corner with the strongest, most pairwise-consistent negative slope — clearing minimum samples, span, and agreement bars — is flagged here. A shared weather swing cancels equally, so it cannot trigger this alone.'),
                  context: <><Search className="h-5 w-5" aria-hidden="true" />{t('tireDifferentialDrift.leakScore', 'evidence score {{score}}', { score: fmtNumber(hasUsableEvidence ? summary.leakScore : null) })}</>,
                },
                {
                  metricId: 'pressure', occurrenceId: 'imbalance',
                  label: t('tireDifferentialDrift.imbalance', 'Structural imbalance'),
                  rawValue: hasUsableEvidence ? summary.imbalancePa / 1000 : null,
                  display: { formatter: raw => ({ value: formatPressure(raw), unit: '' }) },
                  description: t('help.tireDifferentialDrift.imbalance', "The spread between each corner's mean (constant) residual — independent of the leak ranking. A corner permanently offset (e.g. after a wheel swap) shows up here with zero slope, invisible to the leak ranking alone."),
                  context: <><Scale className="h-5 w-5" aria-hidden="true" />{imbalanceCard != null
                    ? t('tireDifferentialDrift.imbalanceCorner', 'largest offset: {{corner}}', { corner: imbalanceCard })
                    : hasUsableEvidence ? t('tireDifferentialDrift.noImbalance', 'corners evenly matched') : '—'}</>,
                },
                {
                  metricId: 'duration', occurrenceId: 'threshold-days',
                  label: t('tireDifferentialDrift.daysToThreshold', 'Days to threshold'),
                  rawValue: hasUsableEvidence && leakDaysToThreshold != null ? leakDaysToThreshold * 86400 : null,
                  display: { formatter: () => ({ value: fmtNumber(leakDaysToThreshold), unit: '' }) },
                  context: <><Gauge className="h-5 w-5" aria-hidden="true" />{t('tireDifferentialDrift.daysToThresholdHint', 'projected from the fitted trend, evidence-gated')}</>,
                },
                {
                  metricId: 'count', occurrenceId: 'usable-samples',
                  label: t('tireDifferentialDrift.samples', 'Samples analyzed'),
                  rawValue: vehicleSelected && historySource.hasData ? summary.usableSamples : null,
                  context: <><Waypoints className="h-5 w-5" aria-hidden="true" />{t('tireDifferentialDrift.samplesHint', '{{span}} day span · {{n}} raw rows', { span: fmtNumber(hasUsableEvidence ? summary.spanDays : null), n: fmtNumber(vehicleSelected && historySource.hasData ? summary.analyzedSamples : null) })}</>,
                },
              ]}
            />
          </VehicleSourceContent>
        </LayoutCard>
      </FadeIn>

      {/* 2 — Residual timeline */}
      <FadeIn delay={0.1}>
          <ChartCard
            title={t('tireDifferentialDrift.residualTimeline', 'Common-mode-removed residuals')}
            subtitle={t('tireDifferentialDrift.residualTimelineHint', "Each corner's deviation from the four-tire median at every sample — shared weather swings cancel out, leaving only relative drift")}
            ariaLabel={t('tireDifferentialDrift.residualTimelineAria', 'Line chart of four tire-corner pressure residuals against the common-mode median over time')}
            chartKey="tire-differential-drift-residuals"
            toolbar exportable size="standard"
            loading={isLoading}
            error={vehicleSelected ? historySource.fatalError : null}
            onRetry={historySource.retry ?? undefined}
            empty={residualSeries.length === 0}
            emptyIcon={<Gauge className="h-8 w-8" aria-hidden="true" />}
            emptyMessage={vehicleSelected ? noDataMessage : noVehicleMessage}
            footer={historySource.hasData && (historySource.refreshError || historySource.isRefreshBlocked)
              ? <VehicleSourceContent source={historySource} enabled={vehicleSelected} label={t('tireDifferentialDrift.residualTimeline', 'Common-mode-removed residuals')}>{null}</VehicleSourceContent>
              : undefined}
            height={340}
            data={residualSeries}
            dataColumns={[
              { key: 'time', label: t('tireDifferentialDrift.col.time', 'Time') },
              { key: 'timestamp', label: t('tireDifferentialDrift.col.timestamp', 'Timestamp (UTC)') },
              { key: 'fl', label: cornerLabel('fl'), format: fmtNumber },
              { key: 'fr', label: cornerLabel('fr'), format: fmtNumber },
              { key: 'rl', label: cornerLabel('rl'), format: fmtNumber },
              { key: 'rr', label: cornerLabel('rr'), format: fmtNumber },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={residualSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit={` ${unitPrefs.pressure}`} tickFormatter={value => fmtNumber(value)} />
                <Tooltip content={<ChartTooltip valueFormatter={value => fmtNumber(value)} />} />
                <ChartLegend state={residualHidden} />
                {TIRE_CORNERS.map((corner) => (
                  <Line
                    key={corner}
                    type="monotone"
                    dataKey={corner}
                    name={cornerLabel(corner)}
                    stroke={CORNER_COLOR[corner]}
                    strokeWidth={2}
                    dot={false}
                    hide={residualHidden.isHidden(corner)}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
      </FadeIn>

      {/* 3 — Per-corner slope ranking */}
      <FadeIn delay={0.2}>
        {/* chart-legend-audit:skip single series (one bar per corner, distinguished by axis category, not stacked/grouped series) */}
        <ChartCard
          title={t('tireDifferentialDrift.slopeRanking', 'Per-corner drift rate')}
          subtitle={t('tireDifferentialDrift.slopeRankingHint', "Theil-Sen slope of each corner's residual, per day — negative means losing pressure relative to the group")}
          ariaLabel={t('tireDifferentialDrift.slopeRankingAria', 'Bar chart of the fitted residual drift rate per day for each tire corner')}
          loading={isLoading}
          toolbar exportable size="standard"
          error={vehicleSelected ? historySource.fatalError : null}
          onRetry={historySource.retry ?? undefined}
          empty={slopeBars.length === 0}
          emptyMessage={vehicleSelected ? t('tireDifferentialDrift.noDrift', 'At least two usable four-corner samples at distinct times are needed to fit a drift rate.') : noVehicleMessage}
          emptyIcon={<Scale className="h-8 w-8" aria-hidden="true" />}
          footer={historySource.hasData && (historySource.refreshError || historySource.isRefreshBlocked)
            ? <VehicleSourceContent source={historySource} enabled={vehicleSelected} label={t('tireDifferentialDrift.slopeRanking', 'Per-corner drift rate')}>{null}</VehicleSourceContent>
            : undefined}
          height={280}
          data={slopeBars}
          dataColumns={[
            { key: 'corner', label: t('tireDifferentialDrift.col.corner', 'Corner') },
            { key: 'slope', label: t('tireDifferentialDrift.col.slopeUnit', 'Slope ({{unit}}/day)', { unit: unitPrefs.pressure }), format: fmtNumber },
            { key: 'confidence', label: t('tireDifferentialDrift.col.confidence', 'Confidence'), format: fmtNumber },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={slopeBars}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="corner" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit={` ${unitPrefs.pressure}/d`} tickFormatter={value => fmtNumber(value)} />
              <Tooltip content={<ChartTooltip valueFormatter={value => fmtNumber(value)} />} />
              <Bar dataKey="slope" name={t('tireDifferentialDrift.col.slope', 'Slope')} radius={[4, 4, 0, 0]}>
                {slopeBars.map((bar) => (
                  <Cell key={bar.key} fill={CORNER_COLOR[bar.key]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </FadeIn>

      {/* 4 — What it means */}
      <FadeIn delay={0.3}>
        <LayoutCard title={t('tireDifferentialDrift.reading', 'Reading this inference')}
          actions={<HelpTooltip
              size="sm"
              i18nKey="help.tireDifferentialDrift.reading"
              defaultValue="Every number here is derived from resampled TPMS residuals, not a manufacturer specification. Leak ranking and structural imbalance are independent read-outs of the same residual series and can disagree — a corner can be offset without drifting, or drifting without ever being the most offset."
              ariaLabel={t('help.tireDifferentialDrift.iconLabel', 'More info about this inference')}
            />}>
          <VehicleSourceContent source={historySource} enabled={vehicleSelected} label={t('tireDifferentialDrift.reading', 'Reading this inference')}>
          {isLoading ? (
            <Skeleton height={140} />
          ) : summary.usableSamples === 0 ? (
            <EmptyState /* no-action: the reading follows from the residual series computed above. */
              icon={<Scale className="h-8 w-8" aria-hidden="true" />}
              message={vehicleSelected ? t('tireDifferentialDrift.noReading', 'The reading appears once at least one usable four-corner sample has been analyzed.') : noVehicleMessage}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {summary.corners.map((c) => (
                <div key={c.corner} className="min-w-0 rounded-shape-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="font-medium">{cornerLabel(c.corner)}</Text>
                    {c.corner === summary.leakCorner ? (
                      <Badge variant="warning">{t('tireDifferentialDrift.suspect', 'Leak suspect')}</Badge>
                    ) : null}
                    {c.corner === summary.imbalanceCorner ? (
                      <Badge variant="info">{t('tireDifferentialDrift.offset', 'Most offset')}</Badge>
                    ) : null}
                  </div>
                  <Text variant="caption" as="p">
                    {t('tireDifferentialDrift.cornerStats', 'slope {{slope}}/day · confidence {{conf}} · mean offset {{offset}}', {
                      slope: formatPressure(c.samples >= 2 ? c.slopePaPerDay / 1000 : null),
                      conf: fmtNumber(c.samples >= 2 ? c.confidence : null),
                      offset: formatPressure(c.meanResidualPa / 1000),
                    })}
                  </Text>
                </div>
              ))}
            </div>
          )}
          </VehicleSourceContent>
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
