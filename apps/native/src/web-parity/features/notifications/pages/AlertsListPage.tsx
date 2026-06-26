// Native parity port of web/src/features/notifications/pages/AlertsListPage.tsx.
//
// AlertsListPage — the alert-entity list: a six-KPI overview card (with
// prior-period deltas), a 7-day alert-trend chart, an alerts-by-type chart, a
// "Watching" pinned-rules section, a search + tab + active-chip filter bar, the
// paginated alert list, an Acknowledge dialog, and an audit-timeline detail
// modal. The History/Preferences tabs of the old AlertsPage are intentionally
// gone (web L7-9).
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Badge, Button, TabNav, PinButton, PrintButton, SavedViewMenu, KpiOverviewCard,
// MetricCard, DataFreshnessAuto, EmptyState, Skeleton, InlineCallout, FadeIn,
// Stagger*, Modal), the Recharts BarChart/PieChart trees, the forms kit
// (SearchInput/FilterBar/ActiveFilterChips/RangePicker), lucide icons via
// @/lib/icons, react-i18next, the URL-state hooks (useUrlEnum/useUrlString/
// useUrlNumber/useSavedViewUrl/useRangeState), useToast, usePageTitle,
// useDateFormat, and the @/lib helpers (fmtInt, CHART_COLORS, priorPeriod,
// useFilteredList) plus the admin AcknowledgeAlertDialog / AlertDetailTimeline
// and the local AlertCard. React Native has no DOM, no Recharts/SVG, no
// Tailwind, no lucide, no react-router URL state, no localStorage, no wired
// react-i18next and no browser document.title, so this port reproduces the same
// behaviour with RN primitives + the established native parity building blocks:
//
//   - PageContainer (title/subtitle/actions + a loading gate) -> an inline
//     ScrollView scaffold: a persistent header (title + subtitle + quiet-hours
//     badge + range preset pills) plus a body. usePageTitle(t('Alerts')) sets the
//     browser tab title, which has no native analogue, so the same translated
//     string is surfaced as the on-screen header (documented in the sidecar).
//   - useUrlEnum/useUrlString/useUrlNumber (filter / alertSearch / alertPage)
//     have no native router; they become useState preserving the exact names,
//     defaults and the "reset page to 1 on filter/search/range change" behaviour.
//   - useRangeState({ persistKey:'alerts.range', defaultPresetId:'all' }) reads
//     URL + localStorage on web; native has neither, so an in-memory range with
//     the same 'all' default ('2015-01-01' .. today, verbatim from
//     lib/datePresets) is used, and the RangePicker becomes native preset pills
//     (All / 30d / 7d / Today) wired to the same setRange + page-reset contract.
//   - The Recharts 7-day stacked BarChart (critical/warning/info per weekday) ->
//     a native per-day stacked horizontal bar with the same three series colours
//     and a legend; the alerts-by-type PieChart -> the same legend list (dot +
//     name + count) the web renders beside the pie, each row carrying a
//     proportion bar. Both preserve their data keys and the EmptyState intent.
//   - KpiOverviewCard + 6 MetricCards (with direction-aware <Delta>) -> a native
//     overview GlassPanel: header (title + period + comparison labels), a 6-tile
//     grid each reproducing the web Delta logic (percent/absolute, lower_better/
//     higher_better/neutral colouring, ↑/↓/→ arrow), a secondary line (Active
//     Rules / Most Common / Last 7 Days / Quiet hours active) and a danger
//     callout footer when criticalCount > 0.
//   - AlertCard (../components/AlertCard, not yet converted) is inlined as a
//     native card preserving severity tokens, the type→icon map, getTimeAgo, the
//     acked badge, and the audit-timeline / acknowledge / reopen / mark-read
//     actions. Its drill-through <Link> has no native router, so "View context"
//     is a static affordance (documented).
//   - AcknowledgeAlertDialog (admin, not yet converted) is inlined as an RN Modal
//     with a multiline note TextInput preserving NOTE_MAX=1000 + the tooLong gate.
//   - AlertDetailTimeline is the already-converted native component, imported.
//   - SavedViewMenu / PrintButton / DataFreshnessAuto / PinButton are browser-only
//     (saved-view URL, window.print, live freshness, drag-pin); the first three
//     are omitted and the pin is reproduced with the native useTogglePin unpin
//     mutation (documented).
//   - useToast: the web page's extra toast.info/toast.toast(undo) calls are
//     redundant on native because the useMarkAlertRead / useAcknowledgeAlert hooks
//     already surface their own success toast; the acknowledge "Undo" action is
//     preserved by the per-row Reopen affordance the card already renders.
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     that preserves every t('key', 'Default', { count/max/actor }) verbatim and
//     reproduces i18next {{var}} interpolation.
//
// State names (filter, alertSearch, alertPage, ackDialogId, detailId, quietHours),
// every API path (via the unchanged native hooks), the range filter, the
// tab/search/page derivations, the prior-period delta maths, the alertsByType /
// alertsByDay aggregations and the isQuietHoursActive predicate are preserved
// verbatim. No DOM, Recharts, Leaflet, react-router, lucide-react, framer-motion,
// or old web UI components are imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type DimensionValue,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {AlertDetailTimeline} from '../../admin/components/AlertDetailTimeline';
import {
  useAcknowledgeAlert as useAcknowledgeAlertHook,
  useAlertDetail as useAlertDetailHook,
  useAlertRules,
  useAlerts,
  useMarkAlertRead,
  useReopenAlert as useReopenAlertHook,
} from '../../../api/hooks/useNotifications';
import {usePinned, useTogglePin} from '../../../api/hooks/usePinned';
import {useSettings} from '../../../api/hooks/useSettings';
import type {Alert, AlertRule} from '../../../api/types';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

// react-i18next is not wired in native; i18next returns the supplied default (or
// the key itself when no default is given) when a translation is missing, so the
// fallback returns the English default while keeping every key verbatim and
// reproducing i18next's {{var}} interpolation.
type TOptions = {count?: number; max?: number; actor?: string};
type TFunc = (key: string, fallback?: string, options?: TOptions) => string;

function interpolate(template: string, options: TOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = options[name as keyof TOptions];
    return value === undefined ? '' : String(value);
  });
}

const t: TFunc = (key, fallback, options) => {
  const base = fallback ?? key;
  return options ? interpolate(base, options) : base;
};

/* ─── Inlined @/lib helpers (no native equivalent) ────────────────────── */

type AlertSeverity = 'info' | 'warning' | 'critical';

// CB-safe Okabe-Ito palette — verbatim from web lib/colors.CHART_COLORS.
const CHART_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

