// DashboardsPage — behaviour + hardening coverage.
//
// DashboardsPage (/power/dashboards) is the manual Grafana dashboard-JSON
// composer. It exposes a single default page export; the interesting logic
// lives in three internal helpers exercised here through the rendered DOM:
//
//   - loadPersistedJson / persistJson — the localStorage draft bridge under
//     the key `ai.dashboardComposer.draft` (mount-restore, change-persist,
//     empty-remove).
//   - panelKindIcon — maps a curated panel's name suffix to a Grafana
//     panel-kind glyph (asserted via lucide's stable `lucide-<kebab>` class).
//
// The AI natural-language drafter (`AINLDashboardComposer`) is a separate,
// independently-tested surface, so it is stubbed to a single button that
// invokes the page's `onApply` prop with a fixed draft. That keeps this suite
// focused on the PAGE's contract — the propose-only apply wiring — without
// re-testing the AI streaming stack or depending on ai_mode.
//
// Facets covered:
//   - page scaffold: title, how-it-works intro, three numbered workflow steps.
//   - curated catalog: all six panels render, alphabetically sorted.
//   - panelKindIcon: timeseries/table/stat/barchart glyph per catalog entry.
//   - persistence: restore-on-mount, persist-on-change, remove-on-empty.
//   - Copy affordance: disabled while empty/whitespace, enabled with content;
//     success path writes the TRIMMED JSON + shows the success callout; the
//     clipboard-unavailable and clipboard-rejected paths show warnings.
//   - Clear affordance: enabled for whitespace-only content (regression guard
//     for the canClear fix) and wipes the editor + persisted draft.
//   - apply-draft wiring: renders the dashboard envelope as pretty-printed
//     JSON, resets any prior status, and persists the result.
//   - a11y: the JSON editor exposes its accessible name.
//
// Network is never touched; the clipboard is stubbed per-test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The AI drafter's own envelope is fixed here so both the stub (hoisted above
// imports by vi.mock) and the assertions can reference the exact same object.
const { SAMPLE_DRAFT } = vi.hoisted(() => ({
  SAMPLE_DRAFT: {
    prompt: 'give me an overview dashboard',
    dashboard: {
      title: 'Fleet overview',
      slots: [
        { panel_name: 'drives_per_day_timeseries', grid_pos: { x: 0, y: 0, w: 24, h: 8 } },
        { panel_name: 'battery_soc_stat', grid_pos: { x: 0, y: 8, w: 12, h: 6 } },
      ],
    },
    rationale: 'stacks daily drives over current battery',
    referenced_panels: ['drives_per_day_timeseries', 'battery_soc_stat'],
  },
}));

// Stub the independently-tested AI composer down to a single button that fires
// the page's onApply with the fixed draft. This isolates the page's
// propose-only apply wiring from the AI streaming stack + ai_mode gating.
vi.mock('@/components/ai/AINLDashboardComposer', () => ({
  AINLDashboardComposer: ({ onApply }: { onApply: (draft: typeof SAMPLE_DRAFT) => void }) => (
    <button type="button" data-testid="stub-apply-draft" onClick={() => onApply(SAMPLE_DRAFT)}>
      Apply stub draft
    </button>
  ),
}));

import DashboardsPage from '@/features/power-user/pages/DashboardsPage';

const DRAFT_KEY = 'ai.dashboardComposer.draft';

const SORTED_PANEL_NAMES = [
  'alerts_count_stat',
  'battery_soc_stat',
  'charging_sessions_table',
  'drives_per_day_timeseries',
  'energy_used_per_day_barchart',
  'vehicles_table',
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/power/dashboards']}>
        <DashboardsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Install an own `navigator.clipboard` property that shadows the jsdom
// prototype stub. Passing `undefined` simulates a browser with no Clipboard
// API. afterEach removes the shadow so each test starts clean.
function stubClipboard(clip: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clip });
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

function typeInEditor(value: string) {
  fireEvent.change(editor(), { target: { value } });
}

beforeEach(() => {
  window.localStorage.removeItem(DRAFT_KEY);
});

afterEach(() => {
  cleanup();
  delete (navigator as { clipboard?: unknown }).clipboard;
  window.localStorage.removeItem(DRAFT_KEY);
});

