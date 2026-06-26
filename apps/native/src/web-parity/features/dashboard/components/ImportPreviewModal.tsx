// Native parity port of
// web/src/features/dashboard/components/ImportPreviewModal.tsx.
//
// A three-tab "Import Dashboard" modal: import a saved-dashboard JSON blob from
// a file, a pasted string, or a share URL, validate/normalise it against the
// widget registry, then preview the available/skipped widgets and a mini grid
// before confirming. Every behaviour from the web component is preserved
// one-for-one — the prop surface (open / onClose / onConfirm / initialJson, web
// L24-30), all state names (activeTab / pastedJson / importUrl / isDragOver /
// validation / parseError / didAutoValidate, web L40-48), the
// auto-validate-on-open derived-state pattern (web L48-53), every handler
// (resetState, handleClose, handleValidate, handleFileImport, handleUrlImport,
// handleConfirm, handleBackToInput, web L55-134), the three tab descriptors
// (web L136-140), the validation-vs-input render fork (web L143-159), and the
// ImportPreview sub-component (web L264-381). Each i18n key keeps its English
// default string so the translation intent survives.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation('dashboard') (web L2, L38, L273) -> inlined
//     useNativeTranslation(): a stable (key, fallback, options?) => string shim
//     reproducing i18next `{{count}}` interpolation against the English fallback
//     copy (the EditConflictBanner / PeriodComparePage precedent).
//   - lucide-react Upload / FileJson / Link2 / CheckCircle2 / XCircle /
//     AlertTriangle / FileUp (web L3-6) -> SemanticIcon glyphs
//     (upload / fileJson / link / success / error / warning / confirm), the
//     established lucide -> SemanticIcon vocabulary used across this tree.
//   - @/lib/cn (web L7) -> RN StyleSheet style arrays (the cn()/clsx ->
//     StyleSheet convention).
//   - @/components/ui Modal / Button / Tabs / Textarea / Input / Badge
//     (web L8-15) -> the React Native built-in Modal primitive (fade overlay +
//     backdrop Pressable + scrollable dialog, the SessionExpiringModal pattern)
//     plus inline native ModalButton (variant/size/icon/disabled), TabStrip
//     ({tabs, activeTab, onChange}), multiline TextInput (Textarea), single-line
//     TextInput with leading icon (Input), and a neutral Badge chip.
//   - @/components/feedback AlertBanner / EmptyState (web L16) -> inline native
//     AlertBanner (danger/warning tinted row + icon) and EmptyState (icon +
//     message), the AuditLogPage / PeriodComparePage precedent.
//   - @/components/motion FadeIn (web L17) -> Animated.View opacity 0->1 mount
//     fade (the established FadeIn port).
//   - ./MiniGridPreview (web L18) -> inline native MiniGridPreview: an
//     aspect-ratio View with absolutely-positioned percentage cells, mirroring
//     the web grid maths (GRID_COLS.lg = 4, safeMaxY guard); the per-widget
//     lucide icon becomes a small accent dot for known widgets.
//   - ../hooks/validateImport validateImportData / fromUrlSafeBase64 /
//     ImportValidation (web L19-20) -> ported byte-for-byte below; the registry
//     availability check (web validateImport L121-123) is preserved against an
//     inlined native widget-id registry (see WIDGET_NAMES). fromUrlSafeBase64 is
//     re-expressed with a Hermes-safe, bitwise-free base64 + UTF-8 decode that
//     feature-detects the global atob (present on react-native-web, Hermes, and
//     the Node test runner) and throws when unavailable so the caller's
//     try/catch surfaces import.invalidUrl.
//   - ../widgets/registry getWidgetDef (web L21) -> inline getWidgetName backed
//     by WIDGET_NAMES (the full web id -> display-name registry data, the source
//     of truth for the available/missing classification + preview labels).
//   - ../widgets/types SavedDashboard (web L22, + WidgetInstance / RGLLayout /
//     RGLLayouts the validator needs) -> ported verbatim as native types.
//
// Browser-only affordances are made explicit (contract rule 7): the web hidden
// <input type="file"> + drag-and-drop drop zone (web L88-103, L177-208) have no
// bare-native analogue. The drop zone becomes a Pressable that opens a DOM file
// picker when one is feature-detected (react-native-web) and otherwise surfaces
// an explicit import.unavailable state; the isDragOver highlight is driven by
// the zone's press-in/press-out so the web drag-over visual intent survives.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported — only react, react-native
// primitives, and the existing apps/native SemanticIcon / AppText / theme
// tokens.

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type DimensionValue,
  type ViewStyle,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors, shadows, spacing } from '../../../../theme/tokens';

/* ── i18n shim (web react-i18next useTranslation) ──────── */

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

