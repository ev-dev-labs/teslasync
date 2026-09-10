import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { DataProvenanceBadge, MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useParkTruth, useVampireSplit } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import { fmtNumber } from '@/lib/numberFormat';
import type { VampireCulpritId } from '../lib/vampireCulprits';
import { deriveVampireCulprits } from '../lib/vampireCulprits';

const ACTION: Record<VampireCulpritId, { key: string; fallback: string }> = {
  sentry: {
    key: 'vampireDrain.culprit.action.sentry',
    fallback: 'Turn Sentry off at home tonight. It is counted only because the car is in Park.',
  },
  cabin_overheat: {
    key: 'vampireDrain.culprit.action.overheat',
    fallback: 'Cabin Overheat is HVAC, not a pack leak. Turn it off if the car sits in shade.',
  },
  precondition: {
    key: 'vampireDrain.culprit.action.precondition',
    fallback: 'Preconditioning is warming the pack/cabin on purpose. Leave it on only before a drive.',
  },
  plugged_complete: {
    key: 'vampireDrain.culprit.action.plugged',
    fallback: 'Charge reached Complete and stayed plugged. Unplug after DC Complete to stop idle draw.',
  },
  unplugged_leak: {
    key: 'vampireDrain.culprit.action.leak',
    fallback: 'Unplugged parked drain remains after Sentry/HVAC. That is 12V upkeep or a genuine leak.',
  },
  unknown: {
    key: 'vampireDrain.culprit.action.unknown',
    fallback: 'No confirmed Park culprit yet. Missing is not zero watts.',
  },
};

export function VampireCulpritPanel({ vehicleId }: { vehicleId: string | undefined }) {
  const { t } = useTranslation();
  const parkQuery = useParkTruth(vehicleId);
  const splitQuery = useVampireSplit(vehicleId);
  const parkState = useDataState(parkQuery, { provenance: 'live' });
  const splitState = useDataState(splitQuery, { provenance: 'historical' });
  const report = deriveVampireCulprits(parkState.data, splitState.data);
  const loading = parkState.status === 'initial' && splitState.status === 'initial';
  const fatal = parkState.fatalError ?? splitState.fatalError;

  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5" data-testid="vampire-culprits">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="mb-0 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('vampireDrain.culprit.title', 'Vampire culprit')}
        </PanelTitle>
        <DataProvenanceBadge provenance={parkState.provenance} status={parkState.status} />
      </div>
      <Text as="p" variant="caption">
        {t(
          'vampireDrain.culprit.subtitle',
          'What to turn off tonight — Sentry, Cabin Overheat, precondition, plugged-Complete, or genuine leak. Not another 12 W tile.',
        )}
      </Text>
      {!vehicleId ? (
        <EmptyState
          icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
          message={t('vampireDrain.selectVehicle', 'Select a vehicle to view its vampire drain.')}
        />
      ) : loading ? (
        <Skeleton className="h-28" />
      ) : fatal ? (
        <QueryError
          error={fatal}
          onRetry={() => {
            void parkQuery.refetch();
            void splitQuery.refetch();
          }}
        />
      ) : (
        <>
          <Text as="p" variant="bodySm">
            {t(ACTION[report.tonight].key, ACTION[report.tonight].fallback)}
          </Text>
          <Grid cols={{ default: 2, lg: 5 }} gap={3}>
            {report.culprits.map((row) => (
              <MetricCard
                key={row.id}
                label={t(`vampireDrain.culprit.${row.id}`, row.id.replace(/_/g, ' '))}
                value={
                  row.drainPct != null
                    ? `${fmtNumber(row.drainPct, 2)}%`
                    : row.active
                      ? t('vampireDrain.culprit.on', 'On')
                      : t('vampireDrain.culprit.off', 'Off')
                }
                color={row.active ? 'amber' : 'cyan'}
              />
            ))}
          </Grid>
          <div className="flex flex-wrap gap-2">
            <Badge variant={report.tonight === 'unknown' ? 'neutral' : 'warning'} size="sm">
              {t('vampireDrain.culprit.tonight', 'Tonight: {{id}}', { id: report.tonight.replace(/_/g, ' ') })}
            </Badge>
          </div>
          <Text as="p" variant="caption">{report.honesty}</Text>
        </>
      )}
    </GlassPanel>
  );
}
