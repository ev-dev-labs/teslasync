import { Binary } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type { PreconditioningQueryState } from './types';

interface PreconditioningExactAccountingProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
}

function Identity({
  label,
  equation,
  balanced,
}: {
  label: string;
  equation: string;
  balanced: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <MetricLabel>{label}</MetricLabel>
        <Badge variant={balanced ? 'success' : 'danger'}>
          {balanced
            ? t('preconditioningEffectiveness.accounting.balanced', 'Balances')
            : t('preconditioningEffectiveness.accounting.mismatch', 'Mismatch')}
        </Badge>
      </div>
      <Text as="p" variant="bodySm" className="mt-2">{equation}</Text>
    </div>
  );
}

export function PreconditioningExactAccounting({
  summary,
  state,
}: PreconditioningExactAccountingProps) {
  const { t } = useTranslation();
  const climate = summary.climateRows;
  const drives = summary.driveRows;
  const departures = summary.departureAccounting;

  return (
    <section data-testid="preconditioning-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Binary className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.accounting.title',
            'Exact accounting identities',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.accounting.subtitle',
            'Independent identities reconcile returned rows, timestamps, drives, departure outcomes, groups, strata, and directory entries.',
          )}
        </Text>
        <PreconditioningSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 1, xl: 2 }} gap={3}>
            <Identity
              label={t('preconditioningEffectiveness.accounting.climateRows', 'Climate returned-row identity')}
              equation={t(
                'preconditioningEffectiveness.accounting.climateEquation',
                '{{returned}} = {{invalid}} invalid + {{missingTime}} missing time + {{badTime}} bad time + {{duplicates}} duplicates + {{cabin}} no cabin + {{target}} no target + {{unknown}} HVAC unknown + {{off}} HVAC off + {{on}} HVAC active.',
                {
                  returned: fmtInt(climate.returnedRows),
                  invalid: fmtInt(climate.invalidRowRows),
                  missingTime: fmtInt(climate.missingTimestampRows),
                  badTime: fmtInt(climate.invalidTimestampRows),
                  duplicates: fmtInt(climate.duplicateTimestampRows),
                  cabin: fmtInt(climate.missingInsideTempRows),
                  target: fmtInt(climate.missingSetpointRows),
                  unknown: fmtInt(climate.completeUnknownHvacRows),
                  off: fmtInt(climate.completeHvacOffRows),
                  on: fmtInt(climate.completeHvacOnRows),
                },
              )}
              balanced={summary.identities.climateRowsBalanced}
            />
            <Identity
              label={t('preconditioningEffectiveness.accounting.timestamps', 'Climate timestamp identity')}
              equation={t(
                'preconditioningEffectiveness.accounting.timestampEquation',
                '{{valid}} timestamp-valid rows = {{unique}} unique + {{duplicates}} duplicates.',
                {
                  valid: fmtInt(climate.timestampValidRows),
                  unique: fmtInt(climate.uniqueTimestampRows),
                  duplicates: fmtInt(climate.duplicateTimestampRows),
                },
              )}
              balanced={summary.identities.climateTimestampsBalanced}
            />
            <Identity
              label={t('preconditioningEffectiveness.accounting.drives', 'Drive returned-row identity')}
              equation={t(
                'preconditioningEffectiveness.accounting.driveEquation',
                '{{returned}} = {{invalid}} invalid + {{missing}} missing start + {{bad}} bad start + {{duplicates}} duplicate drives + {{valid}} unique valid drives.',
                {
                  returned: fmtInt(drives.returnedRows),
                  invalid: fmtInt(drives.invalidRowRows),
                  missing: fmtInt(drives.missingStartRows),
                  bad: fmtInt(drives.invalidStartRows),
                  duplicates: fmtInt(drives.duplicateDriveRows),
                  valid: fmtInt(drives.uniqueValidDrives),
                },
              )}
              balanced={summary.identities.driveRowsBalanced}
            />
            <Identity
              label={t('preconditioningEffectiveness.accounting.outcomes', 'Departure-outcome identity')}
              equation={t(
                'preconditioningEffectiveness.accounting.outcomeEquation',
                '{{valid}} valid drives = {{outside}} outside + {{empty}} empty + {{samples}} samples + {{span}} span + {{stale}} stale + {{target}} target shift + {{band}} in band + {{unknown}} ambiguous + {{active}} active + {{control}} control.',
                {
                  valid: fmtInt(drives.uniqueValidDrives),
                  outside: fmtInt(departures.outsideClimateCoverage),
                  empty: fmtInt(departures.noWindowRows),
                  samples: fmtInt(departures.insufficientThermalSamples),
                  span: fmtInt(departures.insufficientObservationSpan),
                  stale: fmtInt(departures.staleDepartureSample),
                  target: fmtInt(departures.targetShiftExclusions),
                  band: fmtInt(departures.initialInBand),
                  unknown: fmtInt(departures.ambiguousHvac),
                  active: fmtInt(departures.conditioned),
                  control: fmtInt(departures.unconditioned),
                },
              )}
              balanced={summary.identities.departureOutcomesBalanced}
            />
            <Identity
              label={t('preconditioningEffectiveness.accounting.groups', 'Classified-group identity')}
              equation={t(
                'preconditioningEffectiveness.accounting.groupEquation',
                '{{classified}} classified = {{active}} observed HVAC-active + {{control}} explicitly HVAC-off control.',
                {
                  classified: fmtInt(summary.joinedDepartures),
                  active: fmtInt(summary.conditionedDepartures),
                  control: fmtInt(summary.unconditionedDepartures),
                },
              )}
              balanced={summary.identities.classifiedGroupsBalanced}
            />
            <Identity
              label={t('preconditioningEffectiveness.accounting.regimes', 'Departure-stratum identity')}
              equation={t(
                'preconditioningEffectiveness.accounting.regimeEquation',
                '{{classified}} classified = {{hot}} hot starts + {{cold}} cold starts.',
                {
                  classified: fmtInt(summary.joinedDepartures),
                  hot: fmtInt(summary.hotDepartures),
                  cold: fmtInt(summary.coldDepartures),
                },
              )}
              balanced={summary.identities.regimesBalanced}
            />
            <Identity
              label={t('preconditioningEffectiveness.accounting.directory', 'Directory identity')}
              equation={t(
                'preconditioningEffectiveness.accounting.directoryEquation',
                '{{total}} directory entries = {{valid}} unique valid drives; display capping does not alter the total.',
                {
                  total: fmtInt(summary.directory.total),
                  valid: fmtInt(drives.uniqueValidDrives),
                },
              )}
              balanced={summary.identities.directoryBalanced}
            />
          </Grid>
        </PreconditioningSectionBody>
      </GlassPanel>
    </section>
  );
}
