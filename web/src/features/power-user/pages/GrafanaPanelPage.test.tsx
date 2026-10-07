// Comprehensive behaviour suite for the Grafana Panel Builder page
// (`/power/grafana`). The gate that governs this elevation unit looks
// for a co-located `<name>.test.tsx`, so this file is deliberately named
// after the source module and exercises the page's full public surface:
//
//   1. Static render — page shell (title/subtitle), the derived
//      curated-catalog KPI band, the manual JSON editor, and every
//      curated catalog (panel types, datasource UIDs, table + column
//      catalog).
//   2. localStorage draft round-trip — the editor hydrates from the
//      persisted `ai.grafanaPanel.draft` key (loadPersistedJson) and
//      writes/removes it as the textarea changes (persistJson).
//   3. Copy-to-clipboard workflow — disabled-until-content gating, the
//      success path (trimmed write + success callout), the rejected-write
//      failure path (danger callout), and the clipboard-unavailable path
//      (warning callout).
//   4. Clear — empties the editor, drops the persisted draft, and resets
//      any status callout.
//   5. Apply-AI-draft wiring — the page's `handleApplyAiDraft` callback
//      pretty-prints the proposed panel envelope into the editor. The
//      Helix drafter child is mocked to a deterministic apply trigger so
//      this file isolates the *page's* propose-only wiring (the drafter's
//      own AI-off gating is proven by the sibling
//      TestNLGrafanaPanelAIOffManualEditorWorks suite).
//   6. Accessibility — the labelled summary region and named editor
//      controls.
//
// Conventions mirror the repo baseline (CopyButton.test.tsx,
// TestNLGrafanaPanelAIOffManualEditorWorks.test.tsx): fireEvent (no
// user-event dependency), a clipboard stub via Object.defineProperty, a
// framer-motion stub for deterministic eager render, and reliance on the
// real react-i18next fallback (uninitialised in jsdom → `t(key, def)`
// returns `def`).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Canonical localStorage key the page persists the editor draft under.
// Kept in sync with GRAFANA_PANEL_DRAFT_KEY in the source module (the
// constant is module-private, so we mirror the string literal here — it
// is a stable persisted contract, also asserted by the sibling suite).
const DRAFT_KEY = 'ai.grafanaPanel.draft';

// Deterministic draft the mocked Helix drafter emits through onApply.
// Hoisted so the (hoisted) vi.mock factory below can reference it and the
// test body can recompute the exact pretty-printed envelope the page
// should write into the editor.
const { applyDraft } = vi.hoisted(() => ({
  applyDraft: {
    prompt: 'daily distance for the trailing month',
    panel: {
      title: 'Distance per day (last 30d)',
      type: 'timeseries',
      datasource: { type: 'postgres', uid: 'tesla-postgres' },
      targets: [{ ref_id: 'A', raw_sql: 'SELECT 1' }],
      grid_pos: { x: 0, y: 0, w: 12, h: 8 },
    },
    rationale: 'sums drives.distance_m per day over the trailing 30 days',
    referenced_tables: ['drives'],
  },
}));

// Keep framer-motion deterministic in jsdom — render children eagerly
// with no rAF animation dance. Each `motion.<tag>` MUST resolve to a
// *stable* component (cached per tag): returning a fresh function on
// every proxy access makes React treat each render as a new element
// type and fully remount the subtree, which detaches controlled inputs
// and silently drops subsequent state updates.
vi.mock('framer-motion', () => {
  const cache = new Map<string, React.FC<Record<string, unknown>>>();
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (!cache.has(key)) {
            const Motion: React.FC<Record<string, unknown>> = (props) => {
              const { children, ...rest } = props as { children?: React.ReactNode };
              return (
                <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
              );
            };
            cache.set(key, Motion);
          }
          return cache.get(key);
        },
      },
    ),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

