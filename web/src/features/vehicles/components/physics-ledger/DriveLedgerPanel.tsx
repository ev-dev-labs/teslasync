import type {
  PhysicsDriveLedger
} from '@/api/types';
import { Caption, DataTable, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { unknownLabel, useT } from './helpers';

export function DriveLedgerPanel({ ledger }: { ledger?: PhysicsDriveLedger | null }) {
  const t = useT();
  const { formatEnergy } = useUnits();
  const energy = (wh: number) => formatEnergy(wh);
  if (!ledger) {
    return (
      <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-drive">
        <PanelTitle>{t('physicsLedger.drive.title', 'Drive energy ledger')}</PanelTitle>
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.drive.empty', 'No drive interval in this window.')}
        </Text>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-drive">
      <PanelTitle>{t('physicsLedger.drive.title', 'Drive energy ledger')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {ledger.honesty}
      </Text>
      <DataTable
        tableId="physics:drive-ledger"
        caption={t('physicsLedger.drive.title', 'Drive energy ledger')}
        data={[
          {
            key: 'measured',
            label: t('physicsLedger.drive.measured', 'Measured pack energy'),
            value: ledger.measured_wh?.value_wh != null ? energy(ledger.measured_wh.value_wh) : unknownLabel(t),
          },
          {
            key: 'aero',
            label: t('physicsLedger.drive.aero', 'Aero'),
            value: ledger.aero_wh?.value_wh != null ? energy(ledger.aero_wh.value_wh) : unknownLabel(t),
          },
          {
            key: 'rolling',
            label: t('physicsLedger.drive.rolling', 'Rolling'),
            value: ledger.rolling_wh?.value_wh != null ? energy(ledger.rolling_wh.value_wh) : unknownLabel(t),
          },
          {
            key: 'grade',
            label: t('physicsLedger.drive.grade', 'Grade'),
            value: ledger.grade_wh?.value_wh != null ? energy(ledger.grade_wh.value_wh) : unknownLabel(t),
          },
          {
            key: 'inertial',
            label: t('physicsLedger.drive.inertial', 'Inertial'),
            value: ledger.inertial_wh?.value_wh != null ? energy(ledger.inertial_wh.value_wh) : unknownLabel(t),
          },
          {
            key: 'accessory',
            label: t('physicsLedger.drive.accessory', 'Accessory / HVAC'),
            value: ledger.accessory_wh?.value_wh != null ? energy(ledger.accessory_wh.value_wh) : unknownLabel(t),
          },
          {
            key: 'drivetrain-loss',
            label: t('physicsLedger.drive.drivetrainLoss', 'Drivetrain loss (model)'),
            value: ledger.drivetrain_loss_wh?.value_wh != null ? energy(ledger.drivetrain_loss_wh.value_wh) : unknownLabel(t),
          },
        ]}
        columns={[
          {
            key: 'label',
            header: t('physicsLedger.drive.title', 'Drive energy ledger'),
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
        {t('physicsLedger.drive.predicted', 'Predicted (known terms)')}:{' '}
        {ledger.predicted_wh != null ? energy(ledger.predicted_wh) : unknownLabel(t)}
        {' · '}
        {t('physicsLedger.drive.session', 'Session')}: {ledger.session_wh != null ? energy(ledger.session_wh) : unknownLabel(t)}
        {ledger.reconcile_wh != null
          ? ` · ${t('physicsLedger.drive.reconcile', 'reconcile')}: ${energy(ledger.reconcile_wh)}`
          : ''}
      </Caption>
    </GlassPanel>
  );
}
