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

export function CatalogKpiBand({ tableCount, columnCount }: CatalogKpiBandProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('powerSql.kpi.label', 'Catalog overview')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      <MetricCard
        label={t('powerSql.kpi.tables', 'Catalog tables')}
        value={tableCount}
        icon={<Database className="h-5 w-5" />}
        color="cyan"
        subtitle={t('powerSql.kpi.tablesSub', 'read-only surfaces')}
      />
      <MetricCard
        label={t('powerSql.kpi.columns', 'Documented columns')}
        value={columnCount}
        icon={<Columns3 className="h-5 w-5" />}
        color="blue"
        subtitle={t('powerSql.kpi.columnsSub', 'across all tables')}
      />
      <MetricCard
        label={t('powerSql.kpi.access', 'Access mode')}
        value={t('powerSql.kpi.readonly', 'Read-only')}
        icon={<ShieldCheck className="h-5 w-5" />}
        color="green"
        subtitle={t('powerSql.kpi.accessSub', 'no writes possible')}
      />
      <MetricCard
        label={t('powerSql.kpi.units', 'Storage units')}
        value={t('powerSql.kpi.si', 'SI units')}
        icon={<Ruler className="h-5 w-5" />}
        color="purple"
        subtitle={t('powerSql.kpi.unitsSub', 'm · s · Wh')}
      />
    </section>
  );
}
