import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, Bell, Radio, ArrowUpRight, Activity,
  Route, BatteryCharging, Shield, AlertCircle, Settings, Plus, RotateCcw,
  LayoutGrid, Download, Upload,
} from 'lucide-react';
import { request } from '@/api/client';
import { useAuthStatus } from '@/api/hooks/useSettings';
import { useSyncVehicles } from '@/api/hooks/useVehicles';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { FadeIn } from '@/components/motion';
import { AlertBanner } from '@/components/feedback';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { usePageTitle } from '@/hooks/usePageTitle';
import { DashboardGrid } from '../components/DashboardGrid';
import { WidgetPicker } from '../components/WidgetPicker';
import { WidgetSettingsModal } from '../components/WidgetSettingsModal';
import { LayoutManager } from '../components/LayoutManager';
import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { getWidgetDef } from '../widgets/registry';
import type { Vehicle, Alert } from '../types';
import type { WidgetConfig } from '../widgets/types';

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const { t } = useTranslation('dashboard');
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ——— Dashboard layout state ——— */
  const {
    dashboards, activeDashboard, activeId,
    editMode, setEditMode,
    addWidget, removeWidget, updateWidgetConfig,
    updateLayouts, autoArrange, getWidgetSize,
    switchDashboard, createDashboard, renameDashboard, deleteDashboard,
    applyPreset, resetToDefault, exportDashboard, importDashboard,
  } = useDashboardLayout();
  const [showPicker, setShowPicker] = useState(false);
  const [settingsWidgetId, setSettingsWidgetId] = useState<string | null>(null);

  /* ——— Auth status ——— */
  const { data: auth } = useAuthStatus();
  const syncVehicles = useSyncVehicles();

  /* ——— SSE real-time connection ——— */
  const { connected } = useRealtimeEvents({
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
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importDashboard(file);
    } catch {
      // TODO: show error toast
    }
    e.target.value = '';
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
    <div className="flex items-center gap-2">
      {editMode ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowPicker(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('dashboard.addWidget', 'Add Widget')}
          </Button>
          <Button variant="ghost" size="sm" onClick={autoArrange}>
            <LayoutGrid className="h-3.5 w-3.5 mr-1" />
            {t('dashboard.autoArrange', 'Auto Arrange')}
          </Button>
          <Button variant="ghost" size="sm" onClick={resetToDefault}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {t('dashboard.reset', 'Reset')}
          </Button>
          <Button size="sm" onClick={() => setEditMode(false)}>
            {t('dashboard.done', 'Done')}
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={handleRefresh} loading={isRefreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => exportDashboard()}>
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditMode(true)}>
            <Settings className="h-3.5 w-3.5 mr-1" />
            {t('dashboard.customize', 'Customize')}
          </Button>
        </>
      )}
      {!editMode && unreadAlerts > 0 && (
        <Link to="/alerts" className="relative">
          <Bell className="h-5 w-5 text-[var(--text-secondary)] hover:text-neon-cyan transition-colors" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-red text-[9px] font-bold text-[var(--text-primary)]">
            {unreadAlerts}
          </span>
        </Link>
      )}
      <StatusPill color={connected ? '#10b981' : '#6b7280'} pulse={connected}>
        <Radio className="h-3 w-3" />
        {connected ? 'LIVE' : 'OFFLINE'}
      </StatusPill>
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
        {/* Hidden file input for import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />

        {/* Error banner */}
        {anyError && (
          <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
            {t('error.loadFailed', 'Failed to load data')}: {anyError.message}
          </AlertBanner>
        )}

        {/* Auth warning */}
        {auth && !auth.authenticated && (
          <FadeIn>
            <AlertBanner
              variant="warning"
              icon={<AlertCircle className="h-5 w-5" />}
              title={t('auth.notConnected', 'Tesla account not connected')}
            >
              {t('auth.connectPrompt', 'Connect your account in')}{' '}
              <Link to="/settings" className="text-neon-cyan hover:underline">
                {t('auth.settings', 'Settings')}
              </Link>{' '}
              {t('auth.toStart', 'to start tracking.')}
            </AlertBanner>
          </FadeIn>
        )}

        {/* Layout Manager — always show when there are dashboards */}
        {dashboards.length > 0 && (
          <LayoutManager
            dashboards={dashboards}
            activeId={activeId}
            onSwitch={switchDashboard}
            onCreate={createDashboard}
            onRename={renameDashboard}
            onDelete={deleteDashboard}
          />
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
              <DashboardGrid
                dashboard={activeDashboard}
                editMode={editMode}
                onLayoutChange={updateLayouts}
                onRemoveWidget={removeWidget}
                onOpenSettings={setSettingsWidgetId}
                getWidgetSize={getWidgetSize}
              />
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
        onAddWidget={addWidget}
        onApplyPreset={applyPreset}
        activeWidgetIds={activeDashboard.widgets.map((w) => w.widgetId)}
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
            <Button onClick={onSync} loading={isSyncing} icon={<RefreshCw className="h-4 w-4" />}>
              {t('onboarding.sync', 'Sync Vehicles')}
            </Button>
          ) : (
            <Link to="/settings">
              <Button variant="primary">
                {t('onboarding.connect', 'Connect Tesla Account')} <ArrowUpRight className="h-4 w-4 ml-1 inline-block" />
              </Button>
            </Link>
          )}
        </div>
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto">
          {[
            { icon: Activity, label: t('onboarding.tracking', 'Real-time Tracking'), color: '#00f0ff' },
            { icon: Route, label: t('onboarding.drives', 'Drive History'), color: '#a855f7' },
            { icon: BatteryCharging, label: t('onboarding.charging', 'Charge Analytics'), color: '#10b981' },
            { icon: Shield, label: t('onboarding.control', 'Vehicle Control'), color: '#ef4444' },
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
    </div>
  );
}
