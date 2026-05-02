import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { request } from '@/api/client';
import { useAuthStatus } from '@/api/hooks/useSettings';
import { useSyncVehicles } from '@/api/hooks/useVehicles';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { PrintButton } from '@/components/ui/PrintButton';
import { FadeIn } from '@/components/motion';
import { AlertBanner, LiveStaleDataBanner } from '@/components/feedback';
import { LiveIndicator } from '@/components/data-display';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { usePageTitle } from '@/hooks/usePageTitle';
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
import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { useLayoutKeyboard } from '../hooks/useLayoutKeyboard';
import { useKioskMode } from '../hooks/useKioskMode';
import { fromUrlSafeBase64 } from '../hooks/validateImport';
import { getWidgetDef } from '../widgets/registry';
import type { Vehicle, Alert } from '../types';
import type { WidgetConfig, SavedDashboard } from '../widgets/types';
import { Icons } from '@/lib/icons';

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const { t } = useTranslation('dashboard');
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

  /* ——— Core data queries ——— */
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });
  const { data: alerts, error: alertsError } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => request<Alert[]>('/alerts?limit=10'),
  });

  /* ——— Derived values ——— */
  const unreadAlerts = alerts?.filter((a) => !a.is_read).length ?? 0;
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

  /* ——— Command-palette bridge (Phase 40 / Prompt 30) ——— */
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
          <div className="flex items-center gap-1 mr-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              aria-label={t('dashboard.undo', 'Undo')}
              className="text-white/60 hover:text-white disabled:opacity-30"
            >
              <Icons.undoAlt className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={redo}
              disabled={!canRedo}
              aria-label={t('dashboard.redo', 'Redo')}
              className="text-white/60 hover:text-white disabled:opacity-30"
            >
              <Icons.redo className="h-4 w-4" />
            </Button>
            {canUndo && (
              <span className="text-[10px] text-white/30 tabular-nums">
                {undoCount}
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowPicker(true)}>
            <Icons.add className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">{t('dashboard.addWidget', 'Add Widget')}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={autoArrange}>
            <Icons.layoutGrid className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">{t('dashboard.autoArrange', 'Auto Arrange')}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowTemplates(true)} className="hidden sm:flex">
            <Icons.layoutTemplate className="h-3.5 w-3.5 mr-1" />
            {t('dashboard.templates', 'Templates')}
          </Button>
          <Button variant="ghost" size="sm" onClick={resetToDefault} className="hidden sm:flex">
            <Icons.undo className="h-3.5 w-3.5 mr-1" />
            {t('dashboard.reset', 'Reset')}
          </Button>
          <Button size="sm" onClick={() => setEditMode(false)}>
            {t('dashboard.done', 'Done')}
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={handleRefresh} loading={isRefreshing}>
            <Icons.refresh className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowExportModal(true)} className="hidden sm:flex">
            <Icons.download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setImportJson(null); setShowImportModal(true); }} className="hidden sm:flex">
            <Icons.upload className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowKioskSettings(true)} className="hidden sm:flex">
            <Icons.tv className="h-3.5 w-3.5 mr-1" />
            {t('dashboard.kiosk', 'Kiosk')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditMode(true)} data-tour="edit-mode-btn">
            <Icons.settings className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">{t('dashboard.customize', 'Customize')}</span>
          </Button>
        </>
      )}
      {!editMode && unreadAlerts > 0 && (
        <Link to="/alerts" className="relative">
          <Icons.notifications className="h-5 w-5 text-[var(--text-secondary)] hover:text-neon-cyan transition-colors" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-red text-[9px] font-bold text-[var(--text-primary)]">
            {unreadAlerts}
          </span>
        </Link>
      )}
      <LiveIndicator variant="compact" />
      {!editMode && (
        <PrintButton label={t('dashboard.printSnapshot', 'Print snapshot')} />
      )}
    </div>
  );

  return (
    <PageContainer
      title={t('title', 'Command Center')}
      subtitle={t('subtitle', 'Real-time fleet intelligence and control')}
      loading={vehiclesLoading}
      actions={headerActions}
    >
      <div className="space-y-4">
        {/* Live-pipe stale-data warning (only shows after >2 min disconnected) */}
        <LiveStaleDataBanner />

        {/* Error banner */}
        {anyError && (
          <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>
            {t('error.loadFailed', 'Failed to load data')}: {anyError.message}
          </AlertBanner>
        )}

        {/* Auth warning */}
        {auth && !auth.authenticated && (
          <FadeIn>
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
          </FadeIn>
        )}

        {/* Layout Manager — always show when there are dashboards */}
        {dashboards.length > 0 && (
          <div className="space-y-2">
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
          </div>
        )}

        {vehiclesLoading ? (
          <LoadingSkeleton />
        ) : vehicles && vehicles.length > 0 ? (
          <>
            {/* Edit mode hint */}
            {editMode && (
              <FadeIn>
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-3 text-center">
                  <p className="text-sm text-[var(--text-secondary)]">
                    {t('dashboard.editHint', 'Drag widgets to reorder, resize from edges. Click the gear icon for widget settings.')}
                  </p>
                </div>
              </FadeIn>
            )}

            {/* Widget Grid */}
            <FadeIn>
              <div data-tour="dashboard-grid">
                <DashboardGrid
                  dashboard={activeDashboard}
                  editMode={editMode}
                  onLayoutChange={updateLayouts}
                  onRemoveWidget={removeWidget}
                  onOpenSettings={setSettingsWidgetId}
                  getWidgetSize={getWidgetSize}
                  dashboardVehicleId={activeDashboard.settings?.vehicleId}
                  compactMode={activeDashboard.settings?.compactMode}
                  showWidgetBorders={activeDashboard.settings?.showWidgetBorders}
                />
              </div>
            </FadeIn>
          </>
        ) : (
          <FadeIn>
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
          vehicles={(vehicles ?? []).map((v) => ({ id: v.id, display_name: v.display_name }))}
          onUpdate={(settings) => updateDashboardSettings(showDashSettings, settings)}
          onRename={(name) => renameDashboard(showDashSettings, name)}
          onChangeIcon={(icon) => updateDashboardIcon(showDashSettings, icon)}
        />
      )}

      {/* Kiosk Mode — portaled to document.body to escape all app chrome */}
      {isKiosk && createPortal(
        <div
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
            dashboardVehicleId={activeDashboard.settings?.vehicleId}
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
  return (
    <GlassPanel className="p-12 text-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
      <div className="relative">
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
          {authenticated
            ? t('onboarding.syncTitle', 'Sync Your Vehicles')
            : t('onboarding.title', 'Welcome to TeslaSync')}
        </h2>
        <p className="text-[var(--text-secondary)] max-w-md mx-auto mb-8">
          {authenticated
            ? t('onboarding.syncDesc', 'Your Tesla account is connected. Sync your vehicles to start tracking.')
            : t('onboarding.desc', 'The next-generation Tesla fleet intelligence platform. Connect your Tesla account to start real-time monitoring, analytics, and vehicle control.')}
        </p>
        <div className="flex items-center justify-center gap-4">
          {authenticated ? (
            <Button onClick={onSync} loading={isSyncing} icon={<Icons.refresh className="h-4 w-4" />}>
              {t('onboarding.sync', 'Sync Vehicles')}
            </Button>
          ) : (
            <Link to="/settings">
              <Button variant="primary">
                {t('onboarding.connect', 'Connect Tesla Account')} <Icons.drillThrough className="h-4 w-4 ml-1 inline-block" />
              </Button>
            </Link>
          )}
        </div>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-2xl mx-auto">
          {[
            { icon: Icons.efficiency, label: t('onboarding.tracking', 'Real-time Tracking'), color: '#00f0ff' },
            { icon: Icons.drive, label: t('onboarding.drives', 'Drive History'), color: '#a855f7' },
            { icon: Icons.batteryCharging, label: t('onboarding.charging', 'Charge Analytics'), color: '#10b981' },
            { icon: Icons.security, label: t('onboarding.control', 'Vehicle Control'), color: '#ef4444' },
          ].map((f) => (
            <GlassPanel key={f.label} className="p-3 text-center">
              <f.icon className="h-6 w-6 mx-auto mb-2" style={{ color: f.color }} />
              <p className="text-xs font-medium text-gray-300">{f.label}</p>
            </GlassPanel>
          ))}
        </div>
      </div>
    </GlassPanel>
  );
}

/* ——— Loading Skeleton ——— */
function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-72" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
    </div>
  );
}
