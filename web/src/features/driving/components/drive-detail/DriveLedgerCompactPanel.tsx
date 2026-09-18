import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scale } from 'lucide-react';

import { useDriveLedger } from '@/api/hooks/usePhysicsLedger';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { QueryError, Skeleton } from '@/components/feedback';
import { DriveLedgerPanel } from '@/features/vehicles/components/physics-ledger/LedgerPanels';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

/** Compact energy/force ledger for one drive. Full solver lives at /tesla-only/ledger. */
export function DriveLedgerCompactPanel({ driveId }: { driveId: string | undefined }) {
  const { t } = useTranslation();
  const query = useDriveLedger(driveId);
  const state = useDataState(query, { provenance: 'historical' });
  const ledger = state.data;
  const { formatEnergy } = useUnits();

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="drive-ledger-compact">
      <PanelTitle className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('driveDetail.ledger.title', 'Energy ledger')}
      </PanelTitle>
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
          <DriveLedgerPanel ledger={ledger.drive} />
          <Text as="p" size="sm" color="secondary">
            <Link
              to="/tesla-only/ledger"
              className="text-[var(--theme-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
            >
              {t('driveDetail.ledger.openFull', 'Open the full physics ledger')}
            </Link>
          </Text>
        </>
      ) : null}
    </GlassPanel>
  );
}
