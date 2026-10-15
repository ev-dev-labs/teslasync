import type {
  PhysicsLedger
} from '@/api/types';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatEnergyPerDistance } from '@/lib/unitConversion';
import { unknownLabel, useT } from './helpers';
import type { DataStatus } from '@/api/dataState';
import { LedgerEvidenceBrief } from '../operationalbrief-n-z/LedgerEvidenceBrief';

export function RangePanel({ ledger, status }: { ledger: PhysicsLedger; status?: DataStatus }) {
  const t = useT();
  const { formatDistance, formatEnergy, unitPrefs } = useUnits();
  const r = ledger.range;
  const dist = (v: number | null | undefined) => (v != null ? formatDistance(v) : unknownLabel(t));
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-range">
      <PanelTitle>{t('physicsLedger.range.title', 'Range disagreement')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {r?.honesty ?? t('physicsLedger.range.empty', 'No range estimators were recorded in this window.')}
      </Text>
      <LedgerEvidenceBrief ledger={ledger} id="ledger-range-summary" status={status}
        available={r != null && !r.unknown} title={t('physicsLedger.range.title', 'Range disagreement')}
        description={r?.honesty ?? t('physicsLedger.range.empty', 'No range estimators were recorded in this window.')}
        metrics={[
          { metricId: 'distance', occurrenceId: 'rated', label: t('physicsLedger.range.rated', 'Rated'), rawValue: r?.rated_m, display: { formatter: raw => ({ value: dist(raw), unit: '' }) } },
          { metricId: 'distance', occurrenceId: 'typical', label: t('physicsLedger.range.est', 'Typical'), rawValue: r?.est_m, display: { formatter: raw => ({ value: dist(raw), unit: '' }) } },
          { metricId: 'distance', occurrenceId: 'ideal', label: t('physicsLedger.range.ideal', 'Ideal'), rawValue: r?.ideal_m, display: { formatter: raw => ({ value: dist(raw), unit: '' }) } },
          { metricId: 'energy', occurrenceId: 'energy', label: t('physicsLedger.range.energy', 'Energy remaining'), rawValue: r?.energy_wh, display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
          { metricId: 'distance', occurrenceId: 'spread', label: t('physicsLedger.range.spread', 'Spread'), rawValue: r?.spread_m, display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) }, context: r?.disagree ? t('teslaOnly.estimatesDiffer', 'Estimates differ') : t('teslaOnly.noDetectedDifference', 'No detected difference in available estimates') },
          { metricId: 'efficiency', occurrenceId: 'implied', label: t('physicsLedger.range.implied', 'Implied'), rawValue: r?.implied_wh_per_m, display: { formatter: raw => ({ value: formatEnergyPerDistance(raw, unitPrefs), unit: '' }) } },
        ]} />
    </GlassPanel>
  );
}
