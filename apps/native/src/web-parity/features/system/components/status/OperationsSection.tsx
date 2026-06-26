// Native parity port of
// web/src/features/system/components/status/OperationsSection.tsx.
//
// OperationsSection — the "Operations" accordion on /system-status: a collapsed
// GlassPanel card that, when expanded, surfaces (a) notification delivery
// health (total sent / failed / success rate / channel coverage metric cards, a
// success-rate RadialGauge, and a recent-notifications table) and (b) the system
// audit trail table. It polls three endpoints via TanStack Query:
//   • getNotificationStats()  -> GET /notifications/stats        (15s refetch)
//   • getNotificationLogs(10,0) -> GET /notifications/logs?limit=10&offset=0 (15s)
//   • getDevtoolsAuditLogs(20) -> GET /system/audit?limit=20     (30s refetch)
// The collapsed header badge shows the live success rate tinted success/warning/
// danger at the 95% / 80% thresholds.
//
// Native-safe substitutions (rules 4-7), documented in the parity sidecar:
//   • react-i18next useTranslation()/t() -> an inline English-default
//     t(key, fallback?) (no i18next provider ships in native): single-arg calls
//     such as t('Status') return the key verbatim, two-arg calls such as
//     t('common.noData', 'No data available') return the fallback — every
//     user-facing English string is preserved (the VersionSegment precedent).
//   • lucide-react Bell/Send/CheckCircle/XCircle/Activity -> the parity
//     SemanticIcon glyphs (notifications 'NO', send 'SN', success 'OK',
//     error 'X', activity 'AC'); the parity bundle ships no lucide/SVG icon set
//     (FrontendErrorsCard glyph precedent).
//   • './AccordionSection' (sibling, not yet ported — its own conversion slot)
//     -> inlined native collapsible: a GlassPanel with a Pressable header
//     (cyan-400 leading glyph, title, description, badge slot, a chevron that
//     rotates 180° when open) that mounts its children only while open, exactly
//     like the web defaultOpen=false accordion (StateBadge inlined-sibling
//     precedent).
//   • './helpers' getStatusIcon/statusTextClass (sibling, not yet ported) ->
//     inlined statusGlyph()/statusColor(): the same lowercase status buckets map
//     to a glyph (OK/!/X) + the literal hex of the web text-{green,amber,red}-400
//     / text-muted classes.
//   • shared web '@/components/ui' Badge -> an inline native Pill (variant +
//     sm size) using the web Badge dark-mode {color}-900/{color}-200 hex pairs.
//   • shared web '@/components/data-display' MetricCard -> an inline native
//     MetricCard (p-3 rounded-xl card, primary value, neon-tinted icon chip).
//   • shared web '@/components/ui' DataTable + Column<T> -> an inline native
//     DataList<T> (header row + divided data rows in a horizontal ScrollView,
//     with the same column.render cell renderers and an empty-message row); the
//     DOM table's pagination / column-menu / resize affordances are browser-only
//     and dropped.
//   • '@/components/layout' Grid cols={{default:2, md:4}} -> a flex-wrap row of
//     two-up metric cards (native phone width == the source's `default:2`).
//   • '@/components/charts' RadialGauge, '@/components/feedback' Skeleton/
//     EmptyState -> their native parity equivalents.
//   • '@/lib/numberFormat' fmtInt/fmtPercent and '@/lib/dateFormat'
//     formatDateTime -> inlined verbatim (safe-number en-US grouping; "—"
//     fallback for missing/invalid timestamps) — the FrontendErrorsCard /
//     SecretRotationPage inlined-formatter precedent.
//   • Tailwind classes + CSS vars + the DOM <div>/<span>/<h4> tree -> RN
//     View/AppText primitives, a StyleSheet, and theme tokens.
// API paths, query keys, refetch intervals, the successRate formula, and the
// notif-stats / audit-log render gates are all preserved verbatim. No DOM
// elements, lucide-react, Recharts, Leaflet, or web UI-kit modules are imported.

