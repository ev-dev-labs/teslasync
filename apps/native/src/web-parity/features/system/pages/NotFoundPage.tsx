// Native parity port of web/src/features/system/pages/NotFoundPage.tsx.
//
// Catch-all 404 page. The web source is wired to two `<Route path="*">` entries
// in App.tsx so any unmatched URL renders this component. Its behaviour is
// ported one-for-one:
//   - Logs the unmatched path via console.warn (helps spot 404 storms in dev) —
//     preserved verbatim (web L31-33); console.warn exists in React Native.
//   - Suggests the closest matching routes via Levenshtein distance
//     (closestRoutes over ROUTE_REGISTRY, limit 5) — web L35-38.
//   - Offers escape hatches: back, dashboard, command palette — web L84-106.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-router-dom useLocation (web L2, L26) -> an optional `pathname` /
//     `search` prop pair resolved against feature-detected window.location
//     (present on react-native-web, '/' fallback on bare native). There is no
//     in-app router on the native web-parity surface.
//   - react-router-dom useNavigate + Link (web L2, L69-77, L94) -> the optional
//     onNavigate(path) prop fired from link-styled / button Pressables (the
//     CommandsPage / RecentActivity precedent). The route targets ('/' and each
//     suggestion path) are preserved on the prop.
//   - react-i18next useTranslation (web L3, L25) -> inlined useNativeTranslation()
//     supporting both the t(key, fallback) and the i18next t(key, {defaultValue,
//     ...interpolation}) overloads used here, reproducing `{{path}}`
//     interpolation; every English fallback string is preserved (intent kept).
//   - lucide-react Compass/ArrowLeft/Home/Search (web L4) -> SemanticIcon glyphs
//     navigation (a compass is a navigation instrument) / back / home / search,
//     all rendered decorative to match the web aria-hidden icons.
//   - @/components/layout PageContainer (web L6) -> inline native PageContainer
//     (scrolling page + title header), used with the title-only subset the
//     source passes.
//   - @/components/ui Button (web L7) -> inline native ActionButton mirroring the
//     web Button variant ('primary' | 'ghost') + leading icon + label API
//     (the shared AppButton has no icon slot).
//   - @/components/ui GlassPanel (web L7) -> the shared native GlassPanel.
//   - @/hooks/usePageTitle (web L8) -> native-safe usePageTitle (feature-detects
//     document.title; writes "{title} — TeslaSync"; restores on unmount).
//   - @/lib/routeRegistry ROUTE_REGISTRY (web L9) and @/lib/closestRoute
//     closestRoutes (web L10) -> inlined verbatim below. Both are pure,
//     DOM-free TypeScript (a data table + a Levenshtein ranker); their own
//     native parity modules port on their own conversion turns, so per the
//     CommandsPage inline-dependency precedent they are inlined here to keep the
//     page self-contained and behaviour-identical.
//   - window.history.back() (web L87) -> the optional onGoBack prop, else
//     feature-detected history.back() (works on react-native-web, no-op on
//     bare native).
//   - window.dispatchEvent(new Event('toggle-command-palette')) (web L40-42) ->
//     the optional onOpenCommandPalette prop, else a feature-detected
//     dispatchEvent of the same 'toggle-command-palette' event (event name
//     preserved; no-op on bare native).
//
// No DOM-only modules, HTML elements, react-router-dom, react-i18next,
// lucide-react, Recharts, or Leaflet are imported — only react-native
// primitives and the shared native SemanticIcon / AppText / GlassPanel + theme
// tokens.

