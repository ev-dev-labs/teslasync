/**
 * Native parity port of web/src/features/system/pages/MyActivityPage.tsx.
 *
 * The web page is the per-user activity feed: it renders the current user's own
 * audit-log entries (`/users/me/activity`) so non-admins can answer "what did I
 * change last week?" without the admin-wide audit view. A `PageContainer`
 * (title + subtitle + a `RangePicker` in the header `actions` slot) wraps a
 * single `GlassPanel` whose body is a four-way conditional ladder:
 *   1. feature-disabled (HTTP 503 — no ForwardAuth identity provider),
 *   2. unauthenticated (HTTP 401 — request carried no identity header),
 *   3. any other `ApiError` (retryable),
 *   4. otherwise the `RecentActivityFeed` timeline.
 * The date window is a 30-day default (`start = today − 29d`, `end = today`)
 * mirrored into the URL via `useUrlString('start')` / `useUrlString('end')`,
 * and committed atomically by `useUrlBatch()`; the feed is fetched with
 * `useMyRecentActivity({ start, end, limit: 200 })`.
 *
 * This native port preserves that contract 1:1 — the same `useMyRecentActivity`
 * hook + API path + `limit` (200), the same `start`/`end` URL state seeded from
 * the same 30-day `isoDate` default, the same `ApiError`-based 503/401 branching
 * (`featureDisabled` / `unauthenticated` / `apiError`), the same retry action
 * (`refetch`), and the same `RecentActivityFeed` (entry → audit visual + i18n
 * title + entity/detail subtitle + relative time, with an empty state) — using
 * React Native primitives, the existing native `AppText` / `GlassPanel` +
 * design tokens, and the already-ported web-parity `Timeline`.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react `useMemo` (web L13): preserved verbatim; native also uses
 *     `useCallback` + `useSyncExternalStore` for the inlined native-safe URL
 *     store and i18n shim, and `ReactNode` for the local component prop types.
 *   - react-i18next `useTranslation` (web L14): no native i18next runtime → an
 *     inline native-safe `t(key, fallback?, params?)` shim that returns the
 *     English fallback (else the key) and interpolates i18next-style `{{name}}`
 *     placeholders; every key + English default is preserved verbatim.
 *   - `@/components/layout/PageContainer` (web L16): no native parity port yet →
 *     a minimal native-safe `PageContainer` (ScrollView scaffold with title /
 *     subtitle / actions / children, the body gated behind the loading spinner
 *     exactly as the web gates content behind `<Spinner>`).
 *   - `@/components/ui` GlassPanel (web L17): the existing native GlassPanel.
 *   - `@/components/motion` FadeIn (web L18): framer-motion has no native
 *     equivalent → a static passthrough `View` (the established precedent).
 *   - `@/components/feedback/EmptyState` (web L19): a local native-safe
 *     EmptyState (icon glyph + optional title + message + optional retry action),
 *     mirroring the web `{ icon, title, message, action }` contract.
 *   - `@/components/forms` RangePicker (web L20): the web calendar popover has no
 *     native equivalent → a display-only chip showing the active range; the
 *     `onChange` write path (`useUrlBatch`) stays wired even though the native
 *     trigger does not open a picker.
 *   - `@/components/data-display/RecentActivityFeed` (web L21): reproduced
 *     locally over the already-ported web-parity `Timeline`, preserving the
 *     `entityHref` click-through map, the audit `getActivityVisual` lookup, the
 *     subtitle composition, and the relative-time + empty-state behaviour.
 *   - `@/lib/icons` Icons (web L22) + the lucide icons referenced by the audit
 *     registry: DOM SVG icons → decorative glyph constants (the established
 *     icon→glyph precedent). The bell-family variants collapse to 🔔 (BellOff
 *     → 🔕); the activity accent colour is dropped because the feed always
 *     passes `color: undefined` to the timeline.
 *   - `@/hooks/usePageTitle` (web L23): `document.title` is browser-only → a
 *     documented no-op (the native navigator owns the header title).
 *   - `@/hooks/useUrlState` useUrlBatch / useUrlString (web L24): reproduced over
 *     a native-safe module-level URL-param external store (the CommandHistoryPage
 *     precedent) preserving read / omit-default / atomic-write semantics.
 *   - `@/lib/resilience` ApiError (web L25): the native `ApiError` class exported
 *     by the native API client, with the same `status` field the page branches on.
 *   - `@/api/hooks/useUser` useMyRecentActivity (web L26): imported from the
 *     already-ported native hook module (same `/users/me/activity` path + params).
 */
