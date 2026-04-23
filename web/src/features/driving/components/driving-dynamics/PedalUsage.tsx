import { useTranslation } from 'react-i18next';

import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

/**
 * Pedal position and brake-pedal telemetry are not persisted in the typed
 * MotorSnapshot model after the JSONB-telemetry refactor (ADR-001,
 * migration 000144). The panel shell remains so page layout is unchanged but
 * always renders an EmptyState per the section-rendering rule.
 */
export default function PedalUsage() {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.pedalUsage', 'Pedal Usage')}
        </h2>
        <EmptyState
          message={t(
            'dynamics.pedalUnavailable',
            'Pedal telemetry is not available in the current data model',
          )}
        />
      </GlassPanel>
    </FadeIn>
  );
}