import {useCallback, useEffect, useMemo, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

// ─── inline route registry (web @/lib/routeRegistry ROUTE_REGISTRY) ──────────
// Single source of truth for known frontend routes. Ported verbatim; a pure
// data table with no DOM dependency.
interface RouteEntry {
  /** URL pathname starting with '/'. May contain :params. */
  path: string;
  /** SafeRoute name attribute from App.tsx (stable id). */
  name: string;
  /** Stable English label (also used as i18n fallback). */
  label: string;
  /** i18n key for the human-readable label. */
  i18nKey: string;
  /** Hidden from suggestion/palette UIs (parameterized or internal). */
  hidden?: boolean;
}

const ROUTE_REGISTRY: readonly RouteEntry[] = [
  {path: '/', name: 'Dashboard', label: 'Dashboard', i18nKey: 'routes.dashboard'},
  {path: '/admin/feedback', name: 'FeedbackQueue', label: 'Feedback Queue', i18nKey: 'routes.feedbackQueue'},
  {path: '/admin/telemetry/coverage', name: 'FleetTelemetryCoverage', label: 'Fleet Telemetry Coverage', i18nKey: 'routes.fleetTelemetryCoverage'},
  {path: '/alert-rules', name: 'LegacyAlertRulesRedirect', label: 'Legacy Alert Rules Redirect', i18nKey: 'routes.legacyAlertRulesRedirect'},
  {path: '/alert-studio', name: 'LegacyAlertStudioRedirect', label: 'Legacy Alert Studio Redirect', i18nKey: 'routes.legacyAlertStudioRedirect'},
  {path: '/alerts', name: 'LegacyAlertsRedirect', label: 'Legacy Alerts Redirect', i18nKey: 'routes.legacyAlertsRedirect'},
  {path: '/analytics', name: 'Analytics', label: 'Analytics', i18nKey: 'routes.analytics'},
  {path: '/anomaly-detection', name: 'AnomalyDashboard', label: 'Anomaly Dashboard', i18nKey: 'routes.anomalyDashboard'},
  {path: '/api-keys', name: 'APIKeys', label: 'API Keys', i18nKey: 'routes.aPIKeys'},
  {path: '/api-logs', name: 'ApiLogs', label: 'Api Logs', i18nKey: 'routes.apiLogs'},
  {path: '/api-playground', name: 'ApiPlayground', label: 'Api Playground', i18nKey: 'routes.apiPlayground'},
  {path: '/automations', name: 'Automations', label: 'Automations', i18nKey: 'routes.automations'},
  {path: '/automations/:id/edit', name: 'AutomationBuilder', label: 'Automation Builder', i18nKey: 'routes.automationBuilder', hidden: true},
  {path: '/automations/list', name: 'AutomationList', label: 'Automation List', i18nKey: 'routes.automationList'},
  {path: '/automations/new', name: 'AutomationBuilder', label: 'Automation Builder', i18nKey: 'routes.automationBuilder'},
  {path: '/backup', name: 'BackupRestore', label: 'Backup Restore', i18nKey: 'routes.backupRestore'},
  {path: '/battery', name: 'BatteryHealth', label: 'Battery Health', i18nKey: 'routes.batteryHealth'},
  {path: '/battery-cells', name: 'BatteryCells', label: 'Battery Cells', i18nKey: 'routes.batteryCells'},
  {path: '/battery-degradation', name: 'BatteryDegradation', label: 'Battery Degradation', i18nKey: 'routes.batteryDegradation'},
  {path: '/charging', name: 'Charging', label: 'Charging', i18nKey: 'routes.charging'},
  {path: '/charging-curve', name: 'ChargingCurve', label: 'Charging Curve', i18nKey: 'routes.chargingCurve'},
  {path: '/charging-heatmap', name: 'ChargingHeatmap', label: 'Charging Heatmap', i18nKey: 'routes.chargingHeatmap'},
  {path: '/charging/:id', name: 'ChargeDetail', label: 'Charge Detail', i18nKey: 'routes.chargeDetail', hidden: true},
  {path: '/chatbot', name: 'Chatbot', label: 'Chatbot', i18nKey: 'routes.chatbot'},
  {path: '/climate-control', name: 'ClimateControl', label: 'Climate Control', i18nKey: 'routes.climateControl'},
  {path: '/command-history', name: 'CommandHistory', label: 'Command History', i18nKey: 'routes.commandHistory'},
  {path: '/commands', name: 'Commands', label: 'Commands', i18nKey: 'routes.commands'},
  {path: '/cost-analysis', name: 'CostAnalysis', label: 'Cost Analysis', i18nKey: 'routes.costAnalysis'},
  {path: '/data-export', name: 'DataExport', label: 'Data Export', i18nKey: 'routes.dataExport'},
  {path: '/data-repair', name: 'DataRepair', label: 'Data Repair', i18nKey: 'routes.dataRepair'},
  {path: '/db-health', name: 'DBHealthDashboard', label: 'DB Health Dashboard', i18nKey: 'routes.dBHealthDashboard'},
  {path: '/dev-tools', name: 'DevTools', label: 'Dev Tools', i18nKey: 'routes.devTools'},
  {path: '/digital-twin', name: 'DigitalTwin', label: 'Digital Twin', i18nKey: 'routes.digitalTwin'},
  {path: '/drive-score', name: 'DriveScore', label: 'Drive Score', i18nKey: 'routes.driveScore'},
  {path: '/drives', name: 'Drives', label: 'Drives', i18nKey: 'routes.drives'},
  {path: '/drives/:id', name: 'DriveDetail', label: 'Drive Detail', i18nKey: 'routes.driveDetail', hidden: true},
  {path: '/drives/:id/replay', name: 'TripReplay', label: 'Trip Replay', i18nKey: 'routes.tripReplay', hidden: true},
  {path: '/drivetrain-health', name: 'DrivetrainHealth', label: 'Drivetrain Health', i18nKey: 'routes.drivetrainHealth'},
  {path: '/driving-dynamics', name: 'DrivingDynamics', label: 'Driving Dynamics', i18nKey: 'routes.drivingDynamics'},
  {path: '/efficiency', name: 'Efficiency', label: 'Efficiency', i18nKey: 'routes.efficiency'},
  {path: '/energy', name: 'Energy', label: 'Energy', i18nKey: 'routes.energy'},
  {path: '/energy-flow', name: 'EnergyFlow', label: 'Energy Flow', i18nKey: 'routes.energyFlow'},
  {path: '/energy-products', name: 'EnergyProducts', label: 'Energy Products', i18nKey: 'routes.energyProducts'},
  {path: '/exports', name: 'Exports', label: 'Exports', i18nKey: 'routes.exports'},
  {path: '/fleet-api', name: 'FleetAPI', label: 'Fleet API', i18nKey: 'routes.fleetAPI'},
  {path: '/geofences', name: 'Geofences', label: 'Geofences', i18nKey: 'routes.geofences'},
  {path: '/glance', name: 'Glance', label: 'Glance', i18nKey: 'routes.glance'},
  {path: '/guard-mode', name: 'GuardMode', label: 'Guard Mode', i18nKey: 'routes.guardMode'},
  {path: '/lifetime-stats', name: 'LifetimeStats', label: 'Lifetime Stats', i18nKey: 'routes.lifetimeStats'},
  {path: '/live', name: 'LiveMap', label: 'Live Map', i18nKey: 'routes.liveMap'},
  {path: '/live-monitor', name: 'LiveSignalMonitor', label: 'Live Signal Monitor', i18nKey: 'routes.liveSignalMonitor'},
  {path: '/locations', name: 'Locations', label: 'Locations', i18nKey: 'routes.locations'},
  {path: '/maintenance', name: 'Maintenance', label: 'Maintenance', i18nKey: 'routes.maintenance'},
  {path: '/me/activity', name: 'MyActivity', label: 'My Activity', i18nKey: 'routes.myActivity'},
  {path: '/media-player', name: 'MediaPlayer', label: 'Media Player', i18nKey: 'routes.mediaPlayer'},
  {path: '/mileage', name: 'Mileage', label: 'Mileage', i18nKey: 'routes.mileage'},
  {path: '/mqtt-inspector', name: 'MQTTInspector', label: 'MQTT Inspector', i18nKey: 'routes.mQTTInspector'},
  {path: '/navigation', name: 'NavigationRoute', label: 'Navigation Route', i18nKey: 'routes.navigationRoute'},
  {path: '/notifications', name: 'LegacyNotificationsRedirect', label: 'Legacy Notifications Redirect', i18nKey: 'routes.legacyNotificationsRedirect'},
  {path: '/notifications/alerts', name: 'NotificationsAlerts', label: 'Notifications Alerts', i18nKey: 'routes.notificationsAlerts'},
  {path: '/notifications/archived', name: 'NotificationsArchived', label: 'Notifications Archived', i18nKey: 'routes.notificationsArchived'},
  {path: '/notifications/audit', name: 'NotificationsAudit', label: 'Audit Log', i18nKey: 'routes.notificationsAudit'},
  {path: '/notifications/browser', name: 'NotificationsBrowser', label: 'Notifications Browser', i18nKey: 'routes.notificationsBrowser'},
  {path: '/notifications/channels', name: 'NotificationsChannels', label: 'Notifications Channels', i18nKey: 'routes.notificationsChannels'},
  {path: '/notifications/inbox', name: 'NotificationsInbox', label: 'Notifications Inbox', i18nKey: 'routes.notificationsInbox'},
  {path: '/notifications/quiet-hours', name: 'NotificationsQuietHours', label: 'Notifications Quiet Hours', i18nKey: 'routes.notificationsQuietHours'},
  {path: '/notifications/rules', name: 'NotificationsRules', label: 'Notifications Rules', i18nKey: 'routes.notificationsRules'},
  {path: '/notifications/studio', name: 'NotificationsStudio', label: 'Notifications Studio', i18nKey: 'routes.notificationsStudio'},
  {path: '/notifications/webhooks', name: 'NotificationsWebhooks', label: 'Notifications Webhooks', i18nKey: 'routes.notificationsWebhooks'},
  {path: '/onboarding', name: 'Onboarding', label: 'Onboarding', i18nKey: 'routes.onboarding'},
  {path: '/period-compare', name: 'PeriodCompare', label: 'Period Compare', i18nKey: 'routes.periodCompare'},
  {path: '/power-flow', name: 'PowerFlowDashboard', label: 'Power Flow Dashboard', i18nKey: 'routes.powerFlowDashboard'},
  {path: '/powershare', name: 'Powershare', label: 'Powershare', i18nKey: 'routes.powershare'},
  {path: '/projected-range', name: 'ProjectedRange', label: 'Projected Range', i18nKey: 'routes.projectedRange'},
  {path: '/quick-stats', name: 'QuickStats', label: 'Quick Stats', i18nKey: 'routes.quickStats'},
  {path: '/redis-signals', name: 'RedisSignalViewer', label: 'Redis Signal Viewer', i18nKey: 'routes.redisSignalViewer'},
  {path: '/regen-efficiency', name: 'RegenEfficiency', label: 'Regen Efficiency', i18nKey: 'routes.regenEfficiency'},
  {path: '/roadmap', name: 'Roadmap', label: 'Roadmap', i18nKey: 'routes.roadmap'},
  {path: '/route-efficiency', name: 'RouteEfficiency', label: 'Route Efficiency', i18nKey: 'routes.routeEfficiency'},
  {path: '/s/:token', name: 'SharedDrive', label: 'Shared Drive', i18nKey: 'routes.sharedDrive', hidden: true},
  {path: '/safety-settings', name: 'SafetySettings', label: 'Safety Settings', i18nKey: 'routes.safetySettings'},
  {path: '/search', name: 'Search', label: 'Search', i18nKey: 'routes.search'},
  {path: '/security-access', name: 'SecurityAccess', label: 'Security Access', i18nKey: 'routes.securityAccess'},
  {path: '/settings', name: 'Settings', label: 'Settings', i18nKey: 'routes.settings'},
  {path: '/signal-diff', name: 'SignalDiff', label: 'Signal Diff', i18nKey: 'routes.signalDiff'},
  {path: '/signal-explorer', name: 'SignalExplorer', label: 'Signal Explorer', i18nKey: 'routes.signalExplorer'},
  {path: '/signal-gaps', name: 'SignalGapDetector', label: 'Signal Gap Detector', i18nKey: 'routes.signalGapDetector'},
  {path: '/signal-log', name: 'SignalLogViewer', label: 'Signal Log Viewer', i18nKey: 'routes.signalLogViewer'},
  {path: '/sleep-efficiency', name: 'SleepEfficiency', label: 'Sleep Efficiency', i18nKey: 'routes.sleepEfficiency'},
  {path: '/smart-charge', name: 'SmartCharge', label: 'Smart Charge', i18nKey: 'routes.smartCharge'},
  {path: '/software-updates', name: 'SoftwareUpdates', label: 'Software Updates', i18nKey: 'routes.softwareUpdates'},
  {path: '/speed-profile', name: 'SpeedProfile', label: 'Speed Profile', i18nKey: 'routes.speedProfile'},
  {path: '/state-debugger', name: 'StateMachineDebugger', label: 'State Machine Debugger', i18nKey: 'routes.stateMachineDebugger'},
  {path: '/statistics', name: 'Statistics', label: 'Statistics', i18nKey: 'routes.statistics'},
  {path: '/system-status', name: 'SystemStatus', label: 'System Status', i18nKey: 'routes.systemStatus'},
  {path: '/tco', name: 'TrueCostOwnership', label: 'True Cost Ownership', i18nKey: 'routes.trueCostOwnership'},
  {path: '/temperature-impact', name: 'TemperatureImpact', label: 'Temperature Impact', i18nKey: 'routes.temperatureImpact'},
  {path: '/tesla-account', name: 'TeslaAccount', label: 'Tesla Account', i18nKey: 'routes.teslaAccount'},
  {path: '/tesla-charging-history', name: 'TeslaChargingHistory', label: 'Tesla Charging History', i18nKey: 'routes.teslaChargingHistory'},
  {path: '/tesla-charging-sessions', name: 'TeslaChargingSessions', label: 'Tesla Charging Sessions', i18nKey: 'routes.teslaChargingSessions'},
  {path: '/timeline', name: 'Timeline', label: 'Timeline', i18nKey: 'routes.timeline'},
  {path: '/tire-pressure', name: 'TirePressure', label: 'Tire Pressure', i18nKey: 'routes.tirePressure'},
  {path: '/trip-planner', name: 'TripPlanner', label: 'Trip Planner', i18nKey: 'routes.tripPlanner'},
  {path: '/trips', name: 'Trips', label: 'Trips', i18nKey: 'routes.trips'},
  {path: '/trips/:id', name: 'TripDetail', label: 'Trip Detail', i18nKey: 'routes.tripDetail', hidden: true},
  {path: '/vampire-drain', name: 'VampireDrain', label: 'Vampire Drain', i18nKey: 'routes.vampireDrain'},
  {path: '/vehicle-comparison', name: 'FleetCompare', label: 'Fleet Compare', i18nKey: 'routes.fleetCompare'},
  {path: '/vehicles', name: 'Vehicles', label: 'Vehicles', i18nKey: 'routes.vehicles'},
  {path: '/vehicles/:id', name: 'VehicleDetail', label: 'Vehicle Detail', i18nKey: 'routes.vehicleDetail', hidden: true},
  {path: '/vehicles/:id/access', name: 'VehicleAccess', label: 'Vehicle Access', i18nKey: 'routes.vehicleAccess', hidden: true},
  {path: '/watch', name: 'WatchFace', label: 'Watch Face', i18nKey: 'routes.watchFace'},
  {path: '/weekly-digest', name: 'WeeklyDigest', label: 'Weekly Digest', i18nKey: 'routes.weeklyDigest'},
  {path: '/year-review/:year', name: 'YearReview', label: 'Year Review', i18nKey: 'routes.yearReview', hidden: true},
] as const;

// ─── inline suggestion engine (web @/lib/closestRoute closestRoutes) ─────────
interface RouteSuggestion extends RouteEntry {
  distance: number;
}

function closestRoutes(
  query: string,
  registry: readonly RouteEntry[],
  limit = 5,
): RouteSuggestion[] {
  const q = normalizeRoute(query);
  if (!q) {
    return [];
  }

  const scored: RouteSuggestion[] = [];
  for (const r of registry) {
    if (r.hidden) {
      continue;
    }
    const pathDist = levenshtein(q, normalizeRoute(r.path));
    const labelDist = levenshtein(q, normalizeRoute(r.label));
    const distance = Math.min(pathDist, labelDist);
    if (distance <= 6) {
      scored.push({...r, distance});
    }
  }
  scored.sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path));
  return scored.slice(0, limit);
}

