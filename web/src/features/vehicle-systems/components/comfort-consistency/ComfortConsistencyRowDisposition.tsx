import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';

interface ComfortConsistencyRowDispositionProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
}

export function ComfortConsistencyRowDisposition({
  summary,
  state,
}: ComfortConsistencyRowDispositionProps) {
  const { t } = useTranslation();
  const rows = summary.rows;
  const outcomes = [
    [t('comfortConsistency.rows.invalidRow', 'Invalid row type'), rows.invalidRowRows],
    [t('comfortConsistency.rows.missingTime', 'Missing timestamp'), rows.missingTimestampRows],
    [t('comfortConsistency.rows.invalidTime', 'Invalid timestamp'), rows.invalidTimestampRows],
    [t('comfortConsistency.rows.duplicate', 'Duplicate timestamp'), rows.duplicateTimestampRows],
    [t('comfortConsistency.rows.unknownHvac', 'Unknown HVAC state'), rows.unknownHvacRows],
    [t('comfortConsistency.rows.hvacOff', 'HVAC inactive'), rows.hvacOffRows],
    [t('comfortConsistency.rows.missingCabin', 'Active, cabin missing'), rows.missingInsideTempRows],
    [t('comfortConsistency.rows.missingTarget', 'Active, setpoint missing'), rows.missingSetpointRows],
    [t('comfortConsistency.rows.analyzed', 'Analyzed active sample'), rows.analyzedRows],
  ] as const;

  return (
    <section data-testid="comfort-consistency-row-disposition">
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <PanelTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            {t('comfortConsistency.rows.title', 'Returned-row disposition')}
          </PanelTitle>
          <Badge variant={summary.identities.rowsBalanced ? 'success' : 'danger'}>
            {summary.identities.rowsBalanced
              ? t('comfortConsistency.rows.balanced', 'Exact balance')
              : t('comfortConsistency.rows.mismatch', 'Accounting mismatch')}
          </Badge>
        </div>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.rows.subtitle',
            'Ordered, mutually exclusive outcomes explain why each endpoint row is analyzed or withheld.',
          )}
        </Text>
        <ComfortConsistencySectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, md: 3, xl: 5 }} gap={3}>
            {outcomes.map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <MetricLabel>{label}</MetricLabel>
                <MetricValue className="mt-1">{fmtInt(value)}</MetricValue>
              </div>
            ))}
          </Grid>
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'comfortConsistency.rows.identity',
              '{{returned}} returned = all nine outcomes above; {{valid}} timestamp-valid rows reduce to {{unique}} unique timestamps after {{duplicates}} duplicates.',
              {
                returned: fmtInt(rows.returnedRows),
                valid: fmtInt(rows.timestampValidRows),
                unique: fmtInt(rows.uniqueTimestampRows),
                duplicates: fmtInt(rows.duplicateTimestampRows),
              },
            )}
          </Text>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
