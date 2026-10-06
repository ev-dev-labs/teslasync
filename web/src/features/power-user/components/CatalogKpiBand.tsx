// KPI band for the SQL Playground — real facts derived from the static curated
// catalog (table count, documented column count) plus the two invariant
// properties of this surface (read-only access, SI storage units). It fetches
// nothing; the counts are passed in from the page so this stays presentational.

import { Columns3, Database, Ruler, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

export interface CatalogKpiBandProps {
  tableCount: number;
  columnCount: number;
}

/**
 * Retained count-normalization utility. The Brief deliberately bypasses this
 * coercion so malformed source values remain invalid rather than measured zero.
 */
export function safeCount(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function CatalogKpiBand({ tableCount, columnCount }: CatalogKpiBandProps) {
  const { t } = useTranslation();

  const metrics = useOperationalMetrics([
    {
      metricId: 'count', occurrenceId: 'tables', rawValue: tableCount,
      label: t('powerSql.kpi.tables', 'Catalog tables'),
      description: t('powerSql.kpi.tablesSub', 'read-only surfaces'),
      context: <Database className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'count', occurrenceId: 'columns', rawValue: columnCount,
      label: t('powerSql.kpi.columns', 'Documented columns'),
      description: t('powerSql.kpi.columnsSub', 'across all tables'),
      context: <Columns3 className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'status', occurrenceId: 'access',
      rawValue: t('powerSql.kpi.readonly', 'Read-only'),
      label: t('powerSql.kpi.access', 'Access mode'),
      description: t('powerSql.kpi.accessSub', 'no writes possible'),
      context: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'text', occurrenceId: 'units',
      rawValue: t('powerSql.kpi.si', 'SI units'),
      label: t('powerSql.kpi.units', 'Storage units'),
      description: t('powerSql.kpi.unitsSub', 'm · s · Wh'),
      context: <Ruler className="h-4 w-4" aria-hidden="true" />,
    },
  ] satisfies readonly StatMetric[]);
  const invalidCounts = metrics.some((metric) => metric.valueState !== 'value');

  return (
    <OperationalBrief
      compact
      eyebrow={t('powerSql.brief.eyebrow', 'SQL reference')}
      title={t('powerSql.kpi.label', 'Catalog overview')}
      description={t('powerSql.brief.description', 'Counts describe the bundled curated schema, not database rows or query results. Queries never execute in the browser.')}
      statusLabel={invalidCounts
        ? t('powerSql.brief.invalid', 'Invalid catalog counts')
        : t('powerSql.brief.status', 'Static reference')}
      statusTone={invalidCounts ? 'warning' : 'neutral'}
      scope={t('powerSql.brief.scope', 'Bundled schema catalog · all entries')}
      freshness={t('powerSql.brief.freshness', 'Reference data · no live measurement')}
      provenance={t('powerSql.brief.provenance', 'Table and column counts come from the bundled curated SQL catalog. Read-only composing and SI storage are reference properties; no query has been executed.')}
      metrics={metrics}
      testId="power-sql-catalog-brief"
    />
  );
}
