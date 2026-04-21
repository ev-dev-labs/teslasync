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

import { useVehicles, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/** Map status string → Badge variant. */
function statusVariant(status?: string): BadgeVariant {
  if (!status) return 'neutral';
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('on')) return 'success';
  if (s.includes('error') || s.includes('fail')) return 'danger';
  if (s.includes('inactive') || s.includes('off')) return 'neutral';
  return 'warning';
}

/** Map stop reason → Badge variant. */
function stopReasonVariant(reason?: string): BadgeVariant {
  if (!reason) return 'neutral';
  const r = reason.toLowerCase();
  if (r === 'none' || r === '') return 'neutral';
  if (r.includes('user')) return 'warning';
  if (r.includes('error') || r.includes('fault') || r.includes('low')) return 'danger';
  return 'warning';
}

export default function PowersharePage() {
  const { t } = useTranslation();
  usePageTitle(t('powershare.title', 'Powershare'));

  const { data: vehicles } = useVehicles();
  const [vehicleIdStr, setVehicleIdStr] = useState<string>('');

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map(v => ({
        value: String(v.id),
        label: v.display_name ?? `Vehicle ${v.id}`,
      })),
    [vehicles],
  );

  // Auto-select first vehicle if none selected
  const effectiveId = vehicleIdStr || vehicleOptions[0]?.value || '';
  const vehicleId = effectiveId ? Number(effectiveId) : 0;

  const { data: telemetry, isLoading, error } = useChargingTelemetryLatest(vehicleId, 10_000);

  const hasData =
    !!telemetry &&
    (telemetry.powershare_status != null ||
      telemetry.powershare_type != null ||
      telemetry.powershare_stop_reason != null ||
      telemetry.powershare_hours_left != null ||
      telemetry.powershare_power_kw != null);

  return (
    <PageContainer
      title={t('powershare.title', 'Powershare')}
      subtitle={t(
        'powershare.subtitle',
        'Monitor your vehicle’s bidirectional power sharing — status, output, remaining runtime, and stop conditions.',
      )}
      loading={isLoading}
      error={error as Error | null}
      actions={
        vehicleOptions.length > 1 ? (
          <Select
            value={effectiveId}
            onChange={e => setVehicleIdStr(e.target.value)}
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
              <h2 className="text-lg font-semibold text-white/90">
                {t('powershare.statusSection', 'Powershare Status')}
              </h2>
            </div>
            {telemetry?.powershare_status ? (
              <Badge variant={statusVariant(telemetry.powershare_status)}>
                {telemetry.powershare_status}
              </Badge>
            ) : (
              <Badge variant="neutral">{t('common.noData', '—')}</Badge>
            )}
          </div>

          {!hasData ? (
            <EmptyState
              icon={<Info className="h-8 w-8" />}
              message={t(
                'powershare.noData',
                'No Powershare data available yet. Values appear once your vehicle reports Powershare telemetry.',
              )}
            />
          ) : (
            <Grid cols={{ default: 1, sm: 2, md: 3 }} gap={4}>
              <StatCard
                label={t('powershare.type', 'Type')}
                value={telemetry?.powershare_type ?? '—'}
                icon={<Home className="h-4 w-4" />}
                sublabel={t('powershare.typeSub', 'Powershare destination')}
              />
              <StatCard
                label={t('powershare.outputPower', 'Output Power')}
                value={
                  telemetry?.powershare_power_kw != null
                    ? fmtNumber(telemetry.powershare_power_kw, 2)
                    : '—'
                }
                unit={telemetry?.powershare_power_kw != null ? 'kW' : undefined}
                icon={<Power className="h-4 w-4" />}
                sublabel={t('powershare.outputPowerSub', 'Instantaneous power draw')}
              />
              <StatCard
                label={t('powershare.hoursLeft', 'Hours Remaining')}
                value={
                  telemetry?.powershare_hours_left != null
                    ? fmtNumber(telemetry.powershare_hours_left, 1)
                    : '—'
                }
                unit={telemetry?.powershare_hours_left != null ? 'h' : undefined}
                icon={<Clock className="h-4 w-4" />}
                sublabel={t(
                  'powershare.hoursLeftSub',
                  'Estimated runtime at current output',
                )}
              />
            </Grid>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Stop reason */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="h-5 w-5 text-rose-400" />
            <h2 className="text-lg font-semibold text-white/90">
              {t('powershare.stopReasonSection', 'Stop Reason')}
            </h2>
          </div>

          {telemetry?.powershare_stop_reason ? (
            <div className="flex items-center gap-3">
              <Badge variant={stopReasonVariant(telemetry.powershare_stop_reason)}>
                {telemetry.powershare_stop_reason}
              </Badge>
              <span className="text-sm text-white/60">
                {t(
                  'powershare.stopReasonHelp',
                  'Last recorded reason Powershare was halted.',
                )}
              </span>
            </div>
          ) : (
            <EmptyState
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
