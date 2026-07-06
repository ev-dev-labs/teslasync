/**
 * AUTOMATION_WIDGETS registry — contract + wiring coverage.
 *
 * `automations.ts` is a data-only module: it declares the two `WidgetDef`
 * entries the dashboard exposes under the `automations` category and binds each
 * to a `React.lazy` component. It ships no components/hooks/utilities of its own,
 * so the value of this suite is to LOCK the invariants every consumer silently
 * relies on, and to prove the lazy wiring actually resolves to a rendering
 * widget:
 *
 *   1. Data contract (mirrors how the registry is consumed):
 *      - `getWidgetDef` / WidgetPicker's `WIDGET_BY_ID` map → ids must be unique
 *        across the WHOLE registry (a dup silently shadows a widget).
 *      - WidgetPicker groups + labels by `category` → every entry is `automations`.
 *      - `useDashboardLayout` clamps live layout via `clampMinMax(default, min, max)`
 *        → sizes must satisfy `min ≤ default ≤ max` inside the 1–4 column grid.
 *      - icons render in the picker → each is a real lucide component.
 *      - `component` must be a `React.lazy` exotic so `<Suspense>` can load it.
 *   2. Wiring/behaviour: drive each entry's OWN lazy loader to completion (this
 *      exercises the exact `import('../Xxx')` path the registry declares) and
 *      render the resolved component, asserting real UI for the data / empty /
 *      loading states plus the toggle + refresh interactions. A renamed import
 *      path or a broken default export would pass every data-shape check but
 *      fail here.
 *
 * Network is never touched: the automation hooks are mocked and driven per test.
 * `@testing-library/user-event` is not installed in this repo (repo convention —
 * see LayoutManager.test / EditableText.test), so interactions use `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode, ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Workflow, PlayCircle } from 'lucide-react';

import type { WidgetDef, WidgetSize, WidgetProps } from '../types';
import type {
  Automation,
  AutomationHistory,
  AutomationHistoryStats,
  AutomationHistoryListResponse,
} from '@/api/types';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── The automation data hooks — driven per test ──
vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomations: vi.fn(),
  useAutomationHistory: vi.fn(),
  useToggleAutomation: vi.fn(),
}));

import { useAutomations, useAutomationHistory, useToggleAutomation } from '@/api/hooks/useAutomations';
// The registry under test + its real consumer surface (getWidgetDef + registry).
import { AUTOMATION_WIDGETS } from './automations';
import { WIDGET_REGISTRY, getWidgetDef } from './index';

const mockUseAutomations = useAutomations as unknown as ReturnType<typeof vi.fn>;
const mockUseAutomationHistory = useAutomationHistory as unknown as ReturnType<typeof vi.fn>;
const mockUseToggleAutomation = useToggleAutomation as unknown as ReturnType<typeof vi.fn>;

const statusDef = AUTOMATION_WIDGETS.find((w) => w.id === 'automation-status')!;
const historyDef = AUTOMATION_WIDGETS.find((w) => w.id === 'automation-history')!;

// ── Fixtures ──────────────────────────────────────────────────────────────
function recentIso(minsAgo = 5): string {
  return new Date(Date.now() - minsAgo * 60_000).toISOString();
}

function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function automation(over: Partial<Automation> & { id: number; name: string }): Automation {
  return {
    enabled: true,
    consecutive_failures: 0,
    auto_disabled: false,
    last_success_at: recentIso(),
    last_triggered_at: recentIso(),
    next_fire_time: null,
    ...over,
  } as unknown as Automation;
}

function historyEntry(over: Partial<AutomationHistory> & { id: number }): AutomationHistory {
  return {
    automation_name: 'Automation',
    status: 'success',
    duration_ms: 1200,
    triggered_at: recentIso(),
    ...over,
  } as unknown as AutomationHistory;
}

function historyResponse(
  items: AutomationHistory[],
  summaryOver: Partial<AutomationHistoryStats> = {},
): AutomationHistoryListResponse {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    summary: {
      total_executions: items.length,
      succeeded: items.length,
      failed: 0,
      partial: 0,
      success_rate: 100,
      avg_duration_ms: 1200,
      ...summaryOver,
    },
  } as unknown as AutomationHistoryListResponse;
}

/**
 * Drive a `React.lazy` component's own payload to completion and return the
 * resolved default export. This runs the exact `import('../Xxx')` factory the
 * registry declared — so it verifies the import path + default export — while
 * sidestepping the flaky `<Suspense>` retry flush under jsdom/vitest.
 */
