import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scale } from 'lucide-react';

import { useChargeLedger } from '@/api/hooks/usePhysicsLedger';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { QueryError, Skeleton } from '@/components/feedback';
import { ChargeLedgerPanel } from '@/features/vehicles/components/physics-ledger/LedgerPanels';
import { useDataState } from '@/hooks/useDataState';

/** Compact charge-energy ledger for one session. Full solver lives at /tesla-only/ledger. */
export function ChargeLedgerCompactPanel({ sessionId }: { sessionId: string | undefined }) {
  const { t } = useTranslation();
  const query = useChargeLedger(sessionId);
  const state = useDataState(query, { provenance: 'historical' });
  const ledger = state.data;

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="charge-ledger-compact">
      <PanelTitle className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('charging.ledger.title', 'Charge energy ledger')}
      </PanelTitle>
      {state.status === 'initial' ? (
        <Skeleton className="h-28" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : ledger ? (
        <>
          {ledger.truncated ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="danger" size="sm">
                {t('physicsLedger.truncated', 'Sample cap hit — oldest prefix solved')}
              </Badge>
            </div>
          ) : null}
          <ChargeLedgerPanel ledger={ledger} />
          <Text as="p" size="sm" color="secondary">
            <Link
              to="/tesla-only/ledger"
              className="text-[var(--theme-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
            >
              {t('charging.ledger.openFull', 'Open the full physics ledger')}
            </Link>
          </Text>
        </>
      ) : null}
    </GlassPanel>
  );
}
