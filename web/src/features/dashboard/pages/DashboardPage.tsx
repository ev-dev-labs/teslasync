import { useState, useEffect, useRef, useCallback, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStatus } from '@/api/hooks/useSettings';
import {
  FLEET_STATES_QUERY_ROOT,
  useSyncVehicles,
  useVehicles,
} from '@/api/hooks/useVehicles';
import { PageLayout } from '@/components/layout';
import { VisuallyHidden } from '@/components/a11y';
import {
  Badge,
  Button,
  BUTTON_BASE,
  BUTTON_VARIANTS,
  Caption,
  ConfirmDialog,
  GlassPanel,
  Heading,
  Icon,
  Popover,
  PrintButton,
  Text, IconButton } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { FadeIn } from '@/components/motion';
import { AlertBanner, LiveStaleDataBanner, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTheme } from '@/components/ui/ThemeProvider';
import {
  Activity, AlertCircle, ArrowUpRight, BatteryCharging, Check, Download,
  LayoutGrid, MoreHorizontal, Palette, Plus, Redo2, RefreshCw, RotateCcw,
  Route, Settings, Shield, ShieldCheck, Tv, Undo2, Upload,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { neonColorMap, typography } from '@/lib/tokens';
import { DashboardGrid } from '../components/DashboardGrid';
import { WidgetPicker } from '../components/WidgetPicker';
import { WidgetSettingsModal } from '../components/WidgetSettingsModal';
import { LayoutSwitcher } from '../components/LayoutSwitcher';
import { TemplateGallery } from '../components/TemplateGallery';
import { ExportModal } from '../components/ExportModal';
import { ImportPreviewModal } from '../components/ImportPreviewModal';
import { DashboardSettingsModal } from '../components/DashboardSettingsModal';
import { KioskSettingsModal } from '../components/KioskSettingsModal';
import { DASHBOARD_PRESETS, useDashboardLayout, type GridBreakpoint } from '../hooks/useDashboardLayout';
import { useLayoutKeyboard } from '../hooks/useLayoutKeyboard';
import { useKioskMode } from '../hooks/useKioskMode';
import { fromUrlSafeBase64 } from '../hooks/validateImport';
import { getWidgetDef } from '../widgets/registry';
import { markCustomizeDashboardCompleted } from '@/features/onboarding/checklist';
import { kioskBackgroundStyle } from '../lib/kioskAppearance';
import {
  DASHBOARD_PRESET_REQUESTED_EVENT,
  consumePendingDashboardPreset,
} from '@/lib/dashboardPresets';
import { WIDGET_DND_MIME, type WidgetConfig, type SavedDashboard, type DropPlacement } from '../widgets/types';

const THEME_FIRST_RUN_KEY = 'teslasync:themeFirstRunDismissed:v1';
const ACTION_TARGET = 'min-h-11 min-w-11 md:min-h-9 md:min-w-0';

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
  'fleet-posture',
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
      icon={<Icon icon={Palette} />}
      title={t('theme.firstRunTitle', 'Personalize TeslaSync')}
      onClose={persistDismiss}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="min-w-0 sm:flex-1">{t('theme.firstRunBody', 'Pick a color theme that fits your style.')}</span>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
          <Button variant="secondary" size="sm" wrapLabel className={ACTION_TARGET} onClick={openPicker}>
            {t('theme.firstRunOpen', 'Open theme picker')}
          </Button>
          <Button variant="ghost" size="sm" wrapLabel className={ACTION_TARGET} onClick={persistDismiss}>
            {t('theme.firstRunLater', 'Maybe later')}
          </Button>
        </div>
      </div>
    </AlertBanner>
  );
}

