// Native parity port of web/src/features/dashboard/hooks/validateImport.ts.
//
// Despite living under `hooks/`, the web module is a pure dashboard
// import/validation + share-URL codec utility (no React hook, no JSX, no DOM
// element). The validation logic is engine-agnostic and is ported verbatim —
// every numbered step comment (1-6), every local name (`errors`, `warnings`,
// `parsed`, `data`, `rawWidgets`, `validWidgets`, `seenIds`, `registryIds`,
// `available`, `missing`, `rawLayouts`, `availableIds`, `sanitizedLayouts`,
// `breakpointCols`, `validatedDashboard`), the unique-id / `-dup-` suffix
// generation, the `clamp` / `isFinitePositive` guards, the per-breakpoint layout
// sanitisation, and the 100-char name slice are preserved 1:1. Two web imports
// are made native-safe without changing behaviour:
//
//   - `../widgets/types` (SavedDashboard / WidgetInstance / RGLLayouts /
//     RGLLayout): inlined below as module-local interfaces. They are pure type
//     declarations with no runtime or DOM dependency, so the exported
//     `ImportValidation`, `validateImportData`, and `buildMinimalExport`
//     signatures stay structurally identical to the web contract. The
//     `WidgetConfig` / `DashboardSettings` shapes are inlined too so the
//     `SavedDashboard` / `WidgetInstance` types match the source exactly.
//
//   - `../widgets/registry` WIDGET_REGISTRY: the web registry pulls in
//     `lucide-react` icons and `React.lazy(() => import('../XxxWidget'))`
//     component factories — both browser / React-DOM oriented and out of scope
//     for this file's parity slice. validateImportData consumes the registry
//     only as `WIDGET_REGISTRY.map((def) => def.id)` (the availability
//     allow-list), so a minimal `{ id }[]` mirror of every web widget id —
//     grouped exactly by the 16 source registry files — reproduces the
//     availability check identically.
//
// The share-URL base64 codecs used browser-only globals that are absent from the
// React Native (Hermes) runtime AND from the RN TypeScript lib: `btoa`, `atob`,
// `TextEncoder`, and `TextDecoder`. They are reimplemented here as pure,
// engine-agnostic UTF-8 + standard-base64 helpers whose output is byte-identical
// to the web `btoa(TextEncoder.encode(...))` / `TextDecoder.decode(atob(...))`
// pipeline for all realistic inputs, so `toUrlSafeBase64` / `fromUrlSafeBase64`
// round-trip share payloads exactly as on web (same url-safe `+`->`-`, `/`->`_`,
// stripped `=` padding). No explicit "unavailable" state is needed because the
// behaviour is fully reproduced rather than degraded.

/* ─── inlined widget types (web ../widgets/types) ──────────────────────────── */

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

/** react-grid-layout Layout item (position + size in grid units) */
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

/** react-grid-layout Layouts — keyed by breakpoint string */
interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

interface DashboardSettings {
  /** Auto-refresh interval in seconds (0 = use per-widget default) */
  refreshInterval: number;
  /** Filter widgets to show only this vehicle (undefined = all vehicles) */
  vehicleId?: number;
  /** Show widget borders in view mode */
  showWidgetBorders: boolean;
  /** Compact mode — reduces grid gaps */
  compactMode: boolean;
}

interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  settings?: DashboardSettings;
}

/* ─── inlined widget-id allow-list (web ../widgets/registry WIDGET_REGISTRY) ── */
// validateImportData reads the registry only as `.map((def) => def.id)`. This
// minimal `{ id }[]` mirror lists every web widget id, grouped by its source
// registry file (concatenation order from registry/index.ts), so the
// availability allow-list is byte-for-byte identical to the web build.

interface WidgetRegistryEntry {
  id: string;
}

