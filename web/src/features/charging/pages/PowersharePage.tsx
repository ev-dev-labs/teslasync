import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Power, Clock, Home, AlertCircle, Info } from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Select } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { latestNumeric, latestText } from '@/lib/signalObservation';

import { useVehicles } from '@/api/hooks/useVehicles';
import { useSignalObservations } from '@/api/hooks/useTelemetry';
import type { BadgeVariant } from '@/types/fsm';

/** Map status string → Badge variant. */
function statusVariant(status: string | null): BadgeVariant {
  if (!status) return 'neutral';
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('on')) return 'success';
  if (s.includes('error') || s.includes('fail')) return 'danger';
  if (s.includes('inactive') || s.includes('off')) return 'neutral';
  return 'warning';
}

/** Map stop reason → Badge variant. */
function stopReasonVariant(reason: string | null): BadgeVariant {
  if (!reason) return 'neutral';
  const r = reason.toLowerCase();
  if (r === 'none' || r === '') return 'neutral';
  if (r.includes('user')) return 'warning';
  if (r.includes('error') || r.includes('fault') || r.includes('low')) return 'danger';
  return 'warning';
}

/**
 * Powershare telemetry comes from 5 cold signals in signal_observations per
 * ADR-005 (typed-only hot schema; everything else → signal_observations):
 *   PowershareStatus, PowershareType, PowershareStopReason,
 *   PowershareHoursLeft, PowershareInstantaneousPowerKW.
 */
export default function PowersharePage() {
  const { t } = useTranslation();
  usePageTitle(t('powershare.title', 'Powershare'));

  const { data: vehicles } = useVehicles();
  const [vehicleIdStr, setVehicleIdStr] = useState<string>('');

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name ?? `Vehicle ${v.id}`,
      })),
    [vehicles],
  );

  const effectiveId = vehicleIdStr || vehicleOptions[0]?.value || '';
  const vehicleId = effectiveId ? Number(effectiveId) : undefined;

  const { data: statusObs } = useSignalObservations(vehicleId, {
    signal_name: 'PowershareStatus',
    limit: 1,
  });
  const { data: typeObs } = useSignalObservations(vehicleId, {
    signal_name: 'PowershareType',
    limit: 1,
  });
  const { data: stopObs } = useSignalObservations(vehicleId, {
    signal_name: 'PowershareStopReason',
    limit: 1,
  });
  const { data: hoursObs } = useSignalObservations(vehicleId, {
    signal_name: 'PowershareHoursLeft',
    limit: 1,
  });
  const { data: powerObs } = useSignalObservations(vehicleId, {
    signal_name: 'PowershareInstantaneousPowerKW',
    limit: 1,
  });

  const status = latestText(statusObs);
  const shareType = latestText(typeObs);
  const stopReason = latestText(stopObs);
  const hoursLeft = latestNumeric(hoursObs);
  const powerKw = latestNumeric(powerObs);

  const hasData =
    status != null ||
    shareType != null ||
    stopReason != null ||
    hoursLeft != null ||
    powerKw != null;

  return (
    <PageContainer
      title={t('powershare.title', 'Powershare')}
      subtitle={t(
        'powershare.subtitle',
        'Monitor your vehicle’s bidirectional power sharing — status, output, remaining runtime, and stop conditions.',
      )}
      actions={
        vehicleOptions.length > 1 ? (
          <Select
            value={effectiveId}
            onChange={(e) => setVehicleIdStr(e.target.value)}
            options={vehicleOptions}
            aria-label={t('powershare.selectVehicle', 'Select vehicle')}
          />
        ) : null
      }
    >
      {/* Status row */}
      <FadeIn>
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                {t('powershare.statusSection', 'Powershare Status')}
              </h2>
            </div>
            {status ? (
              <Badge variant={statusVariant(status)}>{status}</Badge>
            ) : (
              <Badge variant="neutral">{t('common.noData', '—')}</Badge>
            )}
          </div>

          {hasData ? (
            <Grid cols={{ default: 1, sm: 2, md: 3 }} gap={4}>
              <StatCard
                label={t('powershare.type', 'Type')}
                value={shareType ?? '—'}
                icon={<Home className="h-4 w-4" />}
                sublabel={t('powershare.typeSub', 'Powershare destination')}
              />
              <StatCard
                label={t('powershare.outputPower', 'Output Power')}
                value={powerKw != null ? fmtNumber(powerKw, 2) : '—'}
                unit={powerKw != null ? 'kW' : undefined}
                icon={<Power className="h-4 w-4" />}
                sublabel={t('powershare.outputPowerSub', 'Instantaneous power draw')}
              />
              <StatCard
                label={t('powershare.hoursLeft', 'Hours Remaining')}
                value={hoursLeft != null ? fmtNumber(hoursLeft, 1) : '—'}
                unit={hoursLeft != null ? 'h' : undefined}
                icon={<Clock className="h-4 w-4" />}
                sublabel={t(
                  'powershare.hoursLeftSub',
                  'Estimated runtime at current output',
                )}
              />
            </Grid>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Info className="h-8 w-8" />}
              message={t(
                'powershare.noData',
                'No Powershare data received yet. Values appear once your vehicle reports Powershare telemetry.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Stop reason */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="h-5 w-5 text-rose-400" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {t('powershare.stopReasonSection', 'Stop Reason')}
            </h2>
          </div>

          {stopReason ? (
            <div className="flex items-center gap-3">
              <Badge variant={stopReasonVariant(stopReason)}>{stopReason}</Badge>
              <span className="text-sm text-[var(--text-secondary)]">
                {t(
                  'powershare.stopReasonHelp',
                  'Last recorded reason Powershare was halted.',
                )}
              </span>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Info className="h-8 w-8" />}
              message={t(
                'powershare.noStopReason',
                'No stop reason recorded. Powershare has not been halted, or the signal has not yet been reported.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
