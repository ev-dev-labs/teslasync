// Co-located contract tests for SqlPlaygroundPage (/power/sql).
//
// SqlPlaygroundPage is a thin orchestrator over a deterministic, read-only SQL
// composing surface: a KPI band fed by the static curated catalog, an opt-in AI
// drafter (mounted but propose-only), a manual SQL editor with Run/Clear/Copy
// affordances, and a curated schema catalog. It fetches nothing — every fact is
// derived from the in-repo CURATED_CATALOG constant or from local component
// state persisted to localStorage.
//
// These tests exercise every branch and interaction of the page:
//   1. Baseline render — header, editor, actions, reference panel, and every
//      curated table + a spot-check of unique columns.
//   2. Truthful KPI counts — table/column totals are DERIVED from the imported
//      CURATED_CATALOG so the assertion can never silently drift.
//   3. Affordance gating — Run/Clear/Copy are disabled while the editor is
//      empty (or whitespace-only, exercising the `sql.trim()` branch) and
//      enable once a real query is typed.
//   4. Run guidance — clicking Run surfaces the deterministic "no browser
//      execution" callout (there is no execution endpoint).
//   5. Clear — empties the editor, removes the persisted draft, and dismisses
//      the run callout.
//   6. Stale-message dismissal — editing the query after a Run clears the now
//      stale guidance (regression guard for the hardening fix).
//   7. Persistence — the draft round-trips through localStorage across a full
//      unmount + remount (covers loadPersistedSql + persistSql).
//   8. AI propose-only wiring — the page's onApply copies a typed draft into
//      the editor and clears any prior run message, without the AI surface ever
//      writing editor state itself.
//   9. Copy — the Copy affordance writes the current editor contents to the
//      clipboard.
//
// Network is never touched: the AI drafter (whose own on/off contract lives in
// the sibling __tests__/TestNlSqlPlayground* suites) is replaced with a
// deterministic test double, and the clipboard is stubbed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { ReadonlySQLDraft } from '@/components/ai/AINLSqlPlayground';
import { CURATED_CATALOG } from '../components/sqlCatalog';

// Deterministic i18n: return the default string (2nd arg) and interpolate any
// {{count}}-style placeholders from the options object. Mirrors the proven
// pattern in DevToolsPage.test.tsx — keeps assertions independent of whether a
// translation bundle is loaded in the jsdom run.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          const options =
            opts && typeof opts === 'object'
              ? (opts as Record<string, unknown>)
              : undefined;
          if (options) {
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in options ? String(options[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
    }),
  };
});

// Hoisted so the AI test double (a hoisted vi.mock factory) can reference the
// SQL string, and so matchMedia exists before framer-motion (via FadeIn's
// useMotionPreference) reads it.
const { AI_DRAFT_SQL } = vi.hoisted(() => {
  if (
    typeof globalThis.window !== 'undefined' &&
    typeof window.matchMedia !== 'function'
  ) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  return {
    AI_DRAFT_SQL:
      "SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL '7 days'",
  };
});

// Replace the real AI drafter with a deterministic affordance that invokes the
// page's `onApply` wiring with a typed draft. The drafter's own gated on/off
// contract is covered exhaustively by the sibling __tests__ suites.
vi.mock('@/components/ai/AINLSqlPlayground', () => ({
  AINLSqlPlayground: ({
    onApply,
  }: {
    onApply: (draft: ReadonlySQLDraft) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-ai-apply"
      onClick={() =>
        onApply({
          prompt: 'how many drives last week',
          sql: AI_DRAFT_SQL,
          rationale: 'counts the drives table over the trailing 7 days',
          referenced_tables: ['drives'],
        })
      }
    >
      apply ai draft
    </button>
  ),
}));

import SqlPlaygroundPage from './SqlPlaygroundPage';

const DRAFT_KEY = 'ai.sqlPlayground.draft';
const EDITOR_NAME = 'SQL query editor';

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
});

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/power/sql']}>
        <SqlPlaygroundPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function getEditor(): HTMLTextAreaElement {
  return screen.getByRole('textbox', {
    name: EDITOR_NAME,
  }) as HTMLTextAreaElement;
}

