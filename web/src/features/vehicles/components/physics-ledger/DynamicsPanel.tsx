import type {
  PhysicsLedger
} from '@/api/types';
import { Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { asList, unknownLabel, useT } from './helpers';
import { MotionCharts } from './MotionCharts';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DataStatus } from '@/api/dataState';
import { LedgerEvidenceBrief } from '../operationalbrief-n-z/LedgerEvidenceBrief';

export function DynamicsPanel({ ledger, status }: { ledger: PhysicsLedger; status?: DataStatus }) {
  const { fmtNumber } = useNumberFormatting();
  const t = useT();
  const { formatEnergy, formatSpeed } = useUnits();
  const d = ledger.dynamics;
  const points = asList(d?.points);
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-dynamics">
      <PanelTitle>{t('physicsLedger.dynamics.title', 'Longitudinal dynamics')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {d?.honesty ?? t('physicsLedger.dynamics.empty', 'No motion samples were recorded in this window.')}
      </Text>
      <LedgerEvidenceBrief ledger={ledger} id="ledger-dynamics-summary" status={status}
        available={d != null && !d.unknown}
        title={t('physicsLedger.dynamics.title', 'Longitudinal dynamics')}
        description={d?.honesty ?? t('physicsLedger.dynamics.empty', 'No motion samples were recorded in this window.')}
        metrics={[
          { metricId: 'mass', occurrenceId: 'mass', label: t('physicsLedger.massSource', 'mass'), rawValue: d?.mass_kg, display: { formatter: raw => ({ value: `${fmtNumber(raw)} kg`, unit: '' }) }, context: d?.mass_source ?? unknownLabel(t) },
          { metricId: 'energy', occurrenceId: 'regen', label: t('physicsLedger.dynamics.regen', 'Regen'), rawValue: d?.regen_wh, display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
          { metricId: 'energy', occurrenceId: 'friction', label: t('physicsLedger.dynamics.friction', 'Friction brake'), rawValue: d?.friction_brake_wh, display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
        ]} />
      {points.length > 1 ? (
        <MotionCharts points={points} />
      ) : (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.dynamics.empty', 'No motion samples were recorded in this window.')}
        </Text>
      )}
      <Caption>
        {t('physicsLedger.dynamics.speedNote', 'Speed shown in display units')}: {formatSpeed(points[0]?.speed_mps)}
      </Caption>
    </GlassPanel>
  );
}
