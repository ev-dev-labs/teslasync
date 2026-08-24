import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStatus } from '@/api/hooks/useSettings';
import { useSyncVehicles, useVehicles } from '@/api/hooks/useVehicles';
import { useAlerts } from '@/api/hooks/useAlerts';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, PrintButton, Heading, Text, Caption } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { AlertBanner, LiveStaleDataBanner, Skeleton } from '@/components/feedback';
import { LiveIndicator, DataFreshnessAuto } from '@/components/data-display';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTheme } from '@/components/ui/ThemeProvider';
import { Palette } from 'lucide-react';
import { DashboardGrid } from '../components/DashboardGrid';
import { WidgetPicker } from '../components/WidgetPicker';
import { WidgetSettingsModal } from '../components/WidgetSettingsModal';
import { LayoutManager } from '../components/LayoutManager';
import { LayoutSwitcher } from '../components/LayoutSwitcher';
import { TemplateGallery } from '../components/TemplateGallery';
import { ExportModal } from '../components/ExportModal';
import { ImportPreviewModal } from '../components/ImportPreviewModal';
import { DashboardSettingsModal } from '../components/DashboardSettingsModal';
import { KioskOverlay } from '../components/KioskOverlay';
import { KioskSettingsModal } from '../components/KioskSettingsModal';
import { AddWidgetButton } from '../components/AddWidgetButton';
import { WidgetCatalogueDialog } from '../components/WidgetCatalogueDialog';
import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { useLayoutKeyboard } from '../hooks/useLayoutKeyboard';
import { useKioskMode } from '../hooks/useKioskMode';
import { fromUrlSafeBase64 } from '../hooks/validateImport';
import { getWidgetDef } from '../widgets/registry';
import { markCustomizeDashboardCompleted } from '@/features/onboarding/checklist';
import type { WidgetConfig, SavedDashboard } from '../widgets/types';

import { Icons } from '@/lib/icons';

const THEME_FIRST_RUN_KEY = 'teslasync:themeFirstRunDismissed:v1';

/**
 * Widget ids in the seeded `DEFAULT_DASHBOARD` layout (see
 * `useDashboardLayout.ts:182`). Used to detect "user hasn't customized
 * yet" so the soft hint banner can encourage discovery. Kept in sync manually
 * with the seed so we don't pull state through a re-export cycle.
 */
const DEFAULT_WIDGET_IDS = new Set<string>([
  'onboarding-checklist',
  'vehicle-hero',
  'battery-gauge',
  'climate-status',
  'recent-drives',
  'charge-status',
  'security-status',
  'quick-nav',
]);

const CUSTOMIZE_HINT_DISMISSED_KEY = 'teslasync:dashboard:customizeHintDismissed:v1';
const CUSTOMIZE_HINT_DELAY_MS = 5_000;

/**
 * First-run theme prompt.
 *
 * Renders once at the top of the dashboard for users who haven't picked a
 * theme yet (still on the `neon-cyan` default) AND haven't dismissed the
 * banner before. Both the "Open theme picker" and "Maybe later" actions
 * mark the prompt as dismissed; the close button does the same.
 *
 * Storage key is versioned (`:v1`) so a future redesign can re-trigger the
 * prompt by bumping the suffix.
 */
