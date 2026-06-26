// Native parity port of web/src/features/system/pages/SystemStatusPage.tsx.
//
// The web source is the operator-grade health dashboard at /system-status. It is
// a mobile-first single-column page that answers "is my instance healthy / what
// is broken / what do I do" in <5s. It pulls live data from many existing
// backend endpoints (system health, extended health, version, update-check,
// backup stats, workers health, Tesla API usage, error stats, auth status,
// backup runs/configs, maintenance state, notification stats, vehicles) and
// renders, in order: a StatusHero, an in-page update-available callout, an
// active-incidents card, a sticky chip nav, a Health-rows summary, an operator
// Action-items panel, a Resources panel, then a stack of accordion sections
// (Services & components, Database & connections, Telemetry pipeline, Tesla
// auth, Notifications & audit, Background workers, Backups, Tesla API usage,
// Recent errors, System info), a 30-day uptime heatmap, an SLO card, a
// scheduled-maintenance card, a subscribe card and a Status-API docs link.
//
// This is a SELF-CONTAINED native port mirroring the sibling system page ports
// (ChatbotPage, IncidentTimelinePage, ApiLogsPage): the shared web chrome
// (@/components/layout PageContainer, @/components/ui GlassPanel/Button/Badge,
// @/components/motion FadeIn) and the global @/components/status primitives
// (StatusHero, HealthRow, ResourcesPanel, ActionItemsPanel/ActionItem,
// UptimeHeatmap, StickyChipBar, StickyCompactHero) — none of which have native
// ports — are rebuilt inline with React Native primitives + the existing native
// tokens/components. Already-ported native pieces ARE reused: GlassPanel,
// AppText, SemanticIcon, the design tokens, the useAdmin/useSettings/
// useNotifications/useVehicles TanStack hooks, the api/devtools query functions,
// and the native ../components/status barrel (which provides AnomalyInlineRow,
// the real BackgroundWorkersCard + SubscribeCard ports, and native-safe
// placeholders for the not-yet-ported TeslaAuthCard / TeslaApiUsageCard /
// TelemetryPipelineCard / UpdateAvailableCallout / StatusPageSkeleton /
// LiveStatusPill / IncidentsCard / ScheduledMaintenanceCard / SLOTrackingCard /
// FrontendErrorsCard).
//
// Native-safe adaptations (each documented in the parity sidecar):
//   * react-router-dom <Link to> / the page's many CTA targets -> an optional
//     `onNavigate?(to)` prop (the host wires routing, the Explore/QuickStats
//     convention) plus Linking.openURL for `external` CTAs. No react-router
//     import.
//   * The global @/components/status primitives (StatusHero / HealthRow /
//     ResourcesPanel / ActionItemsPanel / ActionItem / UptimeHeatmap /
//     StickyChipBar) are reimplemented inline with RN primitives so the REAL
//     data (health summary, operator action items, resource bars, uptime grid)
//     renders natively rather than being stubbed. StickyCompactHero (a CSS
//     sticky-on-scroll mini hero) has no native equivalent and is dropped.
//   * AccordionSection is inlined as a real collapsible container (it renders
//     its children) instead of using the barrel's native-safe placeholder,
//     because the placeholder drops children and would hide the Services list,
//     the Database/Notifications/Backups DefLists, the error-code list and the
//     System-info rows. The web wraps the backup DefList in BackupActionsCard;
//     that barrel placeholder also drops children, so the backup DefList is
//     rendered directly to preserve the data.
//   * @/components/layout PageContainer -> an inline ScrollView page with a
//     title/subtitle header + an actions slot; @/components/ui GlassPanel reused;
//     Button/Badge -> inline RN primitives (Button's `loading` -> ActivityIndicator).
//   * The DOM scroll-to-section (document.getElementById + #main-content
//     scrollTo) -> a ScrollView ref + an onLayout offset map; the chip bar taps
//     scroll the page to the matching section. The window `keydown` shortcuts
//     (R / J / K) are a DOM-only affordance with no hardware-keyboard contract
//     on mobile and are dropped; the on-screen Refresh button preserves R's
//     behaviour. The print <style> block is DOM-only and dropped.
//   * useStatusLiveSSE (browser EventSource) -> an inline native-safe stub that
//     reports 'offline' with no snapshot and a no-op reconnect (EventSource is
//     browser-only; the durable poll path via the TanStack queries remains the
//     source of truth). usePageTitle -> a no-op (no document.title). The
//     useDateFormat / useFormatting hooks -> inline useNativeDateFormat /
//     useNativeFormatting (Intl-based, device locale). react-i18next useTranslation
//     -> an inline `t(key, params)` that returns the English key and reproduces
//     i18next `{{name}}` interpolation. formatUptime / formatBytes / fmtInt are
//     ported verbatim from the web helpers/numberFormat. cn (clsx) -> StyleSheet
//     arrays.
//   * lucide-react glyphs (Activity, Database, Bell, ShieldCheck, Cpu, Server,
//     HardDrive, Package, Clock, RefreshCw, Boxes, AlertTriangle, Car, Inbox)
//     map to the nearest repo SemanticIcon names. The web `void Zap` no-op line
//     is dropped (Zap is never imported here).
//
// All state names (now, overallStatus, lastCheckedLabel, teslaTokenWarn,
// lastSuccessfulBackup, backupStaleDays, resourceRows, uptimeDays, chips, the
// hasUpdate/hasStaleBackup/hasNoBackup/hasMaintenance/apiOverBudget flags), the
// derived-status logic, the snake_case API field reads, the query keys
// (['system-status', ...]) and refetch cadences, and the i18n English copy are
// preserved. No DOM, no lucide-react, no Recharts/Leaflet, no react-router, and
// no web UI components are imported.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';

import {
  useSystemHealth,
  useBackupRuns,
  useBackupConfigs,
  useMaintenanceState,
} from '../../../api/hooks/useAdmin';
import { useAuthStatus } from '../../../api/hooks/useSettings';
import { useNotificationStats } from '../../../api/hooks/useNotifications';
import { useVehicles } from '../../../api/hooks/useVehicles';
import {
  getVersionInfo,
  getExtendedHealth,
  checkForUpdates,
  getBackupStats,
  getWorkersHealth,
  getAPIUsage,
  getErrorStats,
} from '../../../api/devtools';

import {
  AnomalyInlineRow,
  BackgroundWorkersCard,
  TeslaAuthCard,
  TeslaApiUsageCard,
  TelemetryPipelineCard,
  UpdateAvailableCallout,
  StatusPageSkeleton,
  LiveStatusPill,
  IncidentsCard,
  ScheduledMaintenanceCard,
  SubscribeCard,
  SLOTrackingCard,
  FrontendErrorsCard,
} from '../components/status';

/* ------------------------------------------------------------------ */
/*  Types (web @/components/status + useStatusLiveSSE)                  */
/* ------------------------------------------------------------------ */

type HeroStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown'
  | 'maintenance';

interface ResourceRow {
  label: string;
  valueText: string;
  metaText?: string;
  percent?: number;
  icon?: ReactNode;
}

interface UptimeDay {
  date: string;
  status: HeroStatus;
}

type StatusLiveState = 'live' | 'reconnecting' | 'offline';

type BadgeVariant = 'info' | 'warning' | 'neutral' | 'success' | 'danger';

/* ------------------------------------------------------------------ */
/*  Shared cadence (verbatim)                                          */
/* ------------------------------------------------------------------ */

const STATUS_REFRESH_MS = 30_000;
const UPDATE_CHECK_MS = 60 * 60 * 1_000; // hourly — backend caches GitHub for 1h
const STALE_BACKUP_DAYS = 7;

/* ------------------------------------------------------------------ */
/*  Pure helpers (web @/lib + ../components/status/helpers, verbatim)  */
/* ------------------------------------------------------------------ */

