import { useTranslation } from 'react-i18next';
import { AlertTriangle, Fingerprint, ListChecks, ShieldCheck } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import type { SchemaDrift } from '@/types/admin-operator-confidence';
import { formatSchemaDelta, type SchemaSectionState } from './schemaPresentation';

export function SchemaGuidance({ state, isDrifted }: { state: SchemaSectionState; isDrifted: boolean }) {
  const { t } = useTranslation();
  const { drift, isLoading, error, onRetry } = state;
  return (
    <LayoutCard title={t('admin.schemaDrift.guidanceTitle', 'What this means')}
      actions={<ListChecks className="h-4 w-4 text-cyan-300" aria-hidden />}>
      {isLoading ? <Skeleton height={72} /> : error ? <QueryError error={error} onRetry={onRetry} /> : !drift ? (
        // no-action: seed capture requires an external API restart; the page header already refreshes the shared evidence.
        <EmptyState icon={<Fingerprint className="h-8 w-8" aria-hidden />}
          message={t('admin.schemaDrift.guidanceEmpty', 'Restart the API to capture a seed fingerprint, then drift interpretation appears here.')} />
      ) : isDrifted ? <DriftedGuidance drift={drift} /> : (
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
          <div className="min-w-0 max-w-3xl">
            <Text as="p" variant="body">
              {t('admin.schemaDrift.cleanBody', 'The live schema matches the recorded seed fingerprint. Migrations and the seed are in sync — no action required.')}
            </Text>
          </div>
        </div>
      )}
    </LayoutCard>
  );
}

function DriftedGuidance({ drift }: { drift: SchemaDrift }) {
  const { t } = useTranslation();
  const changes: string[] = [];
  if ((drift.table_count_delta ?? 0) !== 0) {
    changes.push(t('admin.schemaDrift.changeTables', 'Tables {{delta}}', { delta: formatSchemaDelta(drift.table_count_delta) }));
  }
  if ((drift.column_count_delta ?? 0) !== 0) {
    changes.push(t('admin.schemaDrift.changeColumns', 'Columns {{delta}}', { delta: formatSchemaDelta(drift.column_count_delta) }));
  }
  if ((drift.index_count_delta ?? 0) !== 0) {
    changes.push(t('admin.schemaDrift.changeIndexes', 'Indexes {{delta}}', { delta: formatSchemaDelta(drift.index_count_delta) }));
  }
  const countsKnown = [
    drift.table_count_delta,
    drift.column_count_delta,
    drift.index_count_delta,
  ].every(delta => delta != null && Number.isFinite(delta));
  return (
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
      <div className="min-w-0 max-w-3xl space-y-3">
        <Text as="p" variant="body">
          {changes.length > 0
            ? t('admin.schemaDrift.driftedBodyCounts', 'The live schema differs from the seed: {{changes}}.', { changes: changes.join(' · ') })
            : countsKnown
              ? t('admin.schemaDrift.driftedBodyHash', 'The live schema fingerprint differs from the seed even though object counts match — inspect column definitions or index expressions.')
              : t('admin.schemaDrift.driftedBodyUnknownCounts', 'The live schema fingerprint differs from the seed. Object-count comparisons are unavailable; inspect the available fingerprints and confirm migrations before making changes.')}
        </Text>
        <ul className="list-disc space-y-1.5 ps-5">
          <li><Text as="span" variant="bodySm">
            {t('admin.schemaDrift.remediateSeed', 'Confirm migrations are applied, then restart the API to regenerate the seed fingerprint.')}
          </Text></li>
          <li><Text as="span" variant="bodySm">
            {t('admin.schemaDrift.remediateDdl', 'If migrations are already current, investigate raw DDL that bypassed the migration system.')}
          </Text></li>
        </ul>
      </div>
    </div>
  );
}