/* ── Types (web ../widgets/types) ──────────────────────── */

interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: Record<string, unknown>;
}

/** react-grid-layout Layout item (position + size in grid units). */
interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  moved?: boolean;
}

/** react-grid-layout Layouts — keyed by breakpoint string. */
interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

export interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

export interface ImportValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  dashboard: SavedDashboard | null;
  missingWidgets: string[];
  availableWidgets: string[];
}

/* ── Widget registry data (web ../widgets/registry) ────── */

// The full web widget id -> display-name registry, ported as data. This is the
// source of truth for the available/missing classification in validateImportData
// (web validateImport L121-123) and for the preview labels (web L344). The
// per-widget lucide icons are intentionally dropped (DOM-only); known widgets
// render a generic glyph instead.
const WIDGET_NAMES: Record<string, string> = {
  'alert-feed': 'Alert Feed',
  'notification-stats': 'Notification Stats',
  'fleet-stats': 'Fleet Stats',
  'fleet-stats-bar': 'Fleet Stats Bar',
  'weekly-summary-card': 'Weekly Summary',
  'weekly-digest': 'Weekly Digest',
  'monthly-mileage': 'Monthly Mileage',
  'lifetime-stats': 'Lifetime Stats',
  'mileage-stats': 'Mileage Stats',
  'state-timeline': 'State Timeline',
  'anomaly-detector': 'Anomaly Detector',
  'fsm-distribution': 'State Distribution',
  'cost-breakdown': 'Cost Breakdown',
  'year-review': 'Year in Review',
  'analytics-summary': 'Analytics Summary',
  'recently-unlocked-achievements': 'Recently Unlocked',
  'automation-status': 'Automation Status',
  'automation-history': 'Automation History',
  'battery-gauge': 'Battery Level',
  'battery-radial-gauge': 'Battery Radial Gauge',
  'range-estimate': 'Range Estimate',
  'range-bar': 'Range Bar',
  'battery-degradation-trend': 'Battery Degradation Trend',
  'energy-flow': 'Energy Flow',
  'projected-range': 'Projected Range',
  'battery-cells': 'Battery Cells',
  'battery-degradation-forecast': 'Battery Forecast',
  'battery-health-analytics': 'Battery Analytics',
  'charge-status': 'Charge Status',
  'charge-status-live': 'Charge Status Live',
  'charge-history': 'Charge History',
  'charge-session-chart': 'Charge Session Chart',
  'charge-cost-tracker': 'Charge Cost Tracker',
  'charging-schedule': 'Charging Schedule',
  'cost-forecast': 'Cost Forecast',
  'charging-optimizer': 'Charging Optimizer',
  'wall-connector': 'Wall Connector',
  'charging-telemetry': 'Charging Telemetry',
  'supercharger-history': 'Supercharger History',
  'charge-plans': 'Charge Plans',
  'charging-session-detail': 'Charge Session Detail',
  'climate-status': 'Climate',
  'climate-control-panel': 'Climate Control Panel',
  'weather-at-car': 'Weather at Car',
  'climate-history': 'Climate History',
  'command-quick-actions': 'Quick Actions',
  'command-history': 'Command History',
  'recent-drives': 'Recent Drives',
  'drive-score': 'Driving Score',
  'recent-drives-list': 'Recent Drives List',
  'drive-score-gauge': 'Drive Score Gauge',
  'drive-efficiency-chart': 'Drive Efficiency Chart',
  'speed-heatmap': 'Speed Heatmap',
  'driving-dynamics': 'Driving Dynamics',
  'speed-profile': 'Speed Profile',
  'regen-efficiency': 'Regen Braking',
  'route-efficiency': 'Route Efficiency',
  'driving-coach': 'Driving Coach',
  'trip-summary': 'Trip Summary',
  'drive-telemetry': 'Drive Telemetry',
  'energy-flow-animated': 'Energy Flow Animated',
  'vampire-drain': 'Vampire Drain',
  'sleep-efficiency': 'Sleep Efficiency',
  'solar-production': 'Solar Production',
  'live-power-flow': 'Live Power Flow',
  'energy-site-info': 'Energy Site',
  'backup-history': 'Backup History',
  'power-flow-history': 'Power Flow History',
  'energy-stats': 'Energy Stats',
  'location-map': 'Vehicle Location Map',
  'location-favorites': 'Favorite Locations',
  'geofence-status': 'Geofence Status',
  'destination-eta': 'Destination ETA',
  'position-heatmap': 'Position Heatmap',
  'media-now-playing': 'Now Playing',
  'media-history': 'Media History',
  'security-status': 'Security',
  'door-window-status': 'Door & Window Status',
  'sentry-event-log': 'Sentry Event Log',
  'safety-features': 'Safety Features',
  'safety-history': 'Safety History',
  'guard-mode': 'Guard Mode',
  'vehicle-access': 'Vehicle Access',
  'onboarding-checklist': 'Setup Checklist',
  'uptime-monitor': 'Uptime Monitor',
  'mqtt-status': 'MQTT Status',
  'quick-nav': 'Quick Navigation',
  'api-usage': 'API Usage',
  'system-health': 'System Health',
  'telemetry-errors': 'Telemetry Errors',
  'audit-log': 'Audit Log',
  'backup-monitor': 'Backup Monitor',
  'export-status': 'Export Status',
  'version-info': 'Version Info',
  'dashboard-stats': 'Dashboard Stats',
  'live-signals': 'Live Signals',
  'live-signal-sparklines': 'Live Signal Sparklines',
  'signal-health': 'Signal Health',
  'signal-catalog': 'Signal Catalog',
  'signal-log': 'Signal Log',
  'tire-pressure-visual': 'Tire Pressure Visual',
  'tire-pressure-history': 'Tire Pressure History',
  'vehicle-hero': 'Vehicle Card',
  'vehicle-hero-card': 'Vehicle Hero Card',
  'vehicle-twin': 'Digital Twin',
  'digital-twin-mini': 'Digital Twin Mini',
  'software-update-status': 'Software Update',
  'software-update-history': 'Update History',
  'odometer-counter': 'Odometer Counter',
  'drivetrain-health': 'Drivetrain Health',
  'motor-performance': 'Motor Performance',
  'motor-history': 'Motor History',
  'vehicle-specs': 'Vehicle Specs',
  'watch-summary': 'Watch Summary',
  'maintenance-tracker': 'Maintenance',
  'warranty-status': 'Warranty Status',
  subscriptions: 'Subscriptions',
  'vehicle-upgrades': 'Upgrades & Sharing',
};