function ThemeFirstRunBanner() {
  const { t } = useTranslation();
  const { themeId } = useTheme();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(THEME_FIRST_RUN_KEY) === '1';
    } catch {
      return true;
    }
  });

  if (dismissed) return null;
  // Only nag users who are still on the default theme. Anyone who's already
  // customized has implicitly self-served, so the banner is skipped.
  if (themeId !== 'neon-cyan') return null;

  const persistDismiss = () => {
    try {
      window.localStorage.setItem(THEME_FIRST_RUN_KEY, '1');
    } catch {
      /* quota or disabled storage */
    }
    setDismissed(true);
  };

  const openPicker = () => {
    window.dispatchEvent(new CustomEvent('open-theme-popover'));
    persistDismiss();
  };

  return (
    <AlertBanner
      variant="info"
      icon={<Palette className="h-4 w-4" />}
      title={t('theme.firstRunTitle', 'Personalize TeslaSync')}
      onClose={persistDismiss}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 min-w-0">{t('theme.firstRunBody', 'Pick a color theme that fits your style.')}</span>
        <div className="flex gap-2 shrink-0">
          <Button variant="primary" size="sm" onClick={openPicker}>
            {t('theme.firstRunOpen', 'Open theme picker')}
          </Button>
          <Button variant="ghost" size="sm" onClick={persistDismiss}>
            {t('theme.firstRunLater', 'Maybe later')}
          </Button>
        </div>
      </div>
    </AlertBanner>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  usePageTitle(t('title', 'Command Center'));
  const queryClient = useQueryClient();

  /* ——— Dashboard layout state ——— */
  const {
    dashboards, activeDashboard, activeId,
    editMode, setEditMode,
    addWidgets, removeWidget, updateWidgetConfig,
    updateLayouts, autoArrange, getWidgetSize,
    switchDashboard, createDashboard, renameDashboard, deleteDashboard,
    reorderDashboards, duplicateDashboard, updateDashboardSettings, updateDashboardIcon,
    applyPreset, resetToDefault, exportDashboard, importDashboardFromData,
    canUndo, canRedo, undoCount, undo, redo,
    dirty, pinToVehicle,
  } = useDashboardLayout();
  const [showPicker, setShowPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState<string | null>(null);
  const [showKioskSettings, setShowKioskSettings] = useState(false);
  const [showDashSettings, setShowDashSettings] = useState<string | null>(null);
  useLayoutKeyboard({
    editMode, setEditMode, canUndo, canRedo, onUndo: undo, onRedo: redo,
    dashboards, switchDashboard,
  });
  const [settingsWidgetId, setSettingsWidgetId] = useState<string | null>(null);

  /* ——— Widget-add discovery ——— */
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CUSTOMIZE_HINT_DISMISSED_KEY) === '1';
    } catch {
      return true;
    }
  });
  const [hintReady, setHintReady] = useState(false);
  const isOnlyDefault =
    activeDashboard.widgets.length > 0 &&
    activeDashboard.widgets.every((w) => DEFAULT_WIDGET_IDS.has(w.widgetId));
  useEffect(() => {
    if (!isOnlyDefault || hintDismissed || editMode) {
      setHintReady(false);
      return undefined;
    }
    const id = window.setTimeout(() => setHintReady(true), CUSTOMIZE_HINT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [isOnlyDefault, hintDismissed, editMode]);
  const dismissHint = () => {
    setHintDismissed(true);
    setHintReady(false);
    try {
      window.localStorage.setItem(CUSTOMIZE_HINT_DISMISSED_KEY, '1');
    } catch {
      /* quota or disabled storage */
    }
  };
  const handleCatalogueAdd = (widgetId: string) => {
    addWidgets([widgetId]);
    markCustomizeDashboardCompleted();
    // Also drop the soft hint immediately so it doesn't re-appear once the
    // 5s timer wins after the user already engaged.
    dismissHint();
  };

  /* ——— Kiosk mode ——— */
  const {
    config: kioskConfig, updateConfig: updateKioskConfig,
    isKiosk, enterKiosk, exitKiosk,
    isDimmed, isCursorHidden, rotateIndex, validIds,
  } = useKioskMode(dashboards, activeId, switchDashboard);

  /* ——— Auth status ——— */
  const { data: auth } = useAuthStatus();
  const syncVehicles = useSyncVehicles();

  /* ——— SSE real-time connection ——— */
  // Keep the SSE pipe wired up for cross-tab cache invalidation; live-pipe
  // health is rendered via `<LiveIndicator>` (uses `useLiveConnection`).
  useRealtimeEvents({
    onVehicleUpdate: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
    onFallbackToPolling: () => queryClient.invalidateQueries(),
  });

  /* ——— Core data queries (shared TanStack hooks) ——— */
  const vehiclesQuery = useVehicles();
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = vehiclesQuery;
  const { data: alerts, error: alertsError } = useAlerts();
  const { vehicleId: selectedVehicleId } = useSelectedVehicle();

  /* ——— Derived values ——— */
  const vehicleList = vehicles ?? [];
  const dashboardVehicleId =
    activeDashboard.settings?.vehicleId ?? selectedVehicleId ?? undefined;
  const unreadAlerts = (alerts ?? []).filter((a) => !a.is_read).length;
  const anyError = [vehiclesError, alertsError].find(Boolean) as Error | undefined;

  /* ——— Refresh logic ——— */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60_000); return () => clearInterval(id); }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['vehicle-state'] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['fleet-analytics'] }),
      queryClient.invalidateQueries({ queryKey: ['drives'] }),
      queryClient.invalidateQueries({ queryKey: ['charging'] }),
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
      queryClient.invalidateQueries({ queryKey: ['motor-latest'] }),
      queryClient.invalidateQueries({ queryKey: ['climate-latest'] }),
      queryClient.invalidateQueries({ queryKey: ['security-latest'] }),
      queryClient.invalidateQueries({ queryKey: ['tire-latest'] }),
    ]);
    setIsRefreshing(false);
  };

  /* ——— Import handler ——— */
  const handleImportConfirm = (dashboard: SavedDashboard) => {
    importDashboardFromData(dashboard);
  };

  /* ——— URL import detection ——— */
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#import=')) {
      try {
        const encoded = hash.slice('#import='.length);
        const json = fromUrlSafeBase64(encoded);
        setImportJson(json);
        setShowImportModal(true);
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
      } catch {
        // Invalid base64 — ignore
      }
    }
  }, []);

  /* ——— Command-palette bridge ——— */
  // The command palette dispatches `dashboard:*` CustomEvents because it lives
  // outside the dashboard's React tree and can't call hooks directly.
  useEffect(() => {
    const onToggleEdit = () => setEditMode(!editMode);
    const onAddWidget = () => setShowPicker(true);
    const onReset = () => {
      // Defer to LayoutSwitcher's confirm flow next time the user opens it.
      // For palette invocation, run the destructive op behind window.confirm
      // so power users still get a one-click path.
      if (window.confirm(t('layout.resetMessage', 'This removes all customizations and restores the shipped default dashboard. Your other saved layouts are not affected.'))) {
        resetToDefault();
      }
    };
    window.addEventListener('dashboard:toggle-edit', onToggleEdit);
    window.addEventListener('dashboard:add-widget', onAddWidget);
    window.addEventListener('dashboard:reset', onReset);
    // dashboard:open-switcher is handled by LayoutSwitcher itself if it
    // mounts a listener — for now we navigate to /dashboard so the switcher
    // is on screen and let the user click it.
    return () => {
      window.removeEventListener('dashboard:toggle-edit', onToggleEdit);
      window.removeEventListener('dashboard:add-widget', onAddWidget);
      window.removeEventListener('dashboard:reset', onReset);
    };
  }, [editMode, setEditMode, resetToDefault, t]);

  /* ——— Template gallery handler ——— */
  const handleApplyTemplate = (presetId: string) => {
    if (presetId === '__blank__') {
      createDashboard(t('dashboard.newDashboard', 'New Dashboard'));
    } else {
      applyPreset(presetId);
    }
    setShowTemplates(false);
  };

  /* ——— Widget settings ——— */
  const settingsWidget = settingsWidgetId
    ? activeDashboard.widgets.find((w) => w.id === settingsWidgetId)
    : null;
  const settingsDef = settingsWidget ? getWidgetDef(settingsWidget.widgetId) : null;

  const handleSaveWidgetConfig = (config: WidgetConfig) => {
    if (settingsWidgetId) {
      updateWidgetConfig(settingsWidgetId, config);
    }
  };

  /* ——— Header actions ——— */
  const headerActions = (
    <div data-print-hide className="flex items-center gap-2 flex-wrap">
      {editMode ? (
        <>
          <div className="flex items-center gap-1 me-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              aria-label={t('dashboard.undo', 'Undo')}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30"
            >
              <Icons.undoAlt className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={redo}
              disabled={!canRedo}
              aria-label={t('dashboard.redo', 'Redo')}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30"
            >
              <Icons.redo className="h-4 w-4" />
            </Button>
            {canUndo && (
              <Caption className="tabular-nums" aria-hidden="true">
                {undoCount}
              </Caption>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowPicker(true)}>
            <Icons.add className="h-3.5 w-3.5 sm:me-1" />
            <span className="hidden sm:inline">{t('dashboard.addWidget', 'Add Widget')}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={autoArrange}>
            <Icons.layoutGrid className="h-3.5 w-3.5 sm:me-1" />
            <span className="hidden sm:inline">{t('dashboard.autoArrange', 'Auto Arrange')}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowTemplates(true)} className="hidden sm:flex">
            <Icons.layoutTemplate className="h-3.5 w-3.5 me-1" />
            {t('dashboard.templates', 'Templates')}
          </Button>
          <Button variant="ghost" size="sm" onClick={resetToDefault} className="hidden sm:flex">
            <Icons.undo className="h-3.5 w-3.5 me-1" />
            {t('dashboard.reset', 'Reset')}
          </Button>
          <Button size="sm" onClick={() => setEditMode(false)}>
            {t('dashboard.done', 'Done')}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            loading={isRefreshing}
            aria-label={t('dashboard.refresh', 'Refresh data')}
          >
            <Icons.refresh className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowExportModal(true)}
            className="hidden sm:flex"
            aria-label={t('dashboard.export', 'Export dashboard')}
          >
            <Icons.download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setImportJson(null); setShowImportModal(true); }}
            className="hidden sm:flex"
            aria-label={t('dashboard.import', 'Import dashboard')}
          >
            <Icons.upload className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowKioskSettings(true)} className="hidden sm:flex">
            <Icons.tv className="h-3.5 w-3.5 me-1" />
            {t('dashboard.kiosk', 'Kiosk')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditMode(true)} data-tour="edit-mode-btn">
            <Icons.settings className="h-3.5 w-3.5 sm:me-1" />
            <span className="hidden sm:inline">{t('dashboard.customize', 'Customize')}</span>
          </Button>
        </>
      )}
      {!editMode && unreadAlerts > 0 && (
        <Link
          to="/notifications/alerts"
          className="relative rounded-lg p-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          aria-label={t('dashboard.unreadAlerts', '{{count}} unread alerts', { count: unreadAlerts })}
        >
          <Icons.notifications className="h-5 w-5" aria-hidden="true" />
          <Text
            as="span"
            size="2xs"
            weight="bold"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-neon-red/30 bg-neon-red/90 px-1 tabular-nums text-rose-50 forced-colors:text-[CanvasText]"
          >
            {unreadAlerts > 99 ? '99+' : unreadAlerts}
          </Text>
        </Link>
      )}
      <LiveIndicator variant="compact" />
      <DataFreshnessAuto query={vehiclesQuery} />
      {!editMode && (
        <PrintButton label={t('dashboard.printSnapshot', 'Print snapshot')} />
      )}
    </div>
  );

  return (
    <PageContainer
      title={t('title', 'Command Center')}
      subtitle={t('subtitle', 'Real-time fleet intelligence and control')}
      actions={headerActions}
    >
      <div className="space-y-6">
        {/* Transient banner cluster — first-run theme prompt, live-pipe
            stale warning, customize hint, load error, and Tesla auth
            warning. Each child self-hides when its condition is inactive. */}
        <div className="space-y-3">
          <ThemeFirstRunBanner />
          <LiveStaleDataBanner />

          {/* Soft hint that the dashboard is customizable. Shows after
              CUSTOMIZE_HINT_DELAY_MS for users still on the seeded default
              layout, and disappears the moment they add a widget or dismiss. */}
          {hintReady && !editMode && (
            <AlertBanner
              variant="info"
              icon={<Icons.add className="h-4 w-4" />}
              onClose={dismissHint}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  {t(
                    'dashboard.customizeHint',
                    'You can customize this dashboard. Tap the + to add widgets.',
                  )}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setCatalogueOpen(true);
                    dismissHint();
                  }}
                >
                  {t('dashboard.customizeHintCta', 'Add widgets')}
                </Button>
              </div>
            </AlertBanner>
          )}

          {anyError && (
            <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>
              {t('error.loadFailed', 'Failed to load data')}: {anyError.message}
            </AlertBanner>
          )}

          {auth && !auth.authenticated && (
            <AlertBanner
              variant="warning"
              icon={<Icons.alertCircle className="h-5 w-5" />}
              title={t('auth.notConnected', 'Tesla account not connected')}
            >
              {t('auth.connectPrompt', 'Connect your account in')}{' '}
              <Link to="/settings" className="text-cyan-300 hover:underline">
                {t('auth.settings', 'Settings')}
              </Link>{' '}
              {t('auth.toStart', 'to start tracking.')}
            </AlertBanner>
          )}
        </div>

        {/* Layout switcher + manager — shown whenever saved dashboards exist. */}
        {dashboards.length > 0 && (
          <FadeIn delay={0.05}>
            <section
              aria-label={t('dashboard.layoutsRegion', 'Dashboard layouts')}
              className="space-y-2"
            >
              <LayoutSwitcher
                dashboards={dashboards}
                activeId={activeId}
                dirty={dirty}
                editMode={editMode}
                onSwitch={switchDashboard}
                onCreate={(name) => createDashboard(name)}
                onDuplicate={duplicateDashboard}
                onReset={resetToDefault}
                onToggleEdit={() => setEditMode(!editMode)}
                onPinToVehicle={pinToVehicle}
              />
              <LayoutManager
                dashboards={dashboards}
                activeId={activeId}
                onSwitch={switchDashboard}
                onCreate={createDashboard}
                onRename={renameDashboard}
                onDelete={deleteDashboard}
                onReorder={reorderDashboards}
                onDuplicate={duplicateDashboard}
                onOpenSettings={(id) => setShowDashSettings(id)}
                onOpenTemplates={() => setShowTemplates(true)}
              />
            </section>
          </FadeIn>
        )}

        {/* Primary surface — the customizable widget bento (hero). Owns its
            own loading + empty states so the rest of the page stays live. */}
        {vehiclesLoading ? (
          <LoadingSkeleton />
        ) : vehicleList.length > 0 ? (
          <FadeIn delay={0.1}>
            <section
              aria-label={t('dashboard.widgetsRegion', 'Dashboard widgets')}
              className="space-y-4"
            >
              {editMode && (
                <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-white/[0.02] px-4 py-3 text-center">
                  <Text as="p" size="sm" color="secondary">
                    {t('dashboard.editHint', 'Drag widgets to reorder, resize from edges. Click the gear icon for widget settings.')}
                  </Text>
                </div>
              )}

              <div data-tour="dashboard-grid">
                <DashboardGrid
                  dashboard={activeDashboard}
                  editMode={editMode}
                  onLayoutChange={updateLayouts}
                  onRemoveWidget={removeWidget}
                  onOpenSettings={setSettingsWidgetId}
                  getWidgetSize={getWidgetSize}
                  dashboardVehicleId={dashboardVehicleId}
                  compactMode={activeDashboard.settings?.compactMode}
                  showWidgetBorders={activeDashboard.settings?.showWidgetBorders}
                />
              </div>
            </section>
          </FadeIn>
        ) : (
          <FadeIn delay={0.1}>
            <EmptyOnboarding
              authenticated={auth?.authenticated ?? false}
              onSync={() => syncVehicles.mutate()}
              isSyncing={syncVehicles.isPending}
            />
          </FadeIn>
        )}
      </div>

      {/* Widget Picker Drawer */}
      <WidgetPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onAddWidgets={addWidgets}
        onApplyPreset={applyPreset}
        activeWidgetIds={activeDashboard.widgets.map((w) => w.widgetId)}
      />

      {/* Template Gallery Modal */}
      <TemplateGallery
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onApply={handleApplyTemplate}
      />

      {/* Widget Settings Modal */}
      {settingsWidget && settingsDef && (
        <WidgetSettingsModal
          widget={settingsWidget}
          def={settingsDef}
          open={!!settingsWidgetId}
          onClose={() => setSettingsWidgetId(null)}
          onSave={handleSaveWidgetConfig}
        />
      )}

      {/* Export Modal */}
      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        dashboard={activeDashboard}
        onDownload={() => exportDashboard()}
      />

      {/* Import Preview Modal */}
      <ImportPreviewModal
        open={showImportModal}
        onClose={() => { setShowImportModal(false); setImportJson(null); }}
        onConfirm={handleImportConfirm}
        initialJson={importJson}
      />

      {/* Kiosk Settings Modal */}
      <KioskSettingsModal
        open={showKioskSettings}
        onClose={() => setShowKioskSettings(false)}
        config={kioskConfig}
        onUpdateConfig={updateKioskConfig}
        onEnterKiosk={enterKiosk}
        dashboards={dashboards}
      />

      {/* Dashboard Settings Modal */}
      {showDashSettings && (
        <DashboardSettingsModal
          open={!!showDashSettings}
          onClose={() => setShowDashSettings(null)}
          dashboard={dashboards.find((d) => d.id === showDashSettings) ?? activeDashboard}
          vehicles={vehicleList.map((v) => ({ id: v.id, display_name: v.display_name }))}
          onUpdate={(settings) => updateDashboardSettings(showDashSettings, settings)}
          onRename={(name) => renameDashboard(showDashSettings, name)}
          onChangeIcon={(icon) => updateDashboardIcon(showDashSettings, icon)}
        />
      )}

      {/* Discoverable add-widget surface. The FAB is
          hidden in kiosk mode and edit mode; the catalogue is the lightweight
          alternative to the full WidgetPicker drawer. */}
      {!isKiosk && (
        <AddWidgetButton onClick={() => setCatalogueOpen(true)} isEditing={editMode} />
      )}
      <WidgetCatalogueDialog
        open={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        onAdd={handleCatalogueAdd}
        activeWidgetIds={activeDashboard.widgets.map((w) => w.widgetId)}
      />

      {/* Kiosk Mode — portaled to document.body to escape all app chrome */}
      {isKiosk && createPortal(
        <div
          // Not a <Modal>: kiosk root is a full-screen mounting point for the
          // dashboard grid in kiosk mode, not a dialog. It hosts the live
          // dashboard, not user-dismissable content. New interactive dialogs
          // MUST use <Modal>.
          // eslint-disable-next-line no-restricted-syntax
          className="kiosk-root fixed inset-0 z-[9990]"
          style={{
            backgroundColor: `rgba(10, 10, 20, ${kioskConfig.backgroundOpacity ?? 1})`,
          }}
        >
          <DashboardGrid
            dashboard={activeDashboard}
            editMode={false}
            onLayoutChange={() => {}}
            onRemoveWidget={() => {}}
            onOpenSettings={() => {}}
            getWidgetSize={getWidgetSize}
            dashboardVehicleId={dashboardVehicleId}
            compactMode={activeDashboard.settings?.compactMode}
            showWidgetBorders={activeDashboard.settings?.showWidgetBorders}
            kioskWidgetOpacity={kioskConfig.widgetOpacity ?? 1}
          />
          <KioskOverlay
            config={kioskConfig}
            isDimmed={isDimmed}
            isCursorHidden={isCursorHidden}
            dashboardCount={validIds.length}
            currentIndex={rotateIndex}
            onExit={exitKiosk}
          />
        </div>,
        document.body,
      )}
    </PageContainer>
  );
}

