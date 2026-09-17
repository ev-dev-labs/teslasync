import type {
  PhysicsBlackBoxPoint
} from '@/api/types';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { asList, useT } from './helpers';
import { MotionCharts } from './MotionCharts';

export function BlackBoxPanel({ points }: { points?: PhysicsBlackBoxPoint[] | null }) {
  const t = useT();
  const samples = asList(points);
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-blackbox">
      <PanelTitle>{t('physicsLedger.blackBox.title', 'Black box: last 90 s')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {t('physicsLedger.blackBox.honesty', 'Force, pack power, and speed before the window end, from signal_log only.')}
      </Text>
      {samples.length > 1 ? (
        <MotionCharts points={samples} force />
      ) : (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.blackBox.empty', 'Fewer than two samples in the last 90 seconds.')}
        </Text>
      )}
    </GlassPanel>
  );
}
