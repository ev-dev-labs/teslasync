// Native parity port of
// web/src/features/system/components/status/BackendStatusSection.tsx.
//
// BackendStatusSection is one collapsible card in the System Status page. It
// fetches extended health (component table), the DB connection pool, and the
// runtime version info, then renders three stacked sections inside an
// AccordionSection:
//   1. Component Health  — a DataTable (status / component / latency / failures /
//      last-check), with a header Badge counting how many components are healthy.
//   2. Database Connection Pool — a 5-up Grid of StatCards (max-open / open /
//      in-use / idle / wait-count).
//   3. System Runtime — a 2-column KVList (Go version / uptime / goroutines /
//      OS-arch), preferring the dedicated /system/version response and falling
//      back to the extended-health `system` block.
//
// Web -> native adaptations (documented in the sidecar):
//   - react-i18next `useTranslation` (web L1) has no native wiring, so a local
//     `useT()` shim returns the English default (the key itself when no fallback
//     is given — i18next's missing-key behaviour) and interpolates `{{var}}`
//     placeholders. Every web key (which here doubles as the English copy:
//     'Status', 'Backend Status', 'healthy', 'Max Open', …) is preserved.
//     (the DlqInspectorPanels idiom.)
//   - The two NOT-yet-converted siblings are reproduced inline, not imported:
//       * `./AccordionSection` (web L13) -> an inline <AccordionSection> built on
//         the shared native GlassPanel + a Pressable header (Enter/Space key
//         handling has no native analog; tap toggles), a rotating '▾' caret, and
//         a conditional body. `defaultOpen`, the `open` state, and the
//         icon/title/description/badges contract are preserved.
//       * `./helpers` getStatusIcon / statusTextClass / formatUptime (web L14):
//         statusTextClass's Tailwind `text-{green,amber,red}-400` map to their
//         literal hexes (#4ade80 / #fbbf24 / #f87171), the default
//         `text-[var(--text-muted)]` -> colors.textMuted; getStatusIcon's
//         lucide CheckCircle/AlertTriangle/XCircle (h-4 w-4) -> a small status
//         dot in the same colour (the StatusDot idiom — SemanticIcon's boxed
//         glyph is sized for headers, not inline cells); formatUptime is ported
//         verbatim. getStatusColor / formatBytes / statusToBadgeVariant are NOT
//         imported by the web source and so are intentionally not reproduced.
//   - The shared web ui (web L4-7) is reproduced inline with native primitives:
//       * `Grid` (web L4) -> the CONVERTED shared native Grid (imported).
//       * `Badge` (web L5) -> an inline <Badge> pill (success/warning tints).
//       * `DataTable` + `Column` (web L5) -> an inline generic <DataTable>: a
//         horizontally-scrollable header + rows table with press-to-sort on the
//         `sortable` columns (name/latency/failures); `tableId`/`pagination` are
//         accepted but fold into native scrolling, `emptyMessage` -> EmptyState.
//       * `StatCard` (web L6) -> an inline <StatCard> (label + value + a
//         SemanticIcon, matching the web label/value/icon shape).
//       * `KVList` (web L6) -> an inline <KVList> (columns=2 wrap of
//         label/value rows with a hairline divider).
//       * `Skeleton` (web L7) -> an inline static <Skeleton> box (no pulse —
//         an Animated.loop risks --detectOpenHandles leaks; the LiveControls
//         precedent).
//   - `fmtNumber`/`fmtInt` (web L8) are inlined: safeNumber (0 for nullish /
//     non-finite) -> toFixed(decimals) -> en-US thousands grouping, locale-
//     independent so it never depends on Hermes Intl (the DlqInspector fmtInt
//     idiom, extended to decimals for the "x.x ms" latency cell).
//   - `formatDateTime` (web L9, @/lib/dateFormat) is inlined as a native-safe
//     absolute formatter ("Mon D, YYYY, HH:MM" in device-local time, '—' for
//     null/invalid); the web's locale/timezone settings are not wired on native
//     (the DlqInspector TimeStamp idiom).
//   - `cn` (web L10) is dropped — className merges resolve to RN style arrays.
//   - lucide `Server/Database/Activity/Clock/Gauge` (web L3) -> the shared
//     native SemanticIcon glyph set: server/database/activity/clock and
//     Gauge -> 'speed' (the closest gauge/meter analog; SemanticIcon has no
//     'gauge').
//
// The real data hooks are called UNCHANGED, so every API path is preserved:
//   - useQuery({ queryKey: ['system-status','extended-health'], queryFn:
//     getExtendedHealth, refetchInterval: 30_000 })  -> GET /dev-tools/extended-health
//   - useConnectionPool()                            -> GET /dev-tools/runtime-info
//   - useQuery({ queryKey: ['system-status','version'], queryFn: getVersionInfo,
//     refetchInterval: 60_000 })                     -> GET /system/version
// State names (open), the componentRows / componentColumns / okCount derivations,
// the snake_case response fields (latency_ms, consecutive_failures, last_check,
// go_version, uptime_seconds, goroutines, os, arch) and the section order are
// preserved. No DOM, Recharts, Leaflet, lucide-react, react-i18next, @/lib/cn,
// or old web ui components are imported — only RN primitives + the shared native
// AppText/GlassPanel/EmptyState/SemanticIcon/Grid + theme tokens.

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {Grid} from '../../../../components/layout/Grid';
import {useConnectionPool} from '../../../../api/hooks/useAdmin';
import {getExtendedHealth, getVersionInfo} from '../../../../api/devtools';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type TVars = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, vars?: TVars) => string;

