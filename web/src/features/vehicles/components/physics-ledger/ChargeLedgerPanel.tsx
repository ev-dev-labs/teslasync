import type {
  PhysicsLedger
} from '@/api/types';
import { Badge, Caption, DataTable, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { unknownLabel, useT } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ChargeLedgerPanel({ ledger }: { ledger: PhysicsLedger }) {
  const { fmtNumber } = useNumberFormatting();
  const t = useT();
  const { formatEnergy, formatDuration } = useUnits();
  const c = ledger.charge;
  if (!c) {
    return (
      <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-charge">
        <PanelTitle>{t('physicsLedger.charge.title', 'Charge physics')}</PanelTitle>
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.charge.empty', 'No charge interval in this window.')}
        </Text>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-charge">
      <PanelTitle>{t('physicsLedger.charge.title', 'Charge physics')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {c.honesty}
      </Text>
      <div className="flex flex-wrap gap-2">
        <Badge variant={c.unplugged ? 'success' : 'neutral'} size="sm">
          {c.unplugged ? t('physicsLedger.charge.unplugged', 'Unplugged') : t('physicsLedger.charge.stillPlugged', 'Still plugged / unknown')}
        </Badge>
        {c.dwell_complete_s != null ? (
          <Badge variant="neutral" size="sm">
            {t('physicsLedger.charge.dwell', 'Complete dwell')}: {formatDuration(c.dwell_complete_s)}
          </Badge>
        ) : null}
      </div>
      <DataTable
        tableId="physics:charge-ledger"
        caption={t('physicsLedger.charge.title', 'Charge physics')}
        data={[
          {
            key: 'energy-added',
            label: t('physicsLedger.charge.added', 'Energy added'),
            value: c.energy_added_wh != null ? formatEnergy(c.energy_added_wh) : unknownLabel(t),
          },
          {
            key: 'wall',
            label: t('physicsLedger.charge.wall', 'Wall energy'),
            value: c.wall_wh?.value_wh != null ? formatEnergy(c.wall_wh.value_wh) : unknownLabel(t),
          },
          {
            key: 'precondition',
            label: t('physicsLedger.charge.precondition', 'Preconditioning'),
            value: c.precondition_wh?.value_wh != null ? formatEnergy(c.precondition_wh.value_wh) : unknownLabel(t),
          },
        ]}
        columns={[
          {
            key: 'label',
            header: t('physicsLedger.charge.title', 'Charge physics'),
            defaultWidth: 180,
            minWidth: 140,
            render: (row) => <Text as="span" size="sm">{row.label}</Text>,
          },
          {
            key: 'value',
            header: t('common.value', 'Value'),
            defaultWidth: 140,
            minWidth: 120,
            align: 'right',
            render: (row) => <Text as="span" size="sm">{row.value}</Text>,
          },
        ]}
        keyExtractor={(row) => row.key}
        variant="embedded"
        stickyHeader={false}
        showColumnsMenu={false}
        columnVisibility={false}
        searchable={false}
        exportable={false}
      />
      <Caption>
        {t('physicsLedger.charge.efficiency', 'Efficiency')}:{' '}
        {c.efficiency_known && c.efficiency_pct != null ? `${fmtNumber(c.efficiency_pct)} %` : unknownLabel(t)}
        {' · '}
        {t('physicsLedger.drive.session', 'Session')}: {c.session_wh != null ? formatEnergy(c.session_wh) : unknownLabel(t)}
      </Caption>
    </GlassPanel>
  );
}