// Recharts stacked-bar series colours, verbatim from web (these are chart-value
// colours, not theme tokens, so they are kept as literal hex).
const SERIES_COLORS = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#00f0ff',
} as const;

// Mirrors web lib/numberFormat: safeNumber + fmtNumber + fmtInt. Locale comes
// from useSettings (web sets it globally via useSettings -> setGlobalLocale).
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function formatNumber(value: number, locale: string, decimals: number): string {
  const n = safeNumber(value);
  try {
    return n.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// Mirrors web lib/drivesAggregation.priorPeriod (UTC-based, verbatim).
function ymdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) {
    return null;
  }
  const [, ys, ms, ds] = m;
  return Date.UTC(Number(ys), Number(ms) - 1, Number(ds));
}

function utcMillisToYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function priorPeriod(
  startDate: string | undefined,
  endDate: string | undefined,
): {start: string; end: string} | null {
  if (!startDate || !endDate) {
    return null;
  }
  const startMs = ymdToUtcMillis(startDate);
  const endMs = ymdToUtcMillis(endDate);
  if (startMs == null || endMs == null) {
    return null;
  }
  const lengthDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  const priorEndMs = startMs - 86_400_000;
  const priorStartMs = priorEndMs - (lengthDays - 1) * 86_400_000;
  return {
    start: utcMillisToYmd(priorStartMs),
    end: utcMillisToYmd(priorEndMs),
  };
}

/* ─── In-memory range state (web useRangeState, default preset 'all') ──── */

interface RangeValue {
  start: string;
  end: string;
}
type RangePresetId = 'today' | '7d' | '30d' | 'all';

// Local YYYY-MM-DD, mirroring lib/datePresets.iso (local date, not UTC).
function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Verbatim from web lib/datePresets resolve() bodies for these ids; 'all' uses
// resolveAllTimeStart()'s '2015-01-01' baseline.
function resolveRangePreset(id: RangePresetId, now: Date = new Date()): RangeValue {
  switch (id) {
    case 'today':
      return {start: isoLocal(now), end: isoLocal(now)};
    case '7d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return {start: isoLocal(s), end: isoLocal(now)};
    }
    case '30d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return {start: isoLocal(s), end: isoLocal(now)};
    }
    case 'all':
    default:
      return {start: '2015-01-01', end: isoLocal(now)};
  }
}

/* ─── Quiet hours (web localStorage 'teslasync-quiet-hours') ──────────── */

interface QuietHours {
  start: string;
  end: string;
  enabled: boolean;
}

// localStorage is unavailable on native (AsyncStorage is not wired here); the
// web read of 'teslasync-quiet-hours' falls through to the same default object.
function loadQuietHours(): QuietHours {
  return {start: '22:00', end: '07:00', enabled: false};
}

