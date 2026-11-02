import type {
  PhysicsLedger
} from '@/api/types';
import { Badge, DataTable, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { unknownLabel, useT } from './helpers';

export function ParkLedgerPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatEnergy, formatPower, formatDuration } = useUnits();
  const p = ledger.park;
  if (!p) {
    return (
      <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-park">
        <PanelTitle>{t('physicsLedger.park.title', 'Park / vampire physics')}</PanelTitle>
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.park.empty', 'No park interval in this window.')}
        </Text>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-park">
      <PanelTitle>{t('physicsLedger.park.title', 'Park / vampire physics')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {p.honesty}
      </Text>
      <div className="flex flex-wrap gap-2">
        <Badge variant={p.trusted ? 'success' : 'danger'} size="sm">
          {p.trusted ? t('physicsLedger.park.trusted', 'Park trusted') : t('physicsLedger.park.untrusted', 'Park untrusted')}
        </Badge>
        <Badge variant="neutral" size="sm">
          {formatDuration(p.duration_s)}
        </Badge>
        {p.plugged_at_limit ? (
          <Badge variant="info" size="sm">
            {t('physicsLedger.park.pluggedAtLimit', 'Plugged at limit')}
          </Badge>
        ) : null}
      </div>
      <DataTable
        tableId="physics:park-ledger"
        caption={t('physicsLedger.park.title', 'Park / vampire physics')}
        data={[
          {
            key: 'avg-watts',
            label: t('physicsLedger.park.avgWatts', 'Average drain'),
            value: p.avg_watts_w != null ? formatPower(p.avg_watts_w) : unknownLabel(t),
          },
          {
            key: 'energy',
            label: t('physicsLedger.park.energy', 'Park energy'),
            value: p.energy_wh != null ? formatEnergy(p.energy_wh) : unknownLabel(t),
          },
          {
            key: 'sentry',
            label: t('physicsLedger.park.sentry', 'Sentry'),
            value: p.sentry_wh != null ? formatEnergy(p.sentry_wh) : unknownLabel(t),
          },
          {
            key: 'cabin',
            label: t('physicsLedger.park.cabin', 'Cabin overheat'),
            value: p.cabin_overheat_wh != null ? formatEnergy(p.cabin_overheat_wh) : unknownLabel(t),
          },
          {
            key: 'precondition',
            label: t('physicsLedger.park.precondition', 'Preconditioning'),
            value: p.precondition_wh != null ? formatEnergy(p.precondition_wh) : unknownLabel(t),
          },
          {
            key: 'quiet',
            label: t('physicsLedger.park.quiet', 'Quiet pack'),
            value: p.quiet_pack_wh != null ? formatEnergy(p.quiet_pack_wh) : unknownLabel(t),
          },
        ]}
        columns={[
          {
            key: 'label',
            header: t('physicsLedger.park.title', 'Park / vampire physics'),
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
    </GlassPanel>
  );
}
