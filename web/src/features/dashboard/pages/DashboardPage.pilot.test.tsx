import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui';
import { ToastProvider } from '@/components/feedback';
import { neonColorMap, typography } from '@/lib/tokens';
import type { SavedDashboard } from '../widgets/types';
import type { DashboardGrid } from '../components/DashboardGrid';
import type { WidgetPicker } from '../components/WidgetPicker';
import type { TemplateGallery } from '../components/TemplateGallery';
import type { ExportModal } from '../components/ExportModal';
import type { ImportPreviewModal } from '../components/ImportPreviewModal';
import type { KioskSettingsModal } from '../components/KioskSettingsModal';
import type { LayoutSwitcher } from '../components/LayoutSwitcher';
import type { WidgetSettingsModal } from '../components/WidgetSettingsModal';
import { WIDGET_DND_MIME } from '../widgets/types';
import { toUrlSafeBase64 } from '../hooks/validateImport';

const h = vi.hoisted(() => ({
  query: {
    data: [{ id: 7, display_name: 'Test vehicle' }] as Array<{ id: number; display_name: string }> | undefined,
    isLoading: false, isError: false, error: null as Error | null,
    isFetching: false, dataUpdatedAt: 1, fetchStatus: 'idle',
    refetch: vi.fn(),
  },
  authenticated: true,
  themeId: 'aurora',
  selectedVehicleId: 7,
  isKiosk: false,
  syncPending: false,
  sync: vi.fn(),
  completed: vi.fn(),
  realtime: vi.fn(),
  grid: vi.fn(),
  switcher: vi.fn(),
  layout: {
    dashboards: [] as SavedDashboard[],
    activeDashboard: {
      id: 'd1', name: 'Main', widgets: [], layouts: {},
      createdAt: '2020-01-01', updatedAt: '2020-01-01',
    } as SavedDashboard,
    activeId: 'd1', editMode: false, setEditMode: vi.fn(),
    addWidgets: vi.fn(), addWidgetAndArrange: vi.fn(), addWidgetAt: vi.fn(),
    removeWidget: vi.fn(), updateWidgetConfig: vi.fn(), updateLayouts: vi.fn(),
    autoArrange: vi.fn(), getWidgetSize: vi.fn(() => ({ cols: 1, rows: 1 })),
    switchDashboard: vi.fn(), createDashboard: vi.fn(), createDashboardFromWidgets: vi.fn(),
    renameDashboard: vi.fn(), deleteDashboard: vi.fn(), duplicateDashboard: vi.fn(),
    reorderDashboards: vi.fn(), updateDashboardSettings: vi.fn(), updateDashboardIcon: vi.fn(),
    applyRolePreset: vi.fn(), resetToDefault: vi.fn(), exportDashboard: vi.fn(),
    importDashboardFromData: vi.fn(), canUndo: false, canRedo: false,
    undoCount: 0, undo: vi.fn(), redo: vi.fn(), dirty: false, pinToVehicle: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/api/hooks/useVehicles', async (original) => ({
  ...await original<Record<string, unknown>>(),
  useVehicles: () => h.query,
  useSyncVehicles: () => ({ mutate: h.sync, isPending: h.syncPending }),
}));
vi.mock('@/api/hooks/useSettings', async (original) => ({
  ...await original<Record<string, unknown>>(),
  useAuthStatus: () => ({ data: { authenticated: h.authenticated }, isLoading: false }),
}));
vi.mock('@/components/ui/ThemeProvider', async (original) => ({
  ...await original<Record<string, unknown>>(),
  useTheme: () => ({ themeId: h.themeId }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.selectedVehicleId }),
}));
vi.mock('@/hooks/useRealtimeEvents', () => ({ useRealtimeEvents: h.realtime }));
vi.mock('../hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => h.layout,
  DASHBOARD_PRESETS: [{ id: 'owner' }],
}));
vi.mock('../hooks/useLayoutKeyboard', () => ({ useLayoutKeyboard: () => undefined }));
vi.mock('../hooks/useKioskMode', () => ({
  useKioskMode: () => ({
    config: { backgroundOpacity: 1, widgetOpacity: 1 },
    updateConfig: vi.fn(), isKiosk: h.isKiosk, enterKiosk: vi.fn(),
  }),
}));
vi.mock('../widgets/registry', () => ({
  getWidgetDef: (id: string) => id === 'missing' ? null : { id, name: 'Test widget' },
}));
vi.mock('@/features/onboarding/checklist', () => ({ markCustomizeDashboardCompleted: h.completed }));
vi.mock('@/components/feedback/LiveStaleDataBanner', () => ({ LiveStaleDataBanner: () => null }));
vi.mock('../components/DashboardGrid', () => ({
  DashboardGrid: (props: ComponentProps<typeof DashboardGrid>) => {
    h.grid(props);
    return (
      <div data-testid={props.kioskWidgetOpacity === undefined ? 'pilot-grid' : 'pilot-kiosk-grid'}>
        <Button onClick={() => props.onOpenSettings('w1')}>Test widget settings</Button>
        <Button onClick={() => props.onAddWidgets?.()}>Test grid add</Button>
        <Button onClick={() => props.onBrowseTemplates?.()}>Test grid templates</Button>
      </div>
    );
  },
}));
vi.mock('../components/LayoutSwitcher', () => ({
  LayoutSwitcher: (props: ComponentProps<typeof LayoutSwitcher>) => {
    h.switcher(props);
    return <div data-testid="pilot-switcher" />;
  },
}));
vi.mock('../components/WidgetPicker', () => ({
  WidgetPicker: (props: ComponentProps<typeof WidgetPicker>) => props.open ? (
    <div data-testid="pilot-picker">
      <Button onClick={() => props.onAddWidgets(['battery-gauge'])}>Test picker add</Button>
      <Button onClick={props.onClose}>Test picker close</Button>
    </div>
  ) : null,
}));
vi.mock('../components/TemplateGallery', () => ({
  TemplateGallery: (props: ComponentProps<typeof TemplateGallery>) => props.open ? (
    <div data-testid="pilot-templates">
      <Button onClick={() => props.onApply('__helix__', 'Helix', ['battery-gauge'])}>Test Helix template</Button>
      <Button onClick={() => props.onApply('__blank__', 'Blank')}>Test blank template</Button>
      <Button onClick={() => props.onApply('owner', 'Owner')}>Test owner template</Button>
    </div>
  ) : null,
}));
vi.mock('../components/WidgetSettingsModal', () => ({
  WidgetSettingsModal: (props: ComponentProps<typeof WidgetSettingsModal>) => props.open ? (
    <Button onClick={() => props.onSave({ showTitle: false })}>Test save widget</Button>
  ) : null,
}));
vi.mock('../components/ExportModal', () => ({
  ExportModal: (props: ComponentProps<typeof ExportModal>) => props.open ? (
    <Button onClick={props.onDownload}>Test export download</Button>
  ) : null,
}));
vi.mock('../components/ImportPreviewModal', () => ({
  ImportPreviewModal: (props: ComponentProps<typeof ImportPreviewModal>) => props.open ? (
    <div data-testid="pilot-import" data-json={props.initialJson ?? ''}>
      <Button onClick={() => props.onConfirm(h.layout.activeDashboard)}>Test import confirm</Button>
    </div>
  ) : null,
}));
vi.mock('../components/DashboardSettingsModal', () => ({ DashboardSettingsModal: () => null }));
vi.mock('../components/KioskSettingsModal', () => ({
  KioskSettingsModal: (props: ComponentProps<typeof KioskSettingsModal>) =>
    props.open ? <div data-testid="pilot-kiosk-settings" /> : null,
}));

