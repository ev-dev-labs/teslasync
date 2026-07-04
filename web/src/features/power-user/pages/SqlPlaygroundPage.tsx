// Manual SQL editor surface mounted at /power/sql.
//
// The baseline UI is a manual SQL textarea, a curated schema catalog viewer,
// and a read-only composing workflow. The optional AI drafter
// (AINLSqlPlayground) is rendered alongside via withAiFeature, so it is absent
// in off-mode and propose-only in on-mode. The user must explicitly click
// "Apply to editor" to copy the LLM proposal into the textarea, then explicitly
// click Run.
//
// This page does NOT expose a SQL execution endpoint. The Run button surfaces a
// deterministic help message instructing the user to copy the query into a
// read-only DB tool (a Copy button makes that one click). A future typed
// read-only execution endpoint can replace that handler without changing this
// page's structure or the AI drafter's contract.
//
// State persistence: SQL textarea contents are persisted to localStorage under
// the canonical 'ai.sqlPlayground.draft' key so a long query survives an
// accidental reload.
//
// Modern-UI layout (full-width responsive bento). The page is a thin
// orchestrator; each section is a shared component or an extracted sibling in
// ../components:
//   - PageContainer header (title + subtitle)
//   - CatalogKpiBand: catalog stats (tables, columns, access mode, units)
//   - AINLSqlPlayground: AI drafter (mounted, hidden in off-mode)
//   - Query workspace bento: the manual SQL editor (hero, spans 2 cols on xl)
//     beside a QueryReferencePanel with tips + a copy-ready example
//   - Curated schema catalog: an auto-fit grid of SchemaCatalogCard that
//     reflows into more columns as the viewport widens
//
// ADR-015 alignment:
//   - I3 baseline intact: this page renders the manual SQL editor + curated
//     catalog regardless of the AI feature toggle's state. The AI drafter
//     section is an opt-in propose-only suggestion layered alongside.
//   - I5 hidden UI:    AINLSqlPlayground is wrapped by withAiFeature so the
//     entire AI section is absent from the DOM in off-mode.
//   - I8 propose-only: the page never auto-executes the LLM's proposal. The
//     user must explicitly click Apply to editor and then explicitly click Run.

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Info, Play, TerminalSquare, Trash2 } from 'lucide-react';

import {
  AINLSqlPlayground,
  type ReadonlySQLDraft,
} from '@/components/ai/AINLSqlPlayground';
import { PageContainer } from '@/components/layout';
import {
  Button,
  CopyButton,
  GlassPanel,
  PanelTitle,
  SectionTitle,
  Text,
  Textarea,
} from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';

import { CatalogKpiBand } from '../components/CatalogKpiBand';
import { QueryReferencePanel } from '../components/QueryReferencePanel';
import { SchemaCatalogCard } from '../components/SchemaCatalogCard';
import { CURATED_CATALOG } from '../components/sqlCatalog';

// Canonical localStorage key for the SQL draft. Persisted across navigation
// so a user typing a long query doesn't lose progress on accidental reload.
const SQL_PLAYGROUND_DRAFT_KEY = 'ai.sqlPlayground.draft';

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

  // Persist the SQL textarea contents so a long query survives a navigation
  // away + back. Synchronous setItem in the effect is fine — modern browsers
  // handle 4KB writes in <1ms.
  useEffect(() => {
    persistSql(sql);
  }, [sql]);

  const handleApplyAiDraft = useCallback((draft: ReadonlySQLDraft) => {
    // The draft arrives from an SSE tool_result payload — defend the render
    // against a malformed frame whose `sql` is missing so the controlled
    // Textarea never flips to an uncontrolled `undefined` value.
    setSql(draft.sql ?? '');
    setRunMessage('');
  }, []);

  // Editing the query invalidates any run guidance shown for the *previous*
  // query — clear it so a stale "copy this into your DB client" callout never
  // lingers over a changed (or emptied) editor. A stable identity also keeps
  // the Textarea's onChange reference constant across renders.
  const handleSqlChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setSql(e.target.value);
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

  // KPI band values — real facts derived from the static catalog, not fetched.
  const tableCount = CURATED_CATALOG.length;
  const columnCount = useMemo(
    () => CURATED_CATALOG.reduce((sum, tbl) => sum + (tbl.columns?.length ?? 0), 0),
    [],
  );

  const canRun = sql.trim().length > 0;

  return (
    <PageContainer
      title={t('powerSql.title', 'SQL Playground')}
      subtitle={t(
        'powerSql.subtitle',
        'Compose read-only SELECT / WITH queries against the curated schema catalog. Queries never execute in the browser — copy them into your database client.',
      )}
    >
      <div className="space-y-6" data-testid="power-sql-playground-root">
        {/* 1 — KPI band: real catalog stats, reflows 2 → 4 columns */}
        <FadeIn>
          <CatalogKpiBand tableCount={tableCount} columnCount={columnCount} />
        </FadeIn>

        {/* 2 — AI drafter (absent from the DOM in off-mode via withAiFeature) */}
        <AINLSqlPlayground onApply={handleApplyAiDraft} />

        {/* 3 — Query workspace: editor hero + reference panel */}
        <FadeIn delay={0.1}>
          <section
            aria-label={t('powerSql.workspace.label', 'Query workspace')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3"
          >
            <GlassPanel className="space-y-3 p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="flex items-center gap-2">
                <TerminalSquare className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('powerSql.editor.title', 'Manual SQL editor')}
              </PanelTitle>
              <Textarea
                value={sql}
                onChange={handleSqlChange}
                placeholder={t(
                  'powerSql.editor.placeholder',
                  'SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL \'7 days\'',
                )}
                rows={12}
                aria-label={t('powerSql.editor.label', 'SQL query editor')}
                spellCheck={false}
                className="font-mono"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  onClick={handleRun}
                  disabled={!canRun}
                  aria-disabled={!canRun ? 'true' : 'false'}
                  icon={<Play className="h-4 w-4" aria-hidden="true" />}
                >
                  {t('powerSql.editor.run', 'Run')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleClear}
                  disabled={!canRun}
                  icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                >
                  {t('powerSql.editor.clear', 'Clear')}
                </Button>
                <CopyButton
                  text={sql}
                  variant="outline"
                  size="md"
                  disabled={!canRun}
                  label={t('powerSql.editor.copy', 'Copy query')}
                  title={t(
                    'powerSql.editor.copyTitle',
                    'Copy the query to paste into your database client',
                  )}
                />
              </div>
              {runMessage && (
                <InlineCallout
                  variant="warning"
                  icon={<Info className="h-4 w-4" />}
                  testId="power-sql-run-message"
                >
                  {runMessage}
                </InlineCallout>
              )}
            </GlassPanel>

            <QueryReferencePanel />
          </section>
        </FadeIn>

        {/* 4 — Curated schema catalog: auto-fit bento of table cards */}
        <FadeIn delay={0.2}>
          <section aria-label={t('powerSql.catalog.title', 'Curated schema catalog')}>
            <div className="mb-1 flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              <SectionTitle>
                {t('powerSql.catalog.title', 'Curated schema catalog')}
              </SectionTitle>
            </div>
            <Text variant="bodySm" as="p" className="mb-4 max-w-3xl">
              {t(
                'powerSql.catalog.intro',
                'These tables are the only tables the curated catalog exposes. The Helix natural-language drafter refuses any query referencing tables outside this list.',
              )}
            </Text>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
              {sortedTables.map((table) => (
                <SchemaCatalogCard key={table.name} table={table} />
              ))}
            </div>
          </section>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