const WIDGET_REGISTRY: readonly WidgetRegistryEntry[] = [
  // vehicle.ts — VEHICLE_WIDGETS
  {id: 'vehicle-hero'},
  {id: 'vehicle-hero-card'},
  {id: 'vehicle-twin'},
  {id: 'digital-twin-mini'},
  {id: 'software-update-status'},
  {id: 'software-update-history'},
  {id: 'odometer-counter'},
  {id: 'drivetrain-health'},
  {id: 'motor-performance'},
  {id: 'motor-history'},
  {id: 'vehicle-specs'},
  {id: 'watch-summary'},
  {id: 'maintenance-tracker'},
  {id: 'warranty-status'},
  {id: 'subscriptions'},
  {id: 'vehicle-upgrades'},
  // battery.ts — BATTERY_WIDGETS
  {id: 'battery-gauge'},
  {id: 'battery-radial-gauge'},
  {id: 'range-estimate'},
  {id: 'range-bar'},
  {id: 'battery-degradation-trend'},
  {id: 'energy-flow'},
  {id: 'projected-range'},
  {id: 'battery-cells'},
  {id: 'battery-degradation-forecast'},
  {id: 'battery-health-analytics'},
  // energy.ts — ENERGY_WIDGETS
  {id: 'energy-flow-animated'},
  {id: 'vampire-drain'},
  {id: 'sleep-efficiency'},
  {id: 'solar-production'},
  {id: 'live-power-flow'},
  {id: 'energy-site-info'},
  {id: 'backup-history'},
  {id: 'power-flow-history'},
  {id: 'energy-stats'},
  // driving.ts — DRIVING_WIDGETS
  {id: 'recent-drives'},
  {id: 'drive-score'},
  {id: 'recent-drives-list'},
  {id: 'drive-score-gauge'},
  {id: 'drive-efficiency-chart'},
  {id: 'speed-heatmap'},
  {id: 'driving-dynamics'},
  {id: 'speed-profile'},
  {id: 'regen-efficiency'},
  {id: 'route-efficiency'},
  {id: 'driving-coach'},
  {id: 'trip-summary'},
  {id: 'drive-telemetry'},
  // charging.ts — CHARGING_WIDGETS
  {id: 'charge-status'},
  {id: 'charge-status-live'},
  {id: 'charge-history'},
  {id: 'charge-session-chart'},
  {id: 'charge-cost-tracker'},
  {id: 'charging-schedule'},
  {id: 'cost-forecast'},
  {id: 'charging-optimizer'},
  {id: 'wall-connector'},
  {id: 'charging-telemetry'},
  {id: 'supercharger-history'},
  {id: 'charge-plans'},
  {id: 'charging-session-detail'},
  // climate.ts — CLIMATE_WIDGETS
  {id: 'climate-status'},
  {id: 'climate-control-panel'},
  {id: 'weather-at-car'},
  {id: 'climate-history'},
  // tires.ts — TIRE_WIDGETS
  {id: 'tire-pressure-visual'},
  {id: 'tire-pressure-history'},
  // security.ts — SECURITY_WIDGETS
  {id: 'security-status'},
  {id: 'door-window-status'},
  {id: 'sentry-event-log'},
  {id: 'safety-features'},
  {id: 'safety-history'},
  {id: 'guard-mode'},
  {id: 'vehicle-access'},
  // commands.ts — COMMAND_WIDGETS
  {id: 'command-quick-actions'},
  {id: 'command-history'},
  // media.ts — MEDIA_WIDGETS
  {id: 'media-now-playing'},
  {id: 'media-history'},
  // telemetry.ts — TELEMETRY_WIDGETS
  {id: 'live-signals'},
  {id: 'live-signal-sparklines'},
  {id: 'signal-health'},
  {id: 'signal-catalog'},
  {id: 'signal-log'},
  // analytics.ts — ANALYTICS_WIDGETS
  {id: 'fleet-stats'},
  {id: 'fleet-stats-bar'},
  {id: 'weekly-summary-card'},
  {id: 'weekly-digest'},
  {id: 'monthly-mileage'},
  {id: 'lifetime-stats'},
  {id: 'mileage-stats'},
  {id: 'state-timeline'},
  {id: 'anomaly-detector'},
  {id: 'fsm-distribution'},
  {id: 'cost-breakdown'},
  {id: 'year-review'},
  {id: 'analytics-summary'},
  {id: 'recently-unlocked-achievements'},
  // alerts.ts — ALERT_WIDGETS
  {id: 'alert-feed'},
  {id: 'notification-stats'},
  // automations.ts — AUTOMATION_WIDGETS
  {id: 'automation-status'},
  {id: 'automation-history'},
  // system.ts — SYSTEM_WIDGETS
  {id: 'onboarding-checklist'},
  {id: 'uptime-monitor'},
  {id: 'mqtt-status'},
  {id: 'quick-nav'},
  {id: 'api-usage'},
  {id: 'system-health'},
  {id: 'telemetry-errors'},
  {id: 'audit-log'},
  {id: 'backup-monitor'},
  {id: 'export-status'},
  {id: 'version-info'},
  {id: 'dashboard-stats'},
  // maps.ts — MAP_WIDGETS
  {id: 'location-map'},
  {id: 'location-favorites'},
  {id: 'geofence-status'},
  {id: 'destination-eta'},
  {id: 'position-heatmap'},
];

/* ─── ported validation logic (web validateImport.ts L9-197) ───────────────── */

export interface ImportValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  dashboard: SavedDashboard | null;
  missingWidgets: string[];
  availableWidgets: string[];
}

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Check if a value is a finite positive number */
function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/** Sanitize a single layout item to ensure valid coordinates */
function sanitizeLayoutItem(item: RGLLayout, cols: number): RGLLayout {
  return {
    ...item,
    x: isFinitePositive(item.x) ? clamp(item.x, 0, cols - 1) : 0,
    y: isFinitePositive(item.y) ? item.y : 0,
    w: isFinitePositive(item.w) ? clamp(item.w, 1, cols) : 1,
    h: isFinitePositive(item.h) ? clamp(item.h, 1, 8) : 1,
  };
}