import React, {useCallback, useState, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {getAuditLogs as getDevtoolsAuditLogs} from '../../../../api/devtools';
import {getNotificationLogs, getNotificationStats} from '../../../../api/settings';
import type {AuditLog, NotificationLog} from '../../../../api/types';
import {RadialGauge} from '../../../../components/charts/RadialGauge';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {Skeleton} from '../../../../components/feedback/Skeleton';

/* ─── inlined react-i18next t() (English defaults, no native provider) ───── */

// Single-arg t('Status') returns the key (the English copy doubles as the key);
// two-arg t('common.noData', 'No data available') returns the fallback.
function t(key: string, fallback?: string): string {
  return fallback ?? key;
}

/* ─── inlined @/lib/numberFormat fmtInt / fmtPercent ─────────────────────── */

// web numberFormat module default locale (set globally by useSettings). These
// system-status cards never thread settings, so the shipped en-US default holds.
const DEFAULT_LOCALE = 'en-US';

// web safeNumber: nullish / NaN / Infinity -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// web fmtNumber(v, d): locale-grouped fixed-decimal string with the source's
// bad-locale en-US try/catch fallback.
function fmtNumber(v: unknown, decimals: number): string {
  try {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// web fmtInt(v) = fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// web fmtPercent(v, d) = `${fmtNumber(v, d)}%`.
function fmtPercent(v: unknown, decimals: number): string {
  return `${fmtNumber(v, decimals)}%`;
}

/* ─── inlined @/lib/dateFormat formatDateTime ───────────────────────────── */

// web formatDateTime: "Apr 4, 2026, 02:30 AM" with a "—" fallback for
// missing / invalid timestamps.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleString(DEFAULT_LOCALE, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

/* ─── inlined ./helpers getStatusIcon + statusTextClass ─────────────────── */

// web text-green-400 / text-amber-400 / text-red-400 / text-[var(--text-muted)].
const GREEN_400 = '#4ade80';
const AMBER_400 = '#fbbf24';
const RED_400 = '#f87171';

// web getStatusIcon glyphs: CheckCircle -> 'OK', AlertTriangle -> '!',
// XCircle -> 'X' (resolved from the parity SemanticIcon set).
const STATUS_GLYPH_OK = getSemanticIconDefinition('success').glyph;
const STATUS_GLYPH_WARN = getSemanticIconDefinition('alertCircle').glyph;
const STATUS_GLYPH_ERROR = getSemanticIconDefinition('error').glyph;

// web statusTextClass: the same lowercase status buckets -> the literal hex of
// each Tailwind text color.
function statusColor(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return GREEN_400;
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return AMBER_400;
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return RED_400;
    default:
      return colors.textMuted;
  }
}

// web getStatusIcon: the same buckets pick CheckCircle / AlertTriangle /
// XCircle, with AlertTriangle as the default.
function statusGlyph(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return STATUS_GLYPH_OK;
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return STATUS_GLYPH_ERROR;
    default:
      return STATUS_GLYPH_WARN;
  }
}

/* ─── inlined icon glyphs (lucide -> parity SemanticIcon) ────────────────── */

const BELL_GLYPH = getSemanticIconDefinition('notifications').glyph;
const SEND_GLYPH = getSemanticIconDefinition('send').glyph;
const CHECK_GLYPH = getSemanticIconDefinition('success').glyph;
const XCIRCLE_GLYPH = getSemanticIconDefinition('error').glyph;
const ACTIVITY_GLYPH = getSemanticIconDefinition('activity').glyph;

// web AccordionSection leading icon color (text-cyan-400) + chevron color.
const CYAN_400 = '#22d3ee';
// Closed-state chevron glyph; rotated 180° when open (web ChevronDown rotate-180).
const CHEVRON_GLYPH = '\u2304'; // ⌄

/* ─── inlined @/components/ui Badge (variant + sm size) ──────────────────── */

type PillVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

// web Badge dark-mode {color}-900 bg / {color}-200 text hex pairs.
const PILL_COLORS: Record<PillVariant, {bg: string; text: string}> = {
  info: {bg: '#1e3a8a', text: '#bfdbfe'},
  success: {bg: '#14532d', text: '#bbf7d0'},
  warning: {bg: '#713f12', text: '#fef08a'},
  danger: {bg: '#7f1d1d', text: '#fecaca'},
  neutral: {bg: '#374151', text: '#e5e7eb'},
};

function Pill({variant, children}: {variant: PillVariant; children: string}) {
  const c = PILL_COLORS[variant];
  return (
    <View style={[styles.pill, {backgroundColor: c.bg}]}>
      <AppText style={[styles.pillText, {color: c.text}]}>{children}</AppText>
    </View>
  );
}

Pill.displayName = 'Pill';

/* ─── inlined @/components/data-display MetricCard ───────────────────────── */

type MetricColor = 'cyan' | 'red' | 'green' | 'purple';

// web neonColorMap: icon chip bg ({neon}/10) + ring ({neon}/20) + icon text
// color (text-{cyan-300|rose-300|emerald-300|purple-300}).
const METRIC_COLORS: Record<
  MetricColor,
  {chipBg: string; chipRing: string; iconText: string}
> = {
  cyan: {
    chipBg: 'rgba(0, 240, 255, 0.1)',
    chipRing: 'rgba(0, 240, 255, 0.2)',
    iconText: '#67e8f9',
  },
  red: {
    chipBg: 'rgba(239, 68, 68, 0.1)',
    chipRing: 'rgba(239, 68, 68, 0.2)',
    iconText: '#fda4af',
  },
  green: {
    chipBg: 'rgba(16, 185, 129, 0.1)',
    chipRing: 'rgba(16, 185, 129, 0.2)',
    iconText: '#6ee7b7',
  },
  purple: {
    chipBg: 'rgba(168, 85, 247, 0.1)',
    chipRing: 'rgba(168, 85, 247, 0.2)',
    iconText: '#d8b4fe',
  },
};

function MetricCard({
  label,
  value,
  iconGlyph,
  color,
}: {
  label: string;
  value: string;
  iconGlyph: string;
  color: MetricColor;
}) {
  const c = METRIC_COLORS[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricBody}>
        <AppText numberOfLines={1} style={styles.metricLabel}>
          {label}
        </AppText>
        <AppText numberOfLines={1} style={styles.metricValue}>
          {value}
        </AppText>
      </View>
      <View
        style={[
          styles.metricIconChip,
          {backgroundColor: c.chipBg, borderColor: c.chipRing},
        ]}>
        <AppText style={[styles.metricIconGlyph, {color: c.iconText}]}>
          {iconGlyph}
        </AppText>
      </View>
    </View>
  );
}

