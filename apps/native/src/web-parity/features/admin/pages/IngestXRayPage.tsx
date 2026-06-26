// Native parity port of web/src/features/admin/pages/IngestXRayPage.tsx.
//
// Ingest X-Ray page: per-vehicle telemetry diagnostic surface. An operator
// picks a vehicle + window + bucket and sees how many telemetry samples
// arrived, broken down by field. Backed by
// GET /api/v1/system/ingest-xray/{vehicleID} (router.go ~L3580) which returns
// an IngestXRayResponse with three logical sections:
//
//   - aggregate summary (total_samples, unique_fields) -> XRayHeader
//   - bucketed sample-count time-series                -> XRayBucketChart
//   - per-field stats (count + last_seen + kind)       -> XRayFieldsTable
//
// The underlying useIngestXRay query polls every INTERVALS.FAST so the page
// feels live while diagnosing a stalled pipeline; polling pauses when the app
// is backgrounded (refetchIntervalInBackground:false in the hook).
//
// Every web behavior + state name is preserved: the `vehicleId` / `windowSel`
// / `bucketSel` state, the `useVehicles()` + `useIngestXRay({vehicleId, window,
// bucket, limit:100})` queries, the "select a vehicle" empty state, and the
// four sections (controls, header stats, bucket chart, field-stats table) each
// wrapped in a section error boundary.
//
// The web DOM/Tailwind/Recharts/lucide stack is replaced with React Native
// primitives + the native parity component library. Because the four web
// sub-components imported from `../components/ingest-xray` (XRayControls,
// XRayHeader, XRayBucketChart, XRayFieldsTable) have no native counterparts
// yet, their behavior is inlined here as native-safe components so this page is
// self-contained and renders every section (the DiskForecastPage precedent):
//
//   - `@/components/layout` PageContainer (title/subtitle/`query`) has no native
//     parity component, so a local screen scaffold reproduces the header (title
//     + subtitle), the query-driven freshness chip via the native StatusPill,
//     and the page-level boundary via the native ErrorBoundary.
//   - `@/components/ui` Select (a browser <select> dropdown) becomes a local
//     NativeSelect: a Pressable trigger that reveals a themed option list, with
//     per-option `disabled` (preserving the "bucket >= window" disabling) and
//     the original aria-labels mapped to accessibilityLabel.
//   - `@/components/charts` ChartContainer + Recharts BarChart become a real
//     native bar chart (proportional View bars in a horizontal ScrollView) plus
//     the same title/subtitle/loading/empty contract — the native recharts
//     barrel only renders "unavailable" placeholders, so a true visual is built
//     here instead.
//   - `@/components/ui` DataTable (browser <table>) becomes a native header row
//     + data rows inside a horizontal ScrollView, preserving the `useSortToggle`
//     ('sample_count','desc') sort semantics and the same four columns.
//   - `@/components/ui` Badge becomes a local neutral chip; `@/components/data-
//     display` TimeStamp format="relative" becomes an inlined relative-time
//     formatter; `@/components/data-display` StatCard, `@/components/feedback`
//     EmptyState + ErrorBoundary, `@/components/ui` GlassPanel reuse the
//     already-ported native parity components.
//   - `@/components/motion` FadeIn becomes a reduced-motion-aware mount fade.
//   - `@/lib/numberFormat` fmtInt and `@/hooks/useDateFormat` formatTime are
//     inlined native-safe (en-US grouping; fixed 24h HH:MM, avoiding Hermes
//     Intl gaps).
//   - `@/hooks/usePageTitle` (sets document.title) is a native no-op shim — RN
//     has no document — but the t() title call is preserved.
//   - react-i18next useTranslation becomes a local fallback shim so every
//     admin.xray.* key + English copy is preserved verbatim.
//   - lucide-react Activity/Layers/Clock glyphs are decorative; the native
//     labels carry the meaning, so the glyphs are intentionally omitted.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {StatusPill} from '../../../../components/ui/StatusPill';
import {colors, spacing} from '../../../../theme/tokens';
import {
  formatValueKind,
  useIngestXRay,
  type IngestXRayBucket,
  type IngestXRayBucketPoint,
  type IngestXRayFieldStat,
  type IngestXRayResponse,
  type IngestXRayWindow,
} from '../../../api/hooks/useIngestXRay';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {StatCard} from '../../../components/data-display/StatCard';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TranslationVars) => {
    if (vars == null) {
      return fallback;
    }
    return fallback.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
    );
  }, []);
}

/* ─── usePageTitle (web sets document.title; native has no document) ────────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe formatting (web `@/lib/numberFormat` + `useDateFormat`) ───── */

