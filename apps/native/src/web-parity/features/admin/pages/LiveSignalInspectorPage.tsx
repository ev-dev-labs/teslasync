// Native parity port of web/src/features/admin/pages/LiveSignalInspectorPage.tsx.
//
// LiveSignalInspectorPage — realtime per-vehicle signal viewer. The operator
// picks a vehicle, and the page polls GET /api/v1/signals/{vehicleID}/live every
// 1s (via the unchanged native useVehicleLiveSignals hook) and renders the Redis
// live-cache snapshot as a filterable + sortable table. The 1s cadence and the
// `refetchIntervalInBackground:false` pause-when-hidden contract live entirely in
// the shared hook, so they are preserved verbatim here.
//
// The web original composes the DOM page kit (PageContainer, GlassPanel, Select,
// PanelTitle, EmptyState, SectionErrorBoundary, LiveIndicator, DataTable + Input
// + useSortToggle, TimeStamp), framer-motion FadeIn, lucide SVG icons
// (Activity, Radio, Search), react-i18next, usePageTitle, and the
// `../components/live-signal-inspector` LiveSignalsTable sub-component. React
// Native has no DOM, Tailwind, lucide SVGs, framer-motion, DataTable, wired
// react-i18next, or browser `document.title`, so this port reproduces the same
// behaviour with RN primitives + the established native parity building blocks:
//
//   - PageContainer (title / subtitle / actions + a `query` freshness badge) ->
//     an inline scaffold: a persistent header (translated title + subtitle) plus
//     a header-actions slot that renders the freshness badge driven by the live
//     query and, exactly like the web `actions` prop, the LiveIndicator only when
//     a vehicle is selected. The web passes no `loading`/`empty` prop, so the
//     body always renders and each panel owns its own empty/loading state.
//   - usePageTitle(t('admin.liveSignals.pageTitle')) sets the browser tab title,
//     which has no native analogue; the same translated string is surfaced as the
//     on-screen page header instead (documented in the sidecar).
//   - GlassPanel -> the shared native GlassPanel.
//   - Select (vehicle picker, value/onChange + a "Select vehicle…" placeholder) ->
//     the established native single-choice control: a segmented radio pill group
//     preserving the {value,label} options, the placeholder, and the exact
//     `setVehicleId(v ? Number(v) : null)` onChange contract.
//   - PanelTitle + lucide Activity -> a panel header (SemanticIcon "activity" +
//     bold AppText). EmptyState lucide Radio -> a leading SemanticIcon "radio".
//   - SectionErrorBoundary -> an inline SectionBoundary error boundary class
//     reproducing the "this section failed, the rest still works" contract.
//   - LiveIndicator variant="compact" -> the shared native LiveIndicator.
//   - query={live} (DataFreshnessAuto) -> the shared native FreshnessIndicator
//     driven by `live.dataUpdatedAt` (rendered once the query has data, which —
//     like the web — only happens after a vehicle is selected).
//   - FadeIn (framer-motion) -> a plain View (animation dropped, as in the other
//     admin ports).
//   - The LiveSignalsTable sub-component is NOT in the native conversion manifest,
//     so — exactly like the FeatureFlags sub-components — it is inlined here
//     verbatim-by-behaviour: rowFromEntry / renderValue logic, the
//     useSortToggle('name','asc') sort state, the name/timestamp sort accessors,
//     the name filter, the EmptyState-vs-table branch, and every i18n
//     key/default are preserved. DataTable (table + Input + pagination) becomes a
//     native search field + sortable header + card list. TimeStamp format="relative"
//     is inlined faithfully from @/lib/dateFormat.formatRelative.
//
// State names (vehicleId, filter, sort), API paths (via the unchanged
// useVehicleLiveSignals / useVehicles hooks → /signals/{id}/live, /vehicles), the
// v.id / v.display_name / v.vin reads, and the signal envelope shape are all
// preserved verbatim. No DOM, Recharts, Leaflet, framer-motion, lucide-react, or
// old web UI components are imported. See the colocated .parity.json sidecar for
// the line-by-line mapping.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useVehicleLiveSignals,
  type VehicleLiveSignal,
  type VehicleLiveSignalsResponse,
} from '../../../api/hooks/useTelemetry';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {FreshnessIndicator} from '../../../components/data-display/FreshnessIndicator';
import {LiveIndicator} from '../../../components/data-display/LiveIndicator';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type TVars = Record<string, string | number | null | undefined>;
type TFunc = (key: string, defaultValue?: string, vars?: TVars) => string;