// react-i18next is not wired in native. i18next returns the key itself when a
// translation is missing, so this shim returns the supplied English default (or
// the key) and applies {{var}} interpolation — preserving every web key + copy.
function useT(): TFunc {
  return useCallback((key: string, fallback?: string, vars?: TVars) => {
    let out = fallback ?? key;
    if (vars) {
      for (const varKey of Object.keys(vars)) {
        out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
      }
    }
    return out;
  }, []);
}

/* ─── Pure helpers (inlined from web @/lib/numberFormat + @/lib/dateFormat) ── */

// Mirrors web fmtNumber: safeNumber (0 for nullish / non-finite) -> fixed to
// `decimals` -> en-US thousands grouping. Locale-independent (no Intl dependency).
function fmtNumber(v: unknown, decimals = 2): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fracPart ? `${grouped}.${fracPart}` : grouped;
  return n < 0 ? `-${body}` : body;
}

// Mirrors web fmtInt -> fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Native-safe analog of web formatDateTime (@/lib/dateFormat): null/invalid ->
// '—'; otherwise an absolute "Mon D, YYYY, HH:MM" in device-local time. The
// web's locale/timezone settings are not wired on native.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const mon = MONTHS_SHORT[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${mon} ${d.getDate()}, ${d.getFullYear()}, ${hh}:${mm}`;
}

// Ported verbatim from web helpers.formatUptime.
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

// Status colour family backing web helpers.statusTextClass: Tailwind
// text-{green,amber,red}-400 -> their literal hexes; the default
// text-[var(--text-muted)] -> the theme muted token.
const STATUS_GREEN_400 = '#4ade80';
const STATUS_AMBER_400 = '#fbbf24';
const STATUS_RED_400 = '#f87171';

function statusTextColor(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return STATUS_GREEN_400;
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return STATUS_AMBER_400;
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return STATUS_RED_400;
    default:
      return colors.textMuted;
  }
}

/* ─── Inline DataTable column contract (mirrors web @/components/ui Column) ── */

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

interface ComponentRow {
  name: string;
  status: string;
  latency_ms: number;
  failures: number;
  lastCheck: string;
}

/* ─── Inline shared-ui replacements ───────────────────────────────────── */

