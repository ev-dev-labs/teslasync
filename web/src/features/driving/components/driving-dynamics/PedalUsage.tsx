import { useTranslation } from 'react-i18next';
import { Footprints } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useDriveDynamicsLatest } from '@/api/hooks/useVehicles';
import { INTERVALS } from '@/lib/constants';

interface PedalUsageProps {
  vehicleId: number | null | undefined;
}

/**
 * Pedal telemetry (PedalPosition, BrakePedalPos, BrakePedal).
 *
 * These signals used to come from the removed `signal_observations` route;
 * stale callers 404'd silently and left this panel in a permanent
 * "No pedal telemetry received yet" empty state.
 *
 * Today all 3 signals flow through per-field MQTT to the L1 live cache
 * (mirrored to L2 / Redis with a `signal_log` fallback). We read the
 * latest projected snapshot via `useDriveDynamicsLatest` and render
 * the original throttle / brake / brake-active 3-up gauge layout.
 */
export default function PedalUsage({ vehicleId }: PedalUsageProps) {
  const { t } = useTranslation();

  const { data } = useDriveDynamicsLatest(vehicleId ?? 0, INTERVALS.REALTIME);

  const throttle = typeof data?.pedal_position === 'number' ? data.pedal_position : null;
  const brakePos = typeof data?.brake_pedal_position === 'number' ? data.brake_pedal_position : null;
  const brakeActive = typeof data?.brake_pedal_active === 'boolean' ? data.brake_pedal_active : null;

  const hasAny = throttle != null || brakePos != null || brakeActive != null;

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
          {t('dynamics.pedalUsage', 'Pedal Usage')}
        </h2>
        {hasAny ? (
          <Grid cols={{ default: 1, sm: 3 }} gap={6}>
            <div className="flex flex-col items-center gap-2">
              <RadialGauge
                value={throttle ?? 0}
                max={100}
                label={t('dynamics.throttle', 'Throttle')}
                unit={throttle != null ? '%' : '—'}
                color="#06b6d4"
                size={140}
              />
              <span className="text-xs text-[var(--text-secondary)]">
                {t('dynamics.throttlePosition', 'Throttle Position')}
              </span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <RadialGauge
                value={brakePos ?? 0}
                max={100}
                label={t('dynamics.brake', 'Brake')}
                unit={brakePos != null ? '%' : '—'}
                color="#ef4444"
                size={140}
              />
              <span className="text-xs text-[var(--text-secondary)]">
                {t('dynamics.brakePedalPosition', 'Brake Pedal Position')}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center gap-3">
              <Footprints className="h-8 w-8 text-[var(--text-muted)]" />
              <Badge
                variant={brakeActive ? 'danger' : 'success'}
                size="lg"
              >
                {brakeActive
                  ? t('dynamics.brakeActive', 'Brake Active')
                  : t('dynamics.brakeInactive', 'Brake Inactive')}
              </Badge>
              <span className="text-xs text-[var(--text-secondary)]">
                {t('dynamics.brakePedal', 'Brake Pedal Status')}
              </span>
            </div>
          </Grid>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t('dynamics.pedalNoData', 'No pedal telemetry received yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