// react-i18next useTranslation parity: returns the English key and reproduces
// i18next `{{name}}` interpolation (the only interpolation the source uses).
function t(key: string, params?: Record<string, string | number | undefined>): string {
  if (!params) {
    return key;
  }
  return key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = params[name];
    return v == null ? '' : String(v);
  });
}

// @/lib/numberFormat fmtNumber/fmtInt parity (toLocaleString with fixed digits).
function fmtNumber(value: number, decimals: number): string {
  const n = Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function fmtInt(value: number): string {
  return fmtNumber(value, 0);
}

// ../components/status/helpers formatUptime ported verbatim.
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

// ../components/status/helpers formatBytes ported verbatim.
function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${fmtNumber(bytes / Math.pow(k, i), 1)} ${sizes[i]}`;
}

/* ------------------------------------------------------------------ */
/*  Native hook parities                                               */
/* ------------------------------------------------------------------ */

// @/hooks/useDateFormat().formatDateTime parity (Intl, device locale; '—' for
// null/invalid). The user tz/locale binding has no native settings surface here.
function useNativeDateFormat(): {
  formatDateTime: (value: string | null | undefined) => string;
} {
  const formatDateTime = useCallback((value: string | null | undefined) => {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    try {
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return date.toISOString();
    }
  }, []);
  return { formatDateTime };
}

// @/hooks/useFormatting().formatCurrency parity (USD; no native currency
// settings surface on this page).
function useNativeFormatting(): {
  formatCurrency: (value: number) => string;
} {
  const formatCurrency = useCallback((value: number) => {
    const n = Number.isFinite(value) ? value : 0;
    try {
      return n.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      });
    } catch {
      return `$${n.toFixed(2)}`;
    }
  }, []);
  return { formatCurrency };
}

// @/hooks/usePageTitle parity: no-op (React Native has no document.title); the
// title still renders in the page header.
function useNativePageTitle(_title: string): void {
  // intentionally empty
}

// ../hooks/useStatusLiveSSE parity: the web hook opens a browser EventSource
// against /api/v1/status/live. EventSource is browser-only, so the native port
// reports 'offline' with no snapshot and a no-op reconnect; the durable
// TanStack-query poll path remains the source of truth for every value on the
// page.
function useStatusLiveSSE(): {
  state: StatusLiveState;
  lastUpdateAt: number | null;
  reconnect: () => void;
} {
  const reconnect = useCallback(() => {
    // no-op: native has no EventSource live channel
  }, []);
  return { state: 'offline', lastUpdateAt: null, reconnect };
}

/* ------------------------------------------------------------------ */
/*  Status colour maps (web DOT_FOR_STATUS / TEXT_FOR_STATUS)          */
/* ------------------------------------------------------------------ */

const DOT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy: '#4ade80', // green-400
  degraded: '#fbbf24', // amber-400
  unhealthy: '#f87171', // red-400
  unknown: '#a1a1aa', // zinc-400
  maintenance: '#60a5fa', // blue-400
};

const TEXT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy: '#86efac', // green-300
  degraded: '#fcd34d', // amber-300
  unhealthy: '#fca5a5', // red-300
  unknown: '#d4d4d8', // zinc-300
  maintenance: '#93c5fd', // blue-300
};

const HERO_HEADLINE: Record<HeroStatus, string> = {
  healthy: 'All systems operational',
  degraded: 'Degraded performance',
  unhealthy: 'Service disruption',
  unknown: 'Status unknown',
  maintenance: 'Maintenance in progress',
};

const badgeColors: Record<
  BadgeVariant,
  { surface: string; border: string; fg: string }
> = {
  info: { surface: colors.accentSoft, border: colors.borderAccent, fg: colors.accent },
  warning: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
  neutral: {
    surface: colors.surfaceRaised,
    border: colors.border,
    fg: colors.textSecondary,
  },
  success: {
    surface: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
  },
  danger: {
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
    fg: colors.danger,
  },
};

/* ------------------------------------------------------------------ */
/*  Native UI primitives (web @/components/* parity)                   */
/* ------------------------------------------------------------------ */

function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  const c = badgeColors[variant];
  return (
    <View style={[s.badge, { backgroundColor: c.surface, borderColor: c.border }]}>
      <AppText style={[s.badgeText, { color: c.fg }]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
  icon?: SemanticIconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        size === 'sm' ? s.btnSm : s.btnMd,
        variant === 'ghost' ? s.btnGhost : s.btnPrimary,
        isDisabled && s.btnDisabled,
        pressed && !isDisabled && s.btnPressed,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'ghost' ? colors.textPrimary : colors.background}
          size="small"
        />
      ) : (
        <>
          {icon ? <SemanticIcon decorative name={icon} size="sm" /> : null}
          <AppText
            style={[
              s.btnText,
              size === 'sm' && s.btnTextSm,
              variant === 'ghost' ? s.btnTextGhost : s.btnTextPrimary,
            ]}
            weight="semibold">
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

// @/components/motion FadeIn -> passthrough (the web entrance animation has no
// behavioural contract).
function FadeIn({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function StatusDot({ status }: { status: HeroStatus }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[s.statusDot, { backgroundColor: DOT_FOR_STATUS[status] }]}
    />
  );
}

// web local StatusBadge (status dot + label chip).
function StatusBadge({ status }: { status: HeroStatus }) {
  const label =
    status === 'healthy'
      ? 'healthy'
      : status === 'degraded'
        ? 'degraded'
        : status === 'unhealthy'
          ? 'down'
          : status === 'maintenance'
            ? 'maintenance'
            : 'unknown';
  return (
    <View style={s.statusBadge}>
      <StatusDot status={status} />
      <AppText style={[s.statusBadgeText, { color: TEXT_FOR_STATUS[status] }]}>
        {label}
      </AppText>
    </View>
  );
}

// web local resolveCompStatus (verbatim).
function resolveCompStatus(stat: string): HeroStatus {
  if (stat === 'healthy' || stat === 'ok') {
    return 'healthy';
  }
  if (stat === 'degraded' || stat === 'warning') {
    return 'degraded';
  }
  if (
    stat === 'unhealthy' ||
    stat === 'down' ||
    stat === 'offline' ||
    stat === 'failed'
  ) {
    return 'unhealthy';
  }
  return 'unknown';
}

// @/components/status StatusHero -> inline hero panel.
function StatusHero({
  status,
  subline,
  cta,
}: {
  status: HeroStatus;
  subline?: string;
  cta: { label: string; onPress: () => void; loading?: boolean };
}) {
  return (
    <GlassPanel style={s.heroPanel}>
      <View style={s.heroTop}>
        <StatusDot status={status} />
        <AppText style={[s.heroHeadline, { color: TEXT_FOR_STATUS[status] }]} weight="bold">
          {HERO_HEADLINE[status]}
        </AppText>
      </View>
      {subline ? (
        <AppText style={s.heroSubline} tone="muted">
          {subline}
        </AppText>
      ) : null}
      <View style={s.heroCta}>
        <Button
          icon="refresh"
          label={cta.label}
          loading={cta.loading}
          onPress={cta.onPress}
          size="sm"
          variant="ghost"
        />
      </View>
    </GlassPanel>
  );
}

// @/components/status HealthRow -> inline pressable summary row.
function HealthRow({
  status,
  icon,
  label,
  summary,
  onPress,
}: {
  status: HeroStatus;
  icon: ReactNode;
  label: string;
  summary: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${summary}`}
      onPress={onPress}
      style={({ pressed }) => [s.healthRow, pressed && s.rowPressed]}>
      <StatusDot status={status} />
      <View style={s.healthRowIcon}>{icon}</View>
      <AppText numberOfLines={1} style={s.healthRowLabel} weight="semibold">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={s.healthRowSummary} tone="muted">
        {summary}
      </AppText>
      <SemanticIcon decorative name="next" size="sm" />
    </Pressable>
  );
}