// web @/components/feedback/Skeleton -> a static placeholder box (no pulse).
function Skeleton({height}: {height: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

type BadgeVariant = 'success' | 'warning';

// web @/components/ui Badge (size="sm") -> a tinted pill.
function Badge({variant, label}: {variant: BadgeVariant; label: string}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText variant="caption" weight="semibold" style={badgeTextStyles[variant]}>
        {label}
      </AppText>
    </View>
  );
}

// web getStatusIcon (h-4 w-4 lucide) -> a small status dot in the status colour.
function StatusDot({status}: {status: string}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.statusDot, {backgroundColor: statusTextColor(status)}]}
    />
  );
}

// web @/components/data-display StatCard (label + value + icon).
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: SemanticIconName;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardHeader}>
        <AppText variant="caption" tone="muted" weight="semibold" style={styles.statCardLabel}>
          {label}
        </AppText>
        <SemanticIcon name={icon} size="sm" decorative />
      </View>
      <AppText variant="title" weight="bold">
        {value}
      </AppText>
    </View>
  );
}

interface KVItem {
  label: string;
  value: ReactNode;
}

// web @/components/data-display KVList (columns=2).
function KVList({items}: {items: KVItem[]}) {
  return (
    <View style={styles.kvList}>
      {items.map(item => (
        <View key={item.label} style={styles.kvItem}>
          <AppText variant="caption" tone="muted" style={styles.kvLabel}>
            {item.label}
          </AppText>
          {typeof item.value === 'string' || typeof item.value === 'number' ? (
            <AppText variant="caption" weight="semibold" style={styles.kvValue}>
              {item.value}
            </AppText>
          ) : (
            item.value
          )}
        </View>
      ))}
    </View>
  );
}

const SORT_ASC_GLYPH = '\u25B4'; // ▴
const SORT_DESC_GLYPH = '\u25BE'; // ▾