const KNOWN_WIDGET_IDS = new Set(Object.keys(WIDGET_NAMES));

function getWidgetName(widgetId: string): string | undefined {
  return WIDGET_NAMES[widgetId];
}

/* ── validateImport (web ../hooks/validateImport) ──────── */

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Check if a value is a finite positive number. */
function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/** Sanitize a single layout item to ensure valid coordinates. */
function sanitizeLayoutItem(item: RGLLayout, cols: number): RGLLayout {
  return {
    ...item,
    x: isFinitePositive(item.x) ? clamp(item.x, 0, cols - 1) : 0,
    y: isFinitePositive(item.y) ? item.y : 0,
    w: isFinitePositive(item.w) ? clamp(item.w, 1, cols) : 1,
    h: isFinitePositive(item.h) ? clamp(item.h, 1, 8) : 1,
  };
}

/** Validate and normalize raw JSON into a safe dashboard import. */
function validateImportData(raw: string): ImportValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      isValid: false,
      errors: ['Invalid JSON format'],
      warnings,
      dashboard: null,
      missingWidgets: [],
      availableWidgets: [],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      isValid: false,
      errors: ['Expected a JSON object'],
      warnings,
      dashboard: null,
      missingWidgets: [],
      availableWidgets: [],
    };
  }

  const data = parsed as Record<string, unknown>;

  // 2. Check required fields
  if (!data.name || typeof data.name !== 'string') {
    errors.push('Missing or invalid "name" field');
  }
  if (!Array.isArray(data.widgets)) {
    errors.push('Missing or invalid "widgets" array');
  }
  if (!data.layouts || typeof data.layouts !== 'object') {
    errors.push('Missing or invalid "layouts" object');
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings,
      dashboard: null,
      missingWidgets: [],
      availableWidgets: [],
    };
  }

  // 3. Validate widget entries
  const rawWidgets = data.widgets as unknown[];
  const validWidgets: WidgetInstance[] = [];
  const seenIds = new Set<string>();

  for (const w of rawWidgets) {
    if (typeof w !== 'object' || w === null) {
      continue;
    }
    const widget = w as Record<string, unknown>;
    if (typeof widget.widgetId !== 'string') {
      continue;
    }

    // Generate unique ID for duplicates or missing IDs
    let id =
      typeof widget.id === 'string'
        ? widget.id
        : `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (seenIds.has(id)) {
      id = `${id}-dup-${Math.random().toString(36).slice(2, 6)}`;
    }
    seenIds.add(id);

    validWidgets.push({
      id,
      widgetId: widget.widgetId,
      config:
        typeof widget.config === 'object' && widget.config !== null
          ? (widget.config as Record<string, unknown>)
          : undefined,
    });
  }

  // 4. Check widget availability against registry
  const registryIds = KNOWN_WIDGET_IDS;
  const available = validWidgets.filter(w => registryIds.has(w.widgetId));
  const missing = validWidgets.filter(w => !registryIds.has(w.widgetId));

  if (missing.length > 0) {
    warnings.push(
      `${missing.length} widget(s) not available and will be skipped`,
    );
  }
  if (available.length === 0) {
    errors.push('No compatible widgets found in this layout');
    return {
      isValid: false,
      errors,
      warnings,
      dashboard: null,
      missingWidgets: missing.map(w => w.widgetId),
      availableWidgets: [],
    };
  }

  // 5. Sanitize layouts
  const rawLayouts = data.layouts as Record<string, unknown>;
  const availableIds = new Set(available.map(w => w.id));
  const sanitizedLayouts: RGLLayouts = {};
  const breakpointCols: Record<string, number> = { lg: 4, md: 3, sm: 2, xs: 1 };

  for (const [bp, cols] of Object.entries(breakpointCols)) {
    const rawBpLayout = rawLayouts[bp];
    if (!Array.isArray(rawBpLayout)) {
      // Will be regenerated by reconcileLayouts on import
      continue;
    }
    const items: RGLLayout[] = [];
    for (const entry of rawBpLayout) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const item = entry as Record<string, unknown>;
      if (typeof item.i !== 'string' || !availableIds.has(item.i)) {
        continue;
      }
      items.push(
        sanitizeLayoutItem(
          {
            i: item.i,
            x: typeof item.x === 'number' ? item.x : 0,
            y: typeof item.y === 'number' ? item.y : 0,
            w: typeof item.w === 'number' ? item.w : 1,
            h: typeof item.h === 'number' ? item.h : 1,
            minW: typeof item.minW === 'number' ? item.minW : undefined,
            minH: typeof item.minH === 'number' ? item.minH : undefined,
            maxW: typeof item.maxW === 'number' ? item.maxW : undefined,
            maxH: typeof item.maxH === 'number' ? item.maxH : undefined,
          },
          cols,
        ),
      );
    }
    sanitizedLayouts[bp] = items;
  }

  // 6. Build validated dashboard
  const now = new Date().toISOString();
  const validatedDashboard: SavedDashboard = {
    id: `import-${Date.now()}`,
    name: String(data.name).slice(0, 100),
    widgets: available,
    layouts: sanitizedLayouts,
    createdAt: now,
    updatedAt: now,
    isDefault: false,
  };

  return {
    isValid: true,
    errors,
    warnings,
    dashboard: validatedDashboard,
    missingWidgets: missing.map(w => w.widgetId),
    availableWidgets: available.map(w => w.widgetId),
  };
}

/**
 * Decode URL-safe base64 to a UTF-8 string. Native-safe re-expression of the
 * web TextEncoder/TextDecoder helper: feature-detects the global `atob`
 * (present on react-native-web, Hermes, and the Node test runner) and rebuilds
 * the UTF-8 string with a bitwise-free percent-decode so multi-byte sequences
 * survive. Throws when no base64 decoder exists so the caller's try/catch maps
 * it to import.invalidUrl.
 */
function fromUrlSafeBase64(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const decode = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof decode !== 'function') {
    throw new Error('base64 decoding is unavailable in this environment');
  }
  const binary = decode(padded);
  try {
    return decodeURIComponent(
      binary
        .split('')
        .map(char => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    );
  } catch {
    // Malformed UTF-8 — best-effort raw decode (sufficient for ASCII payloads).
    return binary;
  }
}

/**
 * Extract the dashboard `import` payload from a share URL string. Native-safe
 * re-expression of the web `parsed.hash` / `parsed.searchParams.get('import')`
 * reads (web validateImport caller L109-112): RN's URL polyfill exposes a
 * narrower typed surface than the DOM (no `.hash`, no `URLSearchParams.get`), so
 * the param is parsed from the raw string. The hash form (`#import=…`) wins over
 * the query form, exactly like the web `importParam ?? searchParam`.
 */
function extractImportParam(url: string): string | null {
  // Hash form — web: hash.startsWith('#import=') ? hash.slice(...) : null.
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    const hash = url.slice(hashIndex);
    if (hash.startsWith('#import=')) {
      return hash.slice('#import='.length);
    }
  }
  // Query form — web: parsed.searchParams.get('import') (percent + '+' decoded).
  const queryIndex = url.indexOf('?');
  if (queryIndex !== -1) {
    const queryEnd =
      hashIndex !== -1 && hashIndex > queryIndex ? hashIndex : url.length;
    const query = url.slice(queryIndex + 1, queryEnd);
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      if (key === 'import') {
        const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
        try {
          return decodeURIComponent(rawValue.replace(/\+/g, '%20'));
        } catch {
          return rawValue;
        }
      }
    }
  }
  return null;
}

