import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Lightbulb, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';

import { MetricBar, MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { CHART_COLORS } from '@/components/charts';
import { useDriveDynamicsLatest, useMotorLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { INTERVALS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';

import {
  interpretGrokDynamics,
  type GrokFindingId,
  type GrokMode,
  type GrokTone,
} from './grokDynamics';

interface GrokDynamicsBriefingProps {
  vehicleId: number | null | undefined;
}

const TONE_ICON: Record<GrokTone, LucideIcon> = {
  info: Lightbulb,
  positive: ShieldCheck,
  caution: AlertTriangle,
};

const TONE_ICON_CLASS: Record<GrokTone, string> = {
  info: 'text-sky-300',
  positive: 'text-emerald-300',
  caution: 'text-amber-300',
};

const MODE_BADGE: Record<GrokMode, 'neutral' | 'info' | 'success' | 'warning'> = {
  unknown: 'neutral',
  parked: 'neutral',
  idle: 'info',
  regen: 'success',
  blended_brake: 'warning',
  launch: 'info',
  cornering: 'info',
  drive: 'success',
};

/**
 * Grok's live Tesla powertrain briefing for /driving-dynamics.
 *
 * Reads the same live motor + drive-dynamics snapshots as the cockpit
 * gauges, then says what the axles, pedals, and accelerometer are doing
 * in plain Tesla language. Unknown stays unknown.
 */
export default function GrokDynamicsBriefing({ vehicleId }: GrokDynamicsBriefingProps) {
  const { t } = useTranslation();
  const { formatPower, formatTemperature } = useUnits();

  const motorQuery = useMotorLatest(vehicleId ?? 0, INTERVALS.REALTIME);
  const dynamicsQuery = useDriveDynamicsLatest(vehicleId ?? 0, INTERVALS.REALTIME);

  const handleRetry = useCallback(() => {
    void motorQuery.refetch();
    void dynamicsQuery.refetch();
  }, [dynamicsQuery, motorQuery]);

  const read = useMemo(
    () => interpretGrokDynamics(motorQuery.data, dynamicsQuery.data),
    [dynamicsQuery.data, motorQuery.data],
  );

  const headline = headlineFor(read.mode, t);
  const modeLabel = modeLabelFor(read.mode, t);

  const isLoading = (motorQuery.isLoading || dynamicsQuery.isLoading) && !read.hasSignal;
  const isError = (motorQuery.isError || dynamicsQuery.isError) && !read.hasSignal;

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="grok-dynamics-briefing">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('dynamics.grok.title', "Grok's powertrain read")}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-4">
        {t(
          'dynamics.grok.honesty',
          'Interpreted from live motor, pedal, and accelerometer signals. Not Autopilot, not the chassis controller, and not a 0–60 claim.',
        )}
      </Text>

      {isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('dynamics.grok.loading', 'Loading Grok powertrain read…')}
        >
          <Skeleton className="mb-3 h-8 w-2/3" />
          <Skeleton className="h-28" />
        </div>
      ) : isError ? (
        <QueryError
          error={motorQuery.error ?? dynamicsQuery.error}
          onRetry={handleRetry}
        />
      ) : !read.hasSignal ? (
        <EmptyState
          icon={<Sparkles className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'dynamics.grok.empty',
            'Drive the car so Grok can read axle torque, regen, and chassis g.',
          )}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={MODE_BADGE[read.mode]} size="sm">
              {modeLabel}
            </Badge>
            <Text as="p" variant="bodySm">
              {headline}
            </Text>
          </div>

          <Grid cols={{ default: 1, sm: 2, xl: 4 }} gap={4}>
            <MetricCard
              wrapLabel
              color="cyan"
              label={t('dynamics.grok.drivePower', 'Drive power')}
              value={read.drivePowerW == null ? '—' : formatPower(read.drivePowerW, { precision: 1 })}
            />
            <MetricCard
              wrapLabel
              color="green"
              label={t('dynamics.grok.regenPower', 'Regen harvest')}
              value={read.regenPowerW == null ? '—' : formatPower(read.regenPowerW, { precision: 1 })}
            />
            <MetricCard
              wrapLabel
              color="purple"
              label={t('dynamics.grok.torque', 'Axle torque')}
              value={read.torqueTotalNm == null ? '—' : `${fmtNumber(read.torqueTotalNm, 0)} Nm`}
            />
            <MetricCard
              wrapLabel
              color="amber"
              label={t('dynamics.grok.combinedG', 'Combined g')}
              value={read.combinedG == null ? '—' : `${fmtNumber(read.combinedG, 2)} g`}
            />
          </Grid>

          {read.rearTorqueSharePct != null ? (
            <MetricBar
              label={t('dynamics.grok.rearShare', 'Rear axle share')}
              value={read.rearTorqueSharePct}
              max={100}
              color={CHART_COLORS[0]}
              sublabel={t('dynamics.grok.rearShareValue', '{{value}}% of |torque|', {
                value: fmtNumber(read.rearTorqueSharePct, 0),
              })}
            />
          ) : (
            <Text as="p" variant="caption">
              {t(
                'dynamics.grok.rearShareUnknown',
                'AWD split unknown — both axles have not reported torque yet.',
              )}
            </Text>
          )}

          {read.maxMotorTempC != null ? (
            <Text as="p" variant="caption">
              {t('dynamics.grok.thermal', 'Hottest stator/inverter {{temp}} · {{band}}', {
                temp: formatTemperature(read.maxMotorTempC, { precision: 0 }),
                band: thermalBand(read.thermal, t),
              })}
            </Text>
          ) : (
            <Text as="p" variant="caption">
              {t('dynamics.grok.thermalUnknown', 'Motor thermal envelope not reported yet.')}
            </Text>
          )}

          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {read.findings.map((finding) => {
              const Icon = TONE_ICON[finding.tone];
              return (
                <li
                  key={finding.id}
                  data-finding={finding.id}
                  className={cn(
                    'flex items-start gap-3 rounded-lg p-3',
                    'bg-white/[0.03] border border-white/[0.06]',
                  )}
                >
                  <Icon
                    className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_ICON_CLASS[finding.tone])}
                    aria-hidden="true"
                  />
                  <Text as="p" variant="bodySm">
                    {findingText(finding.id, read, t, formatTemperature)}
                  </Text>
                </li>
              );
            })}
          </ul>

          <Link
            to="/physics-cockpit"
            className="text-sm text-cyan-300 underline-offset-2 hover:underline"
          >
            {t('dynamics.grok.cockpit', 'Open Tesla physics cockpit')}
          </Link>
        </div>
      )}
    </GlassPanel>
  );
}