import DashboardPage from './DashboardPage';

const THEME_KEY = 'teslasync:themeFirstRunDismissed:v1';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider><MemoryRouter><DashboardPage /></MemoryRouter></ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

function expectMobileTarget(element: HTMLElement) {
  expect(element).toHaveClass('min-h-11', 'min-w-11');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  h.query.data = [{ id: 7, display_name: 'Test vehicle' }];
  h.query.isLoading = false;
  h.query.isError = false;
  h.query.error = null;
  h.query.isFetching = false;
  h.query.fetchStatus = 'idle';
  h.query.dataUpdatedAt = Date.now();
  h.authenticated = true;
  h.themeId = 'aurora';
  h.syncPending = false;
  h.isKiosk = false;
  h.layout.editMode = false;
  h.layout.canUndo = false;
  h.layout.canRedo = false;
  h.layout.undoCount = 0;
  h.layout.activeDashboard = {
    id: 'd1', name: 'Main', widgets: [{ id: 'w1', widgetId: 'vehicle-hero' }],
    layouts: {}, createdAt: '2020-01-01', updatedAt: '2020-01-01',
  };
  h.layout.dashboards = [h.layout.activeDashboard];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Dashboard pilot — additive shared-presentation and preservation proof', () => {
  it('keeps the shared header, widget region, workspace selection and layout callbacks', () => {
    const { container } = mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet operations' })).toBeInTheDocument();
    expect(container.querySelector('[data-layout-reference]')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Dashboard widgets' })).toContainElement(screen.getByTestId('pilot-grid'));
    expect(h.grid).toHaveBeenCalledWith(expect.objectContaining({
      dashboard: h.layout.activeDashboard, dashboardVehicleId: 7,
      onLayoutChange: h.layout.updateLayouts, onRemoveWidget: h.layout.removeWidget,
    }));
    expect(h.switcher).toHaveBeenCalledWith(expect.objectContaining({
      onSwitch: h.layout.switchDashboard, onRename: h.layout.renameDashboard,
      onDelete: h.layout.deleteDashboard, onDuplicate: h.layout.duplicateDashboard,
      onReorder: h.layout.reorderDashboards, onPinToVehicle: h.layout.pinToVehicle,
    }));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it.each([
    { mode: 'view', editMode: false },
    { mode: 'edit', editMode: true },
  ])('separates layout context from command hitboxes with the shared scope-first composition in $mode mode', ({ editMode }) => {
    h.layout.editMode = editMode;
    const { container } = mount();
    const actions = screen.getByRole('group', { name: 'Actions' });
    expect(actions).toHaveAttribute('data-action-order', 'context-secondary-destructive-overflow-primary');
    // Exercise the real PageLayout -> PageContainer -> PageActions API, not mocked geometry.
    expect(actions).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-page-actions-scope', 'xl:flex');
    const layouts = screen.getByRole('region', { name: 'Dashboard layouts' });
    const context = layouts.closest('[data-action-group="context"]');
    expect(context).toHaveClass('order-1', 'sm:col-span-2', 'xl:order-2');
    expect(actions.querySelector('[data-action-zone="context"]')).toHaveClass('contents');
    const commands = actions.querySelector('[data-action-zone="commands"]');
    expect(commands).toHaveClass('order-3');
    expect(commands).not.toContainElement(layouts);
    expect(commands?.querySelector('[data-action-group="secondary"]')).toContainElement(
      screen.getByRole('button', { name: editMode ? 'Auto arrange' : 'Refresh data' }),
    );
    expect(commands?.querySelector('[data-action-group="primary"]')).toContainElement(
      screen.getByRole('button', { name: editMode ? 'Done' : 'Customize' }),
    );
    expect(Array.from(commands?.children ?? []).map((group) => group.getAttribute('data-action-group')))
      .toEqual(editMode ? ['secondary', 'primary'] : ['secondary', 'overflow', 'primary']);
    expect(actions).toContainElement(screen.getByTestId('pilot-switcher'));
    expect(screen.getByRole('region', { name: 'Dashboard widgets' })).toContainElement(screen.getByTestId('pilot-grid'));
    expect(container.querySelector('[data-layout-reference]')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(h.layout.updateLayouts).not.toHaveBeenCalled();
    expect(h.layout.switchDashboard).not.toHaveBeenCalled();
  });

  it('keeps dashboard tools Escape dismissal and trigger focus without changing the saved layout', async () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'More dashboard actions' });
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'More dashboard actions' });
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent?.trim()))
      .toEqual(['Export dashboard', 'Import dashboard', 'Kiosk mode', 'Print snapshot']);
    const exportAction = within(dialog).getByRole('button', { name: 'Export dashboard' });
    exportAction.focus();
    expect(exportAction).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More dashboard actions' })).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(h.layout.updateLayouts).not.toHaveBeenCalled();
    expect(h.layout.setEditMode).not.toHaveBeenCalled();
    expect(h.layout.exportDashboard).not.toHaveBeenCalled();
    expect(h.layout.importDashboardFromData).not.toHaveBeenCalled();
  });

  it('keeps vehicle-pinned layout selection ahead of the workspace selection', () => {
    h.layout.activeDashboard.settings = { vehicleId: 19 };
    mount();
    expect(h.grid).toHaveBeenCalledWith(expect.objectContaining({ dashboardVehicleId: 19 }));
  });

  it('gives every page-owned view/menu action mobile minima and keeps the open tools', () => {
    mount();
    for (const name of ['Refresh data', 'Customize', 'More dashboard actions']) {
      expectMobileTarget(screen.getByRole('button', { name }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'More dashboard actions' }));
    for (const name of ['Export dashboard', 'Import dashboard', 'Kiosk mode', 'Print snapshot']) {
      expectMobileTarget(screen.getByRole('button', { name }));
    }
    expect(screen.getByRole('button', { name: 'Export dashboard' })).toHaveClass('h-auto', 'whitespace-normal');
    expect(screen.getByRole('button', { name: 'More dashboard actions' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Export dashboard' }).querySelector('svg'))
      .toHaveClass(typography.color.muted);
  });

  it('keeps edit controls, disabled undo/redo, desktop minima and Done wiring', () => {
    h.layout.editMode = true;
    mount();
    for (const name of ['Undo', 'Redo', 'Add widget', 'Auto arrange', 'Reset', 'Done']) {
      const button = screen.getByRole('button', { name });
      expectMobileTarget(button);
      expect(button).toHaveClass('md:min-h-9', 'md:min-w-0');
    }
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Auto arrange' }));
    expect(h.layout.autoArrange).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.layout.setEditMode).toHaveBeenCalledWith(false);
  });

  it('retains refresh keys and shared busy feedback without a second spinning icon', async () => {
    const { invalidate } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    const refresh = screen.getByRole('button', { name: 'Refresh data' });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('aria-busy', 'true');
    expect(refresh.querySelectorAll('svg')).toHaveLength(1);
    await waitFor(() => expect(refresh).not.toBeDisabled());
    expect(invalidate).toHaveBeenCalledTimes(11);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vehicle-state'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fleet-analytics'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tire-latest'] });
  });

  it('retains grid, saved layouts and an individual retry on a failed registry refresh', () => {
    h.query.error = new Error('Private backend details');
    h.query.isError = true;
    mount();
    expect(screen.getByTestId('pilot-grid')).toBeInTheDocument();
    expect(screen.getByTestId('pilot-switcher')).toBeInTheDocument();
    const warning = screen.getByTestId('stale-refresh-warning');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(h.query.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText('Private backend details')).toBeNull();
  });

  it('keeps paused retained content distinct from a fabricated failure or offline vehicle', () => {
    h.query.fetchStatus = 'paused';
    mount();
    expect(screen.getByTestId('pilot-grid')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Paused offline')).toBeNull();
  });

  it('retains the source-shaped loading state without inventing onboarding or measurements', () => {
    h.query.data = undefined;
    h.query.isLoading = true;
    mount();
    expect(screen.getByTestId('dashboard-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('pilot-grid')).toBeNull();
    expect(screen.queryByText('Bring your vehicles into TeslaSync')).toBeNull();
  });

  it('replaces only the fatal registry body with the existing safe error state', () => {
    h.query.data = undefined;
    h.query.error = new Error('Private backend details');
    h.query.isError = true;
    mount();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('pilot-grid')).toBeNull();
    expect(screen.queryByText('Private backend details')).toBeNull();
  });

  it('keeps all empty-workspace sections, links and neutral decorative capability icons', () => {
    h.query.data = [];
    h.authenticated = false;
    const { container } = mount();
    const connect = screen.getByRole('link', { name: 'Connect Tesla account' });
    expectMobileTarget(connect);
    expect(connect).toHaveAttribute('href', '/settings');
    expectMobileTarget(screen.getByRole('link', { name: 'Explore capabilities' }));
    expect(screen.getByText('Private by design')).toBeInTheDocument();
    expect(screen.getByText('Setup progress')).toHaveClass('font-medium');
    for (const label of ['Live telemetry', 'Drive intelligence', 'Energy analytics', 'Fleet operations']) {
      const item = screen.getAllByText(label).find((element) => element.closest('li'))?.closest('li');
      expect(item?.querySelector('svg')).toHaveClass(typography.color.secondary);
    }
    expect(container.querySelector('.text-cyan-300, .text-purple-300, .text-emerald-300, .text-rose-300')).toBeNull();
    const steps = container.querySelector('ol');
    expect(steps?.children).toHaveLength(3);
    expect(steps?.querySelector('span')).toHaveClass(neonColorMap.cyan.text);
  });

  it('preserves measured account completion, sync behavior, and pending disabled semantics', () => {
    h.query.data = [];
    h.syncPending = true;
    const view = mount();
    const sync = screen.getByRole('button', { name: 'Sync vehicles' });
    expectMobileTarget(sync);
    expect(sync).toBeDisabled();
    expect(view.container.querySelector('ol span')).toHaveClass(neonColorMap.green.text);
    view.unmount();
    h.syncPending = false;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sync vehicles' }));
    expect(h.sync).toHaveBeenCalledOnce();
  });

  it('keeps first-run theme actions secondary, decorative glyphs hidden and dismissal persistent', () => {
    h.themeId = 'neon-cyan';
    const event = vi.fn();
    window.addEventListener('open-theme-popover', event);
    try {
      mount();
      const open = screen.getByRole('button', { name: 'Open theme picker' });
      expectMobileTarget(open);
      expect(open).not.toHaveClass('bg-[var(--theme-primary)]');
      expectMobileTarget(screen.getByRole('button', { name: 'Maybe later' }));
      expect(open.querySelector('svg')).toBeNull();
      const banner = screen.getByText('Personalize TeslaSync').closest('[role="status"]');
      if (banner) expect(banner.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      fireEvent.click(open);
      expect(event).toHaveBeenCalledOnce();
      expect(localStorage.getItem(THEME_KEY)).toBe('1');
      expect(screen.queryByText('Personalize TeslaSync')).toBeNull();
    } finally {
      window.removeEventListener('open-theme-popover', event);
    }
  });

  it('keeps catalog addition, onboarding completion and widget config persistence', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Test grid add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test picker add' }));
    expect(h.layout.addWidgets).toHaveBeenCalledWith(['battery-gauge']);
    expect(h.completed).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Test widget settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test save widget' }));
    expect(h.layout.updateWidgetConfig).toHaveBeenCalledWith('w1', { showTitle: false });
  });

  it('retains arrange-drop validation and forwards exact widget placement callbacks', () => {
    h.layout.editMode = true;
    mount();
    const dataTransfer = { types: [WIDGET_DND_MIME], getData: vi.fn(() => 'battery-gauge') };
    fireEvent.drop(screen.getByTestId('dashboard-arrange-drop'), { dataTransfer });
    expect(dataTransfer.getData).toHaveBeenCalledWith(WIDGET_DND_MIME);
    expect(h.layout.addWidgetAndArrange).toHaveBeenCalledWith('battery-gauge');
    expect(h.completed).toHaveBeenCalledOnce();
    dataTransfer.getData.mockReturnValue('vehicle-hero');
    fireEvent.drop(screen.getByTestId('dashboard-arrange-drop'), { dataTransfer });
    expect(h.layout.addWidgetAndArrange).toHaveBeenCalledOnce();
  });

  it('keeps every template producer and closes only after applying the explicit choice', () => {
    mount();
    for (const name of ['Test Helix template', 'Test blank template', 'Test owner template']) {
      fireEvent.click(screen.getByRole('button', { name: 'Test grid templates' }));
      fireEvent.click(screen.getByRole('button', { name }));
      expect(screen.queryByTestId('pilot-templates')).toBeNull();
    }
    expect(h.layout.createDashboardFromWidgets).toHaveBeenCalledWith('Helix', ['battery-gauge']);
    expect(h.layout.createDashboard).toHaveBeenCalledWith('Blank');
    expect(h.layout.createDashboard).toHaveBeenCalledWith('Owner', { id: 'owner' });
  });

  it('keeps export/import/kiosk settings actions and the shared print control reachable', () => {
    mount();
    const more = () => fireEvent.click(screen.getByRole('button', { name: 'More dashboard actions' }));
    more();
    fireEvent.click(screen.getByRole('button', { name: 'Export dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test export download' }));
    expect(h.layout.exportDashboard).toHaveBeenCalledOnce();
    more();
    fireEvent.click(screen.getByRole('button', { name: 'Import dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test import confirm' }));
    expect(h.layout.importDashboardFromData).toHaveBeenCalledWith(h.layout.activeDashboard);
    more();
    fireEvent.click(screen.getByRole('button', { name: 'Kiosk mode' }));
    expect(screen.getByTestId('pilot-kiosk-settings')).toBeInTheDocument();
  });

  it('retains share-hash decoding and body-portaled kiosk geometry without bypassing findings', () => {
    const json = JSON.stringify({ name: 'Shared', widgets: [], layouts: {} });
    window.location.hash = `#import=${toUrlSafeBase64(json)}`;
    h.isKiosk = true;
    const { container } = mount();
    expect(screen.getByTestId('pilot-import')).toHaveAttribute('data-json', json);
    expect(window.location.hash).toBe('');
    const kiosk = screen.getByTestId('pilot-kiosk-grid').parentElement;
    expect(kiosk?.parentElement).toBe(document.body);
    expect(kiosk).toHaveClass('kiosk-root', 'z-dashboard-kiosk');
    expect(kiosk).not.toHaveClass('z-[9990]');
    expect(container).not.toContainElement(screen.getByTestId('pilot-kiosk-grid'));
  });

  it('retains command-palette wiring and danger confirmation without resetting on dispatch', async () => {
    mount();
    act(() => window.dispatchEvent(new Event('dashboard:add-widget')));
    expect(screen.getByTestId('pilot-picker')).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event('dashboard:toggle-edit')));
    expect(h.layout.setEditMode).toHaveBeenCalledWith(true);
    act(() => window.dispatchEvent(new Event('dashboard:reset')));
    const dialog = await screen.findByRole('dialog');
    expect(h.layout.resetToDefault).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.layout.resetToDefault).not.toHaveBeenCalled();
  });
});