// Verbatim from web.
function isQuietHoursActive(qh: QuietHours): boolean {
  if (!qh.enabled) {
    return false;
  }
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`;
  if (qh.start <= qh.end) {
    return hhmm >= qh.start && hhmm < qh.end;
  }
  return hhmm >= qh.start || hhmm < qh.end;
}

/* ─── Severity tokens (web lib/tokens.normalizeSeverity + severityTokens) ─ */

type Severity = 'info' | 'warn' | 'critical' | 'success';

function normalizeSeverity(s: string | null | undefined): Severity {
  if (!s) {
    return 'info';
  }
  const v = s.toLowerCase();
  if (v === 'warning') {
    return 'warn';
  }
  if (v === 'error' || v === 'fatal') {
    return 'critical';
  }
  if (v === 'ok' || v === 'success') {
    return 'success';
  }
  if (v === 'info' || v === 'warn' || v === 'critical') {
    return v as Severity;
  }
  return 'info';
}

interface SeverityVisual {
  fg: string;
  border: string;
  surface: string;
}

const SEVERITY_VISUALS: Record<Severity, SeverityVisual> = {
  info: {
    fg: colors.accent,
    border: colors.borderAccent,
    surface: colors.surfaceSelected,
  },
  warn: {
    fg: colors.warning,
    border: colors.warningBorder,
    surface: colors.warningSurface,
  },
  critical: {
    fg: colors.danger,
    border: colors.dangerBorder,
    surface: colors.dangerSurface,
  },
  success: {
    fg: colors.success,
    border: colors.successBorder,
    surface: colors.successSurface,
  },
};

// Verbatim from web AlertCard.getTimeAgo.
function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

// web AlertCard TYPE_ICONS (lucide) -> native SemanticIcon names.
const TYPE_ICONS: Record<string, SemanticIconName> = {
  geofence_exit: 'location',
  geofence_enter: 'location',
  low_battery: 'battery',
  battery_low: 'battery',
  battery_high: 'battery',
  charging_complete: 'charging',
  charging_cost: 'charging',
  sentry_event: 'security',
  speed_limit: 'speed',
  temperature: 'climate',
  software_update: 'settingsAlt',
  vampire_drain: 'trendDown',
  tire_pressure_low: 'droplets',
  idle_unlocked: 'locked',
  efficiency_drop: 'analytics',
  system_database: 'database',
  system_mqtt: 'wifi',
  system_redis: 'hardDrive',
  system_tesla_api: 'radio',
  system_worker: 'efficiency',
};

/* ─── Prior-period Delta (web data-display Delta logic) ───────────────── */

type Direction = 'higher_better' | 'lower_better' | 'neutral';

interface DeltaInput {
  direction: Direction;
  previous: number;
  current: number;
  display: 'percent' | 'absolute';
}

function colorForDelta(direction: Direction, signedDelta: number): string {
  if (signedDelta === 0) {
    return colors.textMuted;
  }
  if (direction === 'neutral') {
    return colors.textSecondary;
  }
  const positiveOutcome =
    (direction === 'higher_better' && signedDelta > 0) ||
    (direction === 'lower_better' && signedDelta < 0);
  return positiveOutcome ? colors.success : colors.danger;
}

function MetricDelta({
  delta,
  locale,
  precision,
}: {
  delta: DeltaInput;
  locale: string;
  precision: number;
}) {
  const {direction, previous, current, display} = delta;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return (
      <AppText variant="caption" tone="muted">
        —
      </AppText>
    );
  }
  const signedDelta = current - previous;
  const canPercent = previous !== 0;
  const signedPct = canPercent ? (signedDelta / Math.abs(previous)) * 100 : null;
  const color = colorForDelta(direction, signedDelta);
  const arrow = signedDelta > 0 ? '↑' : signedDelta < 0 ? '↓' : '→';
  const absDelta = Math.abs(signedDelta);
  const absPct = signedPct == null ? null : Math.abs(signedPct);

  const absText = formatNumber(absDelta, locale, precision);
  const pctText = absPct == null ? null : `${formatNumber(absPct, locale, 1)}%`;
  const valueText = display === 'absolute' ? absText : pctText ?? '—';

  return (
    <View style={styles.deltaRow}>
      <AppText variant="caption" weight="semibold" style={{color}}>
        {arrow} {valueText}
      </AppText>
    </View>
  );
}

/* ─── KPI tile (web data-display MetricCard) ──────────────────────────── */

type TileColor = 'cyan' | 'red' | 'amber' | 'purple' | 'green';

const TILE_DOT: Record<TileColor, string> = {
  cyan: colors.accent,
  red: colors.danger,
  amber: colors.warning,
  purple: colors.violet,
  green: colors.success,
};

function MetricTile({
  label,
  value,
  color,
  delta,
  locale,
  precision,
}: {
  label: string;
  value: string;
  color: TileColor;
  delta?: DeltaInput;
  locale: string;
  precision: number;
}) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileLabelRow}>
        <View style={[styles.tileDot, {backgroundColor: TILE_DOT[color]}]} />
        <AppText
          variant="caption"
          tone="muted"
          weight="semibold"
          numberOfLines={1}
          style={styles.tileLabel}>
          {label}
        </AppText>
      </View>
      <AppText variant="title" weight="bold" numberOfLines={1}>
        {value}
      </AppText>
      {delta ? (
        <MetricDelta delta={delta} locale={locale} precision={precision} />
      ) : null}
    </View>
  );
}

/* ─── Native chart stand-ins ──────────────────────────────────────────── */

function pct(value: number, max: number): DimensionValue {
  if (max <= 0) {
    return '0%' as DimensionValue;
  }
  return `${Math.max(Math.min((value / max) * 100, 100), 0)}%` as DimensionValue;
}

function ChartLegend({items}: {items: {label: string; color: string}[]}) {
  return (
    <View style={styles.legend}>
      {items.map(item => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, {backgroundColor: item.color}]} />
          <AppText variant="caption" tone="secondary">
            {item.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

interface DayDatum {
  day: string;
  info: number;
  warning: number;
  critical: number;
}

// Native stand-in for the Recharts 7-day stacked BarChart: one row per weekday
// with a stacked critical/warning/info bar scaled to the busiest day's total.
function AlertTrendChart({data}: {data: DayDatum[]}) {
  const maxTotal = Math.max(
    ...data.map(d => d.critical + d.warning + d.info),
    1,
  );
  return (
    <View style={styles.chartBody}>
      <ChartLegend
        items={[
          {label: t('Critical'), color: SERIES_COLORS.critical},
          {label: t('Warning'), color: SERIES_COLORS.warning},
          {label: t('Info'), color: SERIES_COLORS.info},
        ]}
      />
      <View style={styles.dayRows}>
        {data.map(d => {
          const total = d.critical + d.warning + d.info;
          return (
            <View key={d.day} style={styles.dayRow}>
              <AppText variant="caption" tone="muted" style={styles.dayLabel}>
                {d.day}
              </AppText>
              <View style={styles.dayTrack}>
                {d.critical > 0 ? (
                  <View
                    style={[
                      styles.daySeg,
                      {
                        width: pct(d.critical, maxTotal),
                        backgroundColor: SERIES_COLORS.critical,
                      },
                    ]}
                  />
                ) : null}
                {d.warning > 0 ? (
                  <View
                    style={[
                      styles.daySeg,
                      {
                        width: pct(d.warning, maxTotal),
                        backgroundColor: SERIES_COLORS.warning,
                      },
                    ]}
                  />
                ) : null}
                {d.info > 0 ? (
                  <View
                    style={[
                      styles.daySeg,
                      {
                        width: pct(d.info, maxTotal),
                        backgroundColor: SERIES_COLORS.info,
                      },
                    ]}
                  />
                ) : null}
              </View>
              <AppText variant="caption" style={styles.dayCount}>
                {total}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface TypeDatum {
  name: string;
  value: number;
  fill: string;
}

// Native stand-in for the Recharts PieChart + its side legend: the same dot +
// name + count list the web renders, with a proportion bar for visual intent.
function AlertsByTypeChart({data}: {data: TypeDatum[]}) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <View style={styles.typeRows}>
      {data.map((d, i) => (
        <View key={`${d.name}-${i}`} style={styles.typeRow}>
          <View style={[styles.legendDot, {backgroundColor: d.fill}]} />
          <AppText
            variant="caption"
            tone="secondary"
            numberOfLines={1}
            style={styles.typeName}>
            {d.name}
          </AppText>
          <View style={styles.typeTrack}>
            <View
              style={[
                styles.typeFill,
                {width: pct(d.value, max), backgroundColor: d.fill},
              ]}
            />
          </View>
          <AppText variant="caption" weight="semibold" style={styles.typeValue}>
            {d.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/* ─── Native AlertCard (web ../components/AlertCard) ───────────────────── */

interface AlertCardProps {
  alert: Alert;
  onMarkRead: () => void;
  onAcknowledge: () => void;
  onOpenDetail: () => void;
  onReopen: () => void;
}

function AlertCard({
  alert,
  onMarkRead,
  onAcknowledge,
  onOpenDetail,
  onReopen,
}: AlertCardProps) {
  const sev = normalizeSeverity(alert.severity);
  const visual = SEVERITY_VISUALS[sev];
  const iconName = TYPE_ICONS[alert.type] ?? 'notifications';
  const timeAgo = getTimeAgo(alert.created_at);
  const isAcked = Boolean(alert.acknowledged_at);
  const unread = !alert.is_read;

  return (
    <GlassPanel
      style={[
        styles.alertCard,
        unread ? {borderColor: visual.border} : undefined,
      ]}>
      <View style={styles.alertCardTop}>
        <View
          style={[
            styles.alertIcon,
            {borderColor: visual.border, backgroundColor: visual.surface},
          ]}>
          <SemanticIcon name={iconName} size="sm" decorative />
        </View>
        <View style={styles.alertBody}>
          <View style={styles.alertTitleRow}>
            <AppText
              weight="semibold"
              tone={unread ? 'primary' : 'secondary'}
              numberOfLines={2}
              style={styles.alertTitle}>
              {alert.title}
            </AppText>
            {unread ? (
              <View
                accessible
                accessibilityLabel={t('Unread')}
                style={[styles.unreadDot, {backgroundColor: visual.fg}]}
              />
            ) : null}
          </View>
          <AppText variant="caption" tone="muted" numberOfLines={2}>
            {alert.message}
          </AppText>
        </View>
      </View>

      <View style={styles.alertMeta}>
        <AppText variant="caption" tone="muted">
          {timeAgo}
        </AppText>
        <View
          style={[
            styles.sevChip,
            {borderColor: visual.border, backgroundColor: visual.surface},
          ]}>
          <AppText variant="caption" weight="semibold" style={{color: visual.fg}}>
            {alert.severity}
          </AppText>
        </View>
        <AppText variant="caption" tone="muted">
          {(alert.type ?? 'notification').replace(/_/g, ' ')}
        </AppText>
        {isAcked ? (
          <View style={[styles.ackChip]}>
            <AppText
              variant="caption"
              weight="semibold"
              style={{color: colors.success}}>
              {alert.acknowledged_by
                ? t('alerts.ack.ackedBy', 'Acknowledged by {{actor}}', {
                    actor: alert.acknowledged_by,
                  })
                : t('alerts.ack.ackedByAnonymous', 'Acknowledged')}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.alertActions}>
        {/* web drill-through <Link to={drillHref}>; native has no router, so the
            "View context" affordance is static (documented). */}
        <AppText variant="caption" tone="accent" style={styles.viewContext}>
          {t('alerts.viewContext', 'View context')} ›
        </AppText>
        <CardButton
          label={t('alerts.timeline.title', 'Audit timeline')}
          onPress={onOpenDetail}
        />
        {isAcked ? (
          <CardButton
            label={t('alerts.timeline.kindAnonymous.reopened', 'Reopened')}
            onPress={onReopen}
          />
        ) : (
          <CardButton
            label={t('alerts.ack.button', 'Acknowledge')}
            onPress={onAcknowledge}
          />
        )}
        {unread ? (
          <CardButton label={t('Mark read')} onPress={onMarkRead} />
        ) : null}
      </View>
    </GlassPanel>
  );
}

// Ghost-style native button used for the AlertCard row actions + pagination
// (web @/components/ui/Button variant="ghost" size="sm").
function CardButton({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.cardButton,
        disabled ? styles.cardButtonDisabled : undefined,
        pressed && !disabled ? styles.cardButtonPressed : undefined,
      ]}>
      <AppText
        variant="caption"
        weight="semibold"
        tone={disabled ? 'muted' : 'secondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── Native AcknowledgeAlertDialog (web admin component) ──────────────── */

const NOTE_MAX = 1000;

function AcknowledgeAlertDialog({
  open,
  onClose,
  onSubmit,
  submitting = false,
  alertTitle,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
  submitting?: boolean;
  alertTitle?: string;
}) {
  const [note, setNote] = useState('');

  // Reset the note whenever the dialog reopens (web useEffect on `open`).
  React.useEffect(() => {
    if (open) {
      setNote('');
    }
  }, [open]);

  const trimmed = note.trim();
  const tooLong = trimmed.length > NOTE_MAX;

  const handleSubmit = () => {
    if (submitting || tooLong) {
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!submitting) {
          onClose();
        }
      }}>
      <View style={styles.modalBackdrop}>
        <GlassPanel style={styles.modalCard}>
          <AppText variant="title" weight="bold">
            {t('alerts.ack.dialogTitle', 'Acknowledge alert')}
          </AppText>
          {alertTitle ? (
            <AppText variant="caption" tone="secondary">
              {alertTitle}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="muted" weight="semibold">
            {t('alerts.ack.noteLabel', 'Note (optional)')}
          </AppText>
          <TextInput
            value={note}
            onChangeText={setNote}
            editable={!submitting}
            multiline
            numberOfLines={4}
            placeholder={t(
              'alerts.ack.notePlaceholder',
              "Optional: what's being done?",
            )}
            placeholderTextColor={colors.textMuted}
            maxLength={NOTE_MAX + 50}
            style={[styles.textArea, tooLong ? styles.textAreaError : undefined]}
          />
          <AppText variant="caption" tone={tooLong ? 'danger' : 'muted'}>
            {t(
              'alerts.ack.noteHint',
              'Up to {{max}} characters. Shared in the audit timeline.',
              {max: NOTE_MAX},
            )}
          </AppText>
          <View style={styles.modalActions}>
            <CardButton
              label={t('alerts.ack.cancel', 'Cancel')}
              onPress={onClose}
              disabled={submitting}
            />
            <Pressable
              accessibilityRole="button"
              disabled={submitting || tooLong}
              onPress={handleSubmit}
              style={({pressed}) => [
                styles.primaryButton,
                submitting || tooLong
                  ? styles.cardButtonDisabled
                  : undefined,
                pressed && !(submitting || tooLong)
                  ? styles.cardButtonPressed
                  : undefined,
              ]}>
              <AppText weight="semibold" style={styles.primaryButtonText}>
                {t('alerts.ack.submit', 'Acknowledge')}
              </AppText>
            </Pressable>
          </View>
        </GlassPanel>
      </View>
    </Modal>
  );
}

/* ─── Range preset pills (web RangePicker) ────────────────────────────── */

function RangePresets({
  active,
  onSelect,
}: {
  active: RangePresetId | null;
  onSelect: (id: RangePresetId) => void;
}) {
  const options: {id: RangePresetId; label: string}[] = [
    {id: 'all', label: t('date.preset.all', 'All time')},
    {id: '30d', label: t('date.preset.last30', 'Last 30 days')},
    {id: '7d', label: t('date.preset.last7', 'Last 7 days')},
    {id: 'today', label: t('date.preset.today', 'Today')},
  ];
  return (
    <View style={styles.pillRow} testID="alerts-range">
      {options.map(opt => {
        const selected = opt.id === active;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            style={[styles.pill, selected ? styles.pillSelected : undefined]}>
            <AppText
              variant="caption"
              weight={selected ? 'semibold' : 'regular'}
              tone={selected ? 'accent' : 'secondary'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── Pinned-rule row (web PinButton unpin via useTogglePin) ──────────── */

function PinnedRuleRow({rule}: {rule: AlertRule}) {
  const togglePin = useTogglePin('alert_rule');
  return (
    <View style={styles.pinnedRow}>
      <View style={styles.pinnedRuleInfo}>
        <AppText weight="semibold" numberOfLines={1} style={styles.pinnedName}>
          {rule.name || `${t('alerts.rule', 'Rule')} #${rule.id}`}
        </AppText>
        <View
          style={[
            styles.statusChip,
            rule.enabled ? styles.statusChipOn : styles.statusChipOff,
          ]}>
          <AppText
            variant="caption"
            weight="semibold"
            style={{
              color: rule.enabled ? colors.success : colors.textMuted,
            }}>
            {rule.enabled
              ? t('common.enabled', 'Enabled')
              : t('common.disabled', 'Disabled')}
          </AppText>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('pinned.unpin', 'Unpin')}
        onPress={() =>
          togglePin.mutate({itemId: String(rule.id), pin: false})
        }
        style={styles.pinButton}>
        <SemanticIcon name="star" size="sm" decorative />
      </Pressable>
    </View>
  );
}