function headlineFor(mode: GrokMode, t: (key: string, fallback: string) => string): string {
  switch (mode) {
    case 'parked':
      return t('dynamics.grok.headline.parked', 'Parked. Axles are waiting, not working.');
    case 'idle':
      return t('dynamics.grok.headline.idle', 'In gear, but the motors are barely loaded.');
    case 'regen':
      return t('dynamics.grok.headline.regen', 'Motors are charging the pack — that is free range.');
    case 'blended_brake':
      return t('dynamics.grok.headline.blended', 'Friction brake is in. Regen is sharing the stop.');
    case 'launch':
      return t('dynamics.grok.headline.launch', 'High request, high torque. This is a launch, not a cruise.');
    case 'cornering':
      return t('dynamics.grok.headline.cornering', 'Chassis is seeing real lateral g. Keep inputs smooth.');
    case 'drive':
      return t('dynamics.grok.headline.drive', 'Dual-motor Tesla doing dual-motor things.');
    default:
      return t('dynamics.grok.headline.unknown', 'Not enough live signals to call the play.');
  }
}

function modeLabelFor(mode: GrokMode, t: (key: string, fallback: string) => string): string {
  switch (mode) {
    case 'parked':
      return t('dynamics.grok.mode.parked', 'Park');
    case 'idle':
      return t('dynamics.grok.mode.idle', 'Idle');
    case 'regen':
      return t('dynamics.grok.mode.regen', 'Regen');
    case 'blended_brake':
      return t('dynamics.grok.mode.blended', 'Blended brake');
    case 'launch':
      return t('dynamics.grok.mode.launch', 'Launch');
    case 'cornering':
      return t('dynamics.grok.mode.cornering', 'Cornering');
    case 'drive':
      return t('dynamics.grok.mode.drive', 'Drive');
    default:
      return t('dynamics.grok.mode.unknown', 'Unknown');
  }
}