function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  try {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(n));
  }
}

// Web `useDateFormat().formatTime` -> toLocaleTimeString({hour,minute}). Native
// uses a fixed 24h HH:MM so the X axis is deterministic without Hermes Intl.
function formatClock(value: number): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Web `<TimeStamp format="relative" />` -> @/lib/dateFormat formatRelative,
// ported verbatim (just now / Nm / Nh / Nd, falling back to a short date).
function formatRelative(iso: string): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  const diff = Date.now() - d.getTime();
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ─── FadeIn (web `@/components/motion` FadeIn) ─────────────────────────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function FadeIn({children, style}: {children: ReactNode; style?: StyleProp<ViewStyle>}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

FadeIn.displayName = 'FadeIn';

/* ─── query-driven freshness chip (web PageContainer `<DataFreshnessAuto>`) ─── */

interface FreshnessQueryLike {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
}

function FreshnessChip({query, t}: {query: FreshnessQueryLike; t: NativeTFunction}) {
  if (query.isError) {
    return <StatusPill label={t('common.freshness.error', 'Error')} state="offline" />;
  }
  if (query.isFetching) {
    return <StatusPill label={t('common.freshness.updating', 'Updating\u2026')} state="warning" />;
  }
  if (query.isStale) {
    return <StatusPill label={t('common.freshness.stale', 'Stale')} state="warning" />;
  }
  return <StatusPill label={t('common.freshness.live', 'Live')} state="online" />;
}

FreshnessChip.displayName = 'FreshnessChip';

/* ─── NativeSelect (web `@/components/ui` Select dropdown) ──────────────────── */

interface NativeSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function NativeSelect({
  value,
  options,
  onChange,
  accessibilityLabel,
  width,
}: {
  value: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
  width: number;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <View style={[styles.select, {width}]}>
      <Pressable
        accessibilityHint="Opens the option list"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.selectPressed]}>
        <AppText numberOfLines={1} style={styles.selectValue}>
          {selected ? selected.label : '\u2014'}
        </AppText>
        <AppText style={styles.selectChevron} tone="muted">
          {open ? '\u25B4' : '\u25BE'}
        </AppText>
      </Pressable>
      {open ? (
        <View style={styles.selectList}>
          {options.map(option => {
            const isSelected = option.value === value;
            const isDisabled = option.disabled === true;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{disabled: isDisabled, selected: isSelected}}
                disabled={isDisabled}
                key={option.value || '__placeholder__'}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({pressed}) => [
                  styles.selectOption,
                  isSelected && styles.selectOptionSelected,
                  pressed && !isDisabled && styles.selectPressed,
                ]}>
                <AppText
                  numberOfLines={1}
                  style={[
                    styles.selectOptionText,
                    isDisabled && styles.selectOptionDisabled,
                  ]}
                  tone={isDisabled ? 'muted' : 'primary'}>
                  {option.label}
                </AppText>
                {isSelected ? (
                  <AppText style={styles.selectCheck} tone="accent">
                    {'\u2713'}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

NativeSelect.displayName = 'NativeSelect';

/* ─── XRayControls (web `../components/ingest-xray` XRayControls) ───────────── */

const WINDOW_SECS: Record<IngestXRayWindow, number> = {
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60,
};

const BUCKET_SECS: Record<IngestXRayBucket, number> = {
  '30s': 30,
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
};

const ALL_WINDOWS: IngestXRayWindow[] = ['5m', '15m', '1h', '6h', '24h'];
const ALL_BUCKETS: IngestXRayBucket[] = ['30s', '1m', '5m', '15m', '1h'];

function XRayControls({
  vehicles,
  vehicleId,
  windowSel,
  bucketSel,
  onVehicleChange,
  onWindowChange,
  onBucketChange,
}: {
  vehicles: Vehicle[];
  vehicleId: number | null;
  windowSel: IngestXRayWindow;
  bucketSel: IngestXRayBucket;
  onVehicleChange: (id: number | null) => void;
  onWindowChange: (w: IngestXRayWindow) => void;
  onBucketChange: (b: IngestXRayBucket) => void;
}) {
  const t = useNativeTranslationFallback();

  const vehicleOptions: NativeSelectOption[] = [
    {value: '', label: t('admin.xray.controls.selectVehicle', 'Select vehicle\u2026')},
    ...vehicles.map(v => ({
      value: String(v.id),
      label: v.display_name || v.vin || `Vehicle ${v.id}`,
    })),
  ];

  const windowOptions: NativeSelectOption[] = ALL_WINDOWS.map(w => ({
    value: w,
    label: t(`admin.xray.windowOption.${w}`, w),
  }));

  const bucketOptions: NativeSelectOption[] = ALL_BUCKETS.map(b => {
    const tooBig = BUCKET_SECS[b] >= WINDOW_SECS[windowSel];
    return {
      value: b,
      label: t(`admin.xray.bucketOption.${b}`, b),
      disabled: tooBig,
    };
  });

  return (
    <View style={styles.controlsRow}>
      <NativeSelect
        accessibilityLabel={t('admin.xray.controls.vehicleAria', 'Vehicle')}
        onChange={v => onVehicleChange(v ? Number(v) : null)}
        options={vehicleOptions}
        value={vehicleId !== null ? String(vehicleId) : ''}
        width={248}
      />
      <NativeSelect
        accessibilityLabel={t('admin.xray.controls.windowAria', 'Window')}
        onChange={v => onWindowChange(v as IngestXRayWindow)}
        options={windowOptions}
        value={windowSel}
        width={150}
      />
      <NativeSelect
        accessibilityLabel={t('admin.xray.controls.bucketAria', 'Bucket')}
        onChange={v => onBucketChange(v as IngestXRayBucket)}
        options={bucketOptions}
        value={bucketSel}
        width={150}
      />
    </View>
  );
}

XRayControls.displayName = 'XRayControls';

/* ─── XRayHeader (web `../components/ingest-xray` XRayHeader) ───────────────── */

const WINDOW_LABEL: Record<IngestXRayWindow, string> = {
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
};

function XRayHeader({
  data,
  loading,
  windowSel,
}: {
  data: IngestXRayResponse | undefined;
  loading: boolean;
  windowSel: IngestXRayWindow;
}) {
  const t = useNativeTranslationFallback();
  return (
    <View style={styles.statGrid}>
      <StatCard
        label={t('admin.xray.stats.samples', 'Total samples')}
        style={styles.statCard}
        sublabel={t('admin.xray.stats.samplesSub', 'within selected window')}
        value={loading ? '\u2014' : fmtInt(data?.total_samples ?? 0)}
      />
      <StatCard
        label={t('admin.xray.stats.fields', 'Distinct fields')}
        style={styles.statCard}
        sublabel={t('admin.xray.stats.fieldsSub', 'unique signal names')}
        value={loading ? '\u2014' : fmtInt(data?.unique_fields ?? 0)}
      />
      <StatCard
        label={t('admin.xray.stats.window', 'Window')}
        style={styles.statCard}
        sublabel={t('admin.xray.stats.windowSub', 'observation horizon')}
        value={t(`admin.xray.windowLabel.${windowSel}`, WINDOW_LABEL[windowSel])}
      />
    </View>
  );
}

XRayHeader.displayName = 'XRayHeader';

/* ─── XRayBucketChart (web `../components/ingest-xray` XRayBucketChart) ─────── */

const CHART_TRACK_HEIGHT = 200;

function XRayBucketChart({
  buckets,
  loading,
}: {
  buckets: IngestXRayBucketPoint[];
  loading: boolean;
}) {
  const t = useNativeTranslationFallback();

  // Pre-derive a numeric epoch so the X axis can sort + format cheaply.
  const series = useMemo(
    () =>
      (buckets ?? []).map(b => ({
        ts: Date.parse(b.bucket_start),
        bucket_start: b.bucket_start,
        count: b.count,
      })),
    [buckets],
  );

  const maxCount = useMemo(
    () => series.reduce((max, s) => Math.max(max, s.count), 0),
    [series],
  );

  const isEmpty = !loading && series.length === 0;

  return (
    <View
      accessibilityLabel={t(
        'admin.xray.chart.ariaLabel',
        'Bar chart of ingest sample counts per time bucket.',
      )}
      style={styles.chartRoot}>
      <View style={styles.chartHeader}>
        <AppText style={styles.panelTitle} weight="semibold">
          {t('admin.xray.chart.title', 'Samples per bucket')}
        </AppText>
        <AppText style={styles.chartSubtitle} tone="muted" variant="caption">
          {t(
            'admin.xray.chart.subtitle',
            'Time-series of ingested telemetry rows over the selected window.',
          )}
        </AppText>
      </View>

      {loading ? (
        <View style={styles.chartStatus}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : isEmpty ? (
        <View style={styles.chartStatus}>
          <EmptyState
            message={t(
              'admin.xray.chart.empty',
              'No samples to plot for the selected window.',
            )}
            title={t('admin.xray.chart.emptyTitle', 'No data')}
          />
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chartBars}>
            {series.map(point => {
              const ratio = maxCount > 0 ? point.count / maxCount : 0;
              const fillHeight = point.count > 0 ? Math.max(ratio * 100, 4) : 0;
              return (
                <View key={point.bucket_start} style={styles.barColumn}>
                  <AppText style={styles.barCount} tone="muted" variant="caption">
                    {fmtInt(point.count)}
                  </AppText>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, {height: `${fillHeight}%`}]} />
                  </View>
                  <AppText
                    numberOfLines={1}
                    style={styles.barLabel}
                    tone="muted"
                    variant="caption">
                    {formatClock(point.ts)}
                  </AppText>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

XRayBucketChart.displayName = 'XRayBucketChart';

/* ─── KindBadge (web `@/components/ui` Badge variant="neutral") ─────────────── */

function KindBadge({label}: {label: string}) {
  return (
    <View style={styles.badge}>
      <AppText style={styles.badgeText} tone="secondary" variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

KindBadge.displayName = 'KindBadge';

/* ─── XRayFieldsTable (web `../components/ingest-xray` XRayFieldsTable) ─────── */

type FieldSortKey = 'field' | 'sample_count' | 'last_seen_at' | 'value_kind';

interface FieldColumn {
  key: FieldSortKey;
  header: string;
  width: number;
  align?: 'right';
  sortable: boolean;
  render: (row: IngestXRayFieldStat) => ReactNode;
}

function XRayFieldsTable({
  rows,
  loading,
}: {
  rows: IngestXRayFieldStat[];
  loading: boolean;
}) {
  const t = useNativeTranslationFallback();

  // Mirrors web `useSortToggle('sample_count', 'desc')`.
  const [sortKey, setSortKey] = useState<FieldSortKey>('sample_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const onSort = useCallback(
    (key: FieldSortKey) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'field':
          return a.field.localeCompare(b.field) * dir;
        case 'sample_count':
          return (a.sample_count - b.sample_count) * dir;
        case 'last_seen_at':
          return (Date.parse(a.last_seen_at) - Date.parse(b.last_seen_at)) * dir;
        case 'value_kind':
          return (a.value_kind - b.value_kind) * dir;
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir]);

  const columns: FieldColumn[] = [
    {
      key: 'field',
      header: t('admin.xray.fields.cols.field', 'Field'),
      width: 220,
      sortable: true,
      render: row => (
        <AppText numberOfLines={1} style={styles.fieldMono}>
          {row.field}
        </AppText>
      ),
    },
    {
      key: 'sample_count',
      header: t('admin.xray.fields.cols.count', 'Samples'),
      width: 110,
      align: 'right',
      sortable: true,
      render: row => <AppText style={styles.numeric}>{fmtInt(row.sample_count)}</AppText>,
    },
    {
      key: 'last_seen_at',
      header: t('admin.xray.fields.cols.lastSeen', 'Last seen'),
      width: 130,
      sortable: true,
      render: row => (
        <AppText tone="secondary" variant="caption">
          {formatRelative(row.last_seen_at)}
        </AppText>
      ),
    },
    {
      key: 'value_kind',
      header: t('admin.xray.fields.cols.kind', 'Kind'),
      width: 120,
      sortable: true,
      render: row => <KindBadge label={formatValueKind(row.value_kind)} />,
    },
  ];

  const totalWidth = columns.reduce((sum, c) => sum + c.width + spacing.md, 0);
  const emptyMessage = loading
    ? t('admin.xray.fields.loading', 'Loading\u2026')
    : t(
        'admin.xray.fields.empty',
        'No samples in this window. Try widening the window or confirm the vehicle is publishing.',
      );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        <View style={styles.headerRow}>
          {columns.map(column => {
            const active = column.key === sortKey;
            return (
              <Pressable
                accessibilityLabel={column.header}
                accessibilityRole="button"
                disabled={!column.sortable}
                key={column.key}
                onPress={() => onSort(column.key)}
                style={[
                  styles.headerCell,
                  {width: column.width},
                  column.align === 'right' ? styles.cellRight : null,
                ]}>
                <AppText style={styles.headerText} tone="muted" variant="caption" weight="semibold">
                  {column.header}
                  {active ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        {sorted.length === 0 ? (
          <View style={[styles.emptyRow, {width: totalWidth}]}>
            <AppText tone="muted" variant="caption">
              {emptyMessage}
            </AppText>
          </View>
        ) : (
          sorted.map(row => (
            <View key={row.field} style={styles.row}>
              {columns.map(column => (
                <View
                  key={column.key}
                  style={[
                    styles.cell,
                    {width: column.width},
                    column.align === 'right' ? styles.cellRight : null,
                  ]}>
                  {column.render(row)}
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

XRayFieldsTable.displayName = 'XRayFieldsTable';

/* ─── IngestXRayPage ───────────────────────────────────────────────────────── */

export default function IngestXRayPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('admin.xray.pageTitle', 'Ingest X-Ray'));

  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [windowSel, setWindowSel] = useState<IngestXRayWindow>('1h');
  const [bucketSel, setBucketSel] = useState<IngestXRayBucket>('1m');

  const vehicles = useVehicles();
  const xray = useIngestXRay({
    vehicleId,
    window: windowSel,
    bucket: bucketSel,
    limit: 100,
  });

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="admin-ingest-xray">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('admin.xray.pageTitle', 'Ingest X-Ray')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t(
              'admin.xray.subtitle',
              'Per-vehicle telemetry sample counts \u2014 pick a vehicle to inspect what the ingest pipeline is receiving.',
            )}
          </AppText>
        </View>
        <FreshnessChip query={xray} t={t} />
      </View>

      <ErrorBoundary name="ingest-xray-page">
        <FadeIn>
          <View style={styles.stack}>
            <ErrorBoundary inline name="xray-controls">
              <GlassPanel padding="lg">
                <XRayControls
                  bucketSel={bucketSel}
                  onBucketChange={setBucketSel}
                  onVehicleChange={setVehicleId}
                  onWindowChange={setWindowSel}
                  vehicleId={vehicleId}
                  vehicles={vehicles.data ?? []}
                  windowSel={windowSel}
                />
              </GlassPanel>
            </ErrorBoundary>

            {vehicleId === null ? (
              <GlassPanel padding="lg">
                <EmptyState
                  message={t(
                    'admin.xray.noVehicle.message',
                    'Pick a vehicle from the dropdown above to load its ingest X-Ray for the selected window.',
                  )}
                  title={t('admin.xray.noVehicle.title', 'Select a vehicle')}
                />
              </GlassPanel>
            ) : (
              <>
                <ErrorBoundary inline name="xray-header">
                  <XRayHeader
                    data={xray.data}
                    loading={xray.isLoading}
                    windowSel={windowSel}
                  />
                </ErrorBoundary>

                <ErrorBoundary inline name="xray-chart">
                  <GlassPanel padding="lg">
                    <XRayBucketChart
                      buckets={xray.data?.buckets ?? []}
                      loading={xray.isLoading}
                    />
                  </GlassPanel>
                </ErrorBoundary>

                <ErrorBoundary inline name="xray-fields">
                  <GlassPanel padding="lg">
                    <View style={styles.fieldsHeader}>
                      <AppText style={styles.panelTitle} weight="semibold">
                        {t('admin.xray.panels.fields', 'Field statistics')}
                      </AppText>
                    </View>
                    <XRayFieldsTable
                      loading={xray.isLoading}
                      rows={xray.data?.fields ?? []}
                    />
                  </GlassPanel>
                </ErrorBoundary>
              </>
            )}
          </View>
        </FadeIn>
      </ErrorBoundary>
    </ScrollView>
  );
}

IngestXRayPage.displayName = 'IngestXRayPage';

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  barColumn: {
    alignItems: 'center',
    gap: spacing.xs,
    width: 48,
  },
  barCount: {
    fontVariant: ['tabular-nums'],
  },
  barFill: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    minHeight: 2,
    width: 22,
  },
  barLabel: {
    maxWidth: 44,
  },
  barTrack: {
    alignItems: 'center',
    height: CHART_TRACK_HEIGHT,
    justifyContent: 'flex-end',
    width: 22,
  },
  cell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  chartBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  chartHeader: {
    gap: spacing.xs,
  },
  chartRoot: {
    gap: spacing.md,
  },
  chartStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
  chartSubtitle: {
    lineHeight: 16,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    zIndex: 1,
  },
  emptyRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  fieldMono: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  fieldsHeader: {
    marginBottom: spacing.md,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerCell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  headerRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  headerText: {
    letterSpacing: 0.3,
  },
  numeric: {
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  pageSubtitle: {
    lineHeight: 18,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  select: {
    position: 'relative',
  },
  selectCheck: {
    fontSize: 14,
  },
  selectChevron: {
    fontSize: 12,
  },
  selectList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  selectOption: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionDisabled: {
    opacity: 0.5,
  },
  selectOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  selectOptionText: {
    flex: 1,
  },
  selectPressed: {
    opacity: 0.78,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  selectValue: {
    flex: 1,
  },
  stack: {
    gap: spacing.lg,
  },
  statCard: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 150,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  table: {
    flexDirection: 'column',
  },
});
