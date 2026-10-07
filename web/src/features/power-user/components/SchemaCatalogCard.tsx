// Presentational card for a single curated catalog table.
//
// Extracted from SqlPlaygroundPage so the page stays a thin orchestrator and
// the catalog renders as a responsive bento of cards (one card per table) that
// flow into as many columns as the viewport allows. Purely presentational — it
// owns no state and fetches nothing; the static catalog lives in ./sqlCatalog.

import { memo } from 'react';
import { Database, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';

import type { CuratedTable } from './sqlCatalog';

export interface SchemaCatalogCardProps {
  table: CuratedTable;
}

// Em-dash placeholder surfaced for a missing identity/type field on a malformed
// catalog entry, so a card never renders a blank slot where a value belongs.
const EM_DASH = '—';

// A column whose (trimmed, case-folded) description is exactly this marker is a
// primary key and gets the key glyph — status conveyed by shape + text, not
// colour alone.
const PRIMARY_KEY_MARKER = 'primary key';

/**
 * SchemaCatalogCard renders one curated table as a self-contained GlassPanel:
 * a mono table name (h3), a one-line description, a column-count chip, and the
 * column list with SI-aware descriptions. Primary-key columns get a key icon
 * so the status is conveyed by shape + text, not colour alone.
 */
function SchemaCatalogCardBase({ table }: SchemaCatalogCardProps) {
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
            {table.name || EM_DASH}
          </PanelTitle>
          <Text variant="bodySm" as="p" className="mt-0.5">
            {table.description || t('powerSql.catalog.noDescription', 'No description')}
          </Text>
        </div>
        <Text
          as="span"
          size="2xs"
          weight="medium"
          color="muted"
          className="shrink-0 rounded-full bg-white/[0.04] px-2 py-0.5 tabular-nums"
        >
          {t('powerSql.catalog.columnCount', '{{count}} cols', {
            count: columns.length,
          })}
        </Text>
      </div>

      {columns.length > 0 ? (
        <ul className="space-y-1.5">
          {columns.map((col) => {
            const isPrimaryKey =
              (col.description ?? '').trim().toLowerCase() === PRIMARY_KEY_MARKER;
            return (
              <li
                key={col.name}
                className="rounded-md border border-[var(--border-subtle)] bg-white/[0.02] px-2.5 py-1.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  {isPrimaryKey && (
                    <KeyRound
                      role="img"
                      className="h-3 w-3 shrink-0 self-center text-amber-300"
                      aria-label={t('powerSql.catalog.primaryKey', 'Primary key')}
                    />
                  )}
                  <Text mono size="xs" className="text-emerald-300">
                    {col.name || EM_DASH}
                  </Text>
                  <Text variant="caption">{col.type || EM_DASH}</Text>
                </div>
                {col.description ? (
                  <Text variant="caption" as="p" className="mt-0.5">
                    {col.description}
                  </Text>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Text
          variant="caption"
          as="p"
          className="rounded-md border border-dashed border-[var(--border-subtle)] bg-white/[0.02] px-2.5 py-3 text-center"
        >
          {t('powerSql.catalog.noColumns', 'No columns documented for this table.')}
        </Text>
      )}
    </GlassPanel>
  );
}

export const SchemaCatalogCard = memo(SchemaCatalogCardBase);
SchemaCatalogCard.displayName = 'SchemaCatalogCard';