function DashboardMoreMenu({
  onExport,
  onImport,
  onKiosk,
}: {
  onExport: () => void;
  onImport: () => void;
  onKiosk: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <>
      <IconButton ref={triggerRef} icon={<Icon icon={MoreHorizontal} />} label={t('dashboard.more', 'More')} onClick={() => setOpen((value) => !value)} aria-label={t('dashboard.moreActions', 'More dashboard actions')} aria-expanded={open} aria-haspopup="dialog" />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="end"
        ariaLabel={t('dashboard.moreActions', 'More dashboard actions')}
        className="w-64 p-2"
      >
        <div className="px-2 pb-2 pt-1">
          <Heading level="panel">{t('dashboard.dashboardTools', 'Dashboard tools')}</Heading>
          <Caption className="mt-0.5 block">
            {t('dashboard.dashboardToolsHelp', 'Manage, present, or share this layout.')}
          </Caption>
        </div>
        <div className="space-y-1 border-t border-[var(--border-subtle)] pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => run(onExport)}
            wrapLabel
            className={cn(ACTION_TARGET, 'w-full justify-start')}
          >
            <Icon icon={Download} className={typography.color.muted} />
            {t('dashboard.export', 'Export dashboard')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => run(onImport)}
            wrapLabel
            className={cn(ACTION_TARGET, 'w-full justify-start')}
          >
            <Icon icon={Upload} className={typography.color.muted} />
            {t('dashboard.import', 'Import dashboard')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => run(onKiosk)}
            wrapLabel
            className={cn(ACTION_TARGET, 'w-full justify-start')}
          >
            <Icon icon={Tv} className={typography.color.muted} />
            {t('dashboard.kiosk', "Kiosk")}
          </Button>
          <PrintButton
            label={t('dashboard.printSnapshot', 'Print snapshot')}
            beforePrint={() => setOpen(false)}
            className={cn(ACTION_TARGET, 'h-auto w-full justify-start whitespace-normal break-words py-2')}
          />
        </div>
      </Popover>
    </>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  usePageTitle(t("dashboard.title", 'Fleet operations'));
  const queryClient = useQueryClient();

  /* ——— Dashboard layout state ——— */
  const {
    dashboards, activeDashboard, activeId,
    editMode, setEditMode,
    addWidgets, addWidgetAndArrange, addWidgetAt, removeWidget, updateWidgetConfig,
    updateLayouts, autoArrange, getWidgetSize,
    switchDashboard, createDashboard, createDashboardFromWidgets, renameDashboard, deleteDashboard,
    duplicateDashboard, reorderDashboards, updateDashboardSettings, updateDashboardIcon,
    applyRolePreset, resetToDefault, exportDashboard, importDashboardFromData,
    canUndo, canRedo, undoCount, undo, redo,
    dirty, pinToVehicle,
  } = useDashboardLayout();

  /* ——— HELP-11: adopt a curated role preset the user explicitly requested ———
   *
   * The picker lives on /help, which is a different route, so the request is
   * normally queued while this page is unmounted. Two triggers cover both
   * orderings without either duplicating a dashboard:
   *
   *   • mount — the user picked a role on /help and then navigated here;
   *   • event — the user has both surfaces open, or picks while this page is
   *     already mounted.
   *
   * The request is a ONE-SHOT record, consumed exactly once. It is emphatically
   * NOT "preference !== applied": applied state is derived from the live widget
   * set, so that comparison stayed true forever once a user customised
   * anything, and every remount silently re-applied the preset — restoring
   * deleted widgets, reversing undo, and overwriting whichever dashboard the
   * user had switched to. Navigating to a page must never mutate a layout.
   *
   * Re-applying after customising is available, but only as an explicit action
   * on the Help panel, which queues a fresh request. */
  const applyRolePresetRef = useRef(applyRolePreset);
  applyRolePresetRef.current = applyRolePreset;

  useEffect(() => {
    const adoptPending = () => {
      // Consume first: a request that is taken and then fails to apply is
      // dropped, which is strictly safer than one that survives to re-apply on
      // every future mount.
      const request = consumePendingDashboardPreset();
      if (!request) return;
      applyRolePresetRef.current(request.role);
    };

    adoptPending();
    window.addEventListener(DASHBOARD_PRESET_REQUESTED_EVENT, adoptPending);
    return () => window.removeEventListener(DASHBOARD_PRESET_REQUESTED_EVENT, adoptPending);
  }, []);
  const [showPicker, setShowPicker] = useState(false);
  const draggedWidgetIdRef = useRef<string | null>(null);
  const getDraggedWidgetId = useCallback(() => draggedWidgetIdRef.current, []);
  const [arrangeDropActive, setArrangeDropActive] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [initialTemplateId, setInitialTemplateId] = useState<string | undefined>();
  const openTemplates = (id?: string) => {
    setInitialTemplateId(id);
    setShowTemplates(true);
  };
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState<string | null>(null);
  // Deep-link affordance: /?kiosk=settings (linked from Appearance settings;
  // the dashboard is the index route) opens kiosk settings on load. Read
  // from window.location directly so no router context is required.
  const [showKioskSettings, setShowKioskSettings] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('kiosk') === 'settings',
  );
  const [showDashSettings, setShowDashSettings] = useState<string | null>(null);
  useLayoutKeyboard({
    editMode, setEditMode, canUndo, canRedo, onUndo: undo, onRedo: redo,
    dashboards, switchDashboard,
  });
  const [settingsWidgetId, setSettingsWidgetId] = useState<string | null>(null);

  /* ——— Widget-add discovery ——— */
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
  const handlePickerAdd = (widgetIds: string[]) => {
    addWidgets(widgetIds);
    markCustomizeDashboardCompleted();
    // Also drop the soft hint immediately so it doesn't re-appear once the
    // 5s timer wins after the user already engaged.
    dismissHint();
  };

  const handleArrangeDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setArrangeDropActive(false);
    const widgetId = event.dataTransfer.getData(WIDGET_DND_MIME);
    if (!widgetId || !getWidgetDef(widgetId) || activeDashboard.widgets.some((widget) => widget.widgetId === widgetId)) return;
    addWidgetAndArrange(widgetId);
    markCustomizeDashboardCompleted();
    dismissHint();
  };

  const handleDropWidget = (
    widgetId: string,
    placement: DropPlacement,
    bp: GridBreakpoint,
  ) => {
    addWidgetAt(widgetId, placement, bp);
    markCustomizeDashboardCompleted();
    dismissHint();
  };

  /* ——— Kiosk mode ——— */
  const {
    config: kioskConfig, updateConfig: updateKioskConfig,
    isKiosk, enterKiosk,
  } = useKioskMode(dashboards, activeId, switchDashboard);

  /* ——— Auth status ——— */
  const { data: auth, isLoading: authLoading } = useAuthStatus();
  const syncVehicles = useSyncVehicles();

  /* ——— SSE real-time connection ——— */
  // Keep the SSE pipe wired up for cross-tab cache invalidation; live-pipe
  // health is rendered by the global status line.
  useRealtimeEvents({
    onVehicleUpdate: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
    onFallbackToPolling: () => queryClient.invalidateQueries(),
  });

  /* ——— Core data queries (shared TanStack hooks) ——— */
  const vehiclesQuery = useVehicles();
  const { data: vehicles, isLoading: vehiclesLoading } = vehiclesQuery;
  const vehiclesState = useDataState(vehiclesQuery);
  const {
    vehicleId: selectedVehicleId,
  } = useSelectedVehicle();

  /* ——— Derived values ——— */
  const vehicleList = vehicles ?? [];
  const dashboardVehicleId =
    activeDashboard.settings?.vehicleId ?? selectedVehicleId ?? undefined;

  /* ——— Refresh logic ——— */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60_000); return () => clearInterval(id); }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['vehicle-state'] }),
      queryClient.invalidateQueries({ queryKey: [FLEET_STATES_QUERY_ROOT] }),
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

  /* ——— Reset-to-default ——— */
  // Both reset paths (the header button and the command-palette event) route
  // through the same danger confirm as LayoutSwitcher's own reset flow.
  const { confirm, dialogProps: resetDialogProps } = useConfirm();
  const handleResetRequest = useCallback(async () => {
    const ok = await confirm({
      title: t('layout.resetTitle', 'Reset dashboard to default?'),
      message: t(
        'layout.resetMessage',
        'This removes all customizations and restores the shipped default dashboard. Your other saved layouts are not affected.',
      ),
      variant: 'danger',
      confirmLabel: t('layout.resetConfirm', 'Reset'),
    });
    if (ok) resetToDefault();
  }, [confirm, resetToDefault, t]);

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
    const onReset = () => void handleResetRequest();
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
  }, [editMode, setEditMode, handleResetRequest]);

  /* ——— Template gallery handler ——— */
  const handleApplyTemplate = (presetId: string, name: string, widgetIds?: string[]) => {
    if (presetId === '__helix__' && widgetIds) {
      createDashboardFromWidgets(name, widgetIds);
    } else if (presetId === '__blank__') {
      createDashboard(name);
    } else {
      const preset = DASHBOARD_PRESETS.find((candidate) => candidate.id === presetId);
      if (!preset) return;
      createDashboard(name, preset);
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
    <div data-print-hide className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      {editMode ? (
        <>
          <div className="flex items-center gap-1 me-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              aria-label={t('dashboard.undo', 'Undo')}
              className={cn(ACTION_TARGET, typography.color.secondary)}
            >
              <Icon icon={Undo2} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={redo}
              disabled={!canRedo}
              aria-label={t('dashboard.redo', 'Redo')}
              className={cn(ACTION_TARGET, typography.color.secondary)}
            >
              <Icon icon={Redo2} />
            </Button>
            {canUndo && (
              <Caption className="tabular-nums" aria-hidden="true">
                {undoCount}
              </Caption>
            )}
          </div>
          <Button variant="ghost" size="sm" className={ACTION_TARGET} onClick={() => setShowPicker(true)}
            aria-label={t('dashboard.addWidget', 'Add widget')}>
            <Icon icon={Plus} size="sm" className="sm:me-1" />
            <span className="hidden sm:inline">{t('dashboard.addWidget', 'Add widget')}</span>
          </Button>
          <IconButton icon={<Icon icon={LayoutGrid} size="sm" className="sm:" />} label={t('dashboard.autoArrange', 'Auto arrange')} onClick={autoArrange} aria-label={t('dashboard.autoArrange', 'Auto arrange')} />
          {/* confirm-step: handleResetRequest asks before resetting the layout */}
          <IconButton icon={<Icon icon={RotateCcw} size="sm" className="sm:" />} label={t('dashboard.reset', 'Reset')} onClick={() => void handleResetRequest()} />
        </>
      ) : (
        <>
          <IconButton icon={<Icon icon={RefreshCw} />} label={t('dashboard.refreshShort', 'Refresh')} onClick={handleRefresh} busy={isRefreshing} aria-label={t('dashboard.refresh', 'Refresh data')} />
        </>
      )}
    </div>
  );

  return (
    <PageLayout
      actionLayout="scope-first"
      title={t("dashboard.title", 'Fleet operations')}
      subtitle={t(
        "dashboard.subtitle",
        'Monitor readiness, investigate exceptions, and act from one workspace',
      )}
      contextActions={dashboards.length > 0 && vehicleList.length > 0 && !vehiclesLoading ? (
        <section aria-label={t('dashboard.layoutsRegion', 'Dashboard layouts')} className="min-w-0">
          <LayoutSwitcher
            dashboards={dashboards}
            activeId={activeId}
            dirty={dirty}
            editMode={editMode}
            onSwitch={switchDashboard}
            onCreate={(name) => createDashboard(name)}
            onDuplicate={duplicateDashboard}
            onReset={resetToDefault}
            onPinToVehicle={pinToVehicle}
            onToggleEdit={() => setEditMode((value) => !value)}
            onRename={renameDashboard}
            onDelete={deleteDashboard}
            onReorder={reorderDashboards}
            onOpenTemplates={openTemplates}
            onOpenSettings={(id) => setShowDashSettings(id)}
          />
        </section>
      ) : undefined}
      secondaryActions={headerActions}
      primaryAction={editMode ? (
        <Button size="sm" wrapLabel className={ACTION_TARGET} onClick={() => setEditMode(false)}>
          {t('dashboard.done', 'Done')}
        </Button>
      ) : vehicleList.length > 0 ? (
        <IconButton icon={<Icon icon={Settings} />} label={t('dashboard.customize', 'Customize')} variant="primary" onClick={() => setEditMode(true)} data-tour="edit-mode-btn" />
      ) : undefined}
      overflowActions={!editMode && vehicleList.length > 0 ? (
        <DashboardMoreMenu
          onExport={() => setShowExportModal(true)}
          onImport={() => {
            setImportJson(null);
            setShowImportModal(true);
          }}
          onKiosk={() => setShowKioskSettings(true)}
        />
      ) : undefined}
      query={vehiclesQuery}
      error={!authLoading && auth?.authenticated !== false ? vehiclesState.fatalError : null}
    >
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1 space-y-6">
        <StaleRefreshWarning
          state={vehiclesState}
          label={t('dataSources.labels.vehicleRegistry', 'Vehicle registry')}
        />
        {/* Transient banner cluster — first-run theme prompt, live-pipe
            stale warning, customize hint, load error, and Tesla auth
            warning. Each child self-hides when its condition is inactive. */}
        {vehicleList.length > 0 && (
          <div className="space-y-3">
            <ThemeFirstRunBanner />
            <LiveStaleDataBanner />

          {/* Soft hint that the dashboard is customizable. Shows after
              CUSTOMIZE_HINT_DELAY_MS for users still on the seeded default
              layout, and disappears the moment they add a widget or dismiss. */}
            {hintReady && !editMode && (
              <AlertBanner
                variant="info"
                icon={<Icon icon={Plus} />}
                onClose={dismissHint}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <span className="min-w-0 sm:flex-1">
                    {t(
                      'dashboard.customizeHint',
                      "You can customize this dashboard. Tap the + to add widgets.",
                    )}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    wrapLabel
                    className={ACTION_TARGET}
                    onClick={() => {
                      setShowPicker(true);
                      dismissHint();
                    }}
                  >
                    {t('dashboard.customizeHintCta', 'Add widgets')}
                  </Button>
                </div>
              </AlertBanner>
            )}

            {auth && !auth.authenticated && (
              <AlertBanner
                variant="warning"
                icon={<Icon icon={AlertCircle} size="lg" />}
                title={t('auth.notConnected', 'Tesla account not connected')}
              >
                {t('auth.connectPrompt', "Connect your account in")}{' '}
                <Link to="/settings" className={cn(typography.weight.medium, typography.color.primary, 'underline underline-offset-2')}>
                  {t('auth.settings', 'Settings')}
                </Link>{' '}
                {t('auth.toResume', 'to resume live updates.')}
              </AlertBanner>
            )}
          </div>
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
              {(editMode || showPicker) && (
                <div
                  data-testid="dashboard-arrange-drop"
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(WIDGET_DND_MIME)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                    setArrangeDropActive(true);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setArrangeDropActive(false);
                  }}
                  onDrop={handleArrangeDrop}
                  className={cn(
                    'rounded-xl border border-dashed px-4 py-3 text-center transition-colors',
                    arrangeDropActive
                      ? 'border-[var(--theme-primary)] bg-[var(--control-bg-hover)]'
                      : 'border-[var(--border-subtle)] bg-[var(--control-bg)]',
                  )}
                >
                  <Text as="p" size="sm" color="secondary">
                    {arrangeDropActive
                      ? t('dashboard.arrangeDropActive', 'Release to add and auto-arrange this widget.')
                      : t('dashboard.arrangeDropHint', 'Drag a widget here to add and auto-arrange, or drop it on the grid to choose its position.')}
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
                  onDropWidget={handleDropWidget}
                  getDraggedWidgetId={getDraggedWidgetId}
                  onAddWidgets={() => setShowPicker(true)}
                  onBrowseTemplates={() => openTemplates()}
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
      <WidgetPicker
        open={showPicker}
        onClose={() => { setShowPicker(false); setArrangeDropActive(false); }}
        onAddWidgets={handlePickerAdd}
        activeWidgetIds={activeDashboard.widgets.map((w) => w.widgetId)}
        onDragWidgetStart={(widgetId) => { draggedWidgetIdRef.current = widgetId; }}
        onDragWidgetEnd={() => { draggedWidgetIdRef.current = null; setArrangeDropActive(false); }}
      />
      </div>

      {/* Template Gallery Modal */}
      <TemplateGallery
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onApply={handleApplyTemplate}
        initialTemplateId={initialTemplateId}
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

      {/* Kiosk Mode — portaled to document.body to escape all app chrome */}
      {isKiosk && createPortal(
        <div
          // Not a <Modal>: kiosk root is a full-screen mounting point for the
          // dashboard grid in kiosk mode, not a dialog. It hosts the live
          // dashboard, not user-dismissable content. New interactive dialogs
          // MUST use <Modal>.
          className="kiosk-root kiosk-surface fixed inset-0 z-dashboard-kiosk"
          style={kioskBackgroundStyle(kioskConfig.backgroundOpacity ?? 1)}
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
        </div>,
        document.body,
      )}
      {resetDialogProps && <ConfirmDialog {...resetDialogProps} />}
    </PageLayout>
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
    {
      icon: Activity,
      label: t('onboarding.tracking', "Real-time Tracking"),
      description: t('onboarding.trackingHelp', 'See current vehicle state and data freshness.'),
    },
    {
      icon: Route,
      label: t('onboarding.drives', "Drive history"),
      description: t('onboarding.drivesHelp', 'Review routes, efficiency, and driving patterns.'),
    },
    {
      icon: BatteryCharging,
      label: t('onboarding.charging', "Charge analytics"),
      description: t('onboarding.chargingHelp', 'Understand charging cost and battery health.'),
    },
    {
      icon: Shield,
      label: t('onboarding.control', "Vehicle control"),
      description: t('onboarding.controlHelp', 'Manage alerts, automations, and vehicle actions.'),
    },
  ];
  const setupSteps = [
    {
      label: t('onboarding.stepAccount', 'Connect Tesla account'),
      detail: t('onboarding.stepAccountHelp', 'Authorize TeslaSync through the account settings.'),
      complete: authenticated,
    },
    {
      label: t('onboarding.stepVehicles', 'Sync vehicle inventory'),
      detail: t('onboarding.stepVehiclesHelp', 'Import the vehicles available to your account.'),
      complete: false,
    },
    {
      label: t('onboarding.stepWorkspace', 'Activate your workspace'),
      detail: t('onboarding.stepWorkspaceHelp', 'Live dashboards populate as telemetry arrives.'),
      complete: false,
    },
  ];
  const connectLinkClasses = cn(
    BUTTON_BASE,
    BUTTON_VARIANTS.primary,
    typography.size.sm,
    'min-h-11 min-w-11 max-w-full break-words px-4 py-2 md:min-h-10',
  );

  return (
    <GlassPanel padding="none" className="overflow-hidden">
      <div className="grid xl:grid-cols-dashboard-onboarding">
        <div className="p-6 sm:p-8 xl:p-10">
          <Badge variant={authenticated ? 'success' : 'info'} size="lg" dot>
            {authenticated
              ? t('onboarding.accountConnected', 'Account connected')
              : t('onboarding.setupRequired', 'Workspace setup')}
          </Badge>
          <div className="mt-6 max-w-2xl">
            <Heading level="section">
              {authenticated
                ? t('onboarding.syncTitle', "Sync your vehicles")
                : t('onboarding.title', "Welcome to TeslaSync")}
            </Heading>
            <Text as="p" variant="bodySm" className="mt-3 max-w-xl leading-relaxed">
              {authenticated
                ? t('onboarding.syncDesc', "Your Tesla account is connected. Sync your vehicles to start tracking.")
                : t('onboarding.desc', "The next-generation Tesla fleet intelligence platform. Connect your Tesla account to start real-time monitoring, analytics, and vehicle control.")}
            </Text>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {authenticated ? (
              <Button
                onClick={onSync}
                loading={isSyncing}
                wrapLabel
                className="min-h-11 min-w-11 md:min-h-10"
                icon={<Icon icon={RefreshCw} />}
              >
                {t('onboarding.sync', 'Sync vehicles')}
              </Button>
            ) : (
              <Link to="/settings" className={connectLinkClasses}>
                {t('onboarding.connect', 'Connect Tesla account')}
                <Icon icon={ArrowUpRight} />
              </Link>
            )}
            <Link
              to="/explore"
              className={cn(
                BUTTON_BASE,
                BUTTON_VARIANTS.ghost,
                typography.size.sm,
                'min-h-11 min-w-11 max-w-full break-words px-4 py-2 md:min-h-10',
              )}
            >
              {t('onboarding.explore', 'Explore capabilities')}
            </Link>
          </div>
          <div className="mt-8 flex items-start gap-3 rounded-shape-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
            <Icon icon={ShieldCheck} size="lg" className={cn('mt-0.5', typography.color.secondary)} />
            <div>
              <Text as="p" weight="medium">
                {t('onboarding.privateTitle', 'Private by design')}
              </Text>
              <Text as="p" variant="caption" className="mt-1 leading-relaxed">
                {t('onboarding.privateHelp', 'Your fleet data stays in the infrastructure you control.')}
              </Text>
            </div>
          </div>
        </div>

        <aside className="border-t border-[var(--border-default)] bg-[var(--surface-2)] p-6 sm:p-8 xl:border-s xl:border-t-0">
          <Caption className={typography.weight.medium}>
            {t('onboarding.progress.label', 'Setup progress')}
          </Caption>
          <ol className="mt-5 space-y-5">
            {setupSteps.map((step, index) => {
              const active = !step.complete && setupSteps.slice(0, index).every((item) => item.complete);
              return (
                <li key={step.label} className="flex gap-3">
                  <Text as="span"
                    size="sm"
                    weight="medium"
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border',
                      step.complete
                        ? cn(neonColorMap.green.border, neonColorMap.green.bg, neonColorMap.green.text)
                        : active
                          ? cn(neonColorMap.cyan.border, neonColorMap.cyan.bg, neonColorMap.cyan.text)
                          : 'border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-muted)]',
                    )}
                    aria-hidden="true"
                  >
                    {step.complete ? <Icon icon={Check} /> : index + 1}
                  </Text>
                  <div className="min-w-0 pt-0.5">
                    <Text as="p" weight="medium" color={active || step.complete ? 'primary' : 'secondary'}>
                      {step.label}
                    </Text>
                    <Text as="p" variant="caption" className="mt-1 leading-relaxed">
                      {step.detail}
                    </Text>
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      <div className="border-t border-[var(--border-default)] bg-[var(--surface-1)] px-6 py-5 sm:px-8">
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {features.map((f) => (
            <li key={f.label} className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)]">
                <Icon icon={f.icon} size="lg" className={typography.color.secondary} />
              </div>
              <div className="min-w-0">
                <Text as="p" weight="medium">{f.label}</Text>
                <Text as="p" variant="caption" className="mt-1 leading-relaxed">{f.description}</Text>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  );
}

/* ——— Loading Skeleton — mirrors the switcher strip + widget bento ——— */
function LoadingSkeleton() {
  const { t } = useTranslation('dashboard');
  const loadingLabel = t('dashboard.loading', 'Loading command center');

  return (
    <div
      className="space-y-5"
      role="status"
      aria-label={loadingLabel}
      data-testid="dashboard-loading-skeleton"
    >
      <VisuallyHidden>{loadingLabel}</VisuallyHidden>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-10 w-full rounded-shape-lg sm:w-72" />
        <Skeleton className="h-10 w-40 rounded-shape-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 rounded-panel" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Skeleton className="h-64 rounded-panel xl:col-span-8" />
        <Skeleton className="h-64 rounded-panel xl:col-span-4" />
        <Skeleton className="h-52 rounded-panel xl:col-span-4" />
        <Skeleton className="h-52 rounded-panel xl:col-span-4" />
        <Skeleton className="h-52 rounded-panel xl:col-span-4" />
      </div>
    </div>
  );
}
