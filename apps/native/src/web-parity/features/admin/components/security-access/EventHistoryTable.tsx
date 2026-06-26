// Native parity port of
// web/src/features/admin/components/security-access/EventHistoryTable.tsx.
//
// The web module renders the admin "Security Event History" panel: a FadeIn ->
// GlassPanel with an <h2> heading and, while loading, a Skeleton; otherwise a
// shared <DataTable> of SecurityEvent rows with five columns — Time (a sortable
// <TimeStamp>), Lock (Badge success/danger), Sentry (Badge success/neutral),
// Doors (green/amber text + DoorState string), and Windows (green/amber window
// summary). Built from the shared web UI kit (Badge, GlassPanel, DataTable,
// Skeleton, FadeIn, TimeStamp), react-i18next, the @/types/admin SecurityEvent,
// the @/lib/typeGuards asNonEmptyString guard, and the local ./helpers.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() hook whose
//     t(key, fallback?) returns the English fallback (or the key), so every
//     translation key is preserved verbatim at the call site.
//   • The shared web <Badge> (DOM <span> pill) -> an inlined native Badge: a
//     rounded-full View with a tinted surface/border + a caption AppText in the
//     variant colour (success/danger/neutral, the only variants this table uses),
//     sized to the web `sm` density (px-1.5 py-0.5 text-xs).
//   • The shared web <TimeStamp> (hover Tooltip + Settings-driven relative/
//     absolute preference) -> an inlined native TimeStamp: the same value parsing
//     (string|number|Date|null), the "—" placeholder for null/unparseable values,
//     and an absolute local format. RN has no hover, so the alternate-format
//     Tooltip is dropped; with no Settings runtime in the parity bundle the
//     'auto' format resolves to absolute (a 'relative' override is still honoured).
//   • The shared web <DataTable> (47 KB: resize/reorder/visibility/CSV/selection
//     /persistence) -> an inlined native DataTable covering exactly the props this
//     caller uses: Column<T>{key,header,render,sortable}, data, keyExtractor,
//     emptyMessage, compact, and pagination{defaultPageSize}. Web sorting is
//     controlled-only (header -> onSort?.(key)); this caller passes no onSort, so
//     the Time header is a no-op affordance exactly like web, and the data renders
//     in source order. Pagination slices data at the page size (50) with a
//     Prev/Next pager shown only when there is more than one page, and the page
//     resets to 1 when the row count changes (web `useEffect(setPage(1),[len])`).
//   • The @/types/admin SecurityEvent (camelCase) -> the already-ported, identical
//     SecurityEvent from web-parity/api/hooks/useAdmin. asNonEmptyString and the
//     door/window helpers (./helpers, not yet ported) are inlined verbatim.
//   • cn() conditional text classes -> conditional RN style arrays; the
//     text-green-400 / text-amber-400 door/window colours map to the success /
//     warning theme tokens, and text-[var(--text-muted)] -> AppText tone="muted".
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {Skeleton} from '../../../../components/feedback/Skeleton';
import {FadeIn} from '../../../../components/motion/FadeIn';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {SecurityEvent} from '../../../../api/hooks/useAdmin';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. A stable useCallback identity keeps the
// eventColumns useMemo dependency [t] honest, matching the source.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/typeGuards asNonEmptyString ────────────────────────── */

/** Returns `v` only when it is a non-empty string; `null` otherwise. */
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ─── inlined ./helpers (door + window narrowing) ──────────────────────── */

type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown';

function parseWindowState(val: unknown): WindowState {
  const raw = asNonEmptyString(val);
  if (!raw) {
    return 'Unknown';
  }
  const lower = raw.toLowerCase();
  if (lower === 'closed' || lower === '0') {
    return 'Closed';
  }
  if (lower.includes('vent')) {
    return 'Venting';
  }
  if (lower.includes('open') || lower !== '0') {
    return 'Open';
  }
  return 'Unknown';
}

// Backend may emit DoorState as bool/number/object/string; treat "no door open"
// as closed across every shape (mirrors the web ./helpers door guard).
function doorClosed(state: unknown): boolean {
  if (state == null) {
    return true;
  }
  if (typeof state === 'boolean') {
    return !state;
  }
  if (typeof state === 'number') {
    return state === 0;
  }
  if (typeof state === 'object' && !Array.isArray(state)) {
    return Object.values(state as Record<string, unknown>).every(
      v => v === false || v == null,
    );
  }
  const raw = asNonEmptyString(state);
  if (!raw) {
    return true;
  }
  const lower = raw.trim().toLowerCase();
  if (
    lower === '' ||
    lower === 'closed' ||
    lower === 'closedall' ||
    lower === '0' ||
    lower === 'false'
  ) {
    return true;
  }
  if (lower.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.values(parsed).every(v => v === false || v == null);
    } catch {
      /* fall through */
    }
  }
  return false;
}