MetricCard.displayName = 'MetricCard';

/* ─── inlined @/components/ui DataTable (Column<T> + DataTable) ──────────── */

interface NativeColumn<T> {
  key: string;
  header: string;
  width: number;
  render: (row: T) => ReactNode;
}

function DataList<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
}: {
  columns: NativeColumn<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.tableHeaderRow}>
          {columns.map(col => (
            <View key={col.key} style={{width: col.width}}>
              <AppText style={styles.tableHeaderText}>{col.header}</AppText>
            </View>
          ))}
        </View>
        {data.length === 0 ? (
          <AppText style={styles.tableEmpty}>{emptyMessage}</AppText>
        ) : (
          data.map((row, idx) => (
            <View
              key={keyExtractor(row)}
              style={[styles.tableRow, idx > 0 ? styles.tableRowDivided : null]}>
              {columns.map(col => (
                <View key={col.key} style={{width: col.width}}>
                  {col.render(row)}
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

DataList.displayName = 'DataList';

/* ─── inlined ./AccordionSection (native collapsible) ────────────────────── */

function AccordionSection({
  iconGlyph,
  title,
  description,
  badges,
  defaultOpen = false,
  children,
}: {
  iconGlyph: string;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const handleToggle = useCallback(() => setOpen(prev => !prev), []);

  return (
    <View style={styles.accordionPanel}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={handleToggle}
        style={({pressed}) => [
          styles.accordionHeader,
          pressed ? styles.accordionHeaderPressed : null,
        ]}>
        <AppText style={styles.accordionHeaderIcon}>{iconGlyph}</AppText>
        <View style={styles.accordionHeaderText}>
          <AppText style={styles.accordionTitle}>{title}</AppText>
          <AppText style={styles.accordionDescription}>{description}</AppText>
        </View>
        {badges ? <View style={styles.accordionBadges}>{badges}</View> : null}
        <AppText
          style={[styles.accordionChevron, open ? styles.accordionChevronOpen : null]}>
          {CHEVRON_GLYPH}
        </AppText>
      </Pressable>
      {open ? <View style={styles.accordionBody}>{children}</View> : null}
    </View>
  );
}

AccordionSection.displayName = 'AccordionSection';

/* ─── component ──────────────────────────────────────────────────────────── */

export function OperationsSection() {
  const {data: notifStats, isLoading: statsLoading} = useQuery({
    queryKey: ['system-status', 'notification-stats'],
    queryFn: getNotificationStats,
    refetchInterval: 15_000,
  });

  const {data: notifLogs, isLoading: logsLoading} = useQuery({
    queryKey: ['system-status', 'notification-logs'],
    queryFn: () => getNotificationLogs(10, 0),
    refetchInterval: 15_000,
  });

  const {data: auditLogs, isLoading: auditLoading} = useQuery({
    queryKey: ['system-status', 'audit-logs'],
    queryFn: () => getDevtoolsAuditLogs(20),
    refetchInterval: 30_000,
  });

  const isLoading = statsLoading || logsLoading || auditLoading;

  const successRate =
    notifStats && notifStats.total_sent > 0
      ? (notifStats.sent / notifStats.total_sent) * 100
      : 100;

  const notifLogColumns: NativeColumn<NotificationLog>[] = [
    {
      key: 'status',
      header: t('Status'),
      width: 120,
      render: row => (
        <View style={styles.statusCell}>
          <AppText style={[styles.statusGlyph, {color: statusColor(row.status)}]}>
            {statusGlyph(row.status)}
          </AppText>
          <AppText style={[styles.statusText, {color: statusColor(row.status)}]}>
            {row.status}
          </AppText>
        </View>
      ),
    },
    {
      key: 'title',
      header: t('Title'),
      width: 180,
      render: row => (
        <AppText numberOfLines={1} style={styles.cellPrimary}>
          {row.title}
        </AppText>
      ),
    },
    {
      key: 'message',
      header: t('Message'),
      width: 220,
      render: row => (
        <AppText numberOfLines={1} style={styles.cellMuted}>
          {row.message}
        </AppText>
      ),
    },
    {
      key: 'created_at',
      header: t('Time'),
      width: 150,
      render: row => <AppText style={styles.cellPrimary}>{formatDateTime(row.created_at)}</AppText>,
    },
  ];

  const auditColumns: NativeColumn<AuditLog>[] = [
    {
      key: 'created_at',
      header: t('Time'),
      width: 150,
      render: row => <AppText style={styles.cellPrimary}>{formatDateTime(row.created_at)}</AppText>,
    },
    {
      key: 'action',
      header: t('Action'),
      width: 130,
      render: row => <Pill variant="info">{row.action}</Pill>,
    },
    {
      key: 'resource',
      header: t('Resource'),
      width: 150,
      render: row => (
        <AppText numberOfLines={1} style={styles.cellMono}>
          {row.resource}
        </AppText>
      ),
    },
    {
      key: 'details',
      header: t('Details'),
      width: 220,
      render: row => (
        <AppText numberOfLines={1} style={styles.cellMuted}>
          {row.details}
        </AppText>
      ),
    },
  ];

  const headerBadge = notifStats ? (
    <Pill
      variant={
        successRate >= 95 ? 'success' : successRate >= 80 ? 'warning' : 'danger'
      }>
      {`${fmtPercent(successRate, 1)} ${t('success rate')}`}
    </Pill>
  ) : undefined;

  return (
    <AccordionSection
      iconGlyph={BELL_GLYPH}
      title={t('Operations')}
      description={t('Notification delivery and audit trail')}
      badges={headerBadge}>
      {isLoading ? (
        <View style={styles.loadingGroup}>
          <Skeleton height={128} />
          <Skeleton height={192} />
        </View>
      ) : (
        <View style={styles.contentGroup}>
          {notifStats ? (
            <View>
              <AppText style={styles.sectionTitle}>
                {t('Notification Delivery')}
              </AppText>
              <View style={styles.metricGrid}>
                <MetricCard
                  label={t('Total Sent')}
                  value={fmtInt(notifStats.total_sent)}
                  iconGlyph={SEND_GLYPH}
                  color="cyan"
                />
                <MetricCard
                  label={t('Failed')}
                  value={fmtInt(notifStats.failed)}
                  iconGlyph={XCIRCLE_GLYPH}
                  color="red"
                />
                <MetricCard
                  label={t('Success Rate')}
                  value={fmtPercent(successRate, 1)}
                  iconGlyph={CHECK_GLYPH}
                  color="green"
                />
                <MetricCard
                  label={t('Channels')}
                  value={`${notifStats.enabled_channels}/${notifStats.total_channels}`}
                  iconGlyph={BELL_GLYPH}
                  color="purple"
                />
              </View>

              <View style={styles.gaugeRow}>
                <RadialGauge
                  value={successRate}
                  max={100}
                  label={t('Success')}
                  unit="%"
                  color={
                    successRate >= 95
                      ? '#22c55e'
                      : successRate >= 80
                        ? '#f59e0b'
                        : '#ef4444'
                  }
                  size={120}
                />
              </View>

              {notifLogs ? (
                <DataList
                  columns={notifLogColumns}
                  data={notifLogs}
                  keyExtractor={l => l.id}
                  emptyMessage={t('No recent notifications')}
                />
              ) : (
                <EmptyState
                  icon={
                    <AppText style={styles.emptyStateGlyph}>
                      {ACTIVITY_GLYPH}
                    </AppText>
                  }
                  message={t('common.noData', 'No data available')}
                />
              )}
            </View>
          ) : null}

          <View>
            <AppText style={styles.sectionTitle}>{t('Audit Log')}</AppText>
            {auditLogs && auditLogs.length > 0 ? (
              <DataList
                columns={auditColumns}
                data={auditLogs}
                keyExtractor={l => l.id}
                emptyMessage={t('No audit entries')}
              />
            ) : (
              <EmptyState message={t('No audit log entries')} />
            )}
          </View>
        </View>
      )}
    </AccordionSection>
  );
}

OperationsSection.displayName = 'OperationsSection';

const styles = StyleSheet.create({
  // ── AccordionSection ──
  // GlassPanel overflow-hidden.
  accordionPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surfaceGlass,
    overflow: 'hidden',
  },
  // flex items-center gap-3 px-5 py-4
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  // hover:bg-white/[0.02] -> pressed feedback.
  accordionHeaderPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  // text-cyan-400 shrink-0
  accordionHeaderIcon: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: CYAN_400,
  },
  // flex-1 min-w-0
  accordionHeaderText: {
    flex: 1,
    flexShrink: 1,
  },
  // text-sm font-semibold text-[var(--text-primary)]
  accordionTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  // text-xs text-[var(--text-muted)] mt-0.5
  accordionDescription: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  // flex items-center gap-2 shrink-0
  accordionBadges: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // h-4 w-4 text-[var(--text-muted)] (rotates 180° when open)
  accordionChevron: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 16,
    color: colors.textMuted,
  },
  accordionChevronOpen: {
    transform: [{rotate: '180deg'}],
  },
  // border-t border-white/[0.06] px-5 py-4 space-y-4
  accordionBody: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },

  // ── loading / content groups ──
  // space-y-4
  loadingGroup: {
    gap: 16,
  },
  // space-y-6
  contentGroup: {
    gap: 24,
  },
  // text-sm font-semibold text-[var(--text-primary)] mb-3
  sectionTitle: {
    marginBottom: spacing.md,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  // ── metric grid (Grid cols default:2, gap-3) ──
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: 16,
  },

  // ── MetricCard ──
  // p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]
  metricCard: {
    flexGrow: 1,
    flexBasis: '46%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  // flex-1 min-w-0
  metricBody: {
    flex: 1,
    flexShrink: 1,
  },
  // metric-label mb-1 text-[10px]
  metricLabel: {
    marginBottom: spacing.xs,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  // text-xl font-bold tracking-tight text-[var(--text-primary)]
  metricValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  // rounded-lg p-1.5 ring-1 shrink-0
  metricIconChip: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 6,
    minWidth: 28,
  },
  metricIconGlyph: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── RadialGauge row (flex justify-center mb-4) ──
  gaugeRow: {
    alignItems: 'center',
    marginBottom: 16,
  },

  // ── Pill (Badge variant + sm) ──
  // rounded-full px-1.5 py-0.5 text-xs font-medium
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },

  // ── DataList (table) ──
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  tableHeaderText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.4,
    color: colors.textMuted,
    paddingRight: spacing.sm,
  },
  // compact rows
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  tableRowDivided: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  tableEmpty: {
    paddingVertical: 16,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },

  // ── table cells ──
  statusCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  statusGlyph: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  statusText: {
    fontSize: 12,
    lineHeight: 16,
  },
  // text-[var(--text-primary)]
  cellPrimary: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
    paddingRight: spacing.sm,
  },
  // text-xs text-[var(--text-muted)]
  cellMuted: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    paddingRight: spacing.sm,
  },
  // font-mono text-xs
  cellMono: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
    paddingRight: spacing.sm,
  },

  // ── EmptyState Activity icon (h-8 w-8 opacity-20) ──
  emptyStateGlyph: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: colors.textMuted,
    opacity: 0.4,
  },
});
