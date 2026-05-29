// Manual SQL editor surface mounted at /power/sql.
//
// The baseline UI is a manual SQL textarea, curated schema catalog viewer,
// and Apply target. The optional AI drafter (AINLSqlPlayground) is rendered
// alongside via withAiFeature, so it is absent in off-mode and propose-only
// in on-mode. The user must explicitly click Apply to editor to copy the
// LLM proposal into the textarea, then explicitly click Run.
//
// This page does NOT expose a SQL execution endpoint. The Run button shows a
// deterministic help message instructing the user to copy the query into a
// read-only DB tool. A future typed read-only execution endpoint can replace
// that handler without changing this page's structure or the AI drafter's
// contract.
//
// State persistence: SQL textarea contents are persisted to localStorage under
// the canonical 'ai.sqlPlayground.draft' key.
//
// Visual layout:
//   - Page header (title + AI drafter section conditionally
//     mounted via withAiFeature)
//   - Manual SQL editor (Textarea + Run button + Clear button)
//   - Curated schema catalog viewer (a table-by-table list of
//     column metadata so the user can write SQL deterministically
//     without consulting external docs)
//
// ADR-015 alignment:
//   - I3 baseline intact: this page renders the manual SQL editor
//     + curated catalog regardless of the AI feature toggle's
//     state. The AI drafter section is opt-in propose-only
//     suggestion layered alongside.
//   - I5 hidden UI:       AINLSqlPlayground is wrapped by
//     withAiFeature so the entire AI section is absent from the
//     DOM in off-mode.
//   - I8 propose-only:    the page never auto-executes the LLM's
//     proposal. The user must explicitly click Apply to editor
//     and then explicitly click Run.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AINLSqlPlayground,
  type ReadonlySQLDraft,
} from '@/components/ai/AINLSqlPlayground';
import { Stack } from '@/components/layout';
import { Button, GlassPanel, PageTitle, PanelTitle, Textarea } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';

// Canonical localStorage key for the SQL draft. Persisted across navigation
// so a user typing a long query doesn't lose progress on accidental reload.
const SQL_PLAYGROUND_DRAFT_KEY = 'ai.sqlPlayground.draft';

// CuratedTable is a static descriptor mirroring the Go-side
// AINLSQLSchemaCatalogEntry shape declared in
// internal/api/ai_nl_sql_playground_handler.go's
// nlSqlPlaygroundCuratedCatalog. We duplicate the catalog here
// (instead of fetching it via a new API hook) for two reasons:
//
//   1. The catalog is install-wide-static — it does not vary per
//      user / per vehicle / per tenant. Fetching it would add a
//      round-trip without any actual dynamism.
//   2. A future dynamic catalog can swap the static array for a hook response
//      without churning this page's render tree.
interface CuratedColumn {
  name: string;
  type: string;
  description: string;
}
interface CuratedTable {
  name: string;
  description: string;
  columns: CuratedColumn[];
}

const CURATED_CATALOG: CuratedTable[] = [
  {
    name: 'drives',
    description: 'Per-trip aggregates for completed drives',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle this drive belongs to' },
      { name: 'started_at', type: 'timestamptz', description: 'drive start UTC' },
      { name: 'ended_at', type: 'timestamptz', description: 'drive end UTC' },
      { name: 'distance_m', type: 'double precision', description: 'distance meters (SI)' },
      { name: 'duration_s', type: 'double precision', description: 'duration seconds (SI)' },
      { name: 'energy_used_wh', type: 'double precision', description: 'energy watt-hours (SI)' },
      { name: 'regen_wh', type: 'double precision', description: 'regen watt-hours' },
      { name: 'avg_speed_mps', type: 'double precision', description: 'avg speed m/s (SI)' },
      { name: 'max_speed_mps', type: 'double precision', description: 'max speed m/s' },
    ],
  },
  {
    name: 'charging_sessions',
    description: 'Per-charge aggregates for completed charging sessions',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle being charged' },
      { name: 'started_at', type: 'timestamptz', description: 'session start UTC' },
      { name: 'ended_at', type: 'timestamptz', description: 'session end UTC' },
      { name: 'energy_added_wh', type: 'double precision', description: 'energy added watt-hours (SI)' },
      { name: 'cost_cents', type: 'bigint', description: 'session cost in user-currency cents' },
      { name: 'charger_kind', type: 'text', description: 'home, supercharger, third_party' },
      { name: 'max_power_w', type: 'double precision', description: 'peak power watts' },
    ],
  },
  {
    name: 'vehicles',
    description: 'Vehicle metadata',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vin', type: 'text', description: 'Tesla VIN (PII)' },
      { name: 'display_name', type: 'text', description: 'user-chosen display name (PII)' },
      { name: 'model', type: 'text', description: 'model code' },
      { name: 'color', type: 'text', description: 'exterior color slug' },
    ],
  },
  {
    name: 'alerts',
    description: 'User-defined alerts that have fired',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle the alert fired for' },
      { name: 'alert_rule_id', type: 'bigint', description: 'alert rule that fired' },
      { name: 'fired_at', type: 'timestamptz', description: 'fire timestamp UTC' },
      { name: 'level', type: 'text', description: 'info, warn, critical' },
    ],
  },
  {
    name: 'signal_log_view',
    description: 'Telemetry signal history exposed as a stable view',
    columns: [
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle the signal belongs to' },
      { name: 'signal_name', type: 'text', description: 'canonical signal name' },
      { name: 'ts', type: 'timestamptz', description: 'sample timestamp UTC' },
      { name: 'num_value', type: 'double precision', description: 'numeric value (SI), null if non-numeric' },
      { name: 'str_value', type: 'text', description: 'string value, null if numeric' },
    ],
  },
];

