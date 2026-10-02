import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scale } from 'lucide-react';

import { useDriveLedger } from '@/api/hooks/usePhysicsLedger';
import { Badge, GlassPanel, PanelTitle, Table, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

/** Compact energy/force ledger for one drive. Full solver lives at /tesla-physics/ledger. */
export function DriveLedgerCompactPanel({ driveId }: { driveId: string | undefined }) {
  const { t } = useTranslation();
  const query = useDriveLedger(driveId);
  const state = useDataState(query, { provenance: 'historical' });
  const ledger = state.data;
  const { formatEnergy } = useUnits();
  const drive = ledger?.drive;
  const terms = [
    { key: 'measured', label: t('physicsLedger.drive.measured', 'Measured pack energy'), term: drive?.measured_wh },
    { key: 'aero', label: t('physicsLedger.drive.aero', 'Aero'), term: drive?.aero_wh },
    { key: 'rolling', label: t('physicsLedger.drive.rolling', 'Rolling'), term: drive?.rolling_wh },
    { key: 'grade', label: t('physicsLedger.drive.grade', 'Grade'), term: drive?.grade_wh },
    { key: 'inertial', label: t('physicsLedger.drive.inertial', 'Inertial'), term: drive?.inertial_wh },
    { key: 'accessory', label: t('physicsLedger.drive.accessory', 'Accessory / HVAC'), term: drive?.accessory_wh },
    { key: 'loss', label: t('physicsLedger.drive.drivetrainLoss', 'Drivetrain loss (model)'), term: drive?.drivetrain_loss_wh },
  ];
  const unknown = t('common.unknown', 'Unknown');
  const energy = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? formatEnergy(value) : unknown;

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="drive-ledger-compact">
      <PanelTitle className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('driveDetail.ledger.title', 'Energy ledger')}
      </PanelTitle>
      <StaleRefreshWarning state={state} label={t('driveDetail.ledger.title', 'Energy ledger')} />
      {state.status === 'initial' ? (
        <Skeleton className="h-28" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : ledger ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral" size="sm">
              {t('driveDetail.ledger.regen', 'Regen')}:{' '}
              {ledger.dynamics?.regen_wh != null
                ? formatEnergy(ledger.dynamics.regen_wh)
                : t('common.unknown', 'Unknown')}
            </Badge>
            <Badge variant="neutral" size="sm">
              {t('driveDetail.ledger.friction', 'Friction brake')}:{' '}
              {ledger.dynamics?.friction_brake_wh != null
                ? formatEnergy(ledger.dynamics.friction_brake_wh)
                : t('common.unknown', 'Unknown')}
            </Badge>
            {ledger.truncated ? (
              <Badge variant="danger" size="sm">
                {t('physicsLedger.truncated', 'Sample cap hit — oldest prefix solved')}
              </Badge>
            ) : null}
          </div>
          <Text as="p" variant="caption">{drive?.honesty ?? ledger.honesty}</Text>
          <Table aria-label={t('physicsLedger.drive.title', 'Drive energy ledger')}>
            <thead><tr>
              <th scope="col">{t('driveDetail.report.term', 'Physics term')}</th>
              <th scope="col">{t('driveDetail.whyEnded.signal.cols.value', 'Value')}</th>
              <th scope="col">{t('driveDetail.report.source', 'Source and method')}</th>
              <th scope="col">{t('physicsLedger.missing', 'Missing signals')}</th>
            </tr></thead>
            <tbody>{terms.map(({ key, label, term }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td className="whitespace-nowrap tabular-nums">{term?.unknown ? unknown : energy(term?.value_wh)}</td>
                <td>{term?.method ?? unknown}</td>
                <td>{(term?.missing_signals ?? []).join(', ') || '—'}</td>
              </tr>
            ))}</tbody>
          </Table>
          <Table aria-label={t('driveDetail.report.reconciliation', 'Ledger reconciliation')}>
            <tbody>
              <tr><th scope="row">{t('physicsLedger.drive.predicted', 'Predicted (known terms)')}</th><td>{energy(drive?.predicted_wh)}</td></tr>
              <tr><th scope="row">{t('physicsLedger.drive.session', 'Session')}</th><td>{energy(drive?.session_wh)}</td></tr>
              <tr><th scope="row">{t('physicsLedger.drive.reconcile', 'Reconcile')}</th><td>{energy(drive?.reconcile_wh)}</td></tr>
              <tr><th scope="row">{t('physicsLedger.drive.unexplained', 'Unexplained residual')}</th><td>{drive?.unexplained_known ? energy(drive.unexplained_wh) : unknown}</td></tr>
            </tbody>
          </Table>
          {ledger.drive?.missing_signals?.includes('mass_kg') ? (
            <Text as="p" size="sm" color="secondary">
              {t('driveDetail.ledger.massMissing', 'Vehicle mass is not configured. Mass-dependent estimates require TESLASYNC_VEHICLE_MASS_KG, which applies to every vehicle in this installation.')}
            </Text>
          ) : null}
          {ledger.drive?.grade_wh?.unknown ? (
            <Text as="p" size="sm" color="secondary">
              {t('driveDetail.ledger.elevationMissing', 'Grade and friction-brake estimates require recorded elevation; this telemetry source does not provide it.')}
            </Text>
          ) : null}
          {ledger.drive?.accessory_wh?.unknown ? (
            <Text as="p" size="sm" color="secondary">
              {t('driveDetail.ledger.hvacMissing', 'Tesla reports HVAC on/off state, not power in watts. Accessory energy and the complete unexplained residual cannot be calculated from that state.')}
            </Text>
          ) : null}
        </>
      ) : <EmptyState message={t('physicsLedger.drive.empty', 'No drive interval in this window.')} />}
      <Text as="p" size="sm" color="secondary">
        <Link to="/tesla-physics/ledger" className="text-[var(--theme-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]">
          {t('driveDetail.ledger.openFull', 'Open the full physics ledger')}
        </Link>
      </Text>
    </GlassPanel>
  );
}
