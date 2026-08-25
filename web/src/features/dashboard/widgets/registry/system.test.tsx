/**
 * SYSTEM_WIDGETS registry — contract + wiring coverage.
 *
 * `system.ts` is a data-only module: it declares the twelve `WidgetDef` entries
 * the dashboard exposes under the `system` category and binds each to a
 * `React.lazy` component. It ships no components/hooks/utilities of its own, so
 * the value of this suite is to LOCK the invariants every consumer silently
 * relies on, and to prove the lazy wiring actually resolves to a rendering
 * widget:
 *
 *   1. Data contract (mirrors how the registry is consumed):
 *      - `getWidgetDef` / WidgetPicker's `WIDGET_BY_ID` map → ids must be unique
 *        across the WHOLE registry (a dup silently shadows a widget).
 *      - WidgetPicker groups + labels by `category` → every entry is `system`.
 *      - `useDashboardLayout` clamps live layout via `clampMinMax(default, min,
 *        max)` → sizes must satisfy `min ≤ default ≤ max` inside the 1–4 column
 *        grid.
 *      - icons render in the picker → each is the expected, renderable lucide
 *        component (a copy/paste swap would ship the wrong glyph).
 *      - `help` metadata is forwarded to WidgetShell's "?" tooltip → only the
 *        onboarding checklist carries it, and it must be i18n-keyed.
 *      - `component` must be a `React.lazy` exotic so `<Suspense>` can load it.
 *   2. Wiring/behaviour: drive each entry's OWN lazy loader to completion (this
 *      exercises the exact `import('../Xxx')` path the registry declares) and,
 *      for a representative widget from each distinct data source, render the
 *      resolved component asserting real UI for the data / empty / loading /
 *      error states plus the refresh + navigation interactions. A renamed import
 *      path or a broken default export would pass every data-shape check but
 *      fail here.
 *
 * Network is never touched: every data hook the twelve widgets reach for is
 * mocked and driven per test. `@testing-library/user-event` is not installed in
 * this repo (repo convention — see automations.test / QuickNavWidget.test), so
 * interactions use `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode, ComponentType } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Rocket, HeartPulse, Radio, MapPin, BarChart2, Server, AlertCircle,
  FileSearch, HardDrive, Download, Info, LayoutDashboard,
} from 'lucide-react';

import type { WidgetDef, WidgetSize, WidgetProps } from '../types';

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

// ── Every data hook the twelve system widgets import — mocked so resolving the
//    lazy modules never touches the network, and the rendered ones are driven
//    per-test. vi.mock replaces the whole module, so each factory must expose
//    every named hook any system widget reaches for. ──
vi.mock('@/api/hooks/useAdmin', () => ({
  useSystemHealth: vi.fn(),
  useDBStats: vi.fn(),
  useConnectionPool: vi.fn(),
  useApiLogStats: vi.fn(),
  useAuditLogs: vi.fn(),
  useSecurityEvents: vi.fn(),
  useBackupRuns: vi.fn(),
  useExportJobs: vi.fn(),
  useVehicleStateMachine: vi.fn(),
  useStateTimeline: vi.fn(),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useMQTTStatus: vi.fn(),
  useFleetTelemetryErrorVINs: vi.fn(),
  useFleetTelemetryErrors: vi.fn(),
}));
vi.mock('@/api/hooks/useSettings', () => ({
  useVersionInfo: vi.fn(),
  useCaptureStats: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(() => ({ data: [{ id: 1 }] })),
}));
vi.mock('@/api/hooks/useExports', () => ({
  useExports: vi.fn(),
}));
vi.mock('@/api/hooks/useDashboard', () => ({
  useDashboardStats: vi.fn(),
}));

import { useSystemHealth, useDBStats, useConnectionPool } from '@/api/hooks/useAdmin';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { useVersionInfo, useCaptureStats } from '@/api/hooks/useSettings';

// The registry under test + its real consumer surface (getWidgetDef + registry).
import { SYSTEM_WIDGETS } from './system';
import { WIDGET_REGISTRY, getWidgetDef } from './index';

const mockUseSystemHealth = useSystemHealth as unknown as ReturnType<typeof vi.fn>;
const mockUseDBStats = useDBStats as unknown as ReturnType<typeof vi.fn>;
const mockUseConnectionPool = useConnectionPool as unknown as ReturnType<typeof vi.fn>;
const mockUseMQTTStatus = useMQTTStatus as unknown as ReturnType<typeof vi.fn>;
const mockUseVersionInfo = useVersionInfo as unknown as ReturnType<typeof vi.fn>;
const mockUseCaptureStats = useCaptureStats as unknown as ReturnType<typeof vi.fn>;

/** The twelve system widgets, in declared order. */
const EXPECTED_IDS = [
  'onboarding-checklist',
  'uptime-monitor',
  'mqtt-status',
  'quick-nav',
  'api-usage',
  'system-health',
  'telemetry-errors',
  'audit-log',
  'backup-monitor',
  'export-status',
  'version-info',
  'dashboard-stats',
] as const;

