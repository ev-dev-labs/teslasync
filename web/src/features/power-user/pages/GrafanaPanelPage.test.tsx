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
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
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
import { typography } from '@/lib/tokens';

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
  it('associates the visible editor label and manual-copy guidance across draft edits', () => {
    renderPage();
    const editor = getEditor();
    const originalId = editor.id;
    const descriptionId = editor.getAttribute('aria-describedby');
    expect(editor.labels).toHaveLength(1);
    expect(editor.labels?.[0]).toHaveTextContent('Grafana panel JSON editor');
    expect(editor.labels?.[0]).toHaveAttribute('for', originalId);
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? '')).toHaveTextContent(
      'The browser does not push the panel to Grafana; copy your JSON into your existing Grafana dashboard editor.',
    );
    expect(editor).toHaveAccessibleDescription(
      'Build a Grafana panel JSON envelope against the curated panel-builder catalog below. The browser does not push the panel to Grafana; copy your JSON into your existing Grafana dashboard editor.',
    );
    expect(editor).toHaveAttribute('rows', '14');
    expect(editor).toHaveAttribute('spellcheck', 'false');
    const rawDraft = '  unparsed user text  ';
    fireEvent.change(editor, { target: { value: rawDraft } });
    expect(editor).toHaveValue(rawDraft);
    expect(editor.id).toBe(originalId);
    expect(editor).toHaveAttribute('aria-describedby', descriptionId);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(rawDraft);
    expect(clipboardWriteText).not.toHaveBeenCalled();
  });

  it('retains every catalog identifier and ordered column on neutral reference surfaces', () => {
    renderPage();
    const root = screen.getByTestId('power-grafana-panel-builder-root');
    const columnsByTable = {
      drives: ['id', 'vehicle_id', 'started_at', 'ended_at', 'distance_m', 'duration_s', 'energy_used_wh', 'regen_wh', 'avg_speed_mps', 'max_speed_mps'],
      charging_sessions: ['id', 'vehicle_id', 'started_at', 'ended_at', 'energy_added_wh', 'cost_cents', 'charger_kind', 'max_power_w'],
      vehicles: ['id', 'vin', 'display_name', 'model', 'color'],
      alerts: ['id', 'vehicle_id', 'alert_rule_id', 'fired_at', 'level'],
      signal_log_view: ['vehicle_id', 'signal_name', 'ts', 'num_value', 'str_value'],
    };
    for (const [name, columns] of Object.entries(columnsByTable)) {
      const identity = within(root).getByText(name);
      const entry = identity.closest('li');
      expect(identity.tagName).toBe('CODE');
      expect(entry?.querySelector(':scope > div > code')).toBe(identity);
      expect(identity.textContent).toBe(name);
      expect(entry).toHaveClass('min-w-0', 'bg-[var(--surface-2)]', 'border-[var(--border-subtle)]');
      const columnList = entry?.querySelector(':scope > ul');
      expect(columnList).not.toBeNull();
      const columnCodes = Array.from(columnList?.querySelectorAll(':scope > li > code') ?? []);
      expect(columnCodes.map((code) => code.textContent)).toEqual(columns);
      for (const code of columnCodes) {
        expect(code).toHaveClass(typography.color.secondary);
      }
    }
    const referenceCodes = root.querySelectorAll('code');
    expect(referenceCodes).toHaveLength(50);
    for (const code of Array.from(referenceCodes)) {
      expect(code.className).not.toMatch(/text-(?:cyan|emerald)-300|text-neon-/);
      expect(code).toHaveClass('break-words', '[overflow-wrap:anywhere]');
    }
    expect(within(root).getByText('Tesla VIN (PII)')).toBeInTheDocument();
    expect(within(root).getByText('user-chosen display name (PII)')).toBeInTheDocument();
    expect(within(root).getByText('numeric value (SI), null if non-numeric')).toBeInTheDocument();
    expect(root.querySelectorAll('[class*="bg-white/"]')).toHaveLength(0);
  });

  it('keeps all named section headings and editor actions reachable with shared icon and mobile roles', () => {
    renderPage();
    for (const name of [
      'Manual panel JSON editor',
      'How it works',
      'Curated panel types',
      'Curated datasource types',
      'Curated table catalog (postgres targets)',
    ]) {
      const heading = screen.getByRole('heading', { name });
      expect(heading).toHaveClass('min-w-0', 'break-words');
      expect(heading.querySelector('svg')).toHaveClass('shrink-0', typography.color.secondary);
      expect(heading.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(heading.querySelector('svg')).toHaveAttribute('focusable', 'false');
    }
    const copy = screen.getByRole('button', { name: 'Copy to clipboard' });
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(copy).toHaveClass('h-auto', 'min-h-11', 'md:min-h-10', 'max-w-full', 'whitespace-normal');
    // The icon-only Clear keeps the old text button's own responsive target
    // sizes; the wrap classes belonged to its removed text label.
    expect(clear).toHaveClass('min-h-11', 'md:min-h-10');
    expect(copy).toBeDisabled();
    expect(clear).toBeDisabled();
    fireEvent.change(getEditor(), { target: { value: '{"title":"Editable reference"}' } });
    expect(copy).toBeEnabled();
    expect(clear).toBeEnabled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(clipboardWriteText).not.toHaveBeenCalled();
  });

  it('retains all three passive workflow instructions without implying AI apply or a Grafana push', () => {
    renderPage();
    const workflow = screen.getByRole('list', { name: 'How it works' });
    const instructions = within(workflow).getAllByRole('listitem');
    expect(instructions).toHaveLength(3);
    expect(instructions[0]).toHaveTextContent('Draft with Helix or write / paste a Grafana panel JSON envelope in the editor.');
    expect(instructions[1]).toHaveTextContent('Click copy to clipboard to grab the JSON.');
    expect(instructions[2]).toHaveTextContent('In Grafana, choose add panel → edit JSON and paste it in.');
    expect(workflow.querySelector('[aria-current]')).toBeNull();
    expect(getEditor()).toHaveValue('');
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(screen.getByText(/The browser never pushes panels to Grafana directly/)).toBeInTheDocument();
  });
  it('retains the complete manual panel after denial and retries exact trimmed JSON', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('denied'));
    renderPage();
    const draft = '  {"title":"Complete panel","targets":[{"rawSql":"SELECT 1"}]}  ';
    fireEvent.change(getEditor(), { target: { value: draft } });
    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));
    expect(await screen.findByText(/Select the text manually/)).toBeInTheDocument();
    getEditor().select();
    expect(getEditor().selectionEnd).toBe(draft.length);
    expect(getEditor().value).toBe(draft);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(draft);
    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));
    expect(await screen.findByText(/Copied\. Paste the JSON/)).toBeInTheDocument();
    expect(screen.queryByText(/Select the text manually/)).toBeNull();
    expect(clipboardWriteText.mock.calls).toEqual([[draft.trim()], [draft.trim()]]);
  });

  it.each(['edit', 'clear', 'apply'] as const)('does not announce a stale pending panel copy after %s', async (change) => {
    let resolveCopy: (() => void) | undefined;
    clipboardWriteText.mockImplementation(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    renderPage();
    fireEvent.change(getEditor(), { target: { value: '{"title":"old"}' } });
    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));
    if (change === 'edit') fireEvent.change(getEditor(), { target: { value: '{"title":"new"}' } });
    if (change === 'clear') {
      fireEvent.click(screen.getByRole('button', { name: /Clear/i }));
      const clearDialog = screen.getByRole('dialog');
      expect(within(clearDialog).getByText('Clear the editor?')).toBeInTheDocument();
      fireEvent.click(within(clearDialog).getByRole('button', { name: 'Confirm' }));
      // The clear must land before the pending copy resolves, as before.
      await waitFor(() => expect(getEditor().value).toBe(''));
    }
    if (change === 'apply') fireEvent.click(screen.getByTestId('mock-ai-apply'));
    await act(async () => { resolveCopy?.(); });
    expect(screen.queryByText(/Copied\. Paste the JSON/)).toBeNull();
    if (change === 'edit') expect(getEditor().value).toBe('{"title":"new"}');
    if (change === 'clear') expect(getEditor().value).toBe('');
    if (change === 'apply') expect(getEditor().value).toBe(JSON.stringify(applyDraft.panel, null, 2));
  });
  it('renders the page shell and the curated-catalog KPI band with derived counts', async () => {
    renderPage();

    // Page root marker + title heading + subtitle.
    expect(
      await screen.findByTestId('power-grafana-panel-builder-root'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /Grafana panel builder/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Build a Grafana panel JSON envelope against the curated catalog/i),
    ).toBeInTheDocument();

    // The compact Brief is an accessible region whose four raw metrics surface the
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

  it('reviews static catalog evidence without applying, copying or discarding the JSON draft', () => {
    const { container } = renderPage();
    const json = '{"title":"Retained panel","targets":[{"rawSql":"SELECT 1"}]}';
    fireEvent.change(getEditor(), { target: { value: json } });
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="columns"] [data-operational-value]')).toHaveTextContent('33');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Curated catalog summary details' });
    // Scope/freshness moved off the face into the drawer header.
    const drawerHeader = drawer.querySelector('[data-drawer-header]');
    if (!(drawerHeader instanceof HTMLElement)) throw new Error('Review drawer header is missing');
    expect(within(drawerHeader).getByText(/Bundled builder catalog/)).toBeInTheDocument();
    expect(within(drawerHeader).getByText(/Reference data/)).toBeInTheDocument();
    expect(within(drawer).getByText(/not a live connectivity check/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Curated tables allowed in postgres-target SQL/)).toBeInTheDocument();
    expect(within(drawer).getByText(/The browser never pushes panels to Grafana/)).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    const close = within(drawer).getAllByRole('button', { name: 'Close' });
    fireEvent.click(close[close.length - 1]);
    expect(getEditor()).toHaveValue(json);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(json);
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeEnabled();
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
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Clear the editor?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(editor.value).toBe(''));
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
