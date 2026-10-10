import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Lightbulb, ShieldCheck, Activity, type LucideIcon } from 'lucide-react';

import { MetricBar } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
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
  type GrokTone,
} from './grokDynamics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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

/**
 * Grok's live Tesla powertrain briefing for /driving-dynamics.
 *
 * Reads the same live motor + drive-dynamics snapshots as the cockpit
 * gauges, then says what the axles, pedals, and accelerometer are doing
 * in plain Tesla language. Unknown stays unknown.
 */
export default function GrokDynamicsBriefing({ vehicleId }: GrokDynamicsBriefingProps) {
  const { fmtNumber } = useNumberFormatting();
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

  const isLoading = (motorQuery.isLoading || dynamicsQuery.isLoading) && !read.hasSignal;
  const isError = (motorQuery.isError || dynamicsQuery.isError) && !read.hasSignal;
  const hasBothAxles = Number.isFinite(motorQuery.data?.torque_nm_front)
    && Number.isFinite(motorQuery.data?.torque_nm_rear);
  const findings = read.findings.filter((finding) => hasBothAxles || !finding.id.startsWith('awd_'));
  const metrics: StatMetric[] = [
    { metricId: 'power', occurrenceId: 'drive-power', rawValue: read.drivePowerW,
      label: t('dynamics.grok.drivePower', 'Drive power'),
      display: { formatter: raw => ({ value: formatPower(raw), unit: '' }) } },
    { metricId: 'power', occurrenceId: 'regen-power', rawValue: read.regenPowerW,
      label: t('dynamics.grok.regenPower', 'Regen harvest'),
      display: { formatter: raw => ({ value: formatPower(raw), unit: '' }) } },
    { metricId: 'number', occurrenceId: 'axle-torque', rawValue: read.torqueTotalNm,
      label: t('dynamics.grok.torque', 'Axle torque'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'Nm' }) } },
    { metricId: 'number', occurrenceId: 'combined-g', rawValue: read.combinedG,
      label: t('dynamics.grok.combinedG', 'Combined g'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'g' }) } },
  ];

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="grok-dynamics-briefing">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--theme-primary)]" aria-hidden="true" />
        {t('dynamics.liveInterpretation.title', 'Live powertrain interpretation')}
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
          aria-label={t('dynamics.liveInterpretation.loading', 'Loading current powertrain signals…')}
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
        <EmptyState /* no-action: informational empty — no CTA */
          icon={<Activity className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'dynamics.liveInterpretation.empty',
            'No current axle torque, regen, or acceleration signals reported.',
          )}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" size="sm">
              {t('dynamics.liveInterpretation.scope', 'Latest vehicle signals')}
            </Badge>
            <Text as="p" variant="bodySm">
              {t('dynamics.liveInterpretation.limits', 'Observed values only — not a launch, grip, thermal-health, or selected-trip assessment.')}
            </Text>
          </div>

          <NestedDrivingBrief metrics={metrics}
            title={t('dynamics.brief.liveQuantities', 'Reported powertrain quantities')}
            description={t('dynamics.grok.honesty', 'Interpreted from live motor, pedal, and accelerometer signals. Not Autopilot, not the chassis controller, and not a 0–60 claim.')}
            retained={motorQuery.isError || dynamicsQuery.isError}
            period={{ kind: 'unknown',
              label: t('dynamics.liveInterpretation.scope', 'Latest vehicle signals'),
              reason: t('dynamics.liveInterpretation.limits', 'Observed values only — not a launch, grip, thermal-health, or selected-trip assessment.') }} />

          {hasBothAxles && read.rearTorqueSharePct != null ? (
            <MetricBar
              label={t('dynamics.grok.rearShare', 'Rear axle share')}
              value={read.rearTorqueSharePct}
              max={100}
              color={CHART_COLORS[0]}
              sublabel={t('dynamics.grok.rearShareValue', '{{value}}% of |torque|', {
                value: fmtNumber(read.rearTorqueSharePct),
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
              {t('dynamics.liveInterpretation.thermal', 'Hottest reported stator/inverter {{temp}}. Thermal limiting has not been established.', {
                temp: formatTemperature(read.maxMotorTempC),
              })}
            </Text>
          ) : (
            <Text as="p" variant="caption">
              {t('dynamics.grok.thermalUnknown', 'Motor thermal envelope not reported yet.')}
            </Text>
          )}

          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {findings.map((finding) => {
              const Icon = TONE_ICON.info;
              return (
                <li
                  key={finding.id}
                  data-finding={finding.id}
                  className={cn(
                    'flex items-start gap-3 rounded-lg p-3',
                    'bg-[var(--surface-2)] border border-[var(--border-default)]',
                  )}
                >
                  <Icon
                    className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_ICON_CLASS.info)}
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

function findingText(
  id: GrokFindingId,
  read: ReturnType<typeof interpretGrokDynamics>,
  t: (key: string, fallback: string, values?: Record<string, unknown>) => string,
  formatTemperature: (value: number | null, options?: { precision?: number }) => string,
): string {
  switch (id) {
    case 'parked':
      return t('dynamics.liveInterpretation.parked', 'The latest reported shift state is Park; this is current vehicle context.');
    case 'idle':
      return t('dynamics.liveInterpretation.load', 'Axle torque is a reported motor measurement, not a driver rating or a claim about vehicle motion.');
    case 'regen_harvest':
      return t('dynamics.liveInterpretation.regen', 'Regeneration is reported in current motor signals. Peak power does not establish recovered trip energy.');
    case 'one_pedal':
      return t('dynamics.liveInterpretation.brakeOff', 'The brake switch reports inactive alongside regeneration signals.');
    case 'blended_brake':
      return t('dynamics.liveInterpretation.brakeOn', 'The brake switch reports active alongside regeneration signals. Friction-brake force is not measured here.');
    case 'launch':
      return t('dynamics.liveInterpretation.pedal', 'Pedal and axle torque signals are present. They do not establish launch performance.');
    case 'drive':
      return t('dynamics.liveInterpretation.load', 'Axle torque is a reported motor measurement, not a driver rating or a claim about vehicle motion.');
    case 'cornering':
      return t(
        'dynamics.grok.find.cornering',
        'Lateral accelerometer {{g}} g. That is chassis load, not a grip percentage.',
        { g: read.lateralG == null ? '—' : fmtNumber(Math.abs(read.lateralG)) },
      );
    case 'awd_rear':
      return t(
        'dynamics.liveInterpretation.axleShare',
        'Rear axle accounts for {{share}}% of reported absolute axle torque. This does not establish traction or grip.',
        { share: fmtNumber(read.rearTorqueSharePct ?? 0) },
      );
    case 'awd_front':
      return t(
        'dynamics.liveInterpretation.axleShare',
        'Rear axle accounts for {{share}}% of reported absolute axle torque. This does not establish traction or grip.',
        { share: fmtNumber(read.rearTorqueSharePct ?? 0) },
      );
    case 'awd_balanced':
      return t(
        'dynamics.liveInterpretation.axleShare',
        'Rear axle accounts for {{share}}% of reported absolute axle torque. This does not establish traction or grip.',
        { share: fmtNumber(read.rearTorqueSharePct ?? 0) },
      );
    case 'thermal_hot':
      return t(
        'dynamics.liveInterpretation.thermal',
        'Hottest reported stator/inverter {{temp}}. Thermal limiting has not been established.',
        { temp: formatTemperature(read.maxMotorTempC) },
      );
    case 'thermal_warm':
      return t(
        'dynamics.liveInterpretation.thermal',
        'Hottest reported stator/inverter {{temp}}. Thermal limiting has not been established.',
        { temp: formatTemperature(read.maxMotorTempC) },
      );
  }
}