/* ── Native-safe JSON file picker (web hidden <input type=file>) ── */

interface PickedFile {
  name: string;
  type: string;
  text: () => Promise<string>;
}

interface FileInputElement {
  type: string;
  accept: string;
  onchange: (() => void) | null;
  files: ArrayLike<PickedFile> | null;
  click: () => void;
}

interface MinimalDocument {
  createElement: (tagName: 'input') => FileInputElement;
}

type FilePickResult =
  | { kind: 'text'; text: string }
  | { kind: 'invalidType' }
  | { kind: 'cancelled' };

/**
 * Returns a DOM file picker when one is available (react-native-web), else null.
 * On bare native there is no file system bridge here, so the caller surfaces an
 * explicit import.unavailable state instead of silently failing.
 */
function getJsonFilePicker(): (() => Promise<FilePickResult>) | null {
  const doc = (globalThis as { document?: MinimalDocument }).document;
  if (!doc || typeof doc.createElement !== 'function') {
    return null;
  }
  return () =>
    new Promise<FilePickResult>((resolve, reject) => {
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = () => {
        const file =
          input.files && input.files.length > 0 ? input.files[0] : null;
        if (!file) {
          resolve({ kind: 'cancelled' });
          return;
        }
        // Mirror the web drop check (web L98): application/json or *.json.
        const isJson =
          file.type === 'application/json' || file.name.endsWith('.json');
        if (!isJson) {
          resolve({ kind: 'invalidType' });
          return;
        }
        file
          .text()
          .then(text => resolve({ kind: 'text', text }))
          .catch(reject);
      };
      input.click();
    });
}

