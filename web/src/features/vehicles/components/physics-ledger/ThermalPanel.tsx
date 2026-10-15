import type {
  PhysicsLedger
} from '@/api/types';
import { Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { unknownLabel, useT } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DataStatus } from '@/api/dataState';
import { LedgerEvidenceBrief } from '../operationalbrief-n-z/LedgerEvidenceBrief';

export function ThermalPanel({ ledger, status }: { ledger: PhysicsLedger; status?: DataStatus }) {
  const { fmtNumber } = useNumberFormatting();
  const t = useT();
  const { formatTemperature } = useUnits();
  const th = ledger.thermal;
  const temp = (v: number | null | undefined) => (v != null ? formatTemperature(v) : unknownLabel(t));
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-thermal">
      <PanelTitle>{t('physicsLedger.thermal.title', 'Thermal')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {th?.honesty ?? t('physicsLedger.thermal.empty', 'No pack temperature sensors reported in this window.')}
      </Text>
      <LedgerEvidenceBrief ledger={ledger} id="ledger-thermal-summary" status={status}
        available={th != null && !th.unknown} title={t('physicsLedger.thermal.title', 'Thermal')}
        description={th?.honesty ?? t('physicsLedger.thermal.empty', 'No pack temperature sensors reported in this window.')}
        metrics={[
          { metricId: 'temperature', occurrenceId: 'min', label: t('physicsLedger.thermal.packMin', 'Pack min'), rawValue: th?.pack_min_c, display: { formatter: raw => ({ value: temp(raw), unit: '' }) } },
          { metricId: 'temperature', occurrenceId: 'max', label: t('physicsLedger.thermal.packMax', 'Pack max'), rawValue: th?.pack_max_c, display: { formatter: raw => ({ value: temp(raw), unit: '' }) } },
          { metricId: 'temperature', occurrenceId: 'inside', label: t('physicsLedger.thermal.inside', 'Cabin'), rawValue: th?.inside_c, display: { formatter: raw => ({ value: temp(raw), unit: '' }) } },
          { metricId: 'temperature', occurrenceId: 'outside', label: t('physicsLedger.thermal.outside', 'Ambient'), rawValue: th?.outside_c, display: { formatter: raw => ({ value: temp(raw), unit: '' }) } },
          { metricId: 'number', occurrenceId: 'correlation', label: t('physicsLedger.thermal.heatVsPower', 'Heat vs power correlation'), rawValue: th?.heat_vs_power_r, display: { formatter: raw => ({ value: fmtNumber(raw), unit: '' }) } },
        ]} />
      {!th || th.unknown ? (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.thermal.empty', 'No pack temperature sensors reported in this window.')}
        </Text>
      ) : null}
      <Caption>
        {t('physicsLedger.thermal.heatVsPower', 'Heat vs power correlation')}:{' '}
        {th?.heat_vs_power_r != null ? fmtNumber(th.heat_vs_power_r) : unknownLabel(t)}
      </Caption>
    </GlassPanel>
  );
}
