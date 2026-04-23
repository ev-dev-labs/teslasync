import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useSignalObservations } from '@/api/hooks/useTelemetry';
import { fmtNumber } from '@/lib/numberFormat';

import { latestNumeric } from './signalHelpers';

interface GForcePanelProps {
  vehicleId: number | null | undefined;
}

/**
 * Acceleration G-forces (LateralAcceleration, LongitudinalAcceleration) are
 * cold signals stored in signal_observations per ADR-005. We read the latest
 * observation for each and render a small 2-up panel with magnitude.
 */
export default function GForcePanel({ vehicleId }: GForcePanelProps) {
  const { t } = useTranslation();

  const { data: latObs } = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'LateralAcceleration',
    limit: 1,
  });
  const { data: longObs } = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'LongitudinalAcceleration',
    limit: 1,
  });

  const lateral = latestNumeric(latObs);
  const longitudinal = latestNumeric(longObs);
  const hasAny = lateral != null || longitudinal != null;

  const magnitude =
    lateral != null && longitudinal != null
      ? Math.sqrt(lateral * lateral + longitudinal * longitudinal)
      : null;

  return (
    <FadeIn delay={0.05}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.gForce', 'Acceleration G-Force')}
        </h2>
        {hasAny ? (
          <Grid cols={{ default: 1, sm: 3 }} gap={4}>
            <StatCard
              icon={<Gauge className="h-5 w-5" />}
              label={t('dynamics.lateral', 'Lateral')}
              value={lateral != null ? fmtNumber(lateral, 2) : '—'}
              unit="g"
            />
            <StatCard
              icon={<Gauge className="h-5 w-5" />}
              label={t('dynamics.longitudinal', 'Longitudinal')}
              value={longitudinal != null ? fmtNumber(longitudinal, 2) : '—'}
              unit="g"
            />
            <StatCard
              icon={<Gauge className="h-5 w-5" />}
              label={t('dynamics.combined', 'Combined')}
              value={magnitude != null ? fmtNumber(magnitude, 2) : '—'}
              unit="g"
            />
          </Grid>
        ) : (
          <EmptyState
            message={t('dynamics.gForceNoData', 'No G-force telemetry received yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
