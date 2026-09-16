import type {
  PhysicsDriveLedger
} from '@/api/types';
import { Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { unknownLabel, useT } from './helpers';
import { TermRow } from './TermRow';

export function DriveLedgerPanel({ ledger }: { ledger: PhysicsDriveLedger }) {
  const t = useT();
  const { formatEnergy } = useUnits();
  const energy = (wh: number) => formatEnergy(wh);
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-drive">
      <PanelTitle>{t('physicsLedger.drive.title', 'Drive energy ledger')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {ledger.honesty}
      </Text>
      <div className="divide-y divide-[var(--border-default)]">
        <TermRow label={t('physicsLedger.drive.measured', 'Measured pack energy')} term={ledger.measured_wh} format={energy} highlight />
        <TermRow label={t('physicsLedger.drive.aero', 'Aero')} term={ledger.aero_wh} format={energy} />
        <TermRow label={t('physicsLedger.drive.rolling', 'Rolling')} term={ledger.rolling_wh} format={energy} />
        <TermRow label={t('physicsLedger.drive.grade', 'Grade')} term={ledger.grade_wh} format={energy} />
        <TermRow label={t('physicsLedger.drive.inertial', 'Inertial')} term={ledger.inertial_wh} format={energy} />
        <TermRow label={t('physicsLedger.drive.accessory', 'Accessory / HVAC')} term={ledger.accessory_wh} format={energy} />
        <TermRow label={t('physicsLedger.drive.drivetrainLoss', 'Drivetrain loss (model)')} term={ledger.drivetrain_loss_wh} format={energy} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--border-default)] pt-2">
        <Text as="span" size="sm" className="font-semibold">
          {t('physicsLedger.drive.unexplained', 'Unexplained residual')}
        </Text>
        <Text as="span" size="sm" className="font-semibold tabular-nums">
          {ledger.unexplained_known && ledger.unexplained_wh != null ? energy(ledger.unexplained_wh) : unknownLabel(t)}
        </Text>
      </div>
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