/** Validate and normalize raw JSON into a safe dashboard import */
export function validateImportData(raw: string): ImportValidation {
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
    if (typeof w !== 'object' || w === null) continue;
    const widget = w as Record<string, unknown>;
    if (typeof widget.widgetId !== 'string') continue;

    // Generate unique ID for duplicates or missing IDs
    let id = typeof widget.id === 'string' ? widget.id : `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (seenIds.has(id)) {
      id = `${id}-dup-${Math.random().toString(36).slice(2, 6)}`;
    }
    seenIds.add(id);

    validWidgets.push({
      id,
      widgetId: widget.widgetId,
      config: typeof widget.config === 'object' && widget.config !== null
        ? (widget.config as Record<string, unknown>)
        : undefined,
    });
  }

  // 4. Check widget availability against registry
  const registryIds = new Set(WIDGET_REGISTRY.map((def) => def.id));
  const available = validWidgets.filter((w) => registryIds.has(w.widgetId));
  const missing = validWidgets.filter((w) => !registryIds.has(w.widgetId));

  if (missing.length > 0) {
    warnings.push(`${missing.length} widget(s) not available and will be skipped`);
  }
  if (available.length === 0) {
    errors.push('No compatible widgets found in this layout');
    return {
      isValid: false,
      errors,
      warnings,
      dashboard: null,
      missingWidgets: missing.map((w) => w.widgetId),
      availableWidgets: [],
    };
  }

  // 5. Sanitize layouts
  const rawLayouts = data.layouts as Record<string, unknown>;
  const availableIds = new Set(available.map((w) => w.id));
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
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.i !== 'string' || !availableIds.has(item.i)) continue;
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
    missingWidgets: missing.map((w) => w.widgetId),
    availableWidgets: available.map((w) => w.widgetId),
  };
}

/* ─── url-safe base64 codec (native-safe; replaces btoa/atob/TextEncoder/Decoder) */
// React Native (Hermes) does not expose the browser `btoa` / `atob` /
// `TextEncoder` / `TextDecoder` globals (they are also absent from the RN TS
// lib), so the web encode pipeline is reproduced with pure, engine-agnostic
// UTF-8 + standard-base64 helpers. Output is byte-identical to the web
// `btoa(TextEncoder.encode(...))` / `TextDecoder.decode(atob(...))` pipeline, so
// existing share URLs encode and decode unchanged.

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/* eslint-disable no-bitwise -- standard base64 / UTF-8 bit packing */

/** Encode a JS string to its UTF-8 byte sequence (mirrors TextEncoder.encode). */
function utf8Encode(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** Decode a UTF-8 byte sequence back to a JS string (mirrors TextDecoder.decode). */
function utf8Decode(bytes: number[]): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const byte1 = bytes[i++];
    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
    } else if (byte1 >= 0xc0 && byte1 < 0xe0) {
      const byte2 = bytes[i++] & 0x3f;
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | byte2);
    } else if (byte1 >= 0xe0 && byte1 < 0xf0) {
      const byte2 = bytes[i++] & 0x3f;
      const byte3 = bytes[i++] & 0x3f;
      result += String.fromCharCode(
        ((byte1 & 0x0f) << 12) | (byte2 << 6) | byte3,
      );
    } else {
      const byte2 = bytes[i++] & 0x3f;
      const byte3 = bytes[i++] & 0x3f;
      const byte4 = bytes[i++] & 0x3f;
      const codePoint =
        ((byte1 & 0x07) << 18) | (byte2 << 12) | (byte3 << 6) | byte4;
      result += String.fromCodePoint(codePoint);
    }
  }
  return result;
}

/** Standard base64 (with `=` padding) of a byte sequence (mirrors btoa). */
function base64Encode(bytes: number[]): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const hasByte1 = i + 1 < bytes.length;
    const hasByte2 = i + 2 < bytes.length;
    const byte0 = bytes[i];
    const byte1 = hasByte1 ? bytes[i + 1] : 0;
    const byte2 = hasByte2 ? bytes[i + 2] : 0;
    const triplet = (byte0 << 16) | (byte1 << 8) | byte2;
    output += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    output += hasByte1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
    output += hasByte2 ? BASE64_ALPHABET[triplet & 0x3f] : '=';
  }
  return output;
}

/** Decode standard base64 (padding-tolerant) to a byte sequence (mirrors atob). */
function base64Decode(input: string): number[] {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const value = BASE64_ALPHABET.indexOf(input[i]);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

/* eslint-enable no-bitwise */

/** Encode a string to URL-safe base64 */
export function toUrlSafeBase64(str: string): string {
  // Encode UTF-8 first, then standard base64, then make it url-safe.
  return base64Encode(utf8Encode(str))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode URL-safe base64 to string */
export function fromUrlSafeBase64(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return utf8Decode(base64Decode(padded));
}

/** Build a minimal export payload for share URLs (strips timestamps, IDs) */
export function buildMinimalExport(dashboard: SavedDashboard): string {
  const minimal = {
    name: dashboard.name,
    widgets: dashboard.widgets.map((w) => ({
      id: w.id,
      widgetId: w.widgetId,
      ...(w.config ? { config: w.config } : {}),
    })),
    layouts: dashboard.layouts,
  };
  return JSON.stringify(minimal);
}
