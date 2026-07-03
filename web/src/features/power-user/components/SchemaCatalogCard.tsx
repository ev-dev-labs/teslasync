// Presentational card for a single curated catalog table.
//
// Extracted from SqlPlaygroundPage so the page stays a thin orchestrator and
// the catalog renders as a responsive bento of cards (one card per table) that
// flow into as many columns as the viewport allows. Purely presentational — it
// owns no state and fetches nothing; the static catalog lives in ./sqlCatalog.

import { Database, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';

import type { CuratedTable } from './sqlCatalog';

export interface SchemaCatalogCardProps {
  table: CuratedTable;
}

/**
 * SchemaCatalogCard renders one curated table as a self-contained GlassPanel:
 * a mono table name (h3), a one-line description, a column-count chip, and the
 * column list with SI-aware descriptions. Primary-key columns get a key icon
 * so the status is conveyed by shape + text, not colour alone.
 */
export function SchemaCatalogCard({ table }: SchemaCatalogCardProps) {
  const { t } = useTranslation();
  const columns = table.columns ?? [];

  return (
    <GlassPanel hover glow="cyan" className="flex h-full flex-col p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-2.5">
        <span
          className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 p-1.5 ring-1 ring-cyan-400/20"
          aria-hidden="true"
        >
          <Database className="h-4 w-4 text-cyan-300" />
        </span>
        <div className="min-w-0 flex-1">
          <PanelTitle className="truncate font-mono text-cyan-300">
            {table.name}
          </PanelTitle>
          <Text variant="bodySm" as="p" className="mt-0.5">
            {table.description}
          </Text>
        </div>
        <span className="shrink-0 rounded-full bg-white/[0.04] px-2 py-0.5 text-2xs font-medium tabular-nums text-[var(--text-muted)]">
          {t('powerSql.catalog.columnCount', '{{count}} cols', {
            count: columns.length,
          })}
        </span>
      </div>

      <ul className="space-y-1.5">
        {columns.map((col) => {
          const isPrimaryKey = (col.description ?? '').toLowerCase() === 'primary key';
          return (
            <li
              key={col.name}
              className="rounded-md border border-[var(--border-subtle)] bg-white/[0.02] px-2.5 py-1.5"
            >
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                {isPrimaryKey && (
                  <KeyRound
                    className="h-3 w-3 shrink-0 self-center text-amber-300"
                    aria-label={t('powerSql.catalog.primaryKey', 'Primary key')}
                  />
                )}
                <Text mono size="xs" className="text-emerald-300">
                  {col.name}
                </Text>
                <Text variant="caption">{col.type}</Text>
              </div>
              <Text variant="caption" as="p" className="mt-0.5">
                {col.description}
              </Text>
            </li>
          );
        })}
      </ul>
    </GlassPanel>
  );
}