import React, {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {ApiError} from '../../../api/client';
import {
  useMyRecentActivity,
  type UserActivityEntry,
} from '../../../api/hooks/useUser';
import {Timeline, type TimelineItemData} from '../../../components/data-display/Timeline';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  page constants (web L28-29)                                        */
/* ------------------------------------------------------------------ */

const DEFAULT_WINDOW_DAYS = 30;
const ACTIVITY_LIMIT = 200;

/** Returns a YYYY-MM-DD string for the given date, in local time (web L31-37). */
function isoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L14)    */
/* ------------------------------------------------------------------ */

type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only, L23) */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the header
  // title, so the resolved title is intentionally not applied.
}

/* ------------------------------------------------------------------ */
/*  native-safe URL-param store (web @/hooks/useUrlState, web L24)      */
/* ------------------------------------------------------------------ */

const urlStateStore = new Map<string, string>();
const urlStateListeners = new Set<() => void>();

function getUrlParam(key: string): string | undefined {
  return urlStateStore.get(key);
}

function subscribeUrlState(listener: () => void): () => void {
  urlStateListeners.add(listener);
  return () => {
    urlStateListeners.delete(listener);
  };
}

function notifyUrlState(): void {
  urlStateListeners.forEach(listener => listener());
}

/** Atomic multi-key write — null/undefined/'' deletes the key (web useUrlBatch). */
function setUrlParams(updates: Record<string, string | null | undefined>): void {
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === '') {
      if (urlStateStore.delete(key)) {
        changed = true;
      }
    } else if (urlStateStore.get(key) !== value) {
      urlStateStore.set(key, value);
      changed = true;
    }
  }
  if (changed) {
    notifyUrlState();
  }
}

function useUrlString(
  key: string,
  defaultValue = '',
): [string, (value: string) => void] {
  const raw = useSyncExternalStore(
    subscribeUrlState,
    () => getUrlParam(key),
    () => getUrlParam(key),
  );
  const value = raw ?? defaultValue;
  const set = useCallback((next: string) => setUrlParams({[key]: next}), [key]);
  return [value, set];
}

function useUrlBatch(): (
  updates: Record<string, string | null | undefined>,
) => void {
  return useCallback(updates => setUrlParams(updates), []);
}

/* ------------------------------------------------------------------ */
/*  ported date helpers (web @/lib/dateFormat formatRelative)          */
/* ------------------------------------------------------------------ */

interface FormatOptions {
  tz?: string;
  locale?: string;
}

function intlOpts(
  base: Intl.DateTimeFormatOptions,
  opts?: FormatOptions,
): Intl.DateTimeFormatOptions {
  return opts?.tz ? {...base, timeZone: opts.tz} : base;
}

function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw;
  }
  return undefined;
}

