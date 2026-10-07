import type {
  PhysicsLedger
} from '@/api/types';
import { Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { unknownLabel, useT } from './helpers';

export function ThermalPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatTemperature } = useUnits();
  const th = ledger.thermal;
  const temp = (v: number | null | undefined) => (v != null ? formatTemperature(v) : unknownLabel(t));
  if (!th) {
    return (
      <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-thermal">
        <PanelTitle>{t('physicsLedger.thermal.title', 'Thermal')}</PanelTitle>
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.thermal.empty', 'No pack temperature sensors reported in this window.')}
        </Text>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-thermal">
      <PanelTitle>{t('physicsLedger.thermal.title', 'Thermal')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {th.honesty}
      </Text>
      {th.unknown ? (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.thermal.empty', 'No pack temperature sensors reported in this window.')}
        </Text>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <Caption>{t('physicsLedger.thermal.packMin', 'Pack min')}</Caption>
            <Text as="p" size="sm" className="tabular-nums">
              {temp(th.pack_min_c)}
            </Text>
          </div>
          <div>
            <Caption>{t('physicsLedger.thermal.packMax', 'Pack max')}</Caption>
            <Text as="p" size="sm" className="tabular-nums">
              {temp(th.pack_max_c)}
            </Text>
          </div>
          <div>
            <Caption>{t('physicsLedger.thermal.inside', 'Cabin')}</Caption>
            <Text as="p" size="sm" className="tabular-nums">
              {temp(th.inside_c)}
            </Text>
          </div>
          <div>
            <Caption>{t('physicsLedger.thermal.outside', 'Ambient')}</Caption>
            <Text as="p" size="sm" className="tabular-nums">
              {temp(th.outside_c)}
            </Text>
          </div>
        </div>
      )}
      <Caption>
        {t('physicsLedger.thermal.heatVsPower', 'Heat vs power correlation')}:{' '}
        {th.heat_vs_power_r != null ? fmtNumber(th.heat_vs_power_r, 2) : unknownLabel(t)}
      </Caption>
    </GlassPanel>
  );
}