/* ——— Empty / Onboarding State ——— */
function EmptyOnboarding({ authenticated, onSync, isSyncing }: {
  authenticated: boolean;
  onSync: () => void;
  isSyncing: boolean;
}) {
  const { t } = useTranslation('dashboard');
  const features = [
    { icon: Icons.efficiency, label: t('onboarding.tracking', 'Real-time Tracking'), tone: 'text-cyan-300' },
    { icon: Icons.drive, label: t('onboarding.drives', 'Drive History'), tone: 'text-purple-300' },
    { icon: Icons.batteryCharging, label: t('onboarding.charging', 'Charge Analytics'), tone: 'text-emerald-300' },
    { icon: Icons.security, label: t('onboarding.control', 'Vehicle Control'), tone: 'text-rose-300' },
  ];
  return (
    <GlassPanel className="relative overflow-hidden p-6 text-center sm:p-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.03] via-transparent to-neon-purple/[0.03]"
      />
      <div className="relative space-y-8">
        <div className="mx-auto max-w-lg space-y-3">
          <Heading level="section">
            {authenticated
              ? t('onboarding.syncTitle', 'Sync Your Vehicles')
              : t('onboarding.title', 'Welcome to TeslaSync')}
          </Heading>
          <Text as="p" size="base" color="secondary">
            {authenticated
              ? t('onboarding.syncDesc', 'Your Tesla account is connected. Sync your vehicles to start tracking.')
              : t('onboarding.desc', 'The next-generation Tesla fleet intelligence platform. Connect your Tesla account to start real-time monitoring, analytics, and vehicle control.')}
          </Text>
          <div className="flex items-center justify-center gap-4 pt-1">
            {authenticated ? (
              <Button onClick={onSync} loading={isSyncing} icon={<Icons.refresh className="h-4 w-4" />}>
                {t('onboarding.sync', 'Sync Vehicles')}
              </Button>
            ) : (
              <Link to="/settings">
                <Button variant="primary">
                  {t('onboarding.connect', 'Connect Tesla Account')}{' '}
                  <Icons.drillThrough className="ms-1 inline-block h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {features.map((f) => (
            <li key={f.label}>
              <GlassPanel className="flex h-full flex-col items-center gap-2 p-4 text-center">
                <f.icon className={`h-6 w-6 ${f.tone}`} aria-hidden="true" />
                <Text as="span" size="xs" weight="medium" color="secondary">
                  {f.label}
                </Text>
              </GlassPanel>
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  );
}

/* ——— Loading Skeleton — mirrors the switcher strip + widget bento ——— */
function LoadingSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-10 w-full sm:w-2/3" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