// react-i18next is not wired in native. The web page calls
// t('admin.liveSignals.pageTitle', 'Live Signal Inspector') — a dotted key plus
// an English default — and i18next returns the default when the key is
// unresolved. This fallback returns `defaultValue ?? key` and applies the same
// {{var}} interpolation the web `t` performs. Keys are kept verbatim so a future
// i18n wiring resolves them unchanged.
function useT(): TFunc {
  return useCallback((key: string, defaultValue?: string, vars?: TVars) => {
    let out = defaultValue ?? key;
    if (vars) {
      for (const varKey of Object.keys(vars)) {
        const value = vars[varKey];
        out = out
          .split(`{{${varKey}}}`)
          .join(value == null ? '' : String(value));
      }
    }
    return out;
  }, []);
}

/* ─── Constants ───────────────────────────────────────────────────────── */

// web LiveSignalsTable renders the signal name + value cells with `font-mono`.
const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

const FALLBACK = '\u2014'; // — universal missing-value placeholder
const SORT_ASC = '\u2191'; // ↑
const SORT_DESC = '\u2193'; // ↓

/* ─── Inlined relative formatter (web TimeStamp format="relative") ─────── */

// web @/lib/dateFormat.formatDate — "Apr 4, 2026" in the host locale/timezone,
// — on nullish/unparseable input. Used as the >7d fallback below.
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// web TimeStamp value={row.timestamp} format="relative" resolves to
// @/lib/dateFormat.formatRelative: "just now" / "Nm ago" / "Nh ago" / "Nd ago",
// falling back to the absolute date past 7 days and "—" for nullish/invalid.
function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
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
  return formatDate(iso);
}

/* ─── Inlined LiveSignalsTable (web ../components/live-signal-inspector) ── */

interface LiveSignalRow {
  name: string;
  value: unknown;
  timestamp?: string;
}

// web rowFromEntry — normalise either a `{value, timestamp}` envelope or a bare
// scalar into a flat row. Verbatim logic.
function rowFromEntry(name: string, raw: unknown): LiveSignalRow {
  if (raw && typeof raw === 'object' && 'value' in (raw as VehicleLiveSignal)) {
    const env = raw as VehicleLiveSignal;
    return {name, value: env.value, timestamp: env.timestamp};
  }
  return {name, value: raw};
}

// web renderValue — coerce any value (scalar | object) into a display string so
// the table never crashes on a compound value. Verbatim logic.
function renderValue(v: unknown): string {
  if (v === null) {
    return 'null';
  }
  if (v === undefined) {
    return FALLBACK;
  }
  const tx = typeof v;
  if (tx === 'string') {
    return v as string;
  }
  if (tx === 'number' || tx === 'boolean') {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return FALLBACK;
  }
}

interface LiveSignalsTableProps {
  data: VehicleLiveSignalsResponse | undefined;
  loading: boolean;
  t: TFunc;
}