// @/components/status ResourcesPanel -> inline resource list with usage bars.
function ResourcesPanel({
  rows,
  footnote,
}: {
  rows: ResourceRow[];
  footnote?: string;
}) {
  return (
    <GlassPanel style={s.panel}>
      <PanelTitle>{t('Resources')}</PanelTitle>
      {rows.length === 0 ? (
        <AppText style={s.mutedBody} tone="muted">
          {t('No resource data yet.')}
        </AppText>
      ) : (
        <View style={s.resourceList}>
          {rows.map(row => {
            const pct =
              row.percent != null
                ? Math.max(0, Math.min(100, row.percent))
                : null;
            return (
              <View key={row.label} style={s.resourceRow}>
                <View style={s.resourceHead}>
                  {row.icon ? <View style={s.resourceIcon}>{row.icon}</View> : null}
                  <AppText style={s.resourceLabel}>{row.label}</AppText>
                  <View style={s.resourceValueWrap}>
                    <AppText style={s.resourceValue} weight="semibold">
                      {row.valueText}
                    </AppText>
                    {row.metaText ? (
                      <AppText style={s.resourceMeta} tone="muted">
                        {row.metaText}
                      </AppText>
                    ) : null}
                  </View>
                </View>
                {pct != null ? (
                  <View style={s.resourceTrack}>
                    <View style={[s.resourceFill, { width: `${pct}%` }]} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {footnote ? (
        <AppText style={s.footnote} tone="muted">
          {footnote}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

// @/components/status ActionItem -> inline severity row with optional CTA.
function ActionItem({
  severity,
  title,
  description,
  cta,
  onNavigate,
}: {
  severity: 'info' | 'warn' | 'error';
  title: string;
  description?: string;
  cta?: { label: string; to: string; external?: boolean };
  onNavigate: (to: string, external?: boolean) => void;
}) {
  const tone: BadgeVariant =
    severity === 'error' ? 'danger' : severity === 'warn' ? 'warning' : 'info';
  const iconName: SemanticIconName =
    severity === 'error'
      ? 'severityCritical'
      : severity === 'warn'
        ? 'warning'
        : 'info';
  const accent = badgeColors[tone].fg;
  return (
    <View style={[s.actionItem, { borderLeftColor: accent }]}>
      <View style={s.actionItemHead}>
        <SemanticIcon decorative name={iconName} size="sm" />
        <AppText style={s.actionItemTitle} weight="semibold">
          {title}
        </AppText>
      </View>
      {description ? (
        <AppText style={s.actionItemDesc} tone="muted">
          {description}
        </AppText>
      ) : null}
      {cta ? (
        <View style={s.actionItemCta}>
          <Button
            label={cta.label}
            onPress={() => onNavigate(cta.to, cta.external)}
            size="sm"
            variant="ghost"
          />
        </View>
      ) : null}
    </View>
  );
}

// @/components/status ActionItemsPanel -> inline panel; always renders with an
// explicit empty state when there are no items (web rule #6).
function ActionItemsPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <GlassPanel style={s.panel}>
      <PanelTitle>{title}</PanelTitle>
      {items.length > 0 ? (
        <View style={s.actionItemList}>{items}</View>
      ) : (
        <View style={s.emptyRow}>
          <SemanticIcon decorative name="success" size="sm" />
          <AppText style={s.mutedBody} tone="muted">
            {t('Everything looks good — no action items.')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

// @/components/status UptimeHeatmap -> inline 30-day grid.
function UptimeHeatmap({
  days,
  footnote,
}: {
  days: UptimeDay[];
  footnote?: string;
}) {
  return (
    <GlassPanel style={s.panel}>
      <PanelTitle>{t('30-day uptime')}</PanelTitle>
      <View style={s.heatGrid}>
        {days.map(day => (
          <View
            accessibilityLabel={`${day.date}: ${day.status}`}
            key={day.date}
            style={[s.heatCell, { backgroundColor: DOT_FOR_STATUS[day.status] }]}
          />
        ))}
      </View>
      {footnote ? (
        <AppText style={s.footnote} tone="muted">
          {footnote}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

// @/components/status StickyChipBar -> inline horizontal chip nav (taps scroll
// the page to the matching section; the CSS sticky positioning is dropped).
function StickyChipBar({
  chips,
  onJump,
}: {
  chips: { id: string; label: string }[];
  onJump: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      contentContainerStyle={s.chipBarContent}
      showsHorizontalScrollIndicator={false}
      style={s.chipBar}>
      {chips.map(chip => (
        <Pressable
          accessibilityRole="button"
          key={chip.id}
          onPress={() => onJump(chip.id)}
          style={({ pressed }) => [s.chip, pressed && s.chipPressed]}>
          <AppText style={s.chipText}>{chip.label}</AppText>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <AppText style={s.panelTitle} weight="semibold">
      {children}
    </AppText>
  );
}

// web local AccordionSection -> inline collapsible (renders its children).
function AccordionSection({
  icon,
  title,
  description,
  badges,
  defaultOpen,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <GlassPanel style={s.accordion}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(prev => !prev)}
        style={({ pressed }) => [s.accordionHeader, pressed && s.rowPressed]}>
        <View style={s.accordionIcon}>{icon}</View>
        <View style={s.accordionHeadCopy}>
          <AppText numberOfLines={1} style={s.accordionTitle} weight="semibold">
            {title}
          </AppText>
          <AppText numberOfLines={1} style={s.accordionDesc} tone="muted">
            {description}
          </AppText>
        </View>
        {badges ? <View style={s.accordionBadges}>{badges}</View> : null}
        <SemanticIcon decorative name={open ? 'collapse' : 'expand'} size="sm" />
      </Pressable>
      {open ? <View style={s.accordionBody}>{children}</View> : null}
    </GlassPanel>
  );
}

interface DefListRow {
  label: string;
  value: ReactNode;
}

// web local DefList -> inline key/value rows.
function DefList({ rows }: { rows: DefListRow[] }) {
  return (
    <View style={s.defList}>
      {rows.map(row => (
        <View key={row.label} style={s.defRow}>
          <AppText style={s.defLabel} tone="secondary">
            {row.label}
          </AppText>
          <AppText style={s.defValue} weight="semibold">
            {row.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// web local DetailLink (react-router <Link>) -> inline navigate affordance.
function DetailLink({
  to,
  label,
  onNavigate,
}: {
  to: string;
  label: string;
  onNavigate: (to: string, external?: boolean) => void;
}) {
  return (
    <View style={s.detailLinkWrap}>
      <Pressable
        accessibilityRole="link"
        onPress={() => onNavigate(to)}
        style={({ pressed }) => [s.detailLink, pressed && s.detailLinkPressed]}>
        <AppText style={s.detailLinkText} weight="semibold">
          {label}
        </AppText>
        <SemanticIcon decorative name="next" size="sm" />
      </Pressable>
    </View>
  );
}

// web local SystemInfoRows -> inline DefList of version/runtime fields.
function SystemInfoRows({
  version,
  extHealth,
}: {
  version?: {
    app_version: string;
    chart_version: string;
    go_version: string;
    os: string;
    arch: string;
    uptime_seconds: number;
  };
  extHealth?: {
    system?: { goroutines: number; uptime_seconds: number; go_version: string };
  };
}) {
  if (!version) {
    return (
      <AppText style={s.mutedBody} tone="muted">
        {t('Loading system info…')}
      </AppText>
    );
  }
  const rows: DefListRow[] = [
    { label: t('App version'), value: version.app_version },
    { label: t('Chart version'), value: version.chart_version },
    { label: t('Go runtime'), value: version.go_version },
    { label: t('OS / arch'), value: `${version.os}/${version.arch}` },
    { label: t('Uptime'), value: formatUptime(version.uptime_seconds) },
  ];
  if (extHealth?.system?.goroutines != null) {
    rows.push({ label: t('Goroutines'), value: fmtInt(extHealth.system.goroutines) });
  }
  return <DefList rows={rows} />;
}

// Section wrapper that records its scroll offset for the chip-bar jump nav.
function Section({
  id,
  register,
  children,
}: {
  id: string;
  register: (id: string, y: number) => void;
  children: ReactNode;
}) {
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => register(id, e.nativeEvent.layout.y),
    [id, register],
  );
  return (
    <View collapsable={false} onLayout={onLayout} style={s.section}>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

interface SystemStatusPageProps {
  onNavigate?: (to: string) => void;
}

export default function SystemStatusPage({ onNavigate }: SystemStatusPageProps = {}) {
  useNativePageTitle(t('System Status'));
  const qc = useQueryClient();
  const { formatDateTime } = useNativeDateFormat();
  const { formatCurrency } = useNativeFormatting();

  // ── data sources ────────────────────────────────────────────────
  const {
    data: health,
    isLoading,
    isFetching,
    error,
    refetch: refetchHealth,
    dataUpdatedAt,
  } = useSystemHealth();

  // SSE drops polling cost when connected; useQuery polling remains the
  // offline fallback (native: SSE is unavailable so polling is the only path).
  const {
    state: liveState,
    lastUpdateAt: liveLastUpdate,
    reconnect: liveReconnect,
  } = useStatusLiveSSE();

  const { data: extHealth } = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: STATUS_REFRESH_MS,
  });

  const { data: version } = useQuery({
    queryKey: ['system-status', 'version'],
    queryFn: getVersionInfo,
    refetchInterval: 60_000,
  });

  const { data: updateCheck } = useQuery({
    queryKey: ['system-status', 'update-check'],
    queryFn: checkForUpdates,
    refetchInterval: UPDATE_CHECK_MS,
    staleTime: UPDATE_CHECK_MS,
  });

  const { data: backupStats } = useQuery({
    queryKey: ['system-status', 'backup-stats'],
    queryFn: getBackupStats,
    refetchInterval: STATUS_REFRESH_MS,
  });

  const { data: workers } = useQuery({
    queryKey: ['system-status', 'workers'],
    queryFn: getWorkersHealth,
    refetchInterval: STATUS_REFRESH_MS,
  });

  const { data: apiUsage } = useQuery({
    queryKey: ['system-status', 'api-usage'],
    queryFn: getAPIUsage,
    refetchInterval: 5 * 60_000,
  });

  const { data: errorStats } = useQuery({
    queryKey: ['system-status', 'errors'],
    queryFn: getErrorStats,
    refetchInterval: STATUS_REFRESH_MS,
  });

  const { data: auth } = useAuthStatus();
  const { data: backupRuns } = useBackupRuns();
  const { data: backupConfigs } = useBackupConfigs();
  const { data: maintenance } = useMaintenanceState();
  const { data: notifStats } = useNotificationStats();
  const { data: vehicles } = useVehicles();

  // ── derived overall status ──────────────────────────────────────
  const overallStatus: HeroStatus = useMemo(() => {
    if (maintenance?.mode === 'maintenance') {
      return 'maintenance';
    }
    if (!health) {
      return 'unknown';
    }
    const stat = health.status as string;
    if (stat === 'healthy' || stat === 'ok') {
      return 'healthy';
    }
    if (stat === 'degraded' || stat === 'warning') {
      return 'degraded';
    }
    if (stat === 'unhealthy' || stat === 'down' || stat === 'offline') {
      return 'unhealthy';
    }
    return 'unknown';
  }, [health, maintenance]);

  // ── live "last checked" tick (drives the subline) ───────────────
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const lastCheckedLabel = useMemo(() => {
    if (!dataUpdatedAt) {
      return undefined;
    }
    const secs = Math.max(0, Math.floor((now - dataUpdatedAt) / 1000));
    if (secs < 60) {
      return `${secs}s ago`;
    }
    if (secs < 3600) {
      return `${Math.floor(secs / 60)}m ago`;
    }
    return `${Math.floor(secs / 3600)}h ago`;
  }, [now, dataUpdatedAt]);

  // ── refresh action ──────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    refetchHealth();
    qc.invalidateQueries({ queryKey: ['system-status'] });
    liveReconnect();
  }, [refetchHealth, qc, liveReconnect]);

  // The web window `keydown` shortcuts (R refresh, J/K section jump) are a
  // DOM-only affordance with no hardware-keyboard contract on mobile; the
  // on-screen Refresh button preserves R's behaviour.

  // ── in-page scroll for chip bar / Health rows ───────────────────
  // The web reads #main-content + getBoundingClientRect; native uses a
  // ScrollView ref + an onLayout offset map. We keep the same ~76px offset.
  const scrollRef = useRef<ScrollView>(null);
  const offsetsRef = useRef<Record<string, number>>({});
  const registerSection = useCallback((id: string, y: number) => {
    offsetsRef.current[id] = y;
  }, []);
  const scrollToSection = useCallback((id: string) => {
    const y = offsetsRef.current[id];
    if (y == null) {
      return;
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  const handleNavigate = useCallback(
    (to: string, external?: boolean) => {
      if (external) {
        Linking.openURL(to).catch(() => {
          // best-effort; never claim success
        });
        return;
      }
      onNavigate?.(to);
    },
    [onNavigate],
  );

  // ── derived metrics ─────────────────────────────────────────────
  const teslaTokenWarn = useMemo(() => {
    if (!auth?.expires_at) {
      return null;
    }
    const exp = new Date(auth.expires_at).getTime();
    const days = Math.floor((exp - now) / (24 * 60 * 60 * 1000));
    if (days < 0) {
      return { severity: 'error' as const, days };
    }
    if (days <= 7) {
      return { severity: 'warn' as const, days };
    }
    return null;
  }, [auth, now]);

  const lastSuccessfulBackup = useMemo(() => {
    if (!backupRuns) {
      return null;
    }
    return backupRuns.find(r => r.status === 'completed') ?? null;
  }, [backupRuns]);

  const backupStaleDays = useMemo(() => {
    if (!lastSuccessfulBackup?.completedAt) {
      return null;
    }
    return Math.floor(
      (now - new Date(lastSuccessfulBackup.completedAt).getTime()) /
        (24 * 60 * 60 * 1000),
    );
  }, [lastSuccessfulBackup, now]);

  // camelCaseKeys() aliases every response with a camelCase duplicate; for the
  // component listing we keep only the canonical snake_case keys (those without
  // an uppercase letter).
  const components = health
    ? Object.entries(health.components).filter(([k]) => !/[A-Z]/.test(k))
    : [];
  const okCount = components.filter(
    ([, c]) => c.status === 'ok' || c.status === 'healthy',
  ).length;
  const totalCount = components.length;

  const dbStatus: HeroStatus =
    extHealth?.database?.status === 'ok' || extHealth?.database?.status === 'healthy'
      ? 'healthy'
      : extHealth?.database?.status
        ? 'degraded'
        : 'unknown';
  const dbLatency = extHealth?.database?.latency_ms;

  const teslaAuthStatus: HeroStatus =
    teslaTokenWarn?.severity === 'error'
      ? 'unhealthy'
      : teslaTokenWarn?.severity === 'warn'
        ? 'degraded'
        : auth?.authenticated === false
          ? 'unhealthy'
          : auth?.authenticated
            ? 'healthy'
            : 'unknown';

  const teslaAuthSummary =
    teslaTokenWarn?.severity === 'error'
      ? t('Token expired')
      : teslaTokenWarn?.severity === 'warn'
        ? t('Expires in {{days}}d', { days: teslaTokenWarn.days })
        : auth?.authenticated
          ? t('Connected')
          : t('Not connected');

  const totalRows = useMemo(() => {
    if (!backupStats?.row_counts) {
      return 0;
    }
    return Object.values(backupStats.row_counts).reduce(
      (a, b) => a + (b ?? 0),
      0,
    );
  }, [backupStats]);

  const positionCount = backupStats?.row_counts?.positions ?? 0;
  const drivesCount = backupStats?.row_counts?.drives ?? 0;
  const vehicleCount = vehicles?.length ?? 0;

  const workersStatus: HeroStatus = workers
    ? workers.healthy_count === workers.total
      ? 'healthy'
      : workers.healthy_count > 0
        ? 'degraded'
        : 'unhealthy'
    : 'unknown';

  const notifStatus: HeroStatus = notifStats
    ? notifStats.failed > 0
      ? 'degraded'
      : 'healthy'
    : 'unknown';

  const errorsStatus: HeroStatus = errorStats
    ? errorStats.total_errors > 100
      ? 'degraded'
      : errorStats.total_errors > 500
        ? 'unhealthy'
        : 'healthy'
    : 'unknown';

  // Tesla API budget — alert when spend exceeds the documented free credit.
  const apiOverBudget =
    !!apiUsage && apiUsage.estimated_cost > apiUsage.monthly_credit;

  // ── resources rows ──────────────────────────────────────────────
  const resourceRows: ResourceRow[] = useMemo(() => {
    const rows: ResourceRow[] = [];

    if (extHealth?.database_pool) {
      const acquired = extHealth.database_pool.acquired_conns ?? 0;
      const idle = extHealth.database_pool.idle_conns ?? 0;
      const total = extHealth.database_pool.total_conns ?? 0;
      const max = total > 0 ? total : acquired + idle;
      rows.push({
        label: t('DB connections'),
        valueText: `${acquired}`,
        metaText: max > 0 ? t('of {{max}} in use', { max }) : undefined,
        percent: max > 0 ? (acquired / max) * 100 : undefined,
        icon: <SemanticIcon decorative name="database" size="sm" />,
      });
    }

    if (backupStats?.database_size) {
      rows.push({
        label: t('Storage used'),
        valueText: backupStats.database_size,
        metaText:
          backupStats.table_count != null
            ? t('across {{count}} tables', { count: backupStats.table_count })
            : undefined,
        icon: <SemanticIcon decorative name="hardDrive" size="sm" />,
      });
    }

    if (totalRows > 0) {
      rows.push({
        label: t('Total rows'),
        valueText: fmtInt(totalRows),
        metaText:
          positionCount > 0
            ? t('{{count}} positions', { count: fmtInt(positionCount) })
            : undefined,
        icon: <SemanticIcon decorative name="layoutGrid" size="sm" />,
      });
    }

    if (extHealth?.system?.goroutines != null) {
      rows.push({
        label: t('Runtime threads'),
        valueText: fmtInt(extHealth.system.goroutines),
        metaText: t('goroutines'),
        icon: <SemanticIcon decorative name="cpu" size="sm" />,
      });
    }

    if (workers) {
      rows.push({
        label: t('Workers'),
        valueText: `${workers.healthy_count} / ${workers.total}`,
        metaText: t('healthy'),
        percent:
          workers.total > 0 ? (workers.healthy_count / workers.total) * 100 : undefined,
        icon: <SemanticIcon decorative name="server" size="sm" />,
      });
    }

    if (version?.uptime_seconds != null && version.uptime_seconds > 0) {
      rows.push({
        label: t('Uptime'),
        valueText: formatUptime(version.uptime_seconds),
        icon: <SemanticIcon decorative name="clock" size="sm" />,
      });
    } else if (extHealth?.system?.uptime_seconds != null) {
      rows.push({
        label: t('Uptime'),
        valueText: formatUptime(extHealth.system.uptime_seconds),
        icon: <SemanticIcon decorative name="clock" size="sm" />,
      });
    }

    return rows;
  }, [extHealth, version, backupStats, totalRows, positionCount, workers]);

  // ── 30-day uptime heatmap ───────────────────────────────────────
  const uptimeDays: UptimeDay[] = useMemo(() => {
    const days: UptimeDay[] = [];
    const day = 24 * 60 * 60 * 1000;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * day);
      const iso = d.toISOString().slice(0, 10);
      days.push({
        date: iso,
        // Today = current status; prior days assumed healthy until the backend
        // exposes a real day-level history feed.
        status: i === 0 ? overallStatus : 'healthy',
      });
    }
    return days;
  }, [now, overallStatus]);

  // ── chip bar IDs ────────────────────────────────────────────────
  const chips = useMemo(
    () => [
      { id: 'health', label: t('Health') },
      { id: 'action-items', label: t('Action items') },
      { id: 'resources', label: t('Resources') },
      { id: 'services', label: t('Services') },
      { id: 'database', label: t('Database') },
      { id: 'telemetry', label: t('Telemetry') },
      { id: 'tesla-auth', label: t('Tesla auth') },
      { id: 'notifications', label: t('Notifications') },
      { id: 'workers', label: t('Workers') },
      { id: 'backups', label: t('Backups') },
      { id: 'tesla-api', label: t('Tesla API') },
      { id: 'errors', label: t('Errors') },
      { id: 'system', label: t('System') },
      { id: 'uptime', label: t('Uptime') },
      { id: 'slo', label: t('SLO') },
      { id: 'maintenance', label: t('Maintenance') },
      { id: 'subscribe', label: t('Subscribe') },
    ],
    [],
  );

  // Action item flags
  const hasUpdate = updateCheck?.update_available === true;
  const hasStaleBackup = backupStaleDays != null && backupStaleDays > STALE_BACKUP_DAYS;
  const hasNoBackup =
    backupRuns != null &&
    backupRuns.length === 0 &&
    (backupConfigs?.length ?? 0) > 0;
  const hasMaintenance = maintenance?.mode === 'maintenance';

  // Health staleness — surface in hero subline if /health errored or we haven't
  // received fresh data in over 2 minutes.
  const healthStale =
    !!error || (dataUpdatedAt > 0 && now - dataUpdatedAt > 2 * 60_000);
  const heroSubline = error
    ? t('Health check failed — {{message}}', { message: (error as Error).message })
    : healthStale
      ? t('Last checked {{when}} (stale)', { when: lastCheckedLabel ?? 'unknown' })
      : lastCheckedLabel
        ? t('Last checked {{when}}', { when: lastCheckedLabel })
        : t('Awaiting first check');

  // Health-row contextual summaries
  const servicesSummary =
    totalCount === 0
      ? t('no data')
      : t('{{ok}} / {{total}} healthy', { ok: okCount, total: totalCount });
  const databaseSummary =
    dbLatency != null
      ? `${Math.round(dbLatency)}ms · ${backupStats?.database_size ?? '—'}`
      : backupStats?.database_size ?? t('connected');
  const telemetrySummary =
    vehicleCount > 0
      ? `${vehicleCount} ${vehicleCount === 1 ? t('vehicle') : t('vehicles')} · ${fmtInt(positionCount)} ${t('positions')}`
      : t('operational · 0 vehicles (idle)');
  const notificationsSummary = notifStats
    ? notifStats.enabled_channels === 0
      ? t('No channels configured')
      : t('{{enabled}}/{{total}} channels · {{sent}} sent', {
          enabled: notifStats.enabled_channels,
          total: notifStats.total_channels,
          sent: notifStats.sent,
        })
    : t('operational');
  const workersSummary = workers
    ? t('{{ok}} / {{total}} healthy', {
        ok: workers.healthy_count,
        total: workers.total,
      })
    : t('unknown');

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={s.pageContent}
      style={s.pageRoot}>
      {/* Header — web PageContainer title/subtitle + actions slot. */}
      <View style={s.pageHeader}>
        <View style={s.pageHeaderCopy}>
          <AppText numberOfLines={2} variant="title" weight="bold">
            {t('System Status')}
          </AppText>
          <AppText style={s.pageSubtitle} tone="muted" variant="caption">
            {t('At-a-glance health for your TeslaSync instance')}
          </AppText>
        </View>
        <View style={s.pageActions}>
          <LiveStatusPill
            lastUpdateAt={liveLastUpdate}
            now={now}
            state={liveState}
          />
          <Button
            accessibilityLabel={t('Refresh (R)')}
            disabled={isFetching}
            icon="refresh"
            label={t('Refresh')}
            onPress={handleRefresh}
            size="sm"
            variant="ghost"
          />
        </View>
      </View>

      {isLoading ? (
        <StatusPageSkeleton />
      ) : (
        <View style={s.stack}>
          {/* 1 ─ Hero ───────────────────────────────────────────── */}
          <Section id="status-hero" register={registerSection}>
            <FadeIn>
              <StatusHero
                cta={{
                  label: t('Run health check'),
                  onPress: handleRefresh,
                  loading: isFetching,
                }}
                status={healthStale ? 'unknown' : overallStatus}
                subline={heroSubline}
              />
            </FadeIn>
          </Section>

          {/* 1b ─ Update available callout (in-page) ─────────────── */}
          {hasUpdate ? (
            <FadeIn>
              <UpdateAvailableCallout
                checkedAt={updateCheck?.checked_at}
                current={updateCheck?.current}
                latest={updateCheck?.latest}
              />
            </FadeIn>
          ) : null}

          {/* 1c ─ Active incidents (only when present) ───────────── */}
          <FadeIn>
            <IncidentsCard now={now} />
          </FadeIn>

          {/* 2 ─ Sticky chip bar ─────────────────────────────────── */}
          <StickyChipBar chips={chips} onJump={scrollToSection} />

          {/* 3 ─ Health rows ─────────────────────────────────────── */}
          <Section id="health" register={registerSection}>
            <GlassPanel style={s.panel}>
              <PanelTitle>{t('Health')}</PanelTitle>
              <View style={s.healthRowList}>
                <HealthRow
                  icon={<SemanticIcon decorative name="server" size="sm" />}
                  label={t('Services')}
                  onPress={() => scrollToSection('services')}
                  status={
                    totalCount === 0
                      ? 'unknown'
                      : okCount === totalCount
                        ? 'healthy'
                        : okCount > totalCount / 2
                          ? 'degraded'
                          : 'unhealthy'
                  }
                  summary={servicesSummary}
                />
                <HealthRow
                  icon={<SemanticIcon decorative name="database" size="sm" />}
                  label={t('Database')}
                  onPress={() => scrollToSection('database')}
                  status={dbStatus}
                  summary={databaseSummary}
                />
                <HealthRow
                  icon={<SemanticIcon decorative name="activity" size="sm" />}
                  label={t('Telemetry')}
                  onPress={() => scrollToSection('telemetry')}
                  status="healthy"
                  summary={telemetrySummary}
                />
                <HealthRow
                  icon={<SemanticIcon decorative name="notifications" size="sm" />}
                  label={t('Notifications')}
                  onPress={() => scrollToSection('notifications')}
                  status={notifStatus}
                  summary={notificationsSummary}
                />
                <HealthRow
                  icon={<SemanticIcon decorative name="layoutGrid" size="sm" />}
                  label={t('Workers')}
                  onPress={() => scrollToSection('workers')}
                  status={workersStatus}
                  summary={workersSummary}
                />
                {/* Anomaly row — renders only when anomalies_last_24h > 0 */}
                <AnomalyInlineRow />
                <HealthRow
                  icon={<SemanticIcon decorative name="securityCheck" size="sm" />}
                  label={t('Tesla auth')}
                  onPress={() => scrollToSection('tesla-auth')}
                  status={teslaAuthStatus}
                  summary={teslaAuthSummary}
                />
              </View>
            </GlassPanel>
          </Section>

          {/* 4 ─ Action items (always render) ─────────────────────── */}
          <Section id="action-items" register={registerSection}>
            <ActionItemsPanel title={t('Needs your attention')}>
              {hasMaintenance ? (
                <ActionItem
                  cta={{ label: t('Manage'), to: '/system-status#maintenance' }}
                  description={
                    maintenance?.maintenance_message ||
                    t('System is in operator-set maintenance mode')
                  }
                  key="maintenance"
                  onNavigate={handleNavigate}
                  severity="info"
                  title={t('Maintenance mode is active')}
                />
              ) : null}
              {hasUpdate ? (
                <ActionItem
                  cta={{
                    label: t('Release notes'),
                    to: 'https://github.com/ev-dev-labs/teslasync/releases/latest',
                    external: true,
                  }}
                  description={t('Current: v{{current}}', {
                    current: updateCheck?.current,
                  })}
                  key="update"
                  onNavigate={handleNavigate}
                  severity="info"
                  title={t('Update available — v{{version}}', {
                    version: updateCheck?.latest,
                  })}
                />
              ) : null}
              {teslaTokenWarn?.severity === 'error' ? (
                <ActionItem
                  cta={{ label: t('Re-authenticate'), to: '/tesla-account' }}
                  description={t('Sign in again to resume Tesla-backed features')}
                  key="token-expired"
                  onNavigate={handleNavigate}
                  severity="error"
                  title={t('Tesla token expired')}
                />
              ) : null}
              {teslaTokenWarn?.severity === 'warn' ? (
                <ActionItem
                  cta={{ label: t('Re-authenticate'), to: '/tesla-account' }}
                  description={t('Refresh to avoid disruption')}
                  key="token-warn"
                  onNavigate={handleNavigate}
                  severity="warn"
                  title={t('Tesla token expires in {{days}} day(s)', {
                    days: teslaTokenWarn.days,
                  })}
                />
              ) : null}
              {auth?.authenticated === false && !teslaTokenWarn ? (
                <ActionItem
                  cta={{ label: t('Connect'), to: '/tesla-account' }}
                  description={t('Connect your Tesla account to fetch vehicle data')}
                  key="not-connected"
                  onNavigate={handleNavigate}
                  severity="warn"
                  title={t('Tesla account not connected')}
                />
              ) : null}
              {hasStaleBackup ? (
                <ActionItem
                  cta={{ label: t('Manage backups'), to: '/backup' }}
                  description={t('Run a backup or check the schedule')}
                  key="stale-backup"
                  onNavigate={handleNavigate}
                  severity="warn"
                  title={t('Last backup is {{days}} days old', {
                    days: backupStaleDays ?? 0,
                  })}
                />
              ) : null}
              {hasNoBackup ? (
                <ActionItem
                  cta={{ label: t('Set up backups'), to: '/backup' }}
                  description={t('Configure a schedule or run one now')}
                  key="no-backup"
                  onNavigate={handleNavigate}
                  severity="warn"
                  title={t('No backups recorded')}
                />
              ) : null}
              {apiOverBudget && apiUsage ? (
                <ActionItem
                  cta={{ label: t('Open Tesla API logs'), to: '/api-logs' }}
                  description={t('Review polling cadence or vehicle subscriptions')}
                  key="over-budget"
                  onNavigate={handleNavigate}
                  severity="warn"
                  title={t(
                    'Tesla API estimated cost {{cost}} exceeds {{credit}} monthly credit',
                    {
                      cost: formatCurrency(apiUsage.estimated_cost),
                      credit: formatCurrency(apiUsage.monthly_credit),
                    },
                  )}
                />
              ) : null}
              {workers && workers.healthy_count < workers.total ? (
                <ActionItem
                  description={(workers.workers || [])
                    .filter(w => w.status !== 'healthy')
                    .map(w => w.name)
                    .join(', ')}
                  key="workers-down"
                  onNavigate={handleNavigate}
                  severity="error"
                  title={t('{{down}} of {{total}} workers unhealthy', {
                    down: workers.total - workers.healthy_count,
                    total: workers.total,
                  })}
                />
              ) : null}
            </ActionItemsPanel>
          </Section>

          {/* 5 ─ Resources ───────────────────────────────────────── */}
          <Section id="resources" register={registerSection}>
            <ResourcesPanel
              footnote={t(
                'CPU %, memory bytes, and disk usage need a new /system/resources endpoint (Phase 2).',
              )}
              rows={resourceRows}
            />
          </Section>

          {/* 6 ─ Services & components ────────────────────────────── */}
          <Section id="services" register={registerSection}>
            <AccordionSection
              badges={
                <StatusBadge
                  status={
                    totalCount === 0
                      ? 'unknown'
                      : okCount === totalCount
                        ? 'healthy'
                        : 'degraded'
                  }
                />
              }
              defaultOpen
              description={servicesSummary}
              icon={<SemanticIcon decorative name="server" size="sm" />}
              title={t('Services & components')}>
              {components.length > 0 ? (
                <View style={s.compList}>
                  {components.map(([name, comp]) => (
                    <View key={name} style={s.compRow}>
                      <StatusDot status={resolveCompStatus(comp.status)} />
                      <AppText numberOfLines={1} style={s.compName} weight="semibold">
                        {name}
                      </AppText>
                      <AppText style={s.compStatus} tone="muted">
                        {comp.status}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : (
                <AppText style={s.mutedBody} tone="muted">
                  {t('No component data yet.')}
                </AppText>
              )}
              <DetailLink
                label={t('Open Live Monitor')}
                onNavigate={handleNavigate}
                to="/live-monitor"
              />
            </AccordionSection>
          </Section>

          {/* 7 ─ Database ─────────────────────────────────────────── */}
          <Section id="database" register={registerSection}>
            <AccordionSection
              badges={<StatusBadge status={dbStatus} />}
              defaultOpen
              description={databaseSummary}
              icon={<SemanticIcon decorative name="database" size="sm" />}
              title={t('Database & connections')}>
              <DefList
                rows={[
                  {
                    label: t('Latency'),
                    value: dbLatency != null ? `${Math.round(dbLatency)}ms` : '—',
                  },
                  {
                    label: t('Pool acquired'),
                    value: extHealth?.database_pool
                      ? `${extHealth.database_pool.acquired_conns} / ${
                          extHealth.database_pool.total_conns ||
                          extHealth.database_pool.acquired_conns +
                            extHealth.database_pool.idle_conns
                        }`
                      : '—',
                  },
                  {
                    label: t('Pool idle'),
                    value: extHealth?.database_pool
                      ? String(extHealth.database_pool.idle_conns)
                      : '—',
                  },
                  { label: t('Storage used'), value: backupStats?.database_size ?? '—' },
                  {
                    label: t('Tables'),
                    value:
                      backupStats?.table_count != null
                        ? String(backupStats.table_count)
                        : '—',
                  },
                  { label: t('Total rows'), value: totalRows > 0 ? fmtInt(totalRows) : '—' },
                ]}
              />
              <DetailLink
                label={t('Open DB Health')}
                onNavigate={handleNavigate}
                to="/db-health"
              />
            </AccordionSection>
          </Section>

          {/* 8 ─ Telemetry ────────────────────────────────────────── */}
          <Section id="telemetry" register={registerSection}>
            <AccordionSection
              defaultOpen
              description={telemetrySummary}
              icon={<SemanticIcon decorative name="activity" size="sm" />}
              title={t('Telemetry pipeline')}>
              <TelemetryPipelineCard
                chargingSessionsCount={backupStats?.row_counts?.charging_sessions}
                drivesCount={drivesCount}
                now={now}
                positionCount={positionCount}
                signalLogCount={backupStats?.row_counts?.signal_log}
                vehicles={vehicles}
              />
            </AccordionSection>
          </Section>

          {/* 8b ─ Tesla auth (dedicated card) ─────────────────────── */}
          <Section id="tesla-auth" register={registerSection}>
            <TeslaAuthCard
              authenticated={auth?.authenticated}
              expiresAt={auth?.expires_at}
              now={now}
            />
          </Section>

          {/* 9 ─ Notifications ────────────────────────────────────── */}
          <Section id="notifications" register={registerSection}>
            <AccordionSection
              badges={
                notifStats?.failed ? (
                  <Badge variant="warning">{`${notifStats.failed} failed`}</Badge>
                ) : undefined
              }
              defaultOpen
              description={notificationsSummary}
              icon={<SemanticIcon decorative name="notifications" size="sm" />}
              title={t('Notifications & audit')}>
              <DefList
                rows={[
                  {
                    label: t('Channels'),
                    value: notifStats
                      ? t('{{enabled}} of {{total}} enabled', {
                          enabled: notifStats.enabled_channels,
                          total: notifStats.total_channels,
                        })
                      : '—',
                  },
                  {
                    label: t('Sent (lifetime)'),
                    value: notifStats ? String(notifStats.total_sent) : '—',
                  },
                  {
                    label: t('Pending'),
                    value: notifStats ? String(notifStats.pending) : '—',
                  },
                  {
                    label: t('Failed'),
                    value: notifStats ? String(notifStats.failed) : '—',
                  },
                ]}
              />
              <DetailLink
                label={t('Open Notifications')}
                onNavigate={handleNavigate}
                to="/notifications"
              />
            </AccordionSection>
          </Section>

          {/* 10 ─ Workers ─────────────────────────────────────────── */}
          <Section id="workers" register={registerSection}>
            <AccordionSection
              badges={<StatusBadge status={workersStatus} />}
              defaultOpen
              description={workersSummary}
              icon={<SemanticIcon decorative name="layoutGrid" size="sm" />}
              title={t('Background workers')}>
              <BackgroundWorkersCard health={workers} />
            </AccordionSection>
          </Section>

          {/* 11 ─ Backups ─────────────────────────────────────────── */}
          <Section id="backups" register={registerSection}>
            <AccordionSection
              badges={
                hasStaleBackup ? (
                  <Badge variant="warning">{t('stale')}</Badge>
                ) : hasNoBackup ? (
                  <Badge variant="warning">{t('none')}</Badge>
                ) : undefined
              }
              defaultOpen
              description={
                lastSuccessfulBackup?.completedAt
                  ? backupStaleDays === 0
                    ? t('Last backup: today')
                    : t('Last backup: {{days}}d ago', { days: backupStaleDays ?? '?' })
                  : (backupConfigs?.length ?? 0) > 0
                    ? t('Configured · no successful run yet')
                    : t('Not configured')
              }
              icon={<SemanticIcon decorative name="hardDrive" size="sm" />}
              title={t('Backups')}>
              {/* web wrapped this DefList in BackupActionsCard; the native barrel
                  placeholder drops children, so the DefList is rendered directly
                  to preserve the backup stats. */}
              <DefList
                rows={[
                  {
                    label: t('Configured schedules'),
                    value: String(backupConfigs?.length ?? 0),
                  },
                  { label: t('Total runs'), value: String(backupRuns?.length ?? 0) },
                  {
                    label: t('Last successful'),
                    value: lastSuccessfulBackup?.completedAt
                      ? formatDateTime(lastSuccessfulBackup.completedAt)
                      : '—',
                  },
                  {
                    label: t('Last successful size'),
                    value: lastSuccessfulBackup?.fileSize
                      ? formatBytes(lastSuccessfulBackup.fileSize)
                      : '—',
                  },
                  {
                    label: t('Failures (recent)'),
                    value: String(
                      (backupRuns ?? []).filter(r => r.status === 'failed').length,
                    ),
                  },
                ]}
              />
            </AccordionSection>
          </Section>

          {/* 12 ─ Tesla API usage ─────────────────────────────────── */}
          <Section id="tesla-api" register={registerSection}>
            <AccordionSection
              badges={
                apiOverBudget ? (
                  <Badge variant="warning">{t('over budget')}</Badge>
                ) : undefined
              }
              defaultOpen
              description={
                apiUsage
                  ? t('{{cost}} of {{credit}} estimated this period', {
                      cost: formatCurrency(apiUsage.estimated_cost),
                      credit: formatCurrency(apiUsage.monthly_credit),
                    })
                  : t('No data')
              }
              icon={<SemanticIcon decorative name="vehicle" size="sm" />}
              title={t('Tesla API usage')}>
              <TeslaApiUsageCard apiUsage={apiUsage} now={now} />
            </AccordionSection>
          </Section>

          {/* 13 ─ Recent errors ───────────────────────────────────── */}
          <Section id="errors" register={registerSection}>
            <AccordionSection
              badges={
                errorStats && errorStats.total_errors > 0 ? (
                  <Badge variant={errorsStatus === 'healthy' ? 'neutral' : 'warning'}>
                    {String(errorStats.total_errors)}
                  </Badge>
                ) : (
                  <Badge variant="success">{t('clean')}</Badge>
                )
              }
              defaultOpen
              description={
                errorStats
                  ? t('{{count}} since {{uptime}} ago', {
                      count: errorStats.total_errors,
                      uptime: errorStats.uptime,
                    })
                  : t('No data')
              }
              icon={<SemanticIcon decorative name="warning" size="sm" />}
              title={t('Recent errors')}>
              {errorStats && Object.keys(errorStats.by_code).length > 0 ? (
                <View style={s.errorList}>
                  {Object.entries(errorStats.by_code)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 10)
                    .map(([code, info]) => (
                      <View key={code} style={s.errorRow}>
                        <AppText style={s.errorCode}>{code}</AppText>
                        <AppText
                          numberOfLines={1}
                          style={s.errorMessage}
                          tone="secondary">
                          {info.last_message || '—'}
                        </AppText>
                        <AppText style={s.errorCount} tone="muted">
                          {String(info.count)}
                        </AppText>
                      </View>
                    ))}
                </View>
              ) : (
                <View style={s.emptyRow}>
                  <SemanticIcon decorative name="archive" size="sm" />
                  <AppText style={s.mutedBody} tone="muted">
                    {t('No errors recorded recently.')}
                  </AppText>
                </View>
              )}
              <DetailLink
                label={t('Open error logs')}
                onNavigate={handleNavigate}
                to="/api-logs?level=error"
              />
              <FrontendErrorsCard />
            </AccordionSection>
          </Section>

          {/* 14 ─ System info ─────────────────────────────────────── */}
          <Section id="system" register={registerSection}>
            <AccordionSection
              defaultOpen
              description={t('Version, build, runtime')}
              icon={<SemanticIcon decorative name="package" size="sm" />}
              title={t('System info')}>
              <SystemInfoRows extHealth={extHealth} version={version} />
            </AccordionSection>
          </Section>

          {/* 15 ─ 30-day uptime heatmap ───────────────────────────── */}
          <Section id="uptime" register={registerSection}>
            <UptimeHeatmap
              days={uptimeDays}
              footnote={t(
                'Today reflects the current status. Day-level historical data ships with the backend health-history endpoint in Phase 2.',
              )}
            />
          </Section>

          {/* 16 ─ SLO tracking ────────────────────────────────────── */}
          <Section id="slo" register={registerSection}>
            <SLOTrackingCard />
          </Section>

          {/* 17 ─ Scheduled maintenance ───────────────────────────── */}
          <Section id="maintenance" register={registerSection}>
            <ScheduledMaintenanceCard now={now} />
          </Section>

          {/* 18 ─ Subscribe / discover channels ───────────────────── */}
          <Section id="subscribe" register={registerSection}>
            <SubscribeCard />
          </Section>

          {/* 19 ─ Status API docs link ────────────────────────────── */}
          <View style={s.apiDocs}>
            <Pressable
              accessibilityRole="link"
              onPress={() => handleNavigate('/docs/status-api')}
              style={({ pressed }) => [s.apiDocsLink, pressed && s.detailLinkPressed]}>
              <AppText style={s.apiDocsText} tone="muted">
                {t('Stable Status API for your own dashboards')} →
              </AppText>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles (web Tailwind/CSS-var classes -> tokens)                    */
/* ------------------------------------------------------------------ */

const s = StyleSheet.create({
  accordion: {
    overflow: 'hidden',
  },
  accordionBadges: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  accordionBody: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  accordionDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  accordionHeadCopy: {
    flex: 1,
    gap: 2,
  },
  accordionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  accordionIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  accordionTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  actionItem: {
    backgroundColor: colors.surfaceRaised,
    borderLeftWidth: 3,
    borderRadius: 10,
    gap: spacing.xs,
    padding: spacing.md,
  },
  actionItemCta: {
    alignItems: 'flex-start',
    marginTop: 2,
  },
  actionItemDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionItemHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionItemList: {
    gap: spacing.sm,
  },
  actionItemTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  apiDocs: {
    alignItems: 'center',
    paddingBottom: spacing.lg,
    paddingTop: spacing.xs,
  },
  apiDocsLink: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  apiDocsText: {
    fontSize: 12,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  btn: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnGhost: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
  btnMd: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnSm: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  btnText: {
    fontSize: 14,
  },
  btnTextGhost: {
    color: colors.textPrimary,
  },
  btnTextPrimary: {
    color: colors.background,
  },
  btnTextSm: {
    fontSize: 13,
  },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipBar: {
    flexGrow: 0,
  },
  chipBarContent: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  chipPressed: {
    backgroundColor: colors.surfaceHover,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 17,
  },
  compList: {
    gap: 2,
  },
  compName: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  compRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  compStatus: {
    fontSize: 12,
    lineHeight: 16,
  },
  defLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  defList: {
    gap: spacing.sm,
  },
  defRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  defValue: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    lineHeight: 18,
    textAlign: 'right',
  },
  detailLink: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  detailLinkPressed: {
    opacity: 0.8,
  },
  detailLinkText: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
  },
  detailLinkWrap: {
    alignItems: 'flex-end',
  },
  emptyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  errorCode: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 16,
  },
  errorCount: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  errorList: {
    gap: 2,
  },
  errorMessage: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  errorRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: spacing.sm,
  },
  healthRow: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  healthRowIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthRowLabel: {
    fontSize: 14,
    lineHeight: 19,
  },
  healthRowList: {
    gap: 2,
  },
  healthRowSummary: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'right',
  },
  heatCell: {
    borderRadius: 3,
    height: 16,
    width: 16,
  },
  heatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  heroCta: {
    alignItems: 'flex-start',
    marginTop: spacing.sm,
  },
  heroHeadline: {
    flex: 1,
    fontSize: 20,
    lineHeight: 26,
  },
  heroPanel: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  heroSubline: {
    fontSize: 13,
    lineHeight: 18,
  },
  heroTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  mutedBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  pageActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  pageHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderCopy: {
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageSubtitle: {
    maxWidth: 520,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  resourceFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 6,
  },
  resourceHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resourceIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  resourceLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  resourceList: {
    gap: spacing.md,
  },
  resourceMeta: {
    fontSize: 11,
    lineHeight: 15,
  },
  resourceRow: {
    gap: 6,
  },
  resourceTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
  },
  resourceValue: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    lineHeight: 18,
    textAlign: 'right',
  },
  resourceValueWrap: {
    alignItems: 'flex-end',
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  section: {
    width: '100%',
  },
  stack: {
    gap: spacing.lg,
  },
  statusBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  statusDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
});
