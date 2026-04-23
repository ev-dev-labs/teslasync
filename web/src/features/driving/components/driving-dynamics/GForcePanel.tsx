import { useTranslation } from 'react-i18next';

import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

/**
 * G-Force data (lateral_accel / longitudinal_accel) is no longer persisted in
 * the typed MotorSnapshot model after the JSONB-telemetry refactor (ADR-001,
 * migration 000144). The panel shell remains so page layout is unchanged but
 * always renders an EmptyState per the section-rendering rule.
 */
export default function GForcePanel() {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.05}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.gForce', 'Acceleration G-Force')}
        </h2>
        <EmptyState
          message={t(
            'dynamics.gForceUnavailable',
            'G-force telemetry is not available in the current data model',
          )}
        />
      </GlassPanel>
    </FadeIn>
  );
}