async function resolveLazy(lazyCmp: WidgetDef['component']): Promise<ComponentType<WidgetProps>> {
  const internal = lazyCmp as any;
  try {
    return internal._init(internal._payload);
  } catch (thrown) {
    if (thrown && typeof (thrown as PromiseLike<unknown>).then === 'function') {
      await thrown;
      return internal._init(internal._payload);
    }
    throw thrown;
  }
}

async function renderWidget(def: WidgetDef, size: WidgetSize) {
  const Cmp = await resolveLazy(def.component);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Cmp size={size} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseAutomations.mockReset();
  mockUseAutomationHistory.mockReset();
  mockUseToggleAutomation.mockReset();
  mockUseAutomations.mockReturnValue(makeQuery({ data: [] }));
  mockUseAutomationHistory.mockReturnValue(makeQuery({ data: historyResponse([]) }));
  mockUseToggleAutomation.mockReturnValue({ mutate: vi.fn() });
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Data contract
// ───────────────────────────────────────────────────────────────────────────
describe('AUTOMATION_WIDGETS — registry data contract', () => {
  it('registers exactly the status + history widgets, in order, with locally unique ids', () => {
    const ids = AUTOMATION_WIDGETS.map((w) => w.id);
    expect(ids).toEqual(['automation-status', 'automation-history']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags every entry with the automations category and non-empty, unique copy', () => {
    const names = AUTOMATION_WIDGETS.map((w) => w.name);
    for (const w of AUTOMATION_WIDGETS) {
      expect(w.category).toBe('automations');
      expect(w.name.trim().length).toBeGreaterThan(0);
      expect(w.description.trim().length).toBeGreaterThan(0);
    }
    // WidgetPicker searches name + description; duplicate names would confuse it.
    expect(new Set(names).size).toBe(names.length);
  });

  it('binds each widget to its renderable lucide icon', () => {
    expect(statusDef.icon).toBe(Workflow);
    expect(historyDef.icon).toBe(PlayCircle);
    for (const w of AUTOMATION_WIDGETS) {
      // lucide icons are forwardRef objects; either object or function is renderable.
      expect(['function', 'object']).toContain(typeof w.icon);
    }
  });

  it('exposes coherent grid sizes: min ≤ default ≤ max inside the 1–4 column grid', () => {
    // Mirrors useDashboardLayout's clampMinMax(default, min, max): a min > max or
    // default outside [min,max] would produce a nonsensical clamp at runtime.
    for (const w of AUTOMATION_WIDGETS) {
      for (const dim of ['cols', 'rows'] as const) {
        expect(w.minSize[dim]).toBeGreaterThan(0);
        expect(w.minSize[dim]).toBeLessThanOrEqual(w.defaultSize[dim]);
        expect(w.defaultSize[dim]).toBeLessThanOrEqual(w.maxSize[dim]);
      }
      // The dashboard grid is 4 columns wide.
      expect(w.maxSize.cols).toBeLessThanOrEqual(4);
      expect(w.defaultSize.cols).toBeLessThanOrEqual(4);
    }
  });

  it('wires each widget to a React.lazy exotic component', () => {
    for (const w of AUTOMATION_WIDGETS) {
      const cmp = w.component as any;
      expect(typeof cmp).toBe('object');
      expect(String(cmp.$$typeof)).toBe('Symbol(react.lazy)');
      expect(typeof cmp._init).toBe('function');
    }
  });

  it('resolves each automation id to exactly one, identical entry in the full registry', () => {
    // getWidgetDef (used by DashboardGrid/useDashboardLayout) returns the FIRST
    // match; a duplicate id anywhere in WIDGET_REGISTRY would silently shadow it.
    for (const w of AUTOMATION_WIDGETS) {
      expect(WIDGET_REGISTRY.filter((r) => r.id === w.id)).toHaveLength(1);
      expect(getWidgetDef(w.id)).toBe(w);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Wiring — the status widget lazy-loads and renders through the registry
// ───────────────────────────────────────────────────────────────────────────
describe('automation-status — lazy component wiring', () => {
  it('renders active automations with OK / Failing status badges when data loads', async () => {
    mockUseAutomations.mockReturnValue(
      makeQuery({
        data: [
          automation({ id: 1, name: 'Morning Precondition', consecutive_failures: 0 }),
          automation({ id: 2, name: 'Sentry Alert', consecutive_failures: 2 }),
        ],
      }),
    );
    await renderWidget(statusDef, { cols: 3, rows: 3 });

    expect(screen.getByText('Automation Status')).toBeInTheDocument();
    expect(screen.getByText('Morning Precondition')).toBeInTheDocument();
    expect(screen.getByText('Sentry Alert')).toBeInTheDocument();
    // consecutive_failures === 0 + last_success_at set → OK; > 0 → Failing.
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getAllByText('Failing').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the empty state instead of a blank panel when there are no automations', async () => {
    mockUseAutomations.mockReturnValue(makeQuery({ data: [] }));
    await renderWidget(statusDef, { cols: 3, rows: 3 });

    expect(screen.getByText('No automations configured')).toBeInTheDocument();
    // EmptyState renders role="status"; the widget title still renders above it.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Automation Status')).toBeInTheDocument();
  });

  it('renders a loading skeleton (no title) while the automations query is in flight', async () => {
    mockUseAutomations.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = await renderWidget(statusDef, { cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Automation Status')).not.toBeInTheDocument();
  });

  it('toggles an automation via the accessible switch in the wide layout', async () => {
    const mutate = vi.fn();
    mockUseToggleAutomation.mockReturnValue({ mutate });
    mockUseAutomations.mockReturnValue(
      makeQuery({ data: [automation({ id: 7, name: 'Morning Precondition', enabled: true })] }),
    );
    await renderWidget(statusDef, { cols: 3, rows: 3 });

    const toggle = screen.getByRole('switch', { name: 'Toggle Morning Precondition' });
    fireEvent.click(toggle);
    // enabled === true → clicking requests the opposite state for that id.
    expect(mutate).toHaveBeenCalledWith({ id: 7, enabled: false });
  });

  it('refetches when the freshness refresh control is activated', async () => {
    const refetch = vi.fn();
    mockUseAutomations.mockReturnValue(
      makeQuery({ data: [automation({ id: 1, name: 'Morning Precondition' })], refetch }),
    );
    await renderWidget(statusDef, { cols: 3, rows: 3 });

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Wiring — the history widget lazy-loads and renders through the registry
// ───────────────────────────────────────────────────────────────────────────
describe('automation-history — lazy component wiring', () => {
  it('renders the success-rate summary and run feed when history loads', async () => {
    mockUseAutomationHistory.mockReturnValue(
      makeQuery({
        data: historyResponse(
          [historyEntry({ id: 1, automation_name: 'Morning Precondition', status: 'success' })],
          { total_executions: 3, success_rate: 100 },
        ),
      }),
    );
    await renderWidget(historyDef, { cols: 2, rows: 3 });

    expect(screen.getByText('Automation History')).toBeInTheDocument();
    expect(screen.getByText('Morning Precondition')).toBeInTheDocument();
    // Feed subtitle = `${status} · ${duration}`.
    expect(screen.getByText(/success ·/)).toBeInTheDocument();
    expect(screen.getAllByText(/Success Rate/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the compact empty state when there is no run history', async () => {
    mockUseAutomationHistory.mockReturnValue(makeQuery({ data: historyResponse([]) }));
    await renderWidget(historyDef, { cols: 1, rows: 2 });

    expect(screen.getByText('No automation runs yet')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