/** id → the exact lucide icon the registry must bind (guards copy/paste swaps). */
const EXPECTED_ICONS = {
  'onboarding-checklist': Rocket,
  'uptime-monitor': HeartPulse,
  'mqtt-status': Radio,
  'quick-nav': MapPin,
  'api-usage': BarChart2,
  'system-health': Server,
  'telemetry-errors': AlertCircle,
  'audit-log': FileSearch,
  'backup-monitor': HardDrive,
  'export-status': Download,
  'version-info': Info,
  'dashboard-stats': LayoutDashboard,
} as const;

const byId = (id: string): WidgetDef => SYSTEM_WIDGETS.find((w) => w.id === id)!;

// ── Fixtures ────────────────────────────────────────────────────────────────
 
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

async function renderWidget(id: string, size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const Cmp = await resolveLazy(byId(id).component);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Cmp size={size} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Safe defaults: every rendered widget shows its empty/placeholder branch
  // unless a test opts into data.
  mockUseSystemHealth.mockReturnValue(makeQuery());
  mockUseDBStats.mockReturnValue(makeQuery());
  mockUseConnectionPool.mockReturnValue(makeQuery());
  mockUseMQTTStatus.mockReturnValue(makeQuery());
  mockUseVersionInfo.mockReturnValue(makeQuery());
  mockUseCaptureStats.mockReturnValue(makeQuery());
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Data contract
// ───────────────────────────────────────────────────────────────────────────
describe('SYSTEM_WIDGETS — registry data contract', () => {
  it('registers exactly the twelve system widgets, in declared order, with locally unique ids', () => {
    const ids = SYSTEM_WIDGETS.map((w) => w.id);
    expect(ids).toEqual([...EXPECTED_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags every entry with the system category and non-empty, unique copy', () => {
    const names = SYSTEM_WIDGETS.map((w) => w.name);
    const descriptions = SYSTEM_WIDGETS.map((w) => w.description);
    for (const w of SYSTEM_WIDGETS) {
      expect(w.category).toBe('system');
      expect(w.name.trim().length).toBeGreaterThan(0);
      expect(w.description.trim().length).toBeGreaterThan(0);
    }
    // WidgetPicker searches name + description; duplicates would confuse it.
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('binds each id to its expected, renderable lucide icon', () => {
    for (const w of SYSTEM_WIDGETS) {
      expect(w.icon).toBe(EXPECTED_ICONS[w.id as keyof typeof EXPECTED_ICONS]);
      // lucide icons are forwardRef objects; object or function is renderable.
      expect(['function', 'object']).toContain(typeof w.icon);
    }
  });

  it('exposes coherent grid sizes: min ≤ default ≤ max inside the 1–4 column grid', () => {
    // Mirrors useDashboardLayout's clampMinMax(default, min, max): a min > max or
    // default outside [min,max] would produce a nonsensical clamp at runtime.
    for (const w of SYSTEM_WIDGETS) {
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
    for (const w of SYSTEM_WIDGETS) {
       
      const cmp = w.component as any;
      expect(typeof cmp).toBe('object');
      expect(String(cmp.$$typeof)).toBe('Symbol(react.lazy)');
      expect(typeof cmp._init).toBe('function');
    }
  });

  it('attaches i18n-keyed help only to the onboarding checklist', () => {
    const checklist = byId('onboarding-checklist');
    expect(checklist.help?.i18nKey).toBe('checklist.help');
    expect((checklist.help?.defaultValue ?? '').trim().length).toBeGreaterThan(0);
    // No other system widget carries help metadata.
    const withHelp = SYSTEM_WIDGETS.filter((w) => w.help !== undefined).map((w) => w.id);
    expect(withHelp).toEqual(['onboarding-checklist']);
  });

  it('resolves each system id to exactly one identical entry in the full registry', () => {
    // getWidgetDef (used by DashboardGrid/useDashboardLayout) returns the FIRST
    // match; a duplicate id anywhere in WIDGET_REGISTRY would silently shadow it.
    for (const w of SYSTEM_WIDGETS) {
      expect(WIDGET_REGISTRY.filter((r) => r.id === w.id)).toHaveLength(1);
      expect(getWidgetDef(w.id)).toBe(w);
    }
    expect(getWidgetDef('does-not-exist')).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Lazy import wiring — every declared import path resolves to a component
// ───────────────────────────────────────────────────────────────────────────
describe('SYSTEM_WIDGETS — lazy import wiring', () => {
  it('resolves every declared lazy import to a renderable component', async () => {
    for (const w of SYSTEM_WIDGETS) {
      const Cmp = await resolveLazy(w.component);
      // A broken `import('../Xxx')` path or a missing default export would throw
      // above; a non-component default would fail this shape check.
      expect(typeof Cmp === 'function' || typeof Cmp === 'object').toBe(true);
      expect(Cmp).toBeTruthy();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. quick-nav — a hook-less widget lazy-loads and renders through the registry
// ───────────────────────────────────────────────────────────────────────────
describe('quick-nav — lazy component wiring', () => {
  it('renders the four dashboard shortcut links pointing at their real routes', async () => {
    await renderWidget('quick-nav', { cols: 4, rows: 2 });

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(screen.getByRole('link', { name: /drives/i })).toHaveAttribute('href', '/drives');
    expect(screen.getByRole('link', { name: /battery/i })).toHaveAttribute('href', '/battery');
  });

  it('exposes a labelled navigation landmark with keyboard-focusable links', async () => {
    await renderWidget('quick-nav', { cols: 4, rows: 2 });

    const nav = screen.getByRole('navigation', { name: 'Quick navigation' });
    expect(nav.tagName).toBe('NAV');

    const first = screen.getByRole('link', { name: /drives/i });
    first.focus();
    expect(first).toHaveFocus();
  });

  it('navigates to /charging when the Charging shortcut is clicked', async () => {
    const Cmp = await resolveLazy(byId('quick-nav').component);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={['/']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/" element={<Cmp size={{ cols: 4, rows: 2 }} />} />
            <Route path="/charging" element={<div>Charging Destination</div>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Charging Destination')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /charging/i }));
    expect(screen.getByText('Charging Destination')).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. system-health — a useAdmin widget lazy-loads and renders every branch
// ───────────────────────────────────────────────────────────────────────────
describe('system-health — lazy component wiring', () => {
  const healthy = {
    status: 'healthy',
    databaseSize: '128 MB',
    components: {
      database: { status: 'ok' },
      mqtt: { status: 'ok' },
      tesla_api: { status: 'degraded' },
      fleet_telemetry: { status: 'ok' },
    },
  };

  it('renders the service grid and server stats when health data loads', async () => {
    mockUseSystemHealth.mockReturnValue(makeQuery({ data: healthy }));
    mockUseConnectionPool.mockReturnValue(
      makeQuery({ data: { inUse: 5, maxOpen: 25, memoryMB: 64, goroutines: 42 } }),
    );
    await renderWidget('system-health', { cols: 2, rows: 4 });

    expect(screen.getByText('System Health')).toBeInTheDocument();
    // Humanised service labels from SERVICE_KEYS.
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Tesla Api')).toBeInTheDocument();
    expect(screen.getByText('Fleet Telemetry')).toBeInTheDocument();
    // Stat cards.
    expect(screen.getByText('DB Size')).toBeInTheDocument();
    expect(screen.getByText('128 MB')).toBeInTheDocument();
    expect(screen.getByText('5/25')).toBeInTheDocument();
    expect(screen.getByText('64 MB')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('summarises overall status and the healthy-service count in the compact layout', async () => {
    mockUseSystemHealth.mockReturnValue(makeQuery({ data: healthy }));
    await renderWidget('system-health', { cols: 1, rows: 2 });

    expect(screen.getByText('Healthy')).toBeInTheDocument();
    // 3 of 4 services report ok/healthy (tesla_api is degraded).
    const count = screen.getByText(
      (_content, el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim() === '3/4 services',
    );
    expect(count).toBeInTheDocument();
    // Compact mode hides the widget title.
    expect(screen.queryByText('System Health')).not.toBeInTheDocument();
  });

  it('shows the empty state (not a blank panel) when there is no health data', async () => {
    mockUseSystemHealth.mockReturnValue(makeQuery({ data: undefined }));
    await renderWidget('system-health', { cols: 2, rows: 4 });

    expect(screen.getByText('No system health data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The panel shell (title) still renders above the empty state.
    expect(screen.getByText('System Health')).toBeInTheDocument();
  });

  it('renders a loading skeleton (no title) while health is in flight', async () => {
    mockUseSystemHealth.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = await renderWidget('system-health', { cols: 2, rows: 4 });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('System Health')).not.toBeInTheDocument();
  });

  it('surfaces a genuine load error as an error panel instead of a misleading empty state', async () => {
    mockUseSystemHealth.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('boom') }),
    );
    await renderWidget('system-health', { cols: 2, rows: 4 });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No system health data')).not.toBeInTheDocument();
  });

  it('refetches health when the refresh control is activated', async () => {
    const refetch = vi.fn();
    mockUseSystemHealth.mockReturnValue(makeQuery({ data: healthy, refetch }));
    await renderWidget('system-health', { cols: 2, rows: 4 });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. mqtt-status — a useTelemetry widget lazy-loads and renders through registry
// ───────────────────────────────────────────────────────────────────────────
describe('mqtt-status — lazy component wiring', () => {
  it('renders connection state and aggregated throughput when data loads', async () => {
    mockUseMQTTStatus.mockReturnValue(
      makeQuery({
        data: {
          connected: true,
          broker: 'tcp://mqtt:1883',
          vehicles: [
            { signalCount: 100, signalsPerSecond: 2.5, lastReceived: new Date().toISOString() },
          ],
        },
      }),
    );
    await renderWidget('mqtt-status', { cols: 2, rows: 2 });

    expect(screen.getByText('MQTT Status')).toBeInTheDocument();
    expect(screen.getByText('Messages/sec')).toBeInTheDocument();
    expect(screen.getByText('2.5')).toBeInTheDocument();
    expect(screen.getByText('Total Messages')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('tcp://mqtt:1883')).toBeInTheDocument();
  });

  it('shows the empty state when there is no MQTT status data', async () => {
    mockUseMQTTStatus.mockReturnValue(makeQuery({ data: undefined }));
    await renderWidget('mqtt-status', { cols: 2, rows: 2 });

    expect(screen.getByText('No MQTT status data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('MQTT Status')).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. version-info — a useSettings widget lazy-loads and renders through registry
// ───────────────────────────────────────────────────────────────────────────
describe('version-info — lazy component wiring', () => {
  it('renders version + build metadata, truncating the git sha, when data loads', async () => {
    mockUseVersionInfo.mockReturnValue(
      makeQuery({
        data: {
          chart_version: '1.2.3',
          go_version: 'go1.25.0',
          build_date: '2026-01-01',
          git_commit: 'abcdef1234567',
          uptime: '3d 4h',
        },
      }),
    );
    mockUseCaptureStats.mockReturnValue(
      makeQuery({ data: { signals_per_sec: 5, messages_today: 1000 } }),
    );
    await renderWidget('version-info', { cols: 2, rows: 2 });

    expect(screen.getByText('Version Info')).toBeInTheDocument();
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Go Version')).toBeInTheDocument();
    expect(screen.getByText('go1.25.0')).toBeInTheDocument();
    // git_commit truncated to the first 7 chars.
    expect(screen.getByText('abcdef1')).toBeInTheDocument();
  });

  it('shows the empty state when version data is missing', async () => {
    mockUseVersionInfo.mockReturnValue(makeQuery({ data: undefined }));
    await renderWidget('version-info', { cols: 2, rows: 2 });

    expect(screen.getByText('No version data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
