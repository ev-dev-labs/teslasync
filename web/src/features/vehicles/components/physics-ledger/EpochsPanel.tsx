import type {
  PhysicsLedger
} from '@/api/types';
import { DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { asList, unknownLabel, useT } from './helpers';

export function EpochsPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatEnergy } = useUnits();
  const epochs = asList(ledger.epochs);
  const columns: Column<(typeof epochs)[number]>[] = [
    { key: 'firmware', header: t('physicsLedger.epochs.firmware', 'Firmware'), render: (row) => row.firmware },
    {
      key: 'measured',
      header: t('physicsLedger.epochs.measured', 'Measured'),
      render: (row) => (row.measured_wh != null ? formatEnergy(row.measured_wh) : unknownLabel(t)),
    },
    {
      key: 'predicted',
      header: t('physicsLedger.epochs.predicted', 'Predicted'),
      render: (row) => (row.predicted_wh != null ? formatEnergy(row.predicted_wh) : unknownLabel(t)),
    },
    {
      key: 'unexplained',
      header: t('physicsLedger.epochs.unexplained', 'Unexplained'),
      render: (row) => (row.unexplained_wh != null ? formatEnergy(row.unexplained_wh) : unknownLabel(t)),
    },
    {
      key: 'samples',
      header: t('physicsLedger.epochs.samples', 'Samples'),
      render: (row) => fmtNumber(row.sample_count, 0),
    },
  ];
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-epochs">
      <PanelTitle>{t('physicsLedger.epochs.title', 'Firmware epochs')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {epochs[0]?.honesty ?? t('physicsLedger.epochs.honesty', 'Each software version is a physics baseline for this VIN. Residual changes are correlation, not proof of a fix.')}
      </Text>
      {epochs.length === 0 ? (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.epochs.empty', 'No firmware-labelled samples in this window.')}
        </Text>
      ) : (
        <DataTable
          tableId="physics-ledger:epochs"
          columns={columns}
          mobileColumns={['firmware', 'measured', 'unexplained']}
          data={epochs}
          keyExtractor={(row) => row.firmware}
          emptyMessage={t('physicsLedger.epochs.empty', 'No firmware-labelled samples in this window.')}
        />
      )}
    </GlassPanel>
  );
}