describe('SqlPlaygroundPage', () => {
  it('renders the deterministic baseline: header, editor, actions, reference panel, and every curated catalog table', async () => {
    renderPage();

    // Page chrome.
    expect(
      await screen.findByRole('heading', { name: 'SQL Playground', level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Compose read-only SELECT \/ WITH queries/i),
    ).toBeInTheDocument();

    // The manual SQL editor + its three affordances.
    expect(getEditor()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy query' }),
    ).toBeInTheDocument();

    // Reference panel (title + example caption + a tip).
    expect(screen.getByText('Working with queries')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(
      screen.getByText(/Reference the catalog below for exact column names/i),
    ).toBeInTheDocument();

    // The curated catalog renders one card per table.
    for (const table of CURATED_CATALOG) {
      expect(screen.getByText(table.name)).toBeInTheDocument();
    }
    // Spot-check a few columns that are unique to a single table.
    expect(screen.getByText('distance_m')).toBeInTheDocument();
    expect(screen.getByText('energy_added_wh')).toBeInTheDocument();
    expect(screen.getByText('signal_name')).toBeInTheDocument();
  });

  it('surfaces truthful KPI counts derived from the curated catalog', async () => {
    const expectedTables = CURATED_CATALOG.length;
    const expectedColumns = CURATED_CATALOG.reduce(
      (sum, tbl) => sum + (tbl.columns?.length ?? 0),
      0,
    );

    renderPage();

    const tablesCard = (await screen.findByText('Catalog tables')).closest(
      '[data-role="metric-card"]',
    ) as HTMLElement;
    expect(tablesCard).not.toBeNull();
    expect(
      within(tablesCard).getByText(String(expectedTables)),
    ).toBeInTheDocument();

    const columnsCard = screen
      .getByText('Documented columns')
      .closest('[data-role="metric-card"]') as HTMLElement;
    expect(
      within(columnsCard).getByText(String(expectedColumns)),
    ).toBeInTheDocument();

    // The two invariant KPIs render their literal values.
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('SI units')).toBeInTheDocument();
  });

  it('disables Run, Clear, and Copy while the editor is empty and enables them once a query is typed', async () => {
    renderPage();

    const run = await screen.findByRole('button', { name: 'Run' });
    const clear = screen.getByRole('button', { name: 'Clear' });
    const copy = screen.getByRole('button', { name: 'Copy query' });

    expect(run).toBeDisabled();
    expect(clear).toBeDisabled();
    expect(copy).toBeDisabled();

    // Whitespace-only stays disabled — exercises the `sql.trim()` guard.
    fireEvent.change(getEditor(), { target: { value: '   \n  ' } });
    expect(run).toBeDisabled();

    fireEvent.change(getEditor(), { target: { value: 'SELECT 1' } });
    expect(run).toBeEnabled();
    expect(clear).toBeEnabled();
    expect(copy).toBeEnabled();
  });

  it('clicking Run surfaces the read-only execution guidance (no execution endpoint)', async () => {
    renderPage();

    const editor = getEditor();
    fireEvent.change(editor, { target: { value: 'SELECT * FROM vehicles' } });

    // No callout before Run.
    expect(
      screen.queryByTestId('power-sql-run-message'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    const message = await screen.findByTestId('power-sql-run-message');
    expect(message).toBeInTheDocument();
    expect(message).toHaveTextContent(
      /Read-only execution from the browser is not enabled/i,
    );
    // The current query is never mutated by Run.
    expect(editor.value).toBe('SELECT * FROM vehicles');
  });

  it('Clear empties the editor, removes the persisted draft, and dismisses the run message', async () => {
    renderPage();

    const editor = getEditor();
    fireEvent.change(editor, { target: { value: 'SELECT * FROM drives' } });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe('SELECT * FROM drives');

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(
      await screen.findByTestId('power-sql-run-message'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(editor.value).toBe('');
    expect(
      screen.queryByTestId('power-sql-run-message'),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('editing the query after a Run dismisses the now-stale run guidance', async () => {
    renderPage();

    const editor = getEditor();
    fireEvent.change(editor, { target: { value: 'SELECT 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(
      await screen.findByTestId('power-sql-run-message'),
    ).toBeInTheDocument();

    // Typing a new query invalidates the previous guidance.
    fireEvent.change(editor, { target: { value: 'SELECT 2' } });
    expect(
      screen.queryByTestId('power-sql-run-message'),
    ).not.toBeInTheDocument();
    expect(editor.value).toBe('SELECT 2');
  });

  it('persists the draft to localStorage and restores it when the page remounts', async () => {
    const first = renderPage();
    fireEvent.change(getEditor(), {
      target: { value: 'SELECT vin FROM vehicles' },
    });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(
      'SELECT vin FROM vehicles',
    );

    // Full teardown, then a fresh mount reads the persisted draft on init.
    first.unmount();

    renderPage();
    const restored = await screen.findByRole('textbox', { name: EDITOR_NAME });
    expect((restored as HTMLTextAreaElement).value).toBe(
      'SELECT vin FROM vehicles',
    );
  });

  it('applies an AI-proposed draft into the editor via onApply (propose-only wiring)', async () => {
    renderPage();

    const editor = getEditor();
    expect(editor.value).toBe('');

    // A prior run message must be cleared when a new draft is applied.
    fireEvent.change(editor, { target: { value: 'SELECT 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(
      await screen.findByTestId('power-sql-run-message'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-ai-apply'));

    expect(editor.value).toBe(AI_DRAFT_SQL);
    expect(
      screen.queryByTestId('power-sql-run-message'),
    ).not.toBeInTheDocument();
    // Applying a non-empty draft re-enables Run.
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
  });

  it('Copy query writes the current editor contents to the clipboard', async () => {
    renderPage();

    fireEvent.change(getEditor(), {
      target: { value: 'SELECT * FROM alerts' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy query' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('SELECT * FROM alerts'),
    );
  });
});