/* ── FadeIn (web @/components/motion FadeIn) ───────────── */

function FadeIn({ children }: { children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/* ── AlertBanner (web @/components/feedback AlertBanner) ── */

type AlertVariant = 'danger' | 'warning';

function AlertBanner({
  variant,
  icon,
  children,
}: {
  variant: AlertVariant;
  icon: SemanticIconName;
  children: ReactNode;
}) {
  return (
    <View style={[styles.alert, alertSurfaceStyles[variant]]}>
      <SemanticIcon decorative name={icon} size="sm" style={styles.alertIcon} />
      <View style={styles.alertBody}>{children}</View>
    </View>
  );
}

/* ── Badge (web @/components/ui Badge variant="neutral") ── */

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <AppText style={styles.badgeText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ── EmptyState (web @/components/feedback EmptyState) ──── */

function EmptyState({ message }: { message: string }) {
  return (
    <View accessibilityRole="summary" style={styles.empty}>
      <SemanticIcon
        decorative
        name="layoutGrid"
        size="lg"
        style={styles.emptyIcon}
      />
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── ModalButton (web @/components/ui Button) ──────────── */

function ModalButton({
  label,
  onPress,
  variant,
  size = 'md',
  icon,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant: 'primary' | 'ghost';
  size?: 'sm' | 'md';
  icon?: SemanticIconName;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        variant === 'primary' ? styles.buttonPrimary : styles.buttonGhost,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon ? (
        <SemanticIcon
          decorative
          name={icon}
          size="sm"
          style={styles.buttonIcon}
        />
      ) : null}
      <AppText
        style={
          variant === 'primary'
            ? styles.buttonTextPrimary
            : styles.buttonTextGhost
        }
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── TabStrip (web @/components/ui Tabs) ───────────────── */

interface TabDescriptor {
  key: string;
  label: string;
}

function TabStrip({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: TabDescriptor[];
  activeTab: string;
  onChange: (key: string) => void;
}) {
  return (
    <ScrollView
      accessibilityRole="tablist"
      contentContainerStyle={styles.tabStripContent}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabStrip}
    >
      {tabs.map(tab => {
        const isActive = activeTab === tab.key;
        return (
          <Pressable
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, isActive && styles.tabActive]}
          >
            <AppText
              numberOfLines={1}
              style={isActive ? styles.tabLabelActive : styles.tabLabel}
              weight="semibold"
            >
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ── MiniGridPreview (web ./MiniGridPreview) ───────────── */

const MINI_GRID_COLS = 4; // GRID_COLS.lg

function MiniGridPreview({ dashboard }: { dashboard: SavedDashboard }) {
  const lgLayout = dashboard.layouts.lg ?? [];
  const cols = MINI_GRID_COLS;

  const maxY =
    lgLayout.length > 0 ? Math.max(...lgLayout.map(l => l.y + l.h)) : 2;
  const safeMaxY = maxY > 0 && Number.isFinite(maxY) ? maxY : 2;

  return (
    <View style={[styles.miniGrid, { aspectRatio: cols / safeMaxY }]}>
      {lgLayout.map(item => {
        const widget = dashboard.widgets.find(w => w.id === item.i);
        const known = widget ? KNOWN_WIDGET_IDS.has(widget.widgetId) : false;
        return (
          <View
            key={item.i}
            style={[
              styles.miniCell,
              {
                left: `${(item.x / cols) * 100}%` as DimensionValue,
                top: `${(item.y / safeMaxY) * 100}%` as DimensionValue,
                width: `${(item.w / cols) * 100}%` as DimensionValue,
                height: `${(item.h / safeMaxY) * 100}%` as DimensionValue,
              },
            ]}
          >
            {known ? <View style={styles.miniDot} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/* ── ModalFrame (web @/components/ui Modal size="lg") ──── */

function ModalFrame({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useNativeTranslation();
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          accessibilityLabel={title}
          accessibilityViewIsModal
          accessible
          style={styles.dialog}
        >
          <View style={styles.dialogHeader}>
            <AppText style={styles.dialogTitle} weight="semibold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.close', 'Close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressed,
              ]}
            >
              <SemanticIcon decorative name="close" size="sm" />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.dialogScrollContent}
            keyboardShouldPersistTaps="handled"
            style={styles.dialogScroll}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ── ImportPreviewModal (web L32-260) ──────────────────── */

interface ImportPreviewModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (dashboard: SavedDashboard) => void;
  /** Pre-filled JSON (e.g. from URL import). */
  initialJson?: string | null;
}

export function ImportPreviewModal({
  open,
  onClose,
  onConfirm,
  initialJson,
}: ImportPreviewModalProps) {
  const t = useNativeTranslation();
  const [activeTab, setActiveTab] = useState('file');
  const [pastedJson, setPastedJson] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [validation, setValidation] = useState<ImportValidation | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // If initialJson is provided, auto-validate on open
  const [didAutoValidate, setDidAutoValidate] = useState(false);
  if (open && initialJson && !didAutoValidate) {
    const result = validateImportData(initialJson);
    setValidation(result);
    setDidAutoValidate(true);
  }

  const resetState = useCallback(() => {
    setValidation(null);
    setParseError(null);
    setPastedJson('');
    setImportUrl('');
    setDidAutoValidate(false);
    setActiveTab('file');
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleValidate = useCallback(
    (raw: string) => {
      setParseError(null);
      if (!raw.trim()) {
        setParseError(t('import.emptyInput', 'No data to validate'));
        return;
      }
      const result = validateImportData(raw);
      setValidation(result);
    },
    [t],
  );

  // Native-safe replacement for the web hidden <input type="file"> +
  // handleFileImport/handleFileChange/handleDrop (web L79-103). Opens a DOM file
  // picker when one is feature-detected; otherwise surfaces import.unavailable.
  const handleFileImport = useCallback(() => {
    setParseError(null);
    const picker = getJsonFilePicker();
    if (!picker) {
      setParseError(
        t('import.unavailable', 'File import is not available on this device'),
      );
      return;
    }
    picker()
      .then(result => {
        if (result.kind === 'text') {
          handleValidate(result.text);
        } else if (result.kind === 'invalidType') {
          setParseError(
            t('import.invalidFileType', 'Please drop a .json file'),
          );
        }
      })
      .catch(() => {
        setParseError(t('import.readError', 'Failed to read file'));
      });
  }, [handleValidate, t]);

  const handleUrlImport = useCallback(
    (url: string) => {
      setParseError(null);
      try {
        // `new URL` mirrors the web validity gate (throws on malformed input →
        // invalidUrl). RN's URL polyfill omits .hash / .searchParams.get, so
        // the import param is extracted from the (normalised, then raw) string.
        const source = new URL(url).toString();
        const encoded = extractImportParam(source) ?? extractImportParam(url);
        if (!encoded) {
          setParseError(
            t(
              'import.noImportParam',
              'URL does not contain an import parameter',
            ),
          );
          return;
        }
        const json = fromUrlSafeBase64(encoded);
        handleValidate(json);
      } catch {
        setParseError(t('import.invalidUrl', 'Invalid URL format'));
      }
    },
    [handleValidate, t],
  );

  const handleConfirm = useCallback(() => {
    if (validation?.dashboard) {
      onConfirm(validation.dashboard);
      handleClose();
    }
  }, [validation, onConfirm, handleClose]);

  const handleBackToInput = useCallback(() => {
    setValidation(null);
    setParseError(null);
  }, []);

  const tabs = useMemo<TabDescriptor[]>(
    () => [
      { key: 'file', label: t('import.fromFile', 'From File') },
      { key: 'paste', label: t('import.fromClipboard', 'Paste JSON') },
      { key: 'url', label: t('import.fromUrl', 'From URL') },
    ],
    [t],
  );

  // Show preview if we have validation results
  if (validation) {
    return (
      <ModalFrame
        onClose={handleClose}
        title={t('import.preview', 'Import Preview')}
        visible={open}
      >
        <ImportPreview
          onBack={handleBackToInput}
          onConfirm={handleConfirm}
          validation={validation}
        />
      </ModalFrame>
    );
  }

  return (
    <ModalFrame
      onClose={handleClose}
      title={t('import.title', 'Import Dashboard')}
      visible={open}
    >
      <View style={styles.stack}>
        <TabStrip activeTab={activeTab} onChange={setActiveTab} tabs={tabs} />

        {activeTab === 'file' && (
          <FadeIn>
            <Pressable
              accessibilityLabel={t('import.browse', 'Browse Files')}
              accessibilityRole="button"
              onPress={handleFileImport}
              onPressIn={() => setIsDragOver(true)}
              onPressOut={() => setIsDragOver(false)}
              style={[styles.dropZone, isDragOver && styles.dropZoneActive]}
            >
              <SemanticIcon
                decorative
                name="upload"
                size="lg"
                style={styles.dropIcon}
              />
              <AppText style={styles.dropText} tone="secondary">
                {t(
                  'import.dropFile',
                  'Drop a .json file here or click to browse',
                )}
              </AppText>
              <View style={styles.browsePill}>
                <SemanticIcon
                  decorative
                  name="upload"
                  size="sm"
                  style={styles.browsePillIcon}
                />
                <AppText style={styles.browsePillText} weight="semibold">
                  {t('import.browse', 'Browse Files')}
                </AppText>
              </View>
            </Pressable>
          </FadeIn>
        )}

        {activeTab === 'paste' && (
          <FadeIn>
            <View style={styles.inputStack}>
              <TextInput
                multiline
                numberOfLines={10}
                onChangeText={setPastedJson}
                placeholder={
                  '{"name": "My Dashboard", "widgets": [...], "layouts": {...}}'
                }
                placeholderTextColor={colors.textMuted}
                style={styles.textarea}
                textAlignVertical="top"
                value={pastedJson}
              />
              <ModalButton
                disabled={!pastedJson.trim()}
                icon="fileJson"
                label={t('import.validate', 'Validate & Preview')}
                onPress={() => handleValidate(pastedJson)}
                variant="primary"
              />
            </View>
          </FadeIn>
        )}

        {activeTab === 'url' && (
          <FadeIn>
            <View style={styles.inputStack}>
              <View style={styles.urlInputRow}>
                <SemanticIcon
                  decorative
                  name="link"
                  size="sm"
                  style={styles.urlInputIcon}
                />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setImportUrl}
                  placeholder="https://teslasync.example.com/dashboard#import=..."
                  placeholderTextColor={colors.textMuted}
                  style={styles.urlInput}
                  value={importUrl}
                />
              </View>
              <ModalButton
                disabled={!importUrl.trim()}
                label={t('import.loadUrl', 'Load from URL')}
                onPress={() => handleUrlImport(importUrl)}
                variant="primary"
              />
            </View>
          </FadeIn>
        )}

        {parseError ? (
          <AlertBanner icon="warning" variant="danger">
            <AppText style={styles.alertText}>{parseError}</AppText>
          </AlertBanner>
        ) : null}
      </View>
    </ModalFrame>
  );
}

/* ── Import Preview Sub-component (web L264-381) ────────── */

function ImportPreview({
  validation,
  onConfirm,
  onBack,
}: {
  validation: ImportValidation;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const t = useNativeTranslation();
  const {
    isValid,
    errors,
    warnings,
    dashboard,
    missingWidgets,
    availableWidgets,
  } = validation;

  return (
    <View style={styles.stack}>
      {/* Errors */}
      {errors.length > 0 && (
        <AlertBanner icon="error" variant="danger">
          <View style={styles.bulletList}>
            {errors.map((err, i) => (
              <View key={i} style={styles.bulletRow}>
                <AppText style={styles.bulletDot}>{'\u2022'}</AppText>
                <AppText style={styles.bulletText}>{err}</AppText>
              </View>
            ))}
          </View>
        </AlertBanner>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <AlertBanner icon="warning" variant="warning">
          <View style={styles.bulletList}>
            {warnings.map((warn, i) => (
              <View key={i} style={styles.bulletRow}>
                <AppText style={styles.bulletDot}>{'\u2022'}</AppText>
                <AppText style={styles.bulletText}>{warn}</AppText>
              </View>
            ))}
          </View>
        </AlertBanner>
      )}

      {dashboard ? (
        <FadeIn>
          <View style={styles.stack}>
            {/* Dashboard summary + preview */}
            <View style={styles.summaryRow}>
              <View style={styles.summaryPreview}>
                <MiniGridPreview dashboard={dashboard} />
              </View>
              <View style={styles.summaryInfo}>
                <AppText
                  numberOfLines={1}
                  style={styles.summaryName}
                  weight="semibold"
                >
                  {dashboard.name}
                </AppText>
                <View style={styles.badgeRow}>
                  <Badge
                    label={t('import.availableCount', '{{count}} widgets', {
                      count: availableWidgets.length,
                    })}
                  />
                  {missingWidgets.length > 0 && (
                    <Badge
                      label={t('import.missingCount', '{{count}} skipped', {
                        count: missingWidgets.length,
                      })}
                    />
                  )}
                </View>
              </View>
            </View>

            {/* Widget availability list */}
            <View style={styles.widgetList}>
              <AppText style={styles.widgetListHeader} weight="semibold">
                {t('import.widgets', 'Widgets')}
              </AppText>
              {availableWidgets.map(widgetId => (
                <View key={widgetId} style={styles.widgetRow}>
                  <SemanticIcon
                    decorative
                    name="success"
                    size="sm"
                    style={styles.widgetRowIcon}
                  />
                  <SemanticIcon
                    decorative
                    name="layoutGrid"
                    size="sm"
                    style={styles.widgetRowIcon}
                  />
                  <AppText
                    numberOfLines={1}
                    style={styles.widgetName}
                    tone="secondary"
                  >
                    {getWidgetName(widgetId) ?? widgetId}
                  </AppText>
                </View>
              ))}
              {missingWidgets.map(widgetId => (
                <View
                  key={widgetId}
                  style={[styles.widgetRow, styles.widgetRowMissing]}
                >
                  <SemanticIcon
                    decorative
                    name="error"
                    size="sm"
                    style={styles.widgetRowIcon}
                  />
                  <AppText
                    numberOfLines={1}
                    style={styles.widgetNameMissing}
                    tone="muted"
                  >
                    {widgetId}
                  </AppText>
                  <AppText style={styles.notAvailable}>
                    {t('import.notAvailable', 'Not available')}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        </FadeIn>
      ) : (
        <EmptyState
          message={t('import.cannotPreview', 'Cannot preview this layout')}
        />
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <ModalButton
          label={t('import.back', 'Back')}
          onPress={onBack}
          size="sm"
          variant="ghost"
        />
        {isValid && dashboard && (
          <ModalButton
            icon="confirm"
            label={t('import.confirm', 'Import Dashboard')}
            onPress={onConfirm}
            size="sm"
            variant="primary"
          />
        )}
      </View>
    </View>
  );
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: '#0f1218',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    margin: spacing.lg,
    maxHeight: '85%',
    maxWidth: 640,
    width: '92%',
    ...shadows.panel,
  },
  dialogHeader: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dialogTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  closeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  dialogScroll: {
    flexGrow: 0,
  },
  dialogScrollContent: {
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  stack: {
    gap: spacing.md,
  },
  tabStrip: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
  },
  tabStripContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  tabLabelActive: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  dropZone: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 2,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  dropZoneActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  dropIcon: {
    borderWidth: 0,
  },
  dropText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  browsePill: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  browsePillIcon: {
    borderWidth: 0,
  },
  browsePillText: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  inputStack: {
    gap: spacing.md,
  },
  textarea: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 18,
    minHeight: 180,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  urlInputRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  urlInputIcon: {
    borderWidth: 0,
  },
  urlInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: spacing.sm,
  },
  alert: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertIcon: {
    borderWidth: 0,
  },
  alertBody: {
    flex: 1,
  },
  alertText: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  bulletList: {
    gap: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  bulletDot: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  bulletText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  badge: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.textSecondary,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    borderWidth: 0,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  summaryPreview: {
    flexShrink: 0,
    width: 140,
  },
  summaryInfo: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  summaryName: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  widgetList: {
    gap: spacing.xs,
    maxHeight: 200,
  },
  widgetListHeader: {
    color: colors.textSecondary,
    fontSize: 11,
    letterSpacing: 0.6,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  widgetRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  widgetRowMissing: {
    borderColor: colors.dangerBorder,
  },
  widgetRowIcon: {
    borderWidth: 0,
  },
  widgetName: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  widgetNameMissing: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    textDecorationLine: 'line-through',
  },
  notAvailable: {
    color: colors.danger,
    fontSize: 11,
    lineHeight: 16,
  },
  miniGrid: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  miniCell: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
    position: 'absolute',
  },
  miniDot: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 2,
    height: 6,
    width: 6,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  buttonSm: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonIcon: {
    borderWidth: 0,
  },
  buttonTextPrimary: {
    color: colors.background,
  },
  buttonTextGhost: {
    color: colors.textPrimary,
  },
});

const alertSurfaceStyles = StyleSheet.create<Record<AlertVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

export default ImportPreviewModal;
