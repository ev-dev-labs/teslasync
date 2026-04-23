import { useTranslation } from 'react-i18next';

import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

/**
 * Cruise / autopilot telemetry (cruise_set_speed, vehicle_speed) are no longer
 * persisted in the typed MotorSnapshot model after the JSONB-telemetry refactor
 * (ADR-001, migration 000144). The panel shell remains so page layout is
 * unchanged but always renders an EmptyState per the section-rendering rule.
 */
export default function AutopilotSection() {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.17}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.autopilot', 'Autopilot & Cruise')}
        </h2>
        <EmptyState
          message={t(
            'dynamics.autopilotUnavailable',
            'Cruise/autopilot telemetry is not available in the current data model',
          )}
        />
      </GlassPanel>
    </FadeIn>
  );
}
