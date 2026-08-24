/**
 * DashboardPage — behaviour + hardening coverage.
 *
 * DashboardPage is the fleet "Command Center" orchestrator. Its only export is
 * the default page component; the file-local helpers (`ThemeFirstRunBanner`,
 * `EmptyOnboarding`, `LoadingSkeleton`) are exercised transitively through the
 * page render. The page wires together a large surface, so these tests focus on
 * the branches and interactions the component actually owns:
 *
 *   1. SHELL      — title/subtitle and layout region gating.
 *   2. HEADER     — view-mode actions expose accessible names (the a11y fix),
 *                   refresh invalidates caches, Customize enters edit mode.
 *   3. EDIT MODE  — undo/redo labels + wiring + counter, add-widget picker, Done.
 *   4. DATA STATE — loading skeleton, empty onboarding (authed vs not),
 *                   populated grid.
 *   5. SETTINGS   — opening a widget's settings modal + saving persists config.
 *   6. BANNERS    — load-error + Tesla-not-connected warnings.
 *   7. STATUS     — global alert/live status is not duplicated in page chrome.
 *   8. THEME NAG  — first-run prompt shows/hides on the right conditions and
 *                   both dismiss paths persist + fire the picker event.
 *   9. HINT       — the customize hint appears after its delay and opens the
 *                   catalogue (fake-timer path).
 *  10. CATALOGUE  — adding from the catalogue calls addWidgets + marks onboarding.
 *  11. PALETTE    — the command-palette CustomEvent bridge (add/toggle/reset).
 *  12. KIOSK      — kiosk surface renders and the FAB is hidden.
 *  13. URL IMPORT — a `#import=` share hash opens the import modal with the
 *                   decoded payload.
 *
 * Network is never hit: every data/dashboard hook is stubbed and all heavy
 * feature child components are replaced with lightweight, interaction-friendly
 * stubs. i18n is stubbed so visible copy is the English fallback with
 * {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ── Hoisted, per-test controllable state ──────────────────────────────
// `layout`/`kiosk` feed the stubbed dashboard hooks; the loose scalars feed
// the data hooks + theme so individual tests can flip a single facet.
const h = vi.hoisted(() => {
  const layout: Record<string, unknown> = {
    dashboards: [] as unknown[],
    activeDashboard: {
      id: 'd1',
      name: 'Main',
      widgets: [] as unknown[],
      layouts: {},
      createdAt: '2020-01-01',
      updatedAt: '2020-01-01',
      settings: undefined,
    },
    activeId: 'd1',
    editMode: false,
    setEditMode: vi.fn(),
    addWidget: vi.fn(),
    addWidgets: vi.fn(),
    removeWidget: vi.fn(),
    updateWidgetConfig: vi.fn(),
    updateLayouts: vi.fn(),
    autoArrange: vi.fn(),
    getWidgetSize: vi.fn(() => ({ cols: 1, rows: 1 })),
    switchDashboard: vi.fn(),
    createDashboard: vi.fn(),
    renameDashboard: vi.fn(),
    deleteDashboard: vi.fn(),
    reorderDashboards: vi.fn(),
    duplicateDashboard: vi.fn(),
    updateDashboardSettings: vi.fn(),
    updateDashboardIcon: vi.fn(),
    applyPreset: vi.fn(),
    resetToDefault: vi.fn(),
    exportDashboard: vi.fn(),
    importDashboard: vi.fn(),
    importDashboardFromData: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoCount: 0,
    undo: vi.fn(),
    redo: vi.fn(),
    dirty: false,
    pinToVehicle: vi.fn(),
    visibleFor: vi.fn(() => true),
  };
  const kiosk: Record<string, unknown> = {
    config: {
      rotateInterval: 30,
      dashboardIds: [],
      hideCursor: true,
      cursorTimeout: 5,
      dimAfter: 0,
      dimLevel: 0.5,
      showClock: true,
      clockPosition: 'bottom-right',
      widgetOpacity: 1,
      backgroundOpacity: 1,
    },
    updateConfig: vi.fn(),
    isKiosk: false,
    enterKiosk: vi.fn(),
    exitKiosk: vi.fn(),
    isDimmed: false,
    isCursorHidden: false,
    rotateIndex: 0,
    validIds: ['d1'],
  };
  return {
    layout,
    kiosk,
    vehicles: undefined as unknown,
    auth: { authenticated: true } as unknown,
    themeId: 'aurora' as string,
    syncMutate: vi.fn(),
    syncPending: false,
    markCompleted: vi.fn(),
    widgetDef: { id: 'w1', name: 'Widget', description: 'desc', category: 'vehicle' } as unknown,
  };
});

// ── i18n: passthrough `t(key, default, opts)` with {{interpolation}} ──
vi.mock('react-i18next', () => {
  const translate = (key: string, arg2?: unknown, arg3?: unknown) => {
    let template = key;
    let options: Record<string, unknown> | undefined;
    if (typeof arg2 === 'string') {
      template = arg2;
      if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
    } else if (arg2 && typeof arg2 === 'object') {
      options = arg2 as Record<string, unknown>;
      if (typeof options.defaultValue === 'string') template = options.defaultValue;
    }
    if (options) {
      template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
        options && options[name] != null ? String(options[name]) : '',
      );
    }
    return template;
  };
  return {
    useTranslation: () => ({ t: translate, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => {} },
  };
});

// ── Data hooks ────────────────────────────────────────────────────────
vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useVehicles: () => h.vehicles,
    useSyncVehicles: () => ({ mutate: h.syncMutate, isPending: h.syncPending }),
  };
});

vi.mock('@/api/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuthStatus: () => ({ data: h.auth, isLoading: false }) };
});

// ── App-level hooks ───────────────────────────────────────────────────
vi.mock('@/hooks/useRealtimeEvents', () => ({ useRealtimeEvents: () => undefined }));

vi.mock('@/components/ui/ThemeProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useTheme: () => ({
      themeId: h.themeId,
      modeId: 'dark',
      theme: {},
      mode: {},
      setTheme: vi.fn(),
      setMode: vi.fn(),
      setCustomColors: vi.fn(),
      themes: {},
      modes: {},
    }),
  };
});

// ── Dashboard-local hooks ─────────────────────────────────────────────
vi.mock('../hooks/useDashboardLayout', () => ({ useDashboardLayout: () => h.layout }));
vi.mock('../hooks/useKioskMode', () => ({ useKioskMode: () => h.kiosk }));
vi.mock('../hooks/useLayoutKeyboard', () => ({ useLayoutKeyboard: () => undefined }));

// ── Registry + onboarding checklist ──────────────────────────────────
vi.mock('../widgets/registry', () => ({
  WIDGET_REGISTRY: [],
  getWidgetDef: () => h.widgetDef,
}));
vi.mock('@/features/onboarding/checklist', () => ({
  markCustomizeDashboardCompleted: h.markCompleted,
}));

// ── Live-stale banner → null so it never interferes with banner asserts ──
vi.mock('@/components/feedback/LiveStaleDataBanner', () => ({
  LiveStaleDataBanner: () => null,
}));

// ── Heavy feature child components → interaction-friendly stubs ────────
vi.mock('../components/DashboardGrid', () => ({
  DashboardGrid: (props: any) => (
    <div data-testid={props.kioskWidgetOpacity !== undefined ? 'kiosk-grid' : 'dashboard-grid'}>
      <button type="button" data-testid="grid-open-settings" onClick={() => props.onOpenSettings('w-hero')}>
        open settings
      </button>
    </div>
  ),
}));
vi.mock('../components/WidgetPicker', () => ({
  WidgetPicker: (props: any) => (props.open ? <div data-testid="widget-picker" /> : null),
}));
vi.mock('../components/WidgetSettingsModal', () => ({
  WidgetSettingsModal: (props: any) =>
    props.open ? (
      <div data-testid="widget-settings">
        <button type="button" data-testid="ws-save" onClick={() => props.onSave({ showTitle: false })}>
          save
        </button>
        <button type="button" data-testid="ws-close" onClick={props.onClose}>
          close
        </button>
      </div>
    ) : null,
}));
vi.mock('../components/LayoutManager', () => ({
  LayoutManager: () => <div data-testid="layout-manager" />,
}));
vi.mock('../components/LayoutSwitcher', () => ({
  LayoutSwitcher: () => <div data-testid="layout-switcher" />,
}));
vi.mock('../components/TemplateGallery', () => ({
  TemplateGallery: (props: any) => (props.open ? <div data-testid="template-gallery" /> : null),
}));
vi.mock('../components/ExportModal', () => ({
  ExportModal: (props: any) => (props.open ? <div data-testid="export-modal" /> : null),
}));
vi.mock('../components/ImportPreviewModal', () => ({
  ImportPreviewModal: (props: any) =>
    props.open ? <div data-testid="import-modal" data-json={props.initialJson ?? ''} /> : null,
}));
vi.mock('../components/DashboardSettingsModal', () => ({
  DashboardSettingsModal: (props: any) => (props.open ? <div data-testid="dash-settings" /> : null),
}));
vi.mock('../components/KioskOverlay', () => ({
  KioskOverlay: () => <div data-testid="kiosk-overlay" />,
}));
vi.mock('../components/KioskSettingsModal', () => ({
  KioskSettingsModal: (props: any) => (props.open ? <div data-testid="kiosk-settings" /> : null),
}));
vi.mock('../components/AddWidgetButton', () => ({
  AddWidgetButton: (props: any) => (
    <button type="button" data-testid="add-widget-fab" onClick={props.onClick} />
  ),
}));
vi.mock('../components/WidgetCatalogueDialog', () => ({
  WidgetCatalogueDialog: (props: any) =>
    props.open ? (
      <div data-testid="widget-catalogue">
        <button type="button" data-testid="cat-add" onClick={() => props.onAdd('battery-gauge')}>
          add
        </button>
      </div>
    ) : null,
}));
import DashboardPage from './DashboardPage';
import { toUrlSafeBase64 } from '../hooks/validateImport';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via <FadeIn>).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const THEME_KEY = 'teslasync:themeFirstRunDismissed:v1';
const HINT_KEY = 'teslasync:dashboard:customizeHintDismissed:v1';

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: undefined,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function setDashboard(overrides: Record<string, unknown> = {}) {
  h.layout.activeDashboard = {
    id: 'd1',
    name: 'Main',
    widgets: [],
    layouts: {},
    createdAt: '2020-01-01',
    updatedAt: '2020-01-01',
    settings: undefined,
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.location.hash = '';
  h.layout.editMode = false;
  h.layout.canUndo = false;
  h.layout.canRedo = false;
  h.layout.undoCount = 0;
  h.layout.dirty = false;
  h.layout.dashboards = [];
  h.layout.activeId = 'd1';
  setDashboard();
  (h.kiosk as Record<string, unknown>).isKiosk = false;
  (h.kiosk as Record<string, unknown>).validIds = ['d1'];
  h.vehicles = makeQuery({ data: [{ id: 1, display_name: 'Model 3', vin: 'VIN1' }] });
  h.auth = { authenticated: true };
  h.themeId = 'aurora';
  h.syncPending = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DashboardPage — shell', () => {
  it('renders the Command Center title and subtitle without a page-level recent panel', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Command Center' })).toBeInTheDocument();
    expect(screen.getByText('Real-time fleet intelligence and control')).toBeInTheDocument();
    expect(screen.queryByText('Recently Viewed')).toBeNull();
  });

  it('hides the layout region when there are no saved dashboards', () => {
    h.layout.dashboards = [];
    renderPage();
    expect(screen.queryByTestId('layout-switcher')).toBeNull();
    expect(screen.queryByTestId('layout-manager')).toBeNull();
  });

  it('renders the layout switcher and manager when dashboards exist', () => {
    h.layout.dashboards = [
      { id: 'd1', name: 'Main', widgets: [], layouts: {}, createdAt: '', updatedAt: '' },
    ];
    renderPage();
    expect(screen.getByTestId('layout-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('layout-manager')).toBeInTheDocument();
  });
});

describe('DashboardPage — view-mode header actions', () => {
  it('keeps primary actions visible and groups secondary tools', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Refresh data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export dashboard' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More dashboard actions' }));
    expect(screen.getByRole('button', { name: 'Export dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kiosk mode' })).toBeInTheDocument();
  });

  it('refresh invalidates the core query caches', async () => {
    const { invalidateSpy } = renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['alerts'] });
    expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('entering customize mode calls setEditMode(true)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(h.layout.setEditMode).toHaveBeenCalledWith(true);
  });

  it('opens the export and import modals from the header', () => {
    renderPage();
    expect(screen.queryByTestId('export-modal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More dashboard actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export dashboard' }));
    expect(screen.getByTestId('export-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More dashboard actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import dashboard' }));
    expect(screen.getByTestId('import-modal')).toBeInTheDocument();
  });
});

describe('DashboardPage — edit-mode header', () => {
  it('renders undo/redo controls with labels, wires them, and shows the counter', () => {
    h.layout.editMode = true;
    h.layout.canUndo = true;
    h.layout.canRedo = true;
    h.layout.undoCount = 3;
    renderPage();

    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(h.layout.undo).toHaveBeenCalledTimes(1);
    expect(h.layout.redo).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('add-widget button opens the widget picker', () => {
    h.layout.editMode = true;
    renderPage();
    expect(screen.queryByTestId('widget-picker')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add Widget' }));
    expect(screen.getByTestId('widget-picker')).toBeInTheDocument();
  });

  it('auto-arrange button calls autoArrange and Done exits edit mode', () => {
    h.layout.editMode = true;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Auto Arrange' }));
    expect(h.layout.autoArrange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.layout.setEditMode).toHaveBeenCalledWith(false);
  });
});

describe('DashboardPage — data states', () => {
  it('shows the loading skeleton while vehicles load', () => {
    h.vehicles = makeQuery({ data: undefined, isLoading: true });
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('dashboard-grid')).toBeNull();
    expect(screen.queryByText('Bring your vehicles into TeslaSync')).toBeNull();
    expect(screen.queryByText('Build a live operating picture of your Tesla fleet')).toBeNull();
  });

  it('shows onboarding with a connect link when unauthenticated and no vehicles', () => {
    h.vehicles = makeQuery({ data: [] });
    h.auth = { authenticated: false };
    renderPage();
    expect(screen.getByRole('heading', { name: 'Build a live operating picture of your Tesla fleet' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Connect Tesla Account/i });
    expect(link.getAttribute('href')).toBe('/settings');
    expect(screen.getByText('Workspace setup')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-grid')).toBeNull();
  });

  it('shows sync onboarding and triggers sync when authenticated with no vehicles', () => {
    h.vehicles = makeQuery({ data: [] });
    h.auth = { authenticated: true };
    renderPage();
    expect(screen.getByRole('heading', { name: 'Bring your vehicles into TeslaSync' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sync Vehicles/i }));
    expect(h.syncMutate).toHaveBeenCalledTimes(1);
  });

  it('renders the dashboard grid when vehicles exist', () => {
    renderPage();
    expect(screen.getByTestId('dashboard-grid')).toBeInTheDocument();
    expect(screen.queryByText('Build a live operating picture of your Tesla fleet')).toBeNull();
  });
});

describe('DashboardPage — widget settings flow', () => {
  it('opening a widget settings modal and saving persists the config', () => {
    setDashboard({ widgets: [{ id: 'w-hero', widgetId: 'vehicle-hero' }] });
    renderPage();
    expect(screen.queryByTestId('widget-settings')).toBeNull();
    fireEvent.click(screen.getByTestId('grid-open-settings'));
    expect(screen.getByTestId('widget-settings')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ws-save'));
    expect(h.layout.updateWidgetConfig).toHaveBeenCalledWith('w-hero', { showTitle: false });
  });

  it('closing the settings modal without saving does not persist config', () => {
    setDashboard({ widgets: [{ id: 'w-hero', widgetId: 'vehicle-hero' }] });
    renderPage();
    fireEvent.click(screen.getByTestId('grid-open-settings'));
    fireEvent.click(screen.getByTestId('ws-close'));
    expect(screen.queryByTestId('widget-settings')).toBeNull();
    expect(h.layout.updateWidgetConfig).not.toHaveBeenCalled();
  });
});

describe('DashboardPage — banners', () => {
  it('uses the shared safe error state without exposing backend details', () => {
    h.vehicles = makeQuery({ data: undefined, error: new Error('Boom'), isError: true });
    renderPage();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText(/Boom/)).toBeNull();
    expect(screen.queryByText('Bring your vehicles into TeslaSync')).toBeNull();
  });

  it('warns and links to settings when the Tesla account is not connected', () => {
    h.auth = { authenticated: false };
    renderPage();
    expect(screen.getByText('Tesla account not connected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });

  it('does not show the auth warning when connected', () => {
    h.auth = { authenticated: true };
    renderPage();
    expect(screen.queryByText('Tesla account not connected')).toBeNull();
  });
});

describe('DashboardPage — status ownership', () => {
  it('does not duplicate the global alert or live status controls in the page header', () => {
    h.layout.editMode = true;
    renderPage();
    expect(screen.queryByRole('link', { name: /unread alerts/i })).toBeNull();
    expect(screen.queryByText('Live')).toBeNull();
  });
});

describe('DashboardPage — theme first-run prompt', () => {
  it('prompts first-run users still on the default theme', () => {
    h.themeId = 'neon-cyan';
    renderPage();
    expect(screen.getByText('Personalize TeslaSync')).toBeInTheDocument();
  });

  it('does not prompt when a non-default theme is active', () => {
    h.themeId = 'aurora';
    renderPage();
    expect(screen.queryByText('Personalize TeslaSync')).toBeNull();
  });

  it('does not prompt when previously dismissed', () => {
    h.themeId = 'neon-cyan';
    localStorage.setItem(THEME_KEY, '1');
    renderPage();
    expect(screen.queryByText('Personalize TeslaSync')).toBeNull();
  });

  it('opening the picker dispatches the event, persists dismissal and hides the prompt', () => {
    h.themeId = 'neon-cyan';
    const onOpen = vi.fn();
    window.addEventListener('open-theme-popover', onOpen);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open theme picker' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(THEME_KEY)).toBe('1');
    expect(screen.queryByText('Personalize TeslaSync')).toBeNull();
    window.removeEventListener('open-theme-popover', onOpen);
  });

  it('"maybe later" persists dismissal and hides the prompt', () => {
    h.themeId = 'neon-cyan';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(localStorage.getItem(THEME_KEY)).toBe('1');
    expect(screen.queryByText('Personalize TeslaSync')).toBeNull();
  });
});

describe('DashboardPage — customize hint', () => {
  it('reveals the customize hint after the delay and opens the catalogue', () => {
    setDashboard({ widgets: [{ id: 'w-hero', widgetId: 'vehicle-hero' }] });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      renderPage();
      expect(screen.queryByText(/You can customize this dashboard/i)).toBeNull();
      act(() => {
        vi.advanceTimersByTime(5100);
      });
      expect(screen.getByText(/You can customize this dashboard/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Add widgets' }));
      expect(screen.getByTestId('widget-catalogue')).toBeInTheDocument();
      expect(localStorage.getItem(HINT_KEY)).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show the hint once it has been dismissed', () => {
    setDashboard({ widgets: [{ id: 'w-hero', widgetId: 'vehicle-hero' }] });
    localStorage.setItem(HINT_KEY, '1');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      renderPage();
      act(() => {
        vi.advanceTimersByTime(5100);
      });
      expect(screen.queryByText(/You can customize this dashboard/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DashboardPage — widget catalogue', () => {
  it('adding from the catalogue calls addWidgets and marks onboarding complete', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('add-widget-fab'));
    expect(screen.getByTestId('widget-catalogue')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cat-add'));
    expect(h.layout.addWidgets).toHaveBeenCalledWith(['battery-gauge']);
    expect(h.markCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardPage — command palette bridge', () => {
  it('responds to the add-widget command event', () => {
    renderPage();
    expect(screen.queryByTestId('widget-picker')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('dashboard:add-widget'));
    });
    expect(screen.getByTestId('widget-picker')).toBeInTheDocument();
  });

  it('responds to the toggle-edit command event', () => {
    renderPage();
    act(() => {
      window.dispatchEvent(new Event('dashboard:toggle-edit'));
    });
    expect(h.layout.setEditMode).toHaveBeenCalledWith(true);
  });

  it('runs reset only when the reset command is confirmed', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    act(() => {
      window.dispatchEvent(new Event('dashboard:reset'));
    });
    expect(h.layout.resetToDefault).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('dashboard:reset'));
    });
    expect(h.layout.resetToDefault).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });
});

describe('DashboardPage — kiosk mode', () => {
  it('renders the kiosk surface and hides the add-widget FAB in kiosk mode', () => {
    (h.kiosk as Record<string, unknown>).isKiosk = true;
    renderPage();
    expect(screen.getByTestId('kiosk-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('add-widget-fab')).toBeNull();
  });

  it('shows the add-widget FAB when not in kiosk mode', () => {
    (h.kiosk as Record<string, unknown>).isKiosk = false;
    renderPage();
    expect(screen.getByTestId('add-widget-fab')).toBeInTheDocument();
    expect(screen.queryByTestId('kiosk-overlay')).toBeNull();
  });
});

describe('DashboardPage — URL import', () => {
  it('opens the import modal from a share hash and decodes the payload', () => {
    const json = JSON.stringify({ name: 'Shared', widgets: [], layouts: {} });
    window.location.hash = '#import=' + toUrlSafeBase64(json);
    renderPage();
    const modal = screen.getByTestId('import-modal');
    expect(modal).toBeInTheDocument();
    expect(modal.getAttribute('data-json')).toBe(json);
  });

  it('does not open the import modal without an import hash', () => {
    window.location.hash = '';
    renderPage();
    expect(screen.queryByTestId('import-modal')).toBeNull();
  });
});