function normalizeRoute(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/]+/g, '');
}

/**
 * Iterative two-row Levenshtein. O(m*n) time, O(min(m,n)) space.
 * Standard textbook implementation; no external deps.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  // Always iterate over the shorter string in the inner loop for cache locality.
  let short = a;
  let long = b;
  if (short.length > long.length) {
    short = b;
    long = a;
  }

  const m = short.length;
  const n = long.length;
  let prev: number[] = new Array(m + 1);
  let curr: number[] = new Array(m + 1);
  for (let i = 0; i <= m; i++) {
    prev[i] = i;
  }

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = short.charCodeAt(i - 1) === long.charCodeAt(j - 1) ? 0 : 1;
      curr[i] = Math.min(curr[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[m];
}

// ─── i18n shim (web react-i18next useTranslation) ───────────────────────────
type NativeTOptions = {defaultValue?: string} & Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallbackOrOptions?: string | NativeTOptions,
  options?: NativeTOptions,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (key: string, fallbackOrOptions?: string | NativeTOptions, options?: NativeTOptions) => {
      let fallback: string | undefined;
      let opts: NativeTOptions | undefined;
      if (typeof fallbackOrOptions === 'string') {
        fallback = fallbackOrOptions;
        opts = options;
      } else {
        opts = fallbackOrOptions;
        fallback = opts?.defaultValue;
      }

      const base = fallback ?? key;
      if (!opts) {
        return base;
      }
      return Object.keys(opts).reduce((text, name) => {
        if (name === 'defaultValue') {
          return text;
        }
        return text.split(`{{${name}}}`).join(String(opts![name]));
      }, base);
    },
    [],
  );
}

// ─── usePageTitle shim (web @/hooks/usePageTitle) ───────────────────────────
function usePageTitle(title: string): void {
  useEffect(() => {
    const doc = (globalThis as {document?: {title?: string}}).document;
    if (doc && typeof doc.title === 'string') {
      const prev = doc.title;
      doc.title = `${title} — TeslaSync`;
      return () => {
        doc.title = prev;
      };
    }
    return undefined;
  }, [title]);
}

// ─── location resolver (web react-router-dom useLocation) ───────────────────
function useResolvedLocation(
  pathname?: string,
  search?: string,
): {pathname: string; search: string} {
  return useMemo(() => {
    const scope = globalThis as {
      location?: {pathname?: string; search?: string};
    };
    return {
      pathname: pathname ?? scope.location?.pathname ?? '/',
      search: search ?? scope.location?.search ?? '',
    };
  }, [pathname, search]);
}

// ─── Tailwind shade absent from the native theme -> literal ─────────────────
const CYAN_300 = '#67e8f9'; // text-cyan-300

// ─── PageContainer (web @/components/layout PageContainer, title-only subset) ─
function PageContainer({children, title}: {children: ReactNode; title: string}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <AppText style={styles.pageTitle} variant="title" weight="bold">
          {title}
        </AppText>
      </View>
      {children}
    </ScrollView>
  );
}

// ─── ActionButton (web @/components/ui Button, variant + icon + label) ───────
function ActionButton({
  icon,
  label,
  onPress,
  variant,
}: {
  icon: SemanticIconName;
  label: string;
  onPress: () => void;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'ghost' ? styles.buttonGhost : styles.buttonPrimary,
        pressed && styles.buttonPressed,
      ]}>
      <SemanticIcon decorative name={icon} size="sm" />
      <AppText
        style={variant === 'ghost' ? styles.buttonGhostText : styles.buttonPrimaryText}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

interface NotFoundPageProps {
  pathname?: string;
  search?: string;
  onNavigate?: (path: string) => void;
  onGoBack?: () => void;
  onOpenCommandPalette?: () => void;
}

export default function NotFoundPage({
  pathname,
  search,
  onNavigate,
  onGoBack,
  onOpenCommandPalette,
}: NotFoundPageProps = {}) {
  const t = useNativeTranslation();
  const location = useResolvedLocation(pathname, search);

  usePageTitle(t('notFound.title', 'Page not found'));

  useEffect(() => {
    console.warn('[404]', location.pathname + location.search);
  }, [location.pathname, location.search]);

  const suggestions = useMemo(
    () => closestRoutes(location.pathname, ROUTE_REGISTRY, 5),
    [location.pathname],
  );

  const goBack = () => {
    if (onGoBack) {
      onGoBack();
      return;
    }
    const scope = globalThis as {history?: {back?: () => void}};
    if (typeof scope.history?.back === 'function') {
      scope.history.back();
    }
  };

  const openCommandPalette = () => {
    if (onOpenCommandPalette) {
      onOpenCommandPalette();
      return;
    }
    const scope = globalThis as {
      dispatchEvent?: (event: unknown) => boolean;
      Event?: new (type: string) => unknown;
    };
    if (typeof scope.dispatchEvent === 'function' && typeof scope.Event === 'function') {
      scope.dispatchEvent(new scope.Event('toggle-command-palette'));
    }
  };

  return (
    <PageContainer title={t('notFound.title', 'Page not found')}>
      <GlassPanel style={styles.panel}>
        <View style={styles.iconWrap}>
          <SemanticIcon decorative name="navigation" size="lg" />
        </View>
        <AppText
          accessibilityRole="header"
          style={styles.heading}
          variant="title"
          weight="semibold">
          {t('notFound.heading', "We couldn't find that page")}
        </AppText>
        <AppText style={styles.body} tone="secondary">
          {t('notFound.body', {
            defaultValue: "{{path}} doesn't match any route.",
            path: location.pathname,
          })}
        </AppText>

        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            <AppText style={styles.suggestionsLabel} tone="muted" variant="caption">
              {t('notFound.didYouMean', 'Did you mean:')}
            </AppText>
            <View style={styles.suggestionList}>
              {suggestions.map(s => (
                <Pressable
                  accessibilityRole="link"
                  key={s.path}
                  onPress={() => onNavigate?.(s.path)}
                  style={styles.suggestionLink}>
                  <AppText style={styles.suggestionLabel}>
                    {t(s.i18nKey, s.label)}
                  </AppText>
                  <AppText tone="muted" variant="caption">
                    {s.path}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          <ActionButton
            icon="back"
            label={t('notFound.goBack', 'Go back')}
            onPress={goBack}
            variant="ghost"
          />
          <ActionButton
            icon="home"
            label={t('notFound.goHome', 'Go to dashboard')}
            onPress={() => onNavigate?.('/')}
            variant="primary"
          />
          <ActionButton
            icon="search"
            label={t('notFound.openSearch', 'Open command palette')}
            onPress={openCommandPalette}
            variant="ghost"
          />
        </View>
      </GlassPanel>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 672,
    paddingHorizontal: 24,
    paddingVertical: 48,
    width: '100%',
  },
  iconWrap: {
    marginBottom: 16,
  },
  heading: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    marginTop: 8,
    textAlign: 'center',
  },
  suggestions: {
    alignItems: 'center',
    marginTop: 24,
  },
  suggestionsLabel: {
    marginBottom: 8,
    textAlign: 'center',
  },
  suggestionList: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  suggestionLink: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 4,
  },
  suggestionLabel: {
    color: CYAN_300,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
    marginTop: 32,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  buttonGhostText: {
    color: colors.textPrimary,
  },
});