// Replace the Helix drafter with a deterministic apply trigger. This
// isolates the page's onApply wiring from the drafter's SSE/streaming
// internals and its ai_mode gate (both covered by their own suites).
vi.mock('@/components/ai/AINLGrafanaPanel', () => ({
  AINLGrafanaPanel: ({ onApply }: { onApply: (draft: typeof applyDraft) => void }) => (
    <button
      type="button"
      data-testid="mock-ai-apply"
      onClick={() => onApply(applyDraft)}
    >
      apply proposed draft
    </button>
  ),
}));

import GrafanaPanelPage from '@/features/power-user/pages/GrafanaPanelPage';

const clipboardWriteText = vi.fn<(text: string) => Promise<void>>();

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  clipboardWriteText.mockReset();
  clipboardWriteText.mockResolvedValue(undefined);
  setClipboard({ writeText: clipboardWriteText });
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/power/grafana']}>
        <GrafanaPanelPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function getEditor(): HTMLTextAreaElement {
  return screen.getByLabelText(/Grafana panel JSON editor/i) as HTMLTextAreaElement;
}

describe('GrafanaPanelPage', () => {
  it('renders the page shell and the curated-catalog KPI band with derived counts', async () => {
    renderPage();

    // Page root marker + title heading + subtitle.
    expect(
      await screen.findByTestId('power-grafana-panel-builder-root'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /Grafana Panel Builder/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Build a Grafana panel JSON envelope against the curated catalog/i),
    ).toBeInTheDocument();

    // KPI band is an accessible region whose four MetricCards surface the
    // counts derived from the install-static catalogs: 8 panel types, 2
    // datasources, 5 tables, 33 total columns.
    const summary = screen.getByRole('region', { name: /Curated catalog summary/i });
    expect(within(summary).getByText('Panel types')).toBeInTheDocument();
    expect(within(summary).getByText('Datasources')).toBeInTheDocument();
    expect(within(summary).getByText('Tables')).toBeInTheDocument();
    expect(within(summary).getByText('Columns')).toBeInTheDocument();
    expect(within(summary).getByText('8')).toBeInTheDocument();
    expect(within(summary).getByText('2')).toBeInTheDocument();
    expect(within(summary).getByText('5')).toBeInTheDocument();
    expect(within(summary).getByText('33')).toBeInTheDocument();
  });

  it('renders the full curated catalog: panel types, datasource UIDs, and tables + columns', () => {
    renderPage();

    // All eight curated panel types render so a user can build a panel
    // deterministically without external docs.
    for (const panelType of [
      'timeseries',
      'stat',
      'gauge',
      'table',
      'barchart',
      'heatmap',
      'piechart',
      'logs',
    ]) {
      expect(screen.getByText(panelType)).toBeInTheDocument();
    }

    // Both whitelisted datasource UIDs.
    expect(screen.getByText(/uid=tesla-postgres/i)).toBeInTheDocument();
    expect(screen.getByText(/uid=tesla-prometheus/i)).toBeInTheDocument();

    // The five curated tables plus a representative SI column from two of
    // them (proves the nested column list renders).
    for (const tableName of [
      'drives',
      'charging_sessions',
      'vehicles',
      'alerts',
      'signal_log_view',
    ]) {
      expect(screen.getByText(tableName)).toBeInTheDocument();
    }
    expect(screen.getByText('distance_m')).toBeInTheDocument();
    expect(screen.getByText('energy_added_wh')).toBeInTheDocument();
  });

  it('hydrates the editor from the persisted localStorage draft (loadPersistedJson)', () => {
    const persisted = '{\n  "title": "restored draft",\n  "type": "stat"\n}';
    window.localStorage.setItem(DRAFT_KEY, persisted);

    renderPage();

    expect(getEditor().value).toBe(persisted);
    // A non-empty editor means Copy + Clear are enabled on first paint.
    expect(screen.getByRole('button', { name: /Copy to clipboard/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeEnabled();
  });

  it('persists editor edits to localStorage and clears the key when emptied (persistJson)', () => {
    renderPage();
    const editor = getEditor();

    fireEvent.change(editor, { target: { value: '{"type":"gauge"}' } });
    expect(editor.value).toBe('{"type":"gauge"}');
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe('{"type":"gauge"}');

    // Emptying the editor removes the persisted key rather than storing ''.
    fireEvent.change(editor, { target: { value: '' } });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('keeps Copy + Clear disabled until the editor holds non-whitespace content', () => {
    renderPage();
    const copy = screen.getByRole('button', { name: /Copy to clipboard/i });
    const clear = screen.getByRole('button', { name: /Clear/i });

    // Empty on first paint.
    expect(copy).toBeDisabled();
    expect(clear).toBeDisabled();

    // Whitespace-only is still "empty" for the trim-based guard.
    fireEvent.change(getEditor(), { target: { value: '   \n  ' } });
    expect(copy).toBeDisabled();
    expect(clear).toBeDisabled();

    // Real content enables both affordances.
    fireEvent.change(getEditor(), { target: { value: '{"type":"logs"}' } });
    expect(copy).toBeEnabled();
    expect(clear).toBeEnabled();
  });

  it('copies the trimmed JSON to the clipboard and surfaces a success callout', async () => {
    renderPage();
    fireEvent.change(getEditor(), { target: { value: '  {"type":"stat"}  ' } });

    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));

    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledTimes(1));
    // Surrounding whitespace is trimmed before the write.
    expect(clipboardWriteText).toHaveBeenCalledWith('{"type":"stat"}');
    expect(
      await screen.findByText(/Copied\. Paste the JSON/i),
    ).toBeInTheDocument();
  });

  it('surfaces a danger callout when the clipboard write rejects', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('permission denied'));
    renderPage();
    fireEvent.change(getEditor(), { target: { value: '{"type":"table"}' } });

    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));

    expect(await screen.findByText(/Clipboard write failed/i)).toBeInTheDocument();
    expect(clipboardWriteText).toHaveBeenCalledTimes(1);
  });

  it('surfaces a warning callout when the clipboard API is unavailable', async () => {
    setClipboard(undefined);
    renderPage();
    fireEvent.change(getEditor(), { target: { value: '{"type":"heatmap"}' } });

    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));

    expect(
      await screen.findByText(/Clipboard access is not available in this browser/i),
    ).toBeInTheDocument();
    // No write is attempted when the API is missing.
    expect(clipboardWriteText).not.toHaveBeenCalled();
  });

  it('Clear empties the editor, drops the persisted draft, and resets any status', async () => {
    renderPage();
    const editor = getEditor();
    fireEvent.change(editor, { target: { value: '{"type":"piechart"}' } });

    // Produce a status callout first, then clear.
    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));
    expect(await screen.findByText(/Copied\. Paste the JSON/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));

    expect(editor.value).toBe('');
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.queryByText(/Copied\. Paste the JSON/i)).not.toBeInTheDocument();
    // Back to the disabled baseline.
    expect(screen.getByRole('button', { name: /Copy to clipboard/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeDisabled();
  });

  it('pretty-prints an applied AI draft into the editor (handleApplyAiDraft)', () => {
    renderPage();
    const editor = getEditor();
    expect(editor.value).toBe('');

    fireEvent.click(screen.getByTestId('mock-ai-apply'));

    // The page renders the full panel envelope as pretty-printed JSON so
    // the user pastes a Grafana-ready document.
    const expected = JSON.stringify(applyDraft.panel, null, 2);
    expect(editor.value).toBe(expected);
    expect(editor.value).toContain('"title": "Distance per day (last 30d)"');
    // Applying enables the copy affordance and leaves no stale copy status.
    expect(screen.getByRole('button', { name: /Copy to clipboard/i })).toBeEnabled();
    expect(screen.queryByText(/Copied\. Paste the JSON/i)).not.toBeInTheDocument();
  });

  it('exposes an accessible summary region and named, keyboard-operable editor controls', () => {
    renderPage();

    expect(
      screen.getByRole('region', { name: /Curated catalog summary/i }),
    ).toBeInTheDocument();
    expect(getEditor()).toHaveAttribute('aria-label');
    // Icon-bearing controls still expose text-based accessible names.
    expect(screen.getByRole('button', { name: /Copy to clipboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument();
  });
});