function allWindowsClosed(ev: SecurityEvent | undefined): boolean {
  if (!ev) {
    return true;
  }
  return [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow]
    .map(parseWindowState)
    .every(s => s === 'Closed');
}

function windowSummary(ev: SecurityEvent | undefined): string {
  if (!ev) {
    return '—';
  }
  const states = [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow].map(
    parseWindowState,
  );
  const allClosed = states.every(s => s === 'Closed');
  if (allClosed) {
    return 'All Closed';
  }
  const openCount = states.filter(s => s !== 'Closed').length;
  return `${openCount} Open/Venting`;
}

/* ─── inlined @/components/ui Badge ────────────────────────────────────── */

type BadgeVariant = 'success' | 'danger' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

function Badge({variant = 'neutral', children}: BadgeProps) {
  const tone = BADGE_VARIANT_STYLES[variant];
  return (
    <View style={[styles.badge, {backgroundColor: tone.bg, borderColor: tone.border}]}>
      <AppText style={[styles.badgeText, {color: tone.text}]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── inlined @/components/data-display TimeStamp ──────────────────────── */

type TimeStampFormat = 'relative' | 'absolute' | 'auto';

interface TimeStampProps {
  value: string | number | Date | null | undefined;
  format?: TimeStampFormat;
  style?: StyleProp<TextStyle>;
}

function formatAbsolute(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 0) {
    return formatAbsolute(date);
  }
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
  return `${days}d ago`;
}

// Shared timestamp renderer. Web shows a hover Tooltip with the alternate format
// and defaults 'auto' to the user's Settings preference; RN has no hover and the
// parity bundle has no Settings runtime, so 'auto' resolves to the absolute
// format while an explicit 'relative' override is still honoured. The "—"
// placeholder for null/unparseable values is preserved.
function TimeStamp({value, format = 'auto', style}: TimeStampProps) {
  if (value == null) {
    return <AppText style={style}>—</AppText>;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <AppText style={style}>—</AppText>;
  }
  const effective = format === 'auto' ? 'absolute' : format;
  const primary =
    effective === 'relative' ? formatRelative(date) : formatAbsolute(date);
  return (
    <AppText numberOfLines={1} style={style}>
      {primary}
    </AppText>
  );
}

/* ─── inlined @/components/ui DataTable (subset used here) ──────────────── */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

interface PaginationConfig {
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
  compact?: boolean;
  pagination?: PaginationConfig;
  // Controlled sort, mirroring the web DataTable. Sorting is controlled-only:
  // the sortable header calls onSort?.(key); with no handler it is a no-op.
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
}

function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  emptyMessage,
  compact = false,
  pagination,
  sortKey,
  sortDir,
  onSort,
}: DataTableProps<T>) {
  const paginationEnabled = !!pagination;
  const pageSize = pagination?.defaultPageSize ?? 25;
  const [page, setPage] = useState(1);

  // Mirror the web table: jump back to page 1 whenever the row count changes so
  // a shrinking dataset never strands the viewer on an empty trailing page.
  useEffect(() => {
    setPage(1);
  }, [data.length]);

  if (data.length === 0) {
    return (
      <View accessibilityRole="text" style={styles.empty}>
        <AppText style={styles.emptyText} tone="muted">
          {emptyMessage ?? 'No data'}
        </AppText>
      </View>
    );
  }

  const totalPages = paginationEnabled
    ? Math.max(1, Math.ceil(data.length / pageSize))
    : 1;
  const safePage = Math.min(page, totalPages);
  const pagedData = paginationEnabled
    ? data.slice((safePage - 1) * pageSize, safePage * pageSize)
    : data;

  const rowPadStyle = compact ? styles.rowCompact : styles.rowComfortable;

  return (
    <View style={styles.table} testID={tableId}>
      <View style={[styles.row, styles.headerRow, rowPadStyle]}>
        {columns.map(col => {
          const active = sortKey === col.key;
          const indicator = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
          const header = (
            <AppText
              numberOfLines={1}
              style={styles.headerText}
              tone="muted"
              weight="semibold">
              {col.header}
              {indicator}
            </AppText>
          );
          return (
            <View key={col.key} style={styles.cell}>
              {col.sortable ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onSort?.(col.key)}>
                  {header}
                </Pressable>
              ) : (
                header
              )}
            </View>
          );
        })}
      </View>

      {pagedData.map(row => (
        <View
          key={String(keyExtractor(row))}
          style={[styles.row, styles.bodyRow, rowPadStyle]}>
          {columns.map(col => (
            <View key={col.key} style={styles.cell}>
              {col.render(row)}
            </View>
          ))}
        </View>
      ))}

      {paginationEnabled && totalPages > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage <= 1}}
            disabled={safePage <= 1}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            style={({pressed}) => [
              styles.pagerBtn,
              safePage <= 1 ? styles.pagerBtnDisabled : null,
              pressed && safePage > 1 ? styles.pagerBtnPressed : null,
            ]}>
            <AppText variant="caption" weight="semibold">
              Prev
            </AppText>
          </Pressable>
          <AppText style={styles.pagerLabel} tone="muted" variant="caption">
            {`Page ${safePage} of ${totalPages}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage >= totalPages}}
            disabled={safePage >= totalPages}
            onPress={() => setPage(p => Math.min(totalPages, p + 1))}
            style={({pressed}) => [
              styles.pagerBtn,
              safePage >= totalPages ? styles.pagerBtnDisabled : null,
              pressed && safePage < totalPages ? styles.pagerBtnPressed : null,
            ]}>
            <AppText variant="caption" weight="semibold">
              Next
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ─── EventHistoryTable ────────────────────────────────────────────────── */

interface EventHistoryTableProps {
  history: SecurityEvent[];
  isLoading: boolean;
}

export function EventHistoryTable({history, isLoading}: EventHistoryTableProps) {
  const {t} = useTranslation();

  const eventColumns = useMemo<Column<SecurityEvent>[]>(
    () => [
      {
        key: 'createdAt',
        header: t('admin.security.col.time', 'Time'),
        sortable: true,
        render: row => (
          <TimeStamp style={styles.timeText} value={row.createdAt} />
        ),
      },
      {
        key: 'locked',
        header: t('admin.security.col.lock', 'Lock'),
        render: row => (
          <Badge variant={row.locked ? 'success' : 'danger'}>
            {row.locked
              ? t('admin.security.locked', 'Locked')
              : t('admin.security.unlocked', 'Unlocked')}
          </Badge>
        ),
      },
      {
        key: 'sentryMode',
        header: t('admin.security.col.sentry', 'Sentry'),
        render: row => (
          <Badge variant={row.sentryMode ? 'success' : 'neutral'}>
            {row.sentryMode
              ? t('admin.security.on', 'On')
              : t('admin.security.off', 'Off')}
          </Badge>
        ),
      },
      {
        key: 'doorState',
        header: t('admin.security.col.doors', 'Doors'),
        render: row => (
          <AppText
            style={
              doorClosed(row.doorState) ? styles.textClosed : styles.textOpen
            }>
            {asNonEmptyString(row.doorState) ??
              (doorClosed(row.doorState)
                ? t('admin.security.closed', 'Closed')
                : '—')}
          </AppText>
        ),
      },
      {
        key: 'windows',
        header: t('admin.security.col.windows', 'Windows'),
        render: row => {
          const closed = allWindowsClosed(row);
          return (
            <AppText style={closed ? styles.textClosed : styles.textOpen}>
              {windowSummary(row)}
            </AppText>
          );
        },
      },
    ],
    [t],
  );

  return (
    <FadeIn delay={0.3}>
      <GlassPanel style={styles.panel}>
        <AppText style={styles.heading} weight="semibold">
          {t('admin.security.eventHistory', 'Security Event History')}
        </AppText>
        {isLoading ? (
          <Skeleton lines={8} />
        ) : (
          <DataTable<SecurityEvent>
            columns={eventColumns}
            compact
            data={history}
            emptyMessage={t(
              'admin.security.noEvents',
              'No security events recorded yet.',
            )}
            keyExtractor={row => row.id}
            pagination={{defaultPageSize: 50}}
            tableId="admin:security-events"
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

const BADGE_VARIANT_STYLES: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
};

const styles = StyleSheet.create({
  panel: {
    padding: spacing.md,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  rowComfortable: {
    paddingVertical: spacing.sm,
  },
  rowCompact: {
    paddingVertical: spacing.xs,
  },
  headerRow: {
    backgroundColor: colors.surfaceSelected,
  },
  bodyRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingRight: spacing.xs,
  },
  headerText: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  timeText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  textClosed: {
    fontSize: 13,
    color: colors.success,
  },
  textOpen: {
    fontSize: 13,
    color: colors.warning,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  pagerBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pagerBtnDisabled: {
    opacity: 0.4,
  },
  pagerBtnPressed: {
    opacity: 0.7,
  },
  pagerLabel: {
    minWidth: 96,
    textAlign: 'center',
  },
});