// Native equivalent of useSortToggle('name', 'asc'): a new column resets the
// direction to 'desc'; tapping the active column toggles asc/desc. The visible
// sort still runs in the `sorted` memo below (localeCompare for name, Date.parse
// for timestamp), matching the web component exactly.
function LiveSignalsTable({data, loading, t}: LiveSignalsTableProps) {
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'timestamp'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const onSort = useCallback(
    (key: 'name' | 'timestamp') => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const rows = useMemo<LiveSignalRow[]>(() => {
    const signals = data?.signals ?? {};
    return Object.keys(signals).map(name => rowFromEntry(name, signals[name]));
  }, [data]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return rows;
    }
    return rows.filter(r => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') {
        return a.name.localeCompare(b.name) * dir;
      }
      if (sortKey === 'timestamp') {
        return (
          ((a.timestamp ? Date.parse(a.timestamp) : 0) -
            (b.timestamp ? Date.parse(b.timestamp) : 0)) *
          dir
        );
      }
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const sortMark = (key: 'name' | 'timestamp') =>
    sortKey === key ? (sortDir === 'asc' ? ` ${SORT_ASC}` : ` ${SORT_DESC}`) : '';

  return (
    <View style={styles.tableRoot}>
      {/* web: relative search box with a lucide Search glyph + Input. */}
      <View style={styles.searchBox}>
        <View style={styles.searchIcon}>
          <SemanticIcon decorative name="search" size="sm" />
        </View>
        <TextInput
          accessibilityLabel={t('admin.liveSignals.filterAria', 'Filter signals')}
          onChangeText={setFilter}
          placeholder={t(
            'admin.liveSignals.filterPlaceholder',
            'Filter signal names\u2026',
          )}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          testID="live-signals-filter"
          value={filter}
        />
      </View>

      {!loading && rows.length === 0 ? (
        <View testID="live-signals-empty">
          <EmptyState
            message={t(
              'admin.liveSignals.empty.message',
              'Redis has no live snapshot for this vehicle yet. Confirm the vehicle is online and publishing.',
            )}
            title={t('admin.liveSignals.empty.title', 'No live signals cached')}
          />
        </View>
      ) : (
        <View style={styles.table} testID="live-signals-table">
          <View style={styles.tableHeader}>
            <Pressable
              accessibilityHint={
                sortKey === 'name'
                  ? sortDir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
              accessibilityRole="button"
              onPress={() => onSort('name')}
              style={styles.headerName}
              testID="live-signals-sort-name">
              <AppText tone="muted" variant="caption" weight="semibold">
                {t('admin.liveSignals.cols.name', 'Signal')}
                {sortMark('name')}
              </AppText>
            </Pressable>
            <AppText
              style={styles.headerValue}
              tone="muted"
              variant="caption"
              weight="semibold">
              {t('admin.liveSignals.cols.value', 'Value')}
            </AppText>
            <Pressable
              accessibilityHint={
                sortKey === 'timestamp'
                  ? sortDir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
              accessibilityRole="button"
              onPress={() => onSort('timestamp')}
              style={styles.headerTime}
              testID="live-signals-sort-timestamp">
              <AppText tone="muted" variant="caption" weight="semibold">
                {t('admin.liveSignals.cols.timestamp', 'Last update')}
                {sortMark('timestamp')}
              </AppText>
            </Pressable>
          </View>

          {sorted.length === 0 ? (
            <View style={styles.tableEmptyRow} testID="live-signals-table-empty">
              <AppText tone="muted">
                {loading
                  ? t('admin.liveSignals.table.loading', 'Loading\u2026')
                  : t(
                      'admin.liveSignals.table.filtered',
                      'No signals match this filter.',
                    )}
              </AppText>
            </View>
          ) : (
            sorted.map(row => (
              <View
                key={row.name}
                style={styles.row}
                testID={`live-signal-row-${row.name}`}>
                <View style={styles.cellName}>
                  <AppText numberOfLines={1} style={styles.monoName}>
                    {row.name}
                  </AppText>
                </View>
                <View style={styles.cellValue}>
                  <AppText
                    style={styles.cellCaption}
                    tone="muted"
                    variant="caption">
                    {t('admin.liveSignals.cols.value', 'Value')}
                  </AppText>
                  <AppText numberOfLines={3} style={styles.monoValue} tone="muted">
                    {renderValue(row.value)}
                  </AppText>
                </View>
                <View style={styles.cellTime}>
                  <AppText
                    style={styles.cellCaption}
                    tone="muted"
                    variant="caption">
                    {t('admin.liveSignals.cols.timestamp', 'Last update')}
                  </AppText>
                  <AppText tone="muted" variant="caption">
                    {row.timestamp ? formatRelative(row.timestamp) : FALLBACK}
                  </AppText>
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

/* ─── SectionBoundary (web SectionErrorBoundary) ──────────────────────── */

interface SectionBoundaryProps {
  name: string;
  children: React.ReactNode;
}

interface SectionBoundaryState {
  hasError: boolean;
}

// Wraps a section so a render failure inside it doesn't blank the whole page —
// the resilience contract of the web SectionErrorBoundary (inline fallback).
class SectionBoundary extends React.Component<
  SectionBoundaryProps,
  SectionBoundaryState
> {
  state: SectionBoundaryState = {hasError: false};

  static getDerivedStateFromError(): SectionBoundaryState {
    return {hasError: true};
  }

  render() {
    if (this.state.hasError) {
      return (
        <GlassPanel
          style={styles.panel}
          testID={`section-error-${this.props.name}`}>
          <View style={styles.sectionError}>
            <SemanticIcon decorative name="warning" size="sm" />
            <View style={styles.sectionErrorText}>
              <AppText tone="secondary" weight="semibold">
                This section failed to load.
              </AppText>
              <AppText tone="muted" variant="caption">
                Other parts of the page should still work.
              </AppText>
            </View>
          </View>
        </GlassPanel>
      );
    }
    return this.props.children;
  }
}

/* ─── Page component ──────────────────────────────────────────────────── */

export default function LiveSignalInspectorPage() {
  const t = useT();
  // usePageTitle(t('admin.liveSignals.pageTitle', 'Live Signal Inspector'))
  // drives the browser document.title, which has no React Native analogue; the
  // same translated string is surfaced as the on-screen page header below.

  const [vehicleId, setVehicleId] = useState<number | null>(null);

  const vehicles = useVehicles();
  const live = useVehicleLiveSignals(vehicleId ?? undefined, {
    refetchInterval: 1_000,
    enabled: vehicleId !== null,
  });

  const vehicleOptions = [
    {
      value: '',
      label: t('admin.liveSignals.controls.selectVehicle', 'Select vehicle\u2026'),
    },
    ...(vehicles.data ?? []).map((v: Vehicle) => ({
      value: String(v.id),
      label: v.display_name || v.vin || `Vehicle ${v.id}`,
    })),
  ];

  const currentValue = vehicleId !== null ? String(vehicleId) : '';

  // web query={live} → DataFreshnessAuto. Native maps the query freshness to the
  // shared FreshnessIndicator using the query's last-update time; while the live
  // query is disabled (no vehicle), dataUpdatedAt is 0 and the badge is omitted —
  // mirroring the empty state the web badge surfaces for a disabled query.
  const freshnessTs =
    typeof live.dataUpdatedAt === 'number' && live.dataUpdatedAt > 0
      ? new Date(live.dataUpdatedAt).toISOString()
      : null;

  return (
    <View style={styles.page} testID="live-signal-inspector-page">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <AppText accessibilityRole="header" style={styles.pageTitle}>
              {t('admin.liveSignals.pageTitle', 'Live Signal Inspector')}
            </AppText>
            <AppText style={styles.pageSubtitle} tone="muted">
              {t(
                'admin.liveSignals.subtitle',
                'Realtime view of the Redis-cached live signal snapshot. Refreshes every second while this tab is in the foreground.',
              )}
            </AppText>
          </View>
          <View style={styles.headerActions}>
            {freshnessTs ? (
              <FreshnessIndicator
                testID="live-signals-freshness"
                timestamp={freshnessTs}
              />
            ) : null}
            {vehicleId !== null ? (
              <LiveIndicator
                testID="live-signals-live-indicator"
                variant="compact"
              />
            ) : null}
          </View>
        </View>

        <SectionBoundary name="live-controls">
          <GlassPanel style={styles.panel} testID="live-controls-panel">
            <View
              accessibilityLabel={t(
                'admin.liveSignals.controls.vehicleAria',
                'Vehicle',
              )}
              accessibilityRole="radiogroup"
              style={styles.selectGroup}
              testID="live-signals-vehicle-select">
              {vehicleOptions.map(opt => {
                const selected = currentValue === opt.value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{selected}}
                    key={opt.value || '__placeholder__'}
                    onPress={() =>
                      setVehicleId(opt.value ? Number(opt.value) : null)
                    }
                    style={({pressed}) => [
                      styles.pill,
                      selected && styles.pillSelected,
                      pressed && styles.pillPressed,
                    ]}
                    testID={`live-signals-vehicle-option-${opt.value || 'none'}`}>
                    <AppText
                      numberOfLines={1}
                      style={[styles.pillText, selected && styles.pillTextSelected]}
                      weight={selected ? 'semibold' : 'regular'}>
                      {opt.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </GlassPanel>
        </SectionBoundary>

        {vehicleId === null ? (
          <GlassPanel style={styles.panel} testID="live-signals-no-vehicle">
            <View style={styles.emptyWrap}>
              <SemanticIcon decorative name="radio" size="lg" />
              <EmptyState
                message={t(
                  'admin.liveSignals.noVehicle.message',
                  'Pick a vehicle from the dropdown above to start streaming its live signal cache.',
                )}
                title={t('admin.liveSignals.noVehicle.title', 'Select a vehicle')}
              />
            </View>
          </GlassPanel>
        ) : (
          <SectionBoundary name="live-signals">
            <GlassPanel style={styles.panel} testID="live-signals-panel">
              <View style={styles.panelHeader}>
                <SemanticIcon decorative name="activity" size="sm" />
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('admin.liveSignals.panels.snapshot', 'Live snapshot')}
                </AppText>
              </View>
              <LiveSignalsTable
                data={live.data}
                loading={live.isLoading}
                t={t}
              />
            </GlassPanel>
          </SectionBoundary>
        )}
      </ScrollView>
    </View>
  );
}

LiveSignalInspectorPage.displayName = 'LiveSignalInspectorPage';

/* ─── Styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    rowGap: spacing.lg,
  },
  header: {
    alignItems: 'flex-start',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 200,
    rowGap: spacing.xs,
  },
  headerActions: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  pageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  panel: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  panelHeader: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  sectionError: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  sectionErrorText: {
    flex: 1,
    rowGap: spacing.xs,
  },

  /* vehicle select (web Select) */
  selectGroup: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  pill: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pillSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  pillPressed: {
    backgroundColor: colors.surfaceHover,
  },
  pillText: {
    color: colors.textSecondary,
    maxWidth: 220,
  },
  pillTextSelected: {
    color: colors.accent,
  },

  /* no-vehicle empty */
  emptyWrap: {
    alignItems: 'center',
    rowGap: spacing.sm,
  },

  /* table (web LiveSignalsTable / DataTable) */
  tableRoot: {
    rowGap: spacing.md,
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    columnGap: spacing.sm,
    flexDirection: 'row',
    maxWidth: 420,
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },
  table: {
    rowGap: spacing.sm,
  },
  tableHeader: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    columnGap: spacing.sm,
    flexDirection: 'row',
    paddingBottom: spacing.xs,
  },
  headerName: {
    flex: 1.2,
  },
  headerValue: {
    flex: 1.4,
  },
  headerTime: {
    flex: 1,
  },
  tableEmptyRow: {
    paddingVertical: spacing.md,
  },
  row: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  cellName: {
    flexBasis: '100%',
  },
  cellValue: {
    flex: 1.4,
    minWidth: 140,
    rowGap: 2,
  },
  cellTime: {
    flex: 1,
    minWidth: 110,
    rowGap: 2,
  },
  cellCaption: {
    textTransform: 'uppercase',
  },
  monoName: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 14,
  },
  monoValue: {
    fontFamily: MONO_FONT,
    fontSize: 12,
  },
});