describe('DashboardsPage', () => {
  it('renders the page scaffold: title, how-it-works intro, and three numbered workflow steps', () => {
    const { container } = renderPage();

    expect(screen.getByTestId('power-dashboards-composer-root')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /Dashboard Composer/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('How it works')).toBeInTheDocument();

    const workflow = container.querySelector('ol');
    expect(workflow).not.toBeNull();
    const steps = within(workflow as HTMLElement).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent('1.');
    expect(steps[0]).toHaveTextContent('Pick panels');
    expect(steps[1]).toHaveTextContent('2.');
    expect(steps[1]).toHaveTextContent('Compose JSON');
    expect(steps[2]).toHaveTextContent('3.');
    expect(steps[2]).toHaveTextContent('Copy to Grafana');
  });

  it('exposes the JSON editor with an accessible name and both action buttons', () => {
    renderPage();

    expect(screen.getByLabelText('Dashboard JSON editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy to clipboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Clear$/i })).toBeInTheDocument();
  });

  it('renders all six curated panels in alphabetical order', () => {
    const { container } = renderPage();

    for (const name of SORTED_PANEL_NAMES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    const catalog = container.querySelector('ul');
    expect(catalog).not.toBeNull();
    const items = within(catalog as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(6);

    const text = (catalog as HTMLElement).textContent ?? '';
    const positions = SORTED_PANEL_NAMES.map((n) => text.indexOf(n));
    positions.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
    const ascending = positions.every((p, i) => i === 0 || positions[i - 1] < p);
    expect(ascending).toBe(true);
  });

  it('maps each curated panel to its Grafana panel-kind glyph via panelKindIcon', () => {
    renderPage();

    const iconClassFor = (panelName: string): string => {
      const li = screen.getByText(panelName).closest('li');
      expect(li).not.toBeNull();
      const svg = (li as HTMLElement).querySelector('svg');
      expect(svg).not.toBeNull();
      return (svg as SVGElement).getAttribute('class') ?? '';
    };

    expect(iconClassFor('drives_per_day_timeseries')).toContain('lucide-activity');
    expect(iconClassFor('charging_sessions_table')).toContain('lucide-table');
    expect(iconClassFor('battery_soc_stat')).toContain('lucide-gauge');
    expect(iconClassFor('energy_used_per_day_barchart')).toContain('lucide-bar-chart3');
  });

  it('restores a persisted draft on mount, persists edits, and removes the key when emptied', () => {
    window.localStorage.setItem(DRAFT_KEY, '{"title":"restored"}');
    const { unmount } = renderPage();

    // 1) loadPersistedJson hydrates the editor from localStorage.
    expect(editor().value).toBe('{"title":"restored"}');

    // 2) persistJson writes every edit back to localStorage.
    typeInEditor('{"title":"edited"}');
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe('{"title":"edited"}');

    // 3) Emptying the editor removes the key entirely (not an empty string).
    typeInEditor('');
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();

    // 4) A fresh mount with a persisted value re-hydrates.
    unmount();
    window.localStorage.setItem(DRAFT_KEY, '{"title":"second-mount"}');
    renderPage();
    expect(editor().value).toBe('{"title":"second-mount"}');
  });

  it('enables Copy only for non-whitespace content (trim-aware)', () => {
    renderPage();
    const copy = screen.getByRole('button', { name: /Copy to clipboard/i });

    expect(copy).toBeDisabled();

    typeInEditor('   \n\t  ');
    expect(copy).toBeDisabled();

    typeInEditor('{"title":"x"}');
    expect(copy).toBeEnabled();
  });

  it('keeps Clear enabled for whitespace-only content and wipes editor + persisted draft', () => {
    renderPage();
    const clear = screen.getByRole('button', { name: /^Clear$/i });

    // Empty editor → nothing to clear.
    expect(clear).toBeDisabled();

    // Whitespace-only is copy-empty but still clearable (canClear fix).
    typeInEditor('   \n  ');
    expect(clear).toBeEnabled();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe('   \n  ');

    fireEvent.click(clear);
    expect(editor().value).toBe('');
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('copies the TRIMMED JSON to the clipboard and shows a success callout', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    renderPage();

    typeInEditor('   {"title":"Fleet"}   ');
    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('{"title":"Fleet"}');
    expect(await screen.findByText(/Copied\./i)).toBeInTheDocument();
  });

  it('warns (without throwing) when the Clipboard API is unavailable', async () => {
    stubClipboard(undefined);
    renderPage();

    typeInEditor('{"title":"Fleet"}');
    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));

    expect(
      await screen.findByText(/Clipboard access is not available/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Copied\./i)).not.toBeInTheDocument();
  });

  it('warns when the clipboard write is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard({ writeText });
    renderPage();

    typeInEditor('{"title":"Fleet"}');
    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));

    expect(await screen.findByText(/Clipboard write failed/i)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('{"title":"Fleet"}');
    expect(screen.queryByText(/Copied\./i)).not.toBeInTheDocument();
  });

  it('applies an AI draft as pretty-printed JSON, resets prior status, and persists it', async () => {
    stubClipboard(undefined);
    renderPage();

    // Produce a lingering status via the clipboard-unavailable warning.
    typeInEditor('{"title":"old"}');
    fireEvent.click(screen.getByRole('button', { name: /Copy to clipboard/i }));
    expect(
      await screen.findByText(/Clipboard access is not available/i),
    ).toBeInTheDocument();

    // Apply the AI draft — the page owns the setter, not the AI component.
    fireEvent.click(screen.getByTestId('stub-apply-draft'));

    const expectedJson = JSON.stringify(SAMPLE_DRAFT.dashboard, null, 2);
    expect(editor().value).toBe(expectedJson);
    // Sanity: the pretty-printed envelope actually spans multiple lines.
    expect(expectedJson).toContain('\n');
    // Prior status is cleared on apply.
    expect(screen.queryByText(/Clipboard access is not available/i)).not.toBeInTheDocument();
    // The applied draft is persisted like any other edit.
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(expectedJson);
  });
});
