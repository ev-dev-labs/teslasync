import type {
  PhysicsLedger
} from '@/api/types';
import { Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { unknownLabel, useT } from './helpers';
import type { DataStatus } from '@/api/dataState';
import { LedgerEvidenceBrief } from '../operationalbrief-n-z/LedgerEvidenceBrief';

export function TiresPanel({ ledger, status }: { ledger: PhysicsLedger; status?: DataStatus }) {
  const t = useT();
  const { formatPressure } = useUnits();
  const tr = ledger.tires;
  const corners: Array<[string, string, number | null | undefined]> = [
    ['fl', t('physicsLedger.tires.fl', 'Front left'), tr?.fl_kpa],
    ['fr', t('physicsLedger.tires.fr', 'Front right'), tr?.fr_kpa],
    ['rl', t('physicsLedger.tires.rl', 'Rear left'), tr?.rl_kpa],
    ['rr', t('physicsLedger.tires.rr', 'Rear right'), tr?.rr_kpa],
  ];
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-tires">
      <PanelTitle>{t('physicsLedger.tires.title', 'Tires')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {tr?.honesty ?? t('physicsLedger.tires.empty', 'No TPMS corners reported in this window.')}
      </Text>
      <LedgerEvidenceBrief ledger={ledger} id="ledger-tires-summary" status={status}
        available={tr != null && !tr.unknown} title={t('physicsLedger.tires.title', 'Tires')}
        description={tr?.honesty ?? t('physicsLedger.tires.empty', 'No TPMS corners reported in this window.')}
        metrics={[
          ...corners.map(([corner, label, value]): import('@/components/data-display').StatMetric => ({ metricId: 'pressure', occurrenceId: corner, label, rawValue: value, display: { formatter: raw => ({ value: formatPressure(raw), unit: '' }) } })),
          { metricId: 'pressure', occurrenceId: 'imbalance', label: t('physicsLedger.tires.imbalance', 'Imbalance (max − min)'), rawValue: tr?.imbalance_kpa, display: { formatter: raw => ({ value: formatPressure(raw), unit: '' }) } },
        ]} />
      {!tr || tr.unknown && corners.every(([, , v]) => v == null) ? (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.tires.empty', 'No TPMS corners reported in this window.')}
        </Text>
      ) : null}
      <Caption>
        {t('physicsLedger.tires.imbalance', 'Imbalance (max − min)')}:{' '}
        {tr?.imbalance_kpa != null ? formatPressure(tr.imbalance_kpa) : unknownLabel(t)}
      </Caption>
    </GlassPanel>
  );
}