// web @/components/ui DataTable -> a horizontally-scrollable, sortable table.
function DataTable<T>({
  columns,
  data,
  keyExtractor,
  compact,
  emptyMessage,
}: {
  tableId: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  compact?: boolean;
  pagination?: boolean;
  emptyMessage: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const onSort = useCallback(
    (key: string) => {
      setSortKey(prev => {
        if (prev === key) {
          setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
          return prev;
        }
        setSortDir('asc');
        return key;
      });
    },
    [],
  );

  const rows = useMemo(() => {
    if (!sortKey) {
      return data;
    }
    const sorted = [...data];
    sorted.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [data, sortKey, sortDir]);

  if (data.length === 0) {
    return <EmptyState title={emptyMessage} message="" />;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.tableHeaderRow}>
          {columns.map(col => {
            const active = sortKey === col.key;
            const headerNode = (
              <View style={styles.headerCellInner}>
                <AppText variant="caption" tone="muted" weight="semibold">
                  {col.header}
                </AppText>
                {active ? (
                  <AppText variant="caption" tone="muted">
                    {sortDir === 'asc' ? SORT_ASC_GLYPH : SORT_DESC_GLYPH}
                  </AppText>
                ) : null}
              </View>
            );
            if (col.sortable) {
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{selected: active}}
                  key={col.key}
                  onPress={() => onSort(col.key)}
                  style={[styles.cell, compact && styles.cellCompact]}
                  testID={`backend-components-sort-${col.key}`}>
                  {headerNode}
                </Pressable>
              );
            }
            return (
              <View key={col.key} style={[styles.cell, compact && styles.cellCompact]}>
                {headerNode}
              </View>
            );
          })}
        </View>

        {rows.map(row => (
          <View key={keyExtractor(row)} style={styles.tableRow}>
            {columns.map(col => {
              const content = col.render(row);
              return (
                <View key={col.key} style={[styles.cell, compact && styles.cellCompact]}>
                  {typeof content === 'string' || typeof content === 'number' ? (
                    <AppText variant="caption" style={styles.cellText}>
                      {content}
                    </AppText>
                  ) : (
                    content
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// web ./AccordionSection -> an inline collapsible GlassPanel.
function AccordionSection({
  icon,
  title,
  description,
  badges,
  defaultOpen = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const handleToggle = useCallback(() => setOpen(prev => !prev), []);

  return (
    <GlassPanel style={styles.accordion}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={handleToggle}
        style={({pressed}) => [styles.accordionHeader, pressed && styles.accordionHeaderPressed]}
        testID="backend-status-accordion-header">
        <View style={styles.accordionIcon}>{icon}</View>
        <View style={styles.accordionHeaderText}>
          <AppText weight="semibold" style={styles.accordionTitle}>
            {title}
          </AppText>
          <AppText variant="caption" tone="muted" style={styles.accordionDescription}>
            {description}
          </AppText>
        </View>
        {badges ? <View style={styles.accordionBadges}>{badges}</View> : null}
        <AppText
          accessible={false}
          allowFontScaling={false}
          style={[styles.accordionCaret, open && styles.accordionCaretOpen]}>
          {SORT_DESC_GLYPH}
        </AppText>
      </Pressable>
      {open ? <View style={styles.accordionBody}>{children}</View> : null}
    </GlassPanel>
  );
}

/* ─── BackendStatusSection ────────────────────────────────────────────── */

export function BackendStatusSection() {
  const t = useT();

  const {data: extHealth, isLoading: extLoading} = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });

  const {data: pool, isLoading: poolLoading} = useConnectionPool();

  const {data: version} = useQuery({
    queryKey: ['system-status', 'version'],
    queryFn: getVersionInfo,
    refetchInterval: 60_000,
  });

  const isLoading = extLoading || poolLoading;

  const componentRows: ComponentRow[] = extHealth
    ? Object.entries(extHealth.components).map(([name, c]) => ({
        name,
        status: c.status,
        latency_ms: c.latency_ms ?? 0,
        failures: c.consecutive_failures ?? 0,
        lastCheck: c.last_check ?? '',
      }))
    : [];

  const componentColumns: Column<ComponentRow>[] = [
    {
      key: 'status',
      header: t('Status'),
      render: row => (
        <View style={styles.statusCell}>
          <StatusDot status={row.status} />
          <AppText variant="caption" style={{color: statusTextColor(row.status)}}>
            {row.status}
          </AppText>
        </View>
      ),
    },
    {
      key: 'name',
      header: t('Component'),
      sortable: true,
      render: row => (
        <AppText variant="caption" weight="semibold">
          {row.name}
        </AppText>
      ),
    },
    {
      key: 'latency_ms',
      header: t('Latency'),
      sortable: true,
      render: row => `${fmtNumber(row.latency_ms, 1)} ms`,
    },
    {
      key: 'failures',
      header: t('Failures'),
      sortable: true,
      render: row => (
        <AppText variant="caption" style={row.failures > 0 ? styles.failText : undefined}>
          {fmtInt(row.failures)}
        </AppText>
      ),
    },
    {
      key: 'lastCheck',
      header: t('Last Check'),
      render: row => (row.lastCheck ? formatDateTime(row.lastCheck) : '—'),
    },
  ];

  const okCount = componentRows.filter(
    r => r.status === 'ok' || r.status === 'healthy',
  ).length;

  return (
    <AccordionSection
      icon={<SemanticIcon name="server" size="sm" decorative />}
      title={t('Backend Status')}
      description={t('Component health, database pool, and runtime info')}
      badges={
        componentRows.length > 0 ? (
          <Badge
            variant={okCount === componentRows.length ? 'success' : 'warning'}
            label={`${okCount}/${componentRows.length} ${t('healthy')}`}
          />
        ) : undefined
      }
      defaultOpen>
      {isLoading ? (
        <View style={styles.loadingStack}>
          <Skeleton height={192} />
          <Skeleton height={128} />
        </View>
      ) : (
        <View style={styles.sectionStack}>
          <View>
            <AppText weight="semibold" style={styles.subheading}>
              {t('Component Health')}
            </AppText>
            <DataTable
              tableId="system:backend-components"
              columns={componentColumns}
              data={componentRows}
              keyExtractor={r => r.name}
              compact
              pagination
              emptyMessage={t('No components found')}
            />
          </View>

          {pool ? (
            <View>
              <AppText weight="semibold" style={styles.subheading}>
                {t('Database Connection Pool')}
              </AppText>
              <Grid cols={{default: 2, md: 5}} gap={3}>
                <StatCard label={t('Max Open')} value={fmtInt(pool.maxOpen)} icon="database" />
                <StatCard label={t('Open')} value={fmtInt(pool.open)} icon="database" />
                <StatCard label={t('In Use')} value={fmtInt(pool.inUse)} icon="activity" />
                <StatCard label={t('Idle')} value={fmtInt(pool.idle)} icon="clock" />
                <StatCard label={t('Wait Count')} value={fmtInt(pool.waitCount)} icon="speed" />
              </Grid>
            </View>
          ) : null}

          {extHealth?.system || version ? (
            <View>
              <AppText weight="semibold" style={styles.subheading}>
                {t('System Runtime')}
              </AppText>
              <KVList
                items={[
                  {
                    label: t('Go Version'),
                    value: version?.go_version ?? extHealth?.system?.go_version ?? '—',
                  },
                  {
                    label: t('Uptime'),
                    value: formatUptime(
                      version?.uptime_seconds ?? extHealth?.system?.uptime_seconds ?? 0,
                    ),
                  },
                  {
                    label: t('Goroutines'),
                    value: fmtInt(version?.goroutines ?? extHealth?.system?.goroutines ?? 0),
                  },
                  {
                    label: t('OS / Arch'),
                    value: version ? `${version.os} / ${version.arch}` : '—',
                  },
                ]}
              />
            </View>
          ) : null}
        </View>
      )}
    </AccordionSection>
  );
}

BackendStatusSection.displayName = 'BackendStatusSection';

const styles = StyleSheet.create({
  // GlassPanel overflow-hidden.
  accordion: {
    overflow: 'hidden',
  },
  // flex items-center gap-3 px-5 py-4.
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // hover:bg-white/[0.02].
  accordionHeaderPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  // text-cyan-400 shrink-0.
  accordionIcon: {
    flexShrink: 0,
  },
  // flex-1 min-w-0.
  accordionHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  // text-sm font-semibold text-[var(--text-primary)].
  accordionTitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  // text-xs text-[var(--text-muted)] mt-0.5.
  accordionDescription: {
    marginTop: 2,
  },
  // flex items-center gap-2 shrink-0.
  accordionBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  // ChevronDown h-4 w-4 text-[var(--text-muted)] (rotate-180 when open).
  accordionCaret: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  accordionCaretOpen: {
    transform: [{rotate: '180deg'}],
  },
  // border-t border-white/[0.06] px-5 py-4.
  accordionBody: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // space-y-4 (loading) / space-y-6 (content).
  loadingStack: {
    gap: spacing.md,
  },
  sectionStack: {
    gap: spacing.lg,
  },
  // h4 text-sm font-semibold text-[var(--text-primary)] mb-3.
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  // animate-pulse bg-gray-200 dark:bg-gray-700 rounded.
  skeleton: {
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
  },
  // Badge: inline-flex items-center rounded-full + size="sm" px-1.5 py-0.5.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  // status dot replacing the h-4 w-4 lucide status icon.
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // flex items-center gap-2.
  statusCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // text-red-400 failures cell.
  failText: {
    color: STATUS_RED_400,
  },
  // StatCard: Card flex flex-col gap-1.
  statCard: {
    width: '100%',
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  statCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statCardLabel: {
    flexShrink: 1,
  },
  // KVList columns=2: grid grid-cols-2.
  kvList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // py-2 + flex justify-between, ~half width per cell.
  kvItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kvLabel: {
    flexShrink: 1,
  },
  kvValue: {
    color: colors.textPrimary,
    textAlign: 'right',
  },
  // DataTable header row.
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  cell: {
    minWidth: 132,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  cellCompact: {
    minWidth: 112,
    paddingVertical: spacing.xs,
  },
  headerCellInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cellText: {
    color: colors.textSecondary,
  },
});

const badgeVariantStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});

export default BackendStatusSection;
