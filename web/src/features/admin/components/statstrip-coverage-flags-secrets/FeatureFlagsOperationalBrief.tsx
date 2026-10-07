import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import { QueryError } from '@/components/feedback';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { FeatureFlagEntry, FeatureFlagChange, FeatureFlagsListResponse, FeatureFlagChangesResponse } from '@/types/admin-diagnostics';
import { classifyFlagValue, FLAG_VALUE_KINDS, type FlagValueKind } from '../feature-flags/flagValueKind';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { sourceStatus, sourceFreshness } from './sourceMetadata';

export function featureFlagMetrics(
  flags: FeatureFlagEntry[] | undefined, changes: FeatureFlagChange[] | undefined, t: TFunction,
): StatMetric[] {
  const typeCounts: Record<FlagValueKind, number | null> = {
    boolean: null, number: null, string: null, object: null, array: null, null: null,
  };
  for (const kind of FLAG_VALUE_KINDS) {
    typeCounts[kind] = flags?.filter(flag => classifyFlagValue(flag.value) === kind).length ?? null;
  }
  const flagsContext = flags ? FLAG_VALUE_KINDS.map(kind =>
    t(`admin.flags.statstrip.type.${kind}`, '{{count}} {{kind}} values', { count: typeCounts[kind], kind })).join(' · ')
    : t('admin.flags.statstrip.registryMissing', 'Registry snapshot not supplied');
  const auditContext = t('admin.flags.statstrip.auditContext', 'Returned recent audit rows only (limit 50); not lifetime totals or a selected date range.');
  const values = [
    ['total', 'admin.flags.stats.total', 'Total flags', flags?.length, flagsContext, 'Current registry entries, across all stored JSON value types.'],
    ['boolean', 'admin.flags.stats.boolean', 'Boolean toggles', typeCounts.boolean, flagsContext, 'Boolean-valued flags, including both true and false.'],
    ['structured', 'admin.flags.stats.structured', 'Structured',
      flags ? (typeCounts.object ?? 0) + (typeCounts.array ?? 0) : undefined,
      flagsContext, 'Object-valued and array-valued flags in the current registry.'],
    ['changes', 'admin.flags.stats.changes', 'Recent changes', changes?.length, auditContext, 'Number of returned recent audit rows, including deletions.'],
    ['deletes', 'admin.flags.stats.deletes', 'Deletes', changes?.filter(change => change.operation === 'delete').length,
      auditContext, 'Delete operations among returned recent audit rows.'],
    ['actors', 'admin.flags.stats.actors', 'Contributors',
      changes ? new Set(changes.map(change => (change.actor ?? '').trim()).filter(Boolean)).size : undefined,
      auditContext, 'Distinct non-empty trimmed actor identities in returned recent audit rows.'],
  ] as const;
  return values.map(([occurrenceId, key, fallback, rawValue, context, description]) => ({
    metricId: 'count', occurrenceId, rawValue: rawValue ?? null, label: t(key, fallback), context,
    description: t(`admin.flags.statstrip.${occurrenceId}Description`, description),
  }));
}

export function FeatureFlagsOperationalBrief({ flags, changes }: {
  flags: DataStateSource<FeatureFlagsListResponse>; changes: DataStateSource<FeatureFlagChangesResponse>;
}) {
  const { t } = useTranslation();
  const registry = deriveDataState(flags);
  const audit = deriveDataState(changes);
  const error = registry.fatalError ?? audit.fatalError ?? registry.refreshError ?? audit.refreshError;
  const briefMetrics = useOperationalMetrics(featureFlagMetrics(
    flags.data?.flags ?? (registry.hasData ? [] : undefined),
    changes.data?.rows ?? (audit.hasData ? [] : undefined), t));
  const retained = (registry.hasData && (registry.status === 'stale' || registry.isRefreshing))
    || (audit.hasData && (audit.status === 'stale' || audit.isRefreshing));
  return <section aria-label={t('admin.flags.stats.aria', 'Feature flag summary metrics')} data-retained={retained}>
    {retained && <Text role="status">{t('operationalSource.retained', 'Showing retained measurements')}</Text>}
    {error && <Text role="alert">{error.message}</Text>}
    <OperationalBrief testId="feature-flags-summary" compact metrics={briefMetrics}
      loading={registry.status === 'initial' && audit.status === 'initial'}
      eyebrow={t('admin.flags.brief.eyebrow', 'Feature flag operations')}
      title={t('admin.flags.brief.title', 'Registry and recent changes')}
      description={t('admin.flags.brief.description', 'Review stored value types alongside the recent audit subset. Registry edits and deletions remain sudo-gated and audited.')}
      statusLabel={t('admin.flags.brief.sourceStatus', 'Registry: {{registry}} · Audit: {{audit}}', {
        registry: sourceStatus(registry.status, t), audit: sourceStatus(audit.status, t),
      })}
      statusTone={error ? 'warning' : 'neutral'}
      scope={<Text as="span" variant="caption">{t('admin.flags.statstrip.period', 'Registry snapshot + recent audit subset')}</Text>}
      freshness={<Text as="span" variant="caption">{t('admin.flags.brief.freshness', 'Registry: {{registry}} · Audit: {{audit}}', {
        registry: sourceFreshness(registry.updatedAt, t), audit: sourceFreshness(audit.updatedAt, t),
      })}</Text>}
      provenance={t('admin.flags.statstrip.provenance', 'Registry counts describe the current feed. Changes, deletes and contributors describe only the separately fetched latest 50 audit rows; their date bounds are not supplied.')} />
    <Text variant="caption">{t('admin.flags.statstrip.provenance', 'Registry counts describe the current feed. Changes, deletes and contributors describe only the separately fetched latest 50 audit rows; their date bounds are not supplied.')}</Text>
    {registry.fatalError && <QueryError error={registry.fatalError} onRetry={() => { void flags.refetch?.(); }} />}
    {audit.fatalError && <QueryError error={audit.fatalError} onRetry={() => { void changes.refetch?.(); }} />}
  </section>;
}