/** Date only: "Apr 4, 2026". '—' for nullish/invalid input. */
function formatDate(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString(
      intlLocale(opts),
      intlOpts({year: 'numeric', month: 'short', day: 'numeric'}, opts),
    );
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Short date: "Apr 4". '—' for nullish/invalid input. */
function formatDateShort(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString(
      intlLocale(opts),
      intlOpts({month: 'short', day: 'numeric'}, opts),
    );
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Relative time: "just now", "3m ago", "2h ago", "5d ago", else absolute date. */
function formatRelative(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso, opts);
}

/* ------------------------------------------------------------------ */
/*  decorative glyph stand-ins for the lucide-react icons (web L22)     */
/*  + the audit-registry icons surfaced by the activity feed.           */
/* ------------------------------------------------------------------ */

const ICON_SECURITY_CHECK = '\uD83D\uDEE1'; // 🛡 ShieldCheck (feature disabled)
const ICON_USER = '\uD83D\uDC64'; // 👤 User (identity / auth)
const ICON_WARNING = '\u26A0'; // ⚠ AlertTriangle (load error)
const ICON_HISTORY = '\uD83D\uDCDC'; // 📜 History (empty / fallback)
const ICON_GAMEPAD = '\uD83C\uDFAE'; // 🎮 Gamepad2 (vehicle command)
const ICON_POWER = '\u23FB'; // ⏻ Power (wake / flash)
const ICON_BELL = '\uD83D\uDD14'; // 🔔 Bell / BellRing / BellPlus
const ICON_BELL_OFF = '\uD83D\uDD15'; // 🔕 BellOff (alert rule deleted)
const ICON_LOCK = '\uD83D\uDD12'; // 🔒 Lock
const ICON_UNLOCK = '\uD83D\uDD13'; // 🔓 Unlock
const ICON_THERMOMETER = '\uD83C\uDF21'; // 🌡 Thermometer (climate)
const ICON_BOLT = '\u26A1'; // ⚡ Bolt (charging)
const ICON_SETTINGS = '\u2699'; // ⚙ Settings
const ICON_WORKFLOW = '\uD83D\uDD04'; // 🔄 Workflow (automation)
const ICON_GRID = '\u25A6'; // ▦ LayoutGrid (dashboard layout)
const ICON_DASHBOARD = '\uD83D\uDCCA'; // 📊 LayoutDashboard
const ICON_DOWNLOAD = '\uD83D\uDCE5'; // 📥 Download (data export)
const ICON_KEY = '\uD83D\uDD11'; // 🔑 Key (api key)

/* ------------------------------------------------------------------ */
/*  audit activity registry (web @/lib/activityIcons, web L19/L73)      */
/*  The web `color` (tailwind class) is dropped: RecentActivityFeed      */
/*  always passes `color: undefined` to the timeline, so it is unused.   */
/* ------------------------------------------------------------------ */

interface ActivityVisual {
  /** Decorative glyph rendered in the timeline dot. */
  icon: string;
  /** i18n key (no namespace) used to look up a translated label. */
  i18nKey: string;
  /** English fallback when the i18n key is missing. */
  fallback: string;
}

const ACTIVITY_REGISTRY: Record<string, ActivityVisual> = {
  // ── Vehicle commands ──────────────────────────────────────────────────────
  'vehicle.command': {
    icon: ICON_GAMEPAD,
    i18nKey: 'activity.action.vehicleCommand',
    fallback: 'Vehicle command',
  },
  'vehicle.command.wake': {
    icon: ICON_POWER,
    i18nKey: 'activity.action.vehicleCommandWake',
    fallback: 'Wake vehicle',
  },
  'vehicle.command.honk': {
    icon: ICON_BELL,
    i18nKey: 'activity.action.vehicleCommandHonk',
    fallback: 'Honk horn',
  },
  'vehicle.command.flash': {
    icon: ICON_POWER,
    i18nKey: 'activity.action.vehicleCommandFlash',
    fallback: 'Flash lights',
  },
  'vehicle.command.lock': {
    icon: ICON_LOCK,
    i18nKey: 'activity.action.vehicleCommandLock',
    fallback: 'Lock vehicle',
  },
  'vehicle.command.unlock': {
    icon: ICON_UNLOCK,
    i18nKey: 'activity.action.vehicleCommandUnlock',
    fallback: 'Unlock vehicle',
  },
  'vehicle.command.climate': {
    icon: ICON_THERMOMETER,
    i18nKey: 'activity.action.vehicleCommandClimate',
    fallback: 'Climate command',
  },
  'vehicle.command.charge': {
    icon: ICON_BOLT,
    i18nKey: 'activity.action.vehicleCommandCharge',
    fallback: 'Charging command',
  },

  // ── Settings / preferences ────────────────────────────────────────────────
  'settings.update': {
    icon: ICON_SETTINGS,
    i18nKey: 'activity.action.settingsUpdate',
    fallback: 'Settings updated',
  },
  settings: {
    icon: ICON_SETTINGS,
    i18nKey: 'activity.action.settings',
    fallback: 'Settings change',
  },

  // ── Alerts ────────────────────────────────────────────────────────────────
  'alert.rule.create': {
    icon: ICON_BELL,
    i18nKey: 'activity.action.alertRuleCreate',
    fallback: 'Alert rule created',
  },
  'alert.rule.update': {
    icon: ICON_BELL,
    i18nKey: 'activity.action.alertRuleUpdate',
    fallback: 'Alert rule updated',
  },
  'alert.rule.delete': {
    icon: ICON_BELL_OFF,
    i18nKey: 'activity.action.alertRuleDelete',
    fallback: 'Alert rule deleted',
  },
  alert: {
    icon: ICON_BELL,
    i18nKey: 'activity.action.alert',
    fallback: 'Alert change',
  },

  // ── Automations ───────────────────────────────────────────────────────────
  'automation.create': {
    icon: ICON_WORKFLOW,
    i18nKey: 'activity.action.automationCreate',
    fallback: 'Automation created',
  },
  'automation.update': {
    icon: ICON_WORKFLOW,
    i18nKey: 'activity.action.automationUpdate',
    fallback: 'Automation updated',
  },
  'automation.delete': {
    icon: ICON_WORKFLOW,
    i18nKey: 'activity.action.automationDelete',
    fallback: 'Automation deleted',
  },
  automation: {
    icon: ICON_WORKFLOW,
    i18nKey: 'activity.action.automation',
    fallback: 'Automation change',
  },

  // ── Dashboard / layout ────────────────────────────────────────────────────
  'dashboard.layout.save': {
    icon: ICON_GRID,
    i18nKey: 'activity.action.dashboardLayoutSave',
    fallback: 'Dashboard layout saved',
  },
  dashboard: {
    icon: ICON_DASHBOARD,
    i18nKey: 'activity.action.dashboard',
    fallback: 'Dashboard change',
  },

  // ── Data exports ──────────────────────────────────────────────────────────
  'data_export.create': {
    icon: ICON_DOWNLOAD,
    i18nKey: 'activity.action.dataExportCreate',
    fallback: 'Data export requested',
  },
  data_export: {
    icon: ICON_DOWNLOAD,
    i18nKey: 'activity.action.dataExport',
    fallback: 'Data export',
  },

  // ── API keys ──────────────────────────────────────────────────────────────
  'api_key.create': {
    icon: ICON_KEY,
    i18nKey: 'activity.action.apiKeyCreate',
    fallback: 'API key created',
  },
  'api_key.update': {
    icon: ICON_KEY,
    i18nKey: 'activity.action.apiKeyUpdate',
    fallback: 'API key updated',
  },
  'api_key.delete': {
    icon: ICON_KEY,
    i18nKey: 'activity.action.apiKeyDelete',
    fallback: 'API key revoked',
  },
  api_key: {
    icon: ICON_KEY,
    i18nKey: 'activity.action.apiKey',
    fallback: 'API key change',
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  'auth.login': {
    icon: ICON_USER,
    i18nKey: 'activity.action.authLogin',
    fallback: 'Signed in',
  },
  'auth.logout': {
    icon: ICON_USER,
    i18nKey: 'activity.action.authLogout',
    fallback: 'Signed out',
  },
  auth: {
    icon: ICON_USER,
    i18nKey: 'activity.action.auth',
    fallback: 'Authentication',
  },
};

const ACTIVITY_FALLBACK: ActivityVisual = {
  icon: ICON_HISTORY,
  i18nKey: 'activity.action.unknown',
  fallback: 'Activity',
};

/**
 * Resolves an action string to its visual descriptor, falling back to
 * progressively shorter prefixes (web getActivityVisual). `vehicle.command.wake`
 * matches first; if absent, `vehicle.command`, then the generic fallback.
 */
function getActivityVisual(action: string): ActivityVisual {
  if (!action) {
    return ACTIVITY_FALLBACK;
  }
  const normalized = action.trim();
  const exact = ACTIVITY_REGISTRY[normalized];
  if (exact) {
    return exact;
  }
  const parts = normalized.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('.');
    const match = ACTIVITY_REGISTRY[prefix];
    if (match) {
      return match;
    }
  }
  return ACTIVITY_FALLBACK;
}

/**
 * Maps an entity_type to a frontend route prefix when click-through makes
 * sense (web entityHref). Returning null means "render the subtitle as plain
 * text"; the native navigator shell owns the actual transition.
 */
function entityHref(
  entityType: string | null,
  entityId: string | null,
): string | null {
  if (!entityType || !entityId) {
    return null;
  }
  switch (entityType) {
    case 'vehicle':
      return `/vehicles/${encodeURIComponent(entityId)}`;
    case 'drive':
      return `/drives/${encodeURIComponent(entityId)}`;
    case 'charging_session':
    case 'charge':
      return `/charging/${encodeURIComponent(entityId)}`;
    case 'alert_rule':
      return '/notifications/alerts';
    case 'automation':
      return '/automations';
    case 'geofence':
      return '/geofences';
    case 'data_export':
    case 'export':
      return '/data-export';
    case 'api_key':
      return '/api-keys';
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  native FadeIn (web @/components/motion, web L18)                    */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback/EmptyState, web L19)   */
/* ------------------------------------------------------------------ */

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon?: string;
  title?: string;
  message: string;
  action?: EmptyStateAction;
  testID?: string;
}

function EmptyState({icon, title, message, action, testID}: EmptyStateProps) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState} testID={testID}>
      {icon ? (
        <AppText
          importantForAccessibility="no"
          style={styles.emptyStateIcon}
          tone="muted">
          {icon}
        </AppText>
      ) : null}
      {title ? (
        <AppText style={styles.emptyStateTitle} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyStateMessage} tone="muted">
        {message}
      </AppText>
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onClick}
          style={({pressed}) => [
            styles.emptyStateAction,
            pressed && styles.emptyStateActionPressed,
          ]}
          testID="my-activity-retry">
          <AppText style={styles.emptyStateActionLabel}>{action.label}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native RangePicker (web @/components/forms RangePicker, web L20)    */