function thermalBand(
  thermal: 'unknown' | 'cool' | 'warm' | 'hot',
  t: (key: string, fallback: string) => string,
): string {
  if (thermal === 'hot') return t('dynamics.grok.band.hot', 'hot — ease sustained power');
  if (thermal === 'warm') return t('dynamics.grok.band.warm', 'warm cruise band');
  if (thermal === 'cool') return t('dynamics.grok.band.cool', 'cool');
  return t('dynamics.grok.band.unknown', 'unknown');
}

function findingText(
  id: GrokFindingId,
  read: ReturnType<typeof interpretGrokDynamics>,
  t: (key: string, fallback: string, values?: Record<string, unknown>) => string,
  formatTemperature: (value: number | null, options?: { precision?: number }) => string,
): string {
  switch (id) {
    case 'parked':
      return t('dynamics.grok.find.parked', 'Shift state is Park. Treat torque as residual, not a pull.');
    case 'idle':
      return t('dynamics.grok.find.idle', 'Throttle is quiet and axle torque is near zero. Coast or crawl.');
    case 'regen_harvest':
      return t('dynamics.grok.find.regen', 'Negative axle torque / pack-bound power — one-pedal harvest.');
    case 'one_pedal':
      return t('dynamics.grok.find.onePedal', 'Brake switch is off while motors regen. That is one-pedal Tesla.');
    case 'blended_brake':
      return t('dynamics.grok.find.blended', 'Hydraulic brake is active during regen. Pads are sharing the stop.');
    case 'launch':
      return t('dynamics.grok.find.launch', 'Pedal and torque are both in the launch neighborhood.');
    case 'drive':
      return t('dynamics.grok.find.drive', 'Positive torque on the axles. This is propulsion, not theater.');
    case 'cornering':
      return t(
        'dynamics.grok.find.cornering',
        'Lateral accelerometer {{g}} g. That is chassis load, not a grip percentage.',
        { g: read.lateralG == null ? '—' : fmtNumber(Math.abs(read.lateralG), 2) },
      );
    case 'awd_rear':
      return t(
        'dynamics.grok.find.awdRear',
        'Rear axle is carrying {{share}}% of |torque|. Typical Tesla drive bias — measured, not assumed.',
        { share: fmtNumber(read.rearTorqueSharePct ?? 0, 0) },
      );
    case 'awd_front':
      return t(
        'dynamics.grok.find.awdFront',
        'Front axle is carrying more of |torque| (rear {{share}}%). Often regen or low-traction split.',
        { share: fmtNumber(read.rearTorqueSharePct ?? 0, 0) },
      );
    case 'awd_balanced':
      return t(
        'dynamics.grok.find.awdBalanced',
        'Axles are sharing |torque| nearly evenly (rear {{share}}%).',
        { share: fmtNumber(read.rearTorqueSharePct ?? 0, 0) },
      );
    case 'thermal_hot':
      return t(
        'dynamics.grok.find.thermalHot',
        'Hottest motor/inverter {{temp}}. Near derate — stop asking for sustained peak.',
        { temp: formatTemperature(read.maxMotorTempC, { precision: 0 }) },
      );
    case 'thermal_warm':
      return t(
        'dynamics.grok.find.thermalWarm',
        'Hottest motor/inverter {{temp}}. Normal after a hard pull, not an emergency.',
        { temp: formatTemperature(read.maxMotorTempC, { precision: 0 }) },
      );
  }
}