/* ─── Main component ──────────────────────────────────────────────────── */

export default function AlertsListPage() {
  // usePageTitle(t('Alerts')) sets the browser tab title on web; no native
  // analogue, so the same translated string is the on-screen header.
  const {data: settings} = useSettings();
  const locale =
    settings?.locale && settings.locale.trim() ? settings.locale : 'en-US';
  const precision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const fmtInt = useCallback(
    (v: number) => formatNumber(v, locale, 0),
    [locale],
  );

  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all');
  const [alertSearch, setAlertSearch] = useState('');
  const [alertPage, setAlertPage] = useState(1);
  const alertsPerPage = 20;

  const alertsQuery = useAlerts();
  const {data: rawAlerts, isLoading, error} = alertsQuery;

  // web useRangeState({ persistKey:'alerts.range', defaultPresetId:'all' }); native
  // is in-memory with the same 'all' default and a preset id for the pill UI.
  const [rangePreset, setRangePreset] = useState<RangePresetId>('all');
  const [range, setRangeValue] = useState<RangeValue>(() =>
    resolveRangePreset('all'),
  );
  const {start, end} = range;
  const setRange = useCallback((next: RangeValue) => {
    setRangeValue(next);
  }, []);

  const alerts = useMemo(() => {
    if (!rawAlerts?.length) {
      return rawAlerts;
    }
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return rawAlerts.filter(a => {
      if (!a.created_at) {
        return false;
      }
      const ts = new Date(a.created_at).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [rawAlerts, start, end]);

  const {data: rules} = useAlertRules();
  const markReadMut = useMarkAlertRead();
  const ackMut = useAcknowledgeAlertHook();
  const reopenMut = useReopenAlertHook();
  const [ackDialogId, setAckDialogId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailQuery = useAlertDetailHook(detailId, {enabled: detailId !== null});
  const ackTarget = useMemo(
    () => alerts?.find(a => a.id === ackDialogId) ?? null,
    [alerts, ackDialogId],
  );
  const {data: rulePins = []} = usePinned('alert_rule');
  const pinnedRules = useMemo(() => {
    if (!rules || rulePins.length === 0) {
      return [];
    }
    const order = new Map<string, number>();
    rulePins.forEach(p => order.set(String(p.item_id), p.position));
    return rules
      .filter(r => order.has(String(r.id)))
      .sort(
        (a, b) =>
          (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0),
      );
  }, [rules, rulePins]);

  const tabFilteredAlerts = useMemo(
    () =>
      alerts?.filter(a => {
        if (filter === 'unread') {
          return !a.is_read;
        }
        if (filter === 'critical') {
          return a.severity === 'critical';
        }
        return true;
      }) ?? [],
    [alerts, filter],
  );

  // web useFilteredList(tabFilteredAlerts, alertSearch, ['title','message']).
  const filteredAlerts = useMemo(() => {
    const q = alertSearch.trim().toLowerCase();
    if (!q) {
      return tabFilteredAlerts;
    }
    return tabFilteredAlerts.filter(a =>
      [a.title, a.message].some(v =>
        String(v ?? '')
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [tabFilteredAlerts, alertSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / alertsPerPage));
  const safeAlertPage = Math.min(alertPage, totalPages);
  const pagedAlerts = filteredAlerts.slice(
    (safeAlertPage - 1) * alertsPerPage,
    safeAlertPage * alertsPerPage,
  );

  const totalCount = alerts?.length ?? 0;
  const unreadCount = useMemo(
    () => alerts?.filter(a => !a.is_read).length ?? 0,
    [alerts],
  );
  const criticalCount = useMemo(
    () => alerts?.filter(a => a.severity === 'critical' && !a.is_read).length ?? 0,
    [alerts],
  );
  const infoCount = useMemo(
    () => alerts?.filter(a => (a.severity ?? 'info') === 'info').length ?? 0,
    [alerts],
  );
  const warningCount = useMemo(
    () => alerts?.filter(a => a.severity === 'warning').length ?? 0,
    [alerts],
  );
  const readCount = useMemo(
    () => alerts?.filter(a => a.is_read === true).length ?? 0,
    [alerts],
  );
  const enabledRules = rules?.filter(r => r.enabled).length ?? 0;
  const readRatePct =
    totalCount > 0 ? Math.round((readCount / totalCount) * 100) : null;

  /* ── Prior-period stats for KPI deltas ──────────────────────── */
  const prior = useMemo(() => priorPeriod(start, end), [start, end]);
  const priorAlerts = useMemo(() => {
    if (!rawAlerts?.length || !prior) {
      return [];
    }
    const startMs = new Date(`${prior.start}T00:00:00`).getTime();
    const endMs = new Date(`${prior.end}T23:59:59.999`).getTime();
    return rawAlerts.filter(a => {
      if (!a.created_at) {
        return false;
      }
      const ts = new Date(a.created_at).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [rawAlerts, prior]);
  const priorTotal = priorAlerts.length;
  const priorUnread = useMemo(
    () => priorAlerts.filter(a => !a.is_read).length,
    [priorAlerts],
  );
  const priorCritical = useMemo(
    () =>
      priorAlerts.filter(a => a.severity === 'critical' && !a.is_read).length,
    [priorAlerts],
  );
  const priorWarning = useMemo(
    () => priorAlerts.filter(a => a.severity === 'warning').length,
    [priorAlerts],
  );
  const priorInfo = useMemo(
    () => priorAlerts.filter(a => (a.severity ?? 'info') === 'info').length,
    [priorAlerts],
  );
  const priorRead = useMemo(
    () => priorAlerts.filter(a => a.is_read === true).length,
    [priorAlerts],
  );
  const priorReadRatePct =
    priorTotal > 0 ? Math.round((priorRead / priorTotal) * 100) : null;
  const priorHasData = priorTotal > 0;
  const periodLabel = `${start} – ${end}`;
  const priorLabel = prior ? `vs ${prior.start} – ${prior.end}` : undefined;

  const alertsByType = useMemo<TypeDatum[]>(() => {
    if (!alerts?.length) {
      return [];
    }
    const counts: Record<string, number> = {};
    alerts.forEach(a => {
      const key = a.type ?? 'notification';
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count], i) => ({
        name: (type ?? 'notification').replace(/_/g, ' '),
        value: count,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [alerts]);

  const alertsByDay = useMemo<DayDatum[]>(() => {
    if (!alerts?.length) {
      return [];
    }
    const days: Record<
      string,
      {info: number; warning: number; critical: number}
    > = {};
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = new Intl.DateTimeFormat(locale, {weekday: 'short'}).format(d);
      days[key] = {info: 0, warning: 0, critical: 0};
    }
    alerts.forEach(a => {
      const d = new Date(a.created_at);
      if (now - d.getTime() > 7 * 86400000) {
        return;
      }
      const key = new Intl.DateTimeFormat(locale, {weekday: 'short'}).format(d);
      const sev = a.severity as AlertSeverity;
      if (days[key] && (sev === 'info' || sev === 'warning' || sev === 'critical')) {
        days[key][sev]++;
      }
    });
    return Object.entries(days).map(([day, v]) => ({day, ...v}));
  }, [alerts, locale]);

  const weekAlertCount = useMemo(
    () => alertsByDay.reduce((s, d) => s + d.info + d.warning + d.critical, 0),
    [alertsByDay],
  );

  const [quietHours] = useState<QuietHours>(loadQuietHours);
  const quietActive = isQuietHoursActive(quietHours);

  const handleMarkRead = useCallback(
    (id: number) => {
      // web: markReadMut.mutate(String(id), { onSuccess: toast.info(...) }).
      // The native useMarkAlertRead hook already surfaces the success toast, so
      // the page-level toast is redundant and dropped.
      markReadMut.mutate(String(id));
    },
    [markReadMut],
  );

  const handleAcknowledgeSubmit = useCallback(
    (note: string) => {
      if (ackDialogId === null) {
        return;
      }
      const id = ackDialogId;
      setAckDialogId(null);
      // web wrapped this in toast.toast({ action: { label:'Undo', onClick:
      // reopenMut.mutate(id) } }); the native useAcknowledgeAlert hook toasts on
      // success and the per-row Reopen affordance preserves the Undo capability.
      ackMut.mutate({id, note});
    },
    [ackDialogId, ackMut],
  );

  const handleReopen = useCallback(
    (id: number) => {
      reopenMut.mutate(id);
    },
    [reopenMut],
  );

  const onSelectPreset = useCallback(
    (id: RangePresetId) => {
      setRangePreset(id);
      setRange(resolveRangePreset(id));
      if (alertPage !== 1) {
        setAlertPage(1);
      }
    },
    [alertPage, setRange],
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="alerts-list-page">
      {/* Header (web PageContainer title/subtitle/actions) */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <AppText variant="title" weight="bold">
            {t('Alerts')}
          </AppText>
          {quietActive ? (
            <View style={styles.infoBadge}>
              <AppText
                variant="caption"
                weight="semibold"
                style={{color: colors.accent}}>
                {t('Quiet hours')}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" tone="secondary">
          {t('alerts.subtitle', 'Live alert events from your fleet')}
        </AppText>
        <RangePresets active={rangePreset} onSelect={onSelectPreset} />
      </View>

      {error ? (
        <GlassPanel style={styles.panel}>
          <EmptyState
            title={t('Error')}
            message={(error as Error)?.message ?? t('Error')}
          />
        </GlassPanel>
      ) : null}

      {/* Overview KPI card OR empty state (web KpiOverviewCard) */}
      {totalCount > 0 || priorHasData ? (
        <GlassPanel style={styles.panel} testID="alerts-overview">
          <View style={styles.overviewHeader}>
            <AppText weight="semibold">{t('alerts.overview', 'Overview')}</AppText>
            <View style={styles.overviewLabels}>
              <AppText variant="caption" tone="muted">
                {periodLabel}
              </AppText>
              {priorLabel ? (
                <AppText variant="caption" tone="muted">
                  {priorLabel}
                </AppText>
              ) : null}
            </View>
          </View>

          <View style={styles.tileGrid}>
            <MetricTile
              label={t('Total')}
              value={fmtInt(totalCount)}
              color="cyan"
              locale={locale}
              precision={precision}
              delta={
                priorHasData
                  ? {
                      direction: 'neutral',
                      previous: priorTotal,
                      current: totalCount,
                      display: 'percent',
                    }
                  : undefined
              }
            />
            <MetricTile
              label={t('Critical')}
              value={fmtInt(criticalCount)}
              color="red"
              locale={locale}
              precision={precision}
              delta={
                priorHasData
                  ? {
                      direction: 'lower_better',
                      previous: priorCritical,
                      current: criticalCount,
                      display: 'percent',
                    }
                  : undefined
              }
            />
            <MetricTile
              label={t('Warnings')}
              value={fmtInt(warningCount)}
              color="amber"
              locale={locale}
              precision={precision}
              delta={
                priorHasData
                  ? {
                      direction: 'lower_better',
                      previous: priorWarning,
                      current: warningCount,
                      display: 'percent',
                    }
                  : undefined
              }
            />
            <MetricTile
              label={t('Info')}
              value={fmtInt(infoCount)}
              color="cyan"
              locale={locale}
              precision={precision}
              delta={
                priorHasData
                  ? {
                      direction: 'neutral',
                      previous: priorInfo,
                      current: infoCount,
                      display: 'percent',
                    }
                  : undefined
              }
            />
            <MetricTile
              label={t('Unread')}
              value={fmtInt(unreadCount)}
              color="purple"
              locale={locale}
              precision={precision}
              delta={
                priorHasData
                  ? {
                      direction: 'lower_better',
                      previous: priorUnread,
                      current: unreadCount,
                      display: 'percent',
                    }
                  : undefined
              }
            />
            <MetricTile
              label={t('alerts.readRate', 'Read rate')}
              value={readRatePct != null ? `${readRatePct}%` : '—'}
              color="green"
              locale={locale}
              precision={precision}
              delta={
                priorHasData && readRatePct != null && priorReadRatePct != null
                  ? {
                      direction: 'higher_better',
                      previous: priorReadRatePct,
                      current: readRatePct,
                      display: 'absolute',
                    }
                  : undefined
              }
            />
          </View>

          {/* secondary line (web KpiOverviewCard secondary slot) */}
          <View style={styles.secondaryLine}>
            <AppText variant="caption" tone="muted">
              {/* web <a href="/notifications/studio">; static on native. */}
              {t('Active Rules')}{' '}
              <AppText variant="caption" tone="secondary">
                {enabledRules}/{rules?.length ?? 0}
              </AppText>{' '}
              →
            </AppText>
            <AppText variant="caption" tone="muted">
              ·
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('Most Common')}:{' '}
              <AppText variant="caption" tone="secondary">
                {alertsByType[0]?.name ?? '—'}
              </AppText>
            </AppText>
            <AppText variant="caption" tone="muted">
              ·
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('Last 7 Days')}:{' '}
              <AppText variant="caption" tone="secondary">
                {fmtInt(weekAlertCount)}
              </AppText>
            </AppText>
            {quietActive ? (
              <>
                <AppText variant="caption" tone="muted">
                  ·
                </AppText>
                <AppText variant="caption" style={{color: colors.warning}}>
                  {t('Quiet hours active')}
                </AppText>
              </>
            ) : null}
          </View>

          {/* footer danger callout (web InlineCallout) */}
          {criticalCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFilter('critical');
                setAlertPage(1);
              }}
              style={styles.callout}>
              <SemanticIcon name="alertCircle" size="sm" decorative />
              <AppText
                variant="caption"
                style={[styles.calloutText, {color: colors.danger}]}>
                {t(
                  'alerts.criticalCallout',
                  '{{count}} critical alert needs attention',
                  {count: criticalCount},
                )}
              </AppText>
              <AppText variant="caption" weight="semibold" tone="accent">
                {t('alerts.viewCritical', 'View critical')}
              </AppText>
            </Pressable>
          ) : null}
        </GlassPanel>
      ) : (
        <GlassPanel style={styles.panel}>
          <View style={styles.emptyWrap}>
            <SemanticIcon name="notificationsMuted" size="md" decorative />
            <EmptyState
              title={t('No alerts')}
              message={t(
                'alerts.noAlertsInRange',
                'No alerts in this range. Your fleet is running smoothly.',
              )}
            />
          </View>
        </GlassPanel>
      )}

      {/* Charts (web BarChart + PieChart), only when there is data */}
      {totalCount > 0 ? (
        <View style={styles.chartGrid}>
          <GlassPanel style={styles.panel}>
            <View style={styles.chartTitleRow}>
              <SemanticIcon name="notifications" size="sm" decorative />
              <AppText weight="semibold">{t('Alert Trend (7 Days)')}</AppText>
            </View>
            <AlertTrendChart data={alertsByDay} />
          </GlassPanel>

          <GlassPanel style={styles.panel}>
            <View style={styles.chartTitleRow}>
              <SemanticIcon name="filter" size="sm" decorative />
              <AppText weight="semibold">{t('Alerts by Type')}</AppText>
            </View>
            {alertsByType.length > 0 ? (
              <AlertsByTypeChart data={alertsByType} />
            ) : (
              <EmptyState
                title={t('Alerts by Type')}
                message={t('No alerts')}
              />
            )}
          </GlassPanel>
        </View>
      ) : null}

      {/* Pinned rules — "Watching" (web pinnedRules section) */}
      {pinnedRules.length > 0 ? (
        <GlassPanel style={styles.panel}>
          <View style={styles.watchingHeader}>
            <SemanticIcon name="notifications" size="sm" decorative />
            <AppText
              variant="caption"
              weight="semibold"
              style={[styles.watchingLabel, {color: colors.warning}]}>
              {t('pinned.section.watching', 'Watching')}
            </AppText>
            <AppText variant="caption" tone="muted">
              ({pinnedRules.length})
            </AppText>
          </View>
          <View style={styles.pinnedList}>
            {pinnedRules.map(rule => (
              <PinnedRuleRow key={rule.id} rule={rule} />
            ))}
          </View>
        </GlassPanel>
      ) : null}

      {/* Filter bar: search + tabs + active chips (web FilterBar) */}
      <View style={styles.filterBar}>
        <TextInput
          value={alertSearch}
          onChangeText={v => {
            setAlertSearch(v);
            setAlertPage(1);
          }}
          placeholder={t(
            'alerts.searchPlaceholder',
            'Search by title or message…',
          )}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          testID="alerts-search"
        />
        <View style={styles.tabRow}>
          <SemanticIcon name="filter" size="sm" decorative />
          {(
            [
              {key: 'all' as const, label: `${t('All')} (${totalCount})`},
              {key: 'unread' as const, label: `${t('Unread')} (${unreadCount})`},
              {
                key: 'critical' as const,
                label: `${t('Critical')} (${criticalCount})`,
              },
            ]
          ).map(tab => {
            const selected = filter === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => {
                  setFilter(tab.key);
                  setAlertPage(1);
                }}
                style={[styles.tab, selected ? styles.tabSelected : undefined]}
                testID={`alerts-tab-${tab.key}`}>
                <AppText
                  variant="caption"
                  weight={selected ? 'semibold' : 'regular'}
                  tone={selected ? 'accent' : 'secondary'}>
                  {tab.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Active filter chips (web ActiveFilterChips) */}
      {alertSearch || filter !== 'all' ? (
        <View style={styles.chipRow}>
          {alertSearch ? (
            <Pressable
              onPress={() => {
                setAlertSearch('');
                setAlertPage(1);
              }}
              style={styles.chip}>
              <AppText variant="caption" tone="secondary">
                {t('alerts.filterLabel.search', 'Search')}: {alertSearch} ✕
              </AppText>
            </Pressable>
          ) : null}
          {filter !== 'all' ? (
            <Pressable
              onPress={() => {
                setFilter('all');
                setAlertPage(1);
              }}
              style={styles.chip}>
              <AppText variant="caption" tone="secondary">
                {t('alerts.filterLabel.status', 'Status')}:{' '}
                {filter === 'unread' ? t('Unread') : t('Critical')} ✕
              </AppText>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              setAlertSearch('');
              setFilter('all');
              setAlertPage(1);
            }}
            style={styles.chip}>
            <AppText variant="caption" tone="muted">
              {t('Clear all', 'Clear all')}
            </AppText>
          </Pressable>
        </View>
      ) : null}

      {/* Alert list (web Skeleton / StaggerContainer / EmptyState) */}
      {isLoading ? (
        <View style={styles.skeletonList} testID="alerts-loading">
          {[1, 2, 3, 4, 5].map(i => (
            <View key={i} style={styles.skeletonCard} />
          ))}
        </View>
      ) : filteredAlerts.length > 0 ? (
        <View testID="alerts-list">
          <View style={styles.alertList}>
            {pagedAlerts.map(a => (
              <AlertCard
                key={a.id}
                alert={a}
                onMarkRead={() => handleMarkRead(a.id)}
                onAcknowledge={() => setAckDialogId(a.id)}
                onReopen={() => handleReopen(a.id)}
                onOpenDetail={() => setDetailId(a.id)}
              />
            ))}
          </View>

          {totalPages > 1 ? (
            <View style={styles.pagination}>
              <AppText variant="caption" tone="muted">
                {`Showing ${(safeAlertPage - 1) * alertsPerPage + 1}–${Math.min(
                  safeAlertPage * alertsPerPage,
                  filteredAlerts.length,
                )} of ${filteredAlerts.length}`}
              </AppText>
              <View style={styles.pageControls}>
                <CardButton
                  label="«"
                  disabled={safeAlertPage <= 1}
                  onPress={() => setAlertPage(1)}
                />
                <CardButton
                  label="‹"
                  disabled={safeAlertPage <= 1}
                  onPress={() => setAlertPage(Math.max(1, safeAlertPage - 1))}
                />
                <AppText variant="caption" tone="secondary">
                  {safeAlertPage} / {totalPages}
                </AppText>
                <CardButton
                  label="›"
                  disabled={safeAlertPage >= totalPages}
                  onPress={() =>
                    setAlertPage(Math.min(totalPages, safeAlertPage + 1))
                  }
                />
                <CardButton
                  label="»"
                  disabled={safeAlertPage >= totalPages}
                  onPress={() => setAlertPage(totalPages)}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <GlassPanel style={styles.panel}>
          <View style={styles.emptyWrap}>
            <SemanticIcon name="notificationsMuted" size="md" decorative />
            <EmptyState
              title={t('No alerts')}
              message={
                alertSearch
                  ? t('No alerts match your search.')
                  : filter === 'all'
                  ? t('Your fleet is running smoothly. Alerts will appear here.')
                  : t(`No ${filter} alerts right now.`)
              }
            />
          </View>
        </GlassPanel>
      )}

      {/* Acknowledge dialog (web AcknowledgeAlertDialog) */}
      <AcknowledgeAlertDialog
        open={ackDialogId !== null}
        onClose={() => setAckDialogId(null)}
        onSubmit={handleAcknowledgeSubmit}
        submitting={ackMut.isPending}
        alertTitle={ackTarget?.title}
      />

      {/* Audit timeline detail modal (web Modal + AlertDetailTimeline) */}
      <Modal
        visible={detailId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailId(null)}>
        <View style={styles.modalBackdrop}>
          <GlassPanel style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <AppText variant="title" weight="bold">
                {t('alerts.timeline.title', 'Audit timeline')}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Close', 'Close')}
                onPress={() => setDetailId(null)}
                style={styles.modalClose}>
                <SemanticIcon name="close" size="sm" decorative />
              </Pressable>
            </View>
            {detailQuery.isLoading ? (
              <View style={styles.skeletonCardTall} />
            ) : detailQuery.data ? (
              <View style={styles.detailBody}>
                <View>
                  <AppText weight="semibold">{detailQuery.data.title}</AppText>
                  <AppText variant="caption" tone="muted">
                    {detailQuery.data.message}
                  </AppText>
                </View>
                <AlertDetailTimeline events={detailQuery.data.events} />
              </View>
            ) : (
              <View style={styles.emptyWrap}>
                <SemanticIcon name="notifications" size="sm" decorative />
                <EmptyState
                  title={t('alerts.timeline.empty', 'No events yet')}
                  message={t('alerts.timeline.empty', 'No events yet')}
                />
              </View>
            )}
          </GlassPanel>
        </View>
      </Modal>
    </ScrollView>
  );
}

AlertsListPage.displayName = 'AlertsListPage';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    rowGap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    rowGap: spacing.sm,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  infoBadge: {
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  panel: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  /* overview */
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  overviewLabels: {
    alignItems: 'flex-end',
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 14,
    padding: spacing.md,
    rowGap: 2,
  },
  tileLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.xs,
  },
  tileDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  tileLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flexShrink: 1,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  secondaryLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 14,
    padding: spacing.md,
  },
  calloutText: {
    flex: 1,
  },
  emptyWrap: {
    alignItems: 'center',
    rowGap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  /* charts */
  chartGrid: {
    rowGap: spacing.lg,
  },
  chartTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  chartBody: {
    rowGap: spacing.md,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  dayRows: {
    rowGap: spacing.sm,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  dayLabel: {
    width: 40,
  },
  dayTrack: {
    flex: 1,
    flexDirection: 'row',
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  daySeg: {
    height: '100%',
  },
  dayCount: {
    width: 28,
    textAlign: 'right',
  },
  typeRows: {
    rowGap: spacing.sm,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  typeName: {
    width: 96,
    flexShrink: 1,
  },
  typeTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  typeFill: {
    height: '100%',
    borderRadius: 999,
  },
  typeValue: {
    width: 32,
    textAlign: 'right',
  },
  /* pinned */
  watchingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  watchingLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  pinnedList: {
    rowGap: spacing.sm,
  },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  pinnedRuleInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  pinnedName: {
    flexShrink: 1,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusChipOn: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  statusChipOff: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  pinButton: {
    padding: spacing.xs,
  },
  /* filter bar */
  filterBar: {
    rowGap: spacing.sm,
  },
  searchInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  tab: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  tabSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  /* alert list */
  skeletonList: {
    rowGap: spacing.sm,
  },
  skeletonCard: {
    height: 80,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
  },
  skeletonCardTall: {
    height: 128,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
  },
  alertList: {
    rowGap: spacing.sm,
  },
  alertCard: {
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  alertCardTop: {
    flexDirection: 'row',
    columnGap: spacing.md,
  },
  alertIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBody: {
    flex: 1,
    rowGap: 2,
  },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing.sm,
  },
  alertTitle: {
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 6,
  },
  alertMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  sevChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  ackChip: {
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  alertActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  viewContext: {
    marginRight: 'auto',
  },
  cardButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardButtonDisabled: {
    opacity: 0.45,
  },
  cardButtonPressed: {
    opacity: 0.8,
  },
  /* pagination */
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingTop: spacing.md,
  },
  pageControls: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.xs,
  },
  /* modals */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 16, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalClose: {
    padding: spacing.xs,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: spacing.sm,
  },
  detailBody: {
    rowGap: spacing.md,
  },
  textArea: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  textAreaError: {
    borderColor: colors.dangerBorder,
  },
  primaryButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  /* range pills */
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pillSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
});