function loadPersistedSql(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(SQL_PLAYGROUND_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistSql(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(SQL_PLAYGROUND_DRAFT_KEY, value);
    } else {
      window.localStorage.removeItem(SQL_PLAYGROUND_DRAFT_KEY);
    }
  } catch {
    /* ignore — quota exceeded etc. */
  }
}

export default function SqlPlaygroundPage() {
  const { t } = useTranslation();
  usePageTitle(t('powerSql.title', 'SQL Playground'));

  const [sql, setSql] = useState<string>(() => loadPersistedSql());
  const [runMessage, setRunMessage] = useState<string>('');

  // Persist the SQL textarea contents so a long query survives a
  // navigation away + back. Synchronous setItem in the effect is
  // fine — modern browsers handle 4KB writes in <1ms.
  useEffect(() => {
    persistSql(sql);
  }, [sql]);

  const handleApplyAiDraft = useCallback((draft: ReadonlySQLDraft) => {
    setSql(draft.sql);
    setRunMessage('');
  }, []);

  const handleClear = useCallback(() => {
    setSql('');
    setRunMessage('');
  }, []);

  const handleRun = useCallback(() => {
    const trimmed = sql.trim();
    if (!trimmed) {
      setRunMessage(
        t(
          'powerSql.editor.runEmpty',
          'Type or paste a SELECT/WITH query above before running.',
        ),
      );
      return;
    }
    // There is no backend SQL execution endpoint yet. Surface a deterministic
    // instruction directing the user to a read-only DB tool. A future typed
    // read-only execution endpoint can swap this branch for an actual fetch.
    setRunMessage(
      t(
        'powerSql.editor.runUnavailable',
        'Read-only execution from the browser is not enabled in this build. Copy the query into your preferred database client (psql, DBeaver, TablePlus) and run it there.',
      ),
    );
  }, [sql, t]);

  const sortedTables = useMemo(
    () => [...CURATED_CATALOG].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const canRun = sql.trim().length > 0;

  return (
    <div className="space-y-6 p-6" data-testid="power-sql-playground-root">
      <PageTitle>{t('powerSql.title', 'SQL Playground')}</PageTitle>

      <p className="text-sm text-[var(--text-secondary)]">
        {t(
          'powerSql.intro',
          'Write read-only SELECT or WITH queries against the curated schema catalog below. Queries do NOT execute from the browser; copy your query into your preferred database client.',
        )}
      </p>

      <AINLSqlPlayground onApply={handleApplyAiDraft} />

      <GlassPanel>
        <Stack className="gap-4">
          <PanelTitle>{t('powerSql.editor.title', 'Manual SQL editor')}</PanelTitle>
          <Textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder={t(
              'powerSql.editor.placeholder',
              'SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL \'7 days\'',
            )}
            rows={10}
            aria-label={t('powerSql.editor.label', 'SQL query editor')}
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={handleRun}
              disabled={!canRun}
              aria-disabled={!canRun ? 'true' : 'false'}
            >
              {t('powerSql.editor.run', 'Run')}
            </Button>
            <Button variant="secondary" onClick={handleClear} disabled={!canRun}>
              {t('powerSql.editor.clear', 'Clear')}
            </Button>
            {runMessage && (
              <span className="text-sm text-amber-300" role="status">
                {runMessage}
              </span>
            )}
          </div>
        </Stack>
      </GlassPanel>

      <GlassPanel>
        <Stack className="gap-4">
          <PanelTitle>
            {t('powerSql.catalog.title', 'Curated schema catalog')}
          </PanelTitle>
          <p className="text-sm text-[var(--text-secondary)]">
            {t(
              'powerSql.catalog.intro',
              'These tables are the only tables the curated catalog exposes. The Helix natural-language drafter refuses any query referencing tables outside this list.',
            )}
          </p>
          <ul className="space-y-4">
            {sortedTables.map((table) => (
              <li key={table.name} className="rounded-md border border-[var(--border-subtle)] p-4">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-base text-cyan-300">
                    {table.name}
                  </span>
                  <span className="text-sm text-[var(--text-secondary)]">{table.description}</span>
                </div>
                <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {table.columns.map((col) => (
                    <li key={col.name} className="text-xs text-[var(--text-secondary)]">
                      <span className="font-mono text-emerald-300">{col.name}</span>
                      <span className="text-[var(--text-muted)]"> · </span>
                      <span className="text-[var(--text-secondary)]">{col.type}</span>
                      <span className="text-[var(--text-muted)]"> — </span>
                      <span>{col.description}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Stack>
      </GlassPanel>
    </div>
  );
}
