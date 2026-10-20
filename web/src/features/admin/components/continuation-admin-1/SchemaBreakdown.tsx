import { useTranslation } from 'react-i18next';
import { Clock, GitCompare } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Caption, Text } from '@/components/ui';
import { SeverityBadge } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { formatRelativeTime } from '@/lib/dateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatSchemaDelta, schemaDeltaTone, type SchemaSectionState } from './schemaPresentation';

export function SchemaBreakdown({ state }: { state: SchemaSectionState }) {
  const { t } = useTranslation();
  const { drift, isLoading, error, onRetry } = state;
  return (
    <LayoutCard title={t('admin.schemaDrift.breakdownTitle', 'Drift breakdown')}
      actions={<GitCompare className="h-4 w-4 text-cyan-300" aria-hidden />}>
      <Caption>{t('admin.schemaDrift.breakdownSub', 'Per-object comparison of current vs seed')}</Caption>
      {isLoading ? <Skeleton height={150} /> : error ? <QueryError error={error} onRetry={onRetry} /> : !drift ? (
        // no-action: the page header refreshes the shared schema query; this comparison has no independent recovery.
        <EmptyState icon={<GitCompare className="h-8 w-8" aria-hidden />}
          message={t('admin.schemaDrift.breakdownEmpty', 'No comparison available yet.')} />
      ) : (
        <>
          <ul className="space-y-3">
            <CategoryRow label={t('admin.schemaDrift.tables', 'Tables')}
              current={drift.current?.table_count} expected={drift.expected?.table_count} delta={drift.table_count_delta} />
            <CategoryRow label={t('admin.schemaDrift.columns', 'Columns')}
              current={drift.current?.column_count} expected={drift.expected?.column_count} delta={drift.column_count_delta} />
            <CategoryRow label={t('admin.schemaDrift.indexes', 'Indexes')}
              current={drift.current?.index_count} expected={drift.expected?.index_count} delta={drift.index_count_delta} />
          </ul>
          {drift.expected_generated_at && (
            <Caption className="mt-4 flex items-center gap-1.5 border-t border-[var(--border-subtle)] pt-3">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('admin.schemaDrift.seedCaptured', 'Seed captured {{when}}', { when: formatRelativeTime(drift.expected_generated_at) })}
            </Caption>
          )}
        </>
      )}
    </LayoutCard>
  );
}

function CategoryRow({ label, current, expected, delta }: {
  label: string; current: number | null | undefined; expected: number | null | undefined; delta: number | null | undefined;
}) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const count = (value: number | null | undefined) => value == null ? '—' : fmtInt(value);
  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <Text as="div" variant="body" className="break-words">{label}</Text>
        <Caption className="tabular-nums">
          {t('admin.schemaDrift.currentExpected', '{{current}} → {{expected}}', { current: count(current), expected: count(expected) })}
        </Caption>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Text as="span" variant="bodySm" className="tabular-nums">{formatSchemaDelta(delta)}</Text>
        {delta != null && Number.isFinite(delta) && (
          <SeverityBadge severity={schemaDeltaTone(delta)} size="sm">
            {delta === 0 ? t('admin.schemaDrift.match', 'Match') : t('admin.schemaDrift.drift', 'Drift')}
          </SeverityBadge>
        )}
      </div>
    </li>
  );
}