/* ------------------------------------------------------------------ */

interface RangeValue {
  start: string;
  end: string;
}

function RangePicker({
  value,
  onChange,
  triggerTestId,
}: {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  align?: 'start' | 'end';
  triggerTestId?: string;
}) {
  // The web calendar popover has no native equivalent here; the trigger is a
  // display-only chip showing the active range. `onChange` is retained so the
  // write path stays wired even though the native trigger does not open a picker.
  void onChange;
  const labelText = `${formatDateShort(value.start)} \u2013 ${formatDateShort(
    value.end,
  )}`;
  return (
    <Pressable
      accessibilityRole="button"
      style={styles.rangePicker}
      testID={triggerTestId}>
      <AppText style={styles.rangePickerText} tone="secondary" variant="caption">
        {labelText}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native RecentActivityFeed (web @/components/data-display, web L21)  */
/* ------------------------------------------------------------------ */

interface RecentActivityFeedProps {
  entries: UserActivityEntry[];
  /** Accepted for web source parity; native styling uses StyleSheet. */
  className?: string;
  /** Override the empty-state message (i18n-translated by the caller). */
  emptyMessage?: string;
}

function RecentActivityFeed({
  entries,
  className,
  emptyMessage,
}: RecentActivityFeedProps) {
  const t = useNativeTranslation();

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={ICON_HISTORY}
        message={
          emptyMessage ??
          t('activity.myActivity.empty', 'No recent activity in this window.')
        }
        testID="my-activity-empty"
      />
    );
  }

  const items: TimelineItemData[] = entries.map(entry => {
    const visual = getActivityVisual(entry.action);
    const title = t(visual.i18nKey, visual.fallback);
    const href = entityHref(entry.entity_type, entry.entity_id);

    const subtitleParts: string[] = [];
    if (entry.entity_type) {
      subtitleParts.push(
        entry.entity_id
          ? `${entry.entity_type} \u00B7 ${entry.entity_id}`
          : entry.entity_type,
      );
    }
    if (entry.detail) {
      subtitleParts.push(entry.detail);
    }
    const subtitleText = subtitleParts.join(' \u2014 ');

    return {
      icon: visual.icon,
      // Render the title as a link so users can jump to the entity. The native
      // navigator shell owns the transition, so the destination is preserved as
      // an accessibility hint rather than an onPress handler.
      title: href ? (
        <Pressable
          accessibilityHint={`Go to ${href}`}
          accessibilityRole="link"
          testID={`my-activity-link-${entry.id}`}>
          <AppText style={styles.activityLink}>{title}</AppText>
        </Pressable>
      ) : (
        title
      ),
      subtitle: subtitleText || undefined,
      time: formatRelative(entry.ts),
      color: undefined,
    };
  });

  return <Timeline className={className} items={items} />;
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout/PageContainer, L16)   */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  testID?: string;
}

