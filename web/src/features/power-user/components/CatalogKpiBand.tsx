// KPI band for the SQL Playground — real facts derived from the static curated
// catalog (table count, documented column count) plus the two invariant
// properties of this surface (read-only access, SI storage units). It fetches
// nothing; the counts are passed in from the page so this stays presentational.

import { Columns3, Database, Ruler, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';

export interface CatalogKpiBandProps {
  tableCount: number;
  columnCount: number;
}

/**
 * Clamp a raw count to a safe, user-presentable non-negative integer. The KPI
 * counts are derived from a `.length` / `reduce` over the static catalog, so in
 * the happy path this is a no-op. The coercion is a defensive guard: a caller
 * passing `NaN` (an empty `reduce`), a negative, or a fractional value must
 * never surface as "NaN"/"-3"/"3.5 tables" in the band.
 */
export function safeCount(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function CatalogKpiBand({ tableCount, columnCount }: CatalogKpiBandProps) {
  const { t } = useTranslation();

  const tables = safeCount(tableCount);
  const columns = safeCount(columnCount);

  return (
    <section
      aria-label={t('powerSql.kpi.label', 'Catalog overview')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      <MetricCard
        label={t('powerSql.kpi.tables', 'Catalog tables')}
        value={tables}
        icon={<Database className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
        subtitle={t('powerSql.kpi.tablesSub', 'read-only surfaces')}
      />
      <MetricCard
        label={t('powerSql.kpi.columns', 'Documented columns')}
        value={columns}
        icon={<Columns3 className="h-5 w-5" aria-hidden="true" />}
        color="blue"
        subtitle={t('powerSql.kpi.columnsSub', 'across all tables')}
      />
      <MetricCard
        label={t('powerSql.kpi.access', 'Access mode')}
        value={t('powerSql.kpi.readonly', 'Read-only')}
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        color="green"
        subtitle={t('powerSql.kpi.accessSub', 'no writes possible')}
      />
      <MetricCard
        label={t('powerSql.kpi.units', 'Storage units')}
        value={t('powerSql.kpi.si', 'SI units')}
        icon={<Ruler className="h-5 w-5" aria-hidden="true" />}
        color="purple"
        subtitle={t('powerSql.kpi.unitsSub', 'm · s · Wh')}
      />
    </section>
  );
}
