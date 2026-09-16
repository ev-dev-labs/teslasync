import type {
  PhysicsLedger
} from '@/api/types';
import { Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { unknownLabel, useT } from './helpers';

export function TiresPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatPressure } = useUnits();
  const tr = ledger.tires;
  const corners: Array<[string, number | null]> = [
    [t('physicsLedger.tires.fl', 'Front left'), tr.fl_kpa],
    [t('physicsLedger.tires.fr', 'Front right'), tr.fr_kpa],
    [t('physicsLedger.tires.rl', 'Rear left'), tr.rl_kpa],
    [t('physicsLedger.tires.rr', 'Rear right'), tr.rr_kpa],
  ];
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-tires">
      <PanelTitle>{t('physicsLedger.tires.title', 'Tires')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {tr.honesty}
      </Text>
      {tr.unknown && corners.every(([, v]) => v == null) ? (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.tires.empty', 'No TPMS corners reported in this window.')}
        </Text>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {corners.map(([label, v]) => (
            <div key={label}>
              <Caption>{label}</Caption>
              <Text as="p" size="sm" className="tabular-nums">
                {v != null ? formatPressure(v) : unknownLabel(t)}
              </Text>
            </div>
          ))}
        </div>
      )}
      <Caption>
        {t('physicsLedger.tires.imbalance', 'Imbalance (max − min)')}:{' '}
        {tr.imbalance_kpa != null ? formatPressure(tr.imbalance_kpa) : unknownLabel(t)}
      </Caption>
    </GlassPanel>
  );
}
