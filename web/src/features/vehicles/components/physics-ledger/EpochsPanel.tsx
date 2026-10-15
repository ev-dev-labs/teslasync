import type {
  PhysicsLedger
} from '@/api/types';
import { DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { asList, unknownLabel, useT } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { applyColumnLayout, getColumnLayout, readLegacyVisibleLayout } from '@/lib/columnOrderStore';
import { defaultExportFilename, downloadCSV, downloadJSON, toCSV } from '@/lib/csvExport';

const TABLE_ID = 'physics-ledger:epochs';

export function EpochsPanel({ ledger }: { ledger: PhysicsLedger }) {
  const { fmtInt } = useNumberFormatting();
  const t = useT();
  const { formatEnergy, unitPrefs } = useUnits();
  const epochs = asList(ledger.epochs);
  const columns: Column<(typeof epochs)[number]>[] = [
    { key: 'firmware', header: t('physicsLedger.epochs.firmware', 'Firmware'), render: (row) => row.firmware,
      exportValue: row => row.firmware },
    {
      key: 'measured',
      align: 'right',
      header: t('physicsLedger.epochs.measured', 'Measured'),
      render: (row) => (row.measured_wh != null ? formatEnergy(row.measured_wh) : unknownLabel(t)),
      exportValue: row => row.measured_wh != null ? formatEnergy(row.measured_wh) : unknownLabel(t),
    },
    {
      key: 'predicted',
      align: 'right',
      header: t('physicsLedger.epochs.predicted', 'Predicted'),
      render: (row) => (row.predicted_wh != null ? formatEnergy(row.predicted_wh) : unknownLabel(t)),
      exportValue: row => row.predicted_wh != null ? formatEnergy(row.predicted_wh) : unknownLabel(t),
    },
    {
      key: 'unexplained',
      align: 'right',
      header: t('physicsLedger.epochs.unexplained', 'Unexplained'),
      render: (row) => (row.unexplained_wh != null ? formatEnergy(row.unexplained_wh) : unknownLabel(t)),
      exportValue: row => row.unexplained_wh != null ? formatEnergy(row.unexplained_wh) : unknownLabel(t),
    },
    {
      key: 'samples',
      align: 'right',
      header: t('physicsLedger.epochs.samples', 'Samples'),
      render: (row) => fmtInt(row.sample_count),
      exportValue: row => fmtInt(row.sample_count),
    },
  ];
  const onExport: NonNullable<Parameters<typeof DataTable<(typeof epochs)[number]>>[0]['onExport']> =
    (format, rows, scope) => {
      const evidence = {
        scope: scope === 'selected' ? 'selectedLoaded' : 'matchingLoaded',
        vehicle_id: ledger.vehicle_id,
        kind: ledger.kind,
        start: ledger.start,
        end: ledger.end,
        truncated: ledger.truncated,
        missing_signals: ledger.missing_signals,
        unknown_intervals: ledger.unknown_intervals,
        unknown_hours: ledger.unknown_hours,
        contradictions: ledger.contradictions,
        honesty: ledger.honesty,
      };
      const filename = defaultExportFilename(`${TABLE_ID}-${format === 'json' ? 'rawJSON' : 'displayCSV'}`);
      if (format === 'json') {
        downloadJSON(filename, {
          representation: 'rawJSON',
          ...evidence,
          epochs: rows.map(row => ({
            firmware: row.firmware,
            measured_wh: row.measured_wh,
            predicted_wh: row.predicted_wh,
            unexplained_wh: row.unexplained_wh,
            sample_count: row.sample_count,
            honesty: row.honesty,
          })),
        });
      } else {
        const layout = getColumnLayout(TABLE_ID)
          ?? readLegacyVisibleLayout(TABLE_ID, columns.map(column => column.key));
        downloadCSV(filename, toCSV(rows, [
          ...applyColumnLayout(columns, layout).map(column => ({
            key: column.key,
            header: ['measured', 'predicted', 'unexplained'].includes(column.key)
              ? `${column.header} (${unitPrefs.energy})` : column.header,
            accessor: column.exportValue,
          })),
          { key: 'epoch_honesty', accessor: row => row.honesty },
          { key: 'representation', accessor: () => 'displayCSV' },
          ...Object.entries(evidence).map(([key, value]) => ({ key, accessor: () => value })),
        ]));
      }
    };
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
          tableId={TABLE_ID}
          onExport={onExport}
          name={t('physicsLedger.epochs.title', 'Firmware epochs')}
          columns={columns}
          mobilePresentation={{
            roles: { firmware: 'title', measured: 'primary', predicted: 'meta', unexplained: 'meta', samples: 'meta' },
            displayValue: (row, key) => {
              if (key === 'firmware') return row.firmware;
              if (key === 'samples') return fmtInt(row.sample_count);
              const energy = key === 'measured' ? row.measured_wh
                : key === 'predicted' ? row.predicted_wh : row.unexplained_wh;
              return energy != null ? formatEnergy(energy) : unknownLabel(t);
            },
          }}
          data={epochs}
          keyExtractor={(row) => row.firmware}
          emptyMessage={t('physicsLedger.epochs.empty', 'No firmware-labelled samples in this window.')}
        />
      )}
      {epochs.length > 0 && (
        <Text as="p" size="sm" color="secondary">
          rawJSON (SI, Wh) / displayCSV ({unitPrefs.energy}).{' '}
          {t('table.export.loadedScope', 'Exports include only matching loaded rows, or selected loaded rows.')}
        </Text>
      )}
    </GlassPanel>
  );
}