function PageContainer({
  title,
  subtitle,
  loading,
  actions,
  children,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'my-activity-page'}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText style={styles.title} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.subtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ?? null}
      </View>

      {loading ? (
        <View style={styles.loading} testID="my-activity-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MyActivityPage — per-user activity feed (web L39-121)
   ═══════════════════════════════════════════════════════════════════════ */

export default function MyActivityPage() {
  const t = useNativeTranslation();
  usePageTitle(t('activity.myActivity.title', 'My Activity'));

  const defaults = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (DEFAULT_WINDOW_DAYS - 1));
    return {start: isoDate(start), end: isoDate(today)};
  }, []);

  const [start] = useUrlString('start', defaults.start);
  const [end] = useUrlString('end', defaults.end);
  const setRangeBatch = useUrlBatch();

  const {data, isLoading, error, refetch} = useMyRecentActivity({
    start,
    end,
    limit: ACTIVITY_LIMIT,
  });

  const entries = data ?? [];
  const apiError = error instanceof ApiError ? error : null;
  const featureDisabled = apiError?.status === 503;
  const unauthenticated = apiError?.status === 401;

  return (
    <PageContainer
      actions={
        <RangePicker
          align="end"
          onChange={r => setRangeBatch({start: r.start, end: r.end})}
          triggerTestId="my-activity-range"
          value={{start, end}}
        />
      }
      loading={isLoading}
      subtitle={t(
        'activity.myActivity.subtitle',
        'Recent actions you have taken in TeslaSync.',
      )}
      testID="my-activity-page"
      title={t('activity.myActivity.title', 'My Activity')}>
      <FadeIn>
        <GlassPanel style={styles.panel}>
          {featureDisabled ? (
            <EmptyState
              icon={ICON_SECURITY_CHECK}
              message={t(
                'activity.myActivity.disabled.description',
                'Per-user activity is only available when TeslaSync is deployed behind an identity provider (ForwardAuth). Ask your administrator to configure AUTH_FORWARD_HEADER.',
              )}
              testID="my-activity-disabled"
              title={t(
                'activity.myActivity.disabled.title',
                'Activity feed disabled',
              )}
            />
          ) : unauthenticated ? (
            <EmptyState
              icon={ICON_USER}
              message={t(
                'activity.myActivity.unauthorized.description',
                'Your request did not include an identity header. Sign in through your identity provider and try again.',
              )}
              testID="my-activity-unauthorized"
              title={t(
                'activity.myActivity.unauthorized.title',
                'Identity required',
              )}
            />
          ) : apiError ? (
            <EmptyState
              action={{
                label: t('common.retry', 'Retry'),
                onClick: () => {
                  void refetch();
                },
              }}
              icon={ICON_WARNING}
              message={apiError.message}
              testID="my-activity-error"
              title={t('activity.myActivity.error.title', 'Could not load activity')}
            />
          ) : (
            <RecentActivityFeed entries={entries} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  activityLink: {
    color: '#67e8f9',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
  },
  emptyStateAction: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  emptyStateActionLabel: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  emptyStateActionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  emptyStateIcon: {
    fontSize: 20,
  },
  emptyStateMessage: {
    maxWidth: 360,
    textAlign: 'center',
  },
  emptyStateTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
    marginTop: spacing.xs,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  rangePicker: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rangePickerText: {
    fontSize: typography.caption,
  },
  scaffold: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  title: {
    color: colors.textPrimary,
  },
});
