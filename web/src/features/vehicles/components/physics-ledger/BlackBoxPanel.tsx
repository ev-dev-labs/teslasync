import type {
  PhysicsBlackBoxPoint
} from '@/api/types';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useT } from './helpers';
import { MotionCharts } from './MotionCharts';

export function BlackBoxPanel({ points }: { points: PhysicsBlackBoxPoint[] }) {
  const t = useT();
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-blackbox">
      <PanelTitle>{t('physicsLedger.blackBox.title', 'Black box: last 90 s')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {t('physicsLedger.blackBox.honesty', 'Force, pack power, and speed before the window end, from signal_log only.')}
      </Text>
      {points.length > 1 ? (
        <MotionCharts points={points} force />
      ) : (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.blackBox.empty', 'Fewer than two samples in the last 90 seconds.')}
        </Text>
      )}
    </GlassPanel>
  );
}
