// Native parity port of web/src/features/admin/components/ingest-xray/index.ts.
//
// The web module (4 lines) is a barrel that re-exports the four Ingest X-Ray
// building blocks — XRayHeader (L1), XRayControls (L2), XRayBucketChart (L3),
// XRayFieldsTable (L4).
//
// Like the established native devtools/charts/format barrels, this port is
// SELF-CONTAINED: the web siblings reach into a browser-only graph that is
// absent from the React Native parity tree — lucide-react icons (Activity/
// Layers/Clock), the web @/components/data-display StatCard + TimeStamp, the
// @/components/layout Grid, the @/components/ui Select/Badge/DataTable +
// useSortToggle, and the @/components/charts recharts BarChart stack
// (ChartContainer PNG/CSV export, fullscreen, time-axis, Tooltip). We therefore
// inline native-safe implementations that keep the public export surface, the
// prop contracts, the state/behavior, the API/unit handling and the i18n intent,
// and surface an explicit unavailable state for the browser-only chart export /
// DataTable pagination. The .ts extension keeps JSX out (trees are built with
// React.createElement), matching devtools/index.ts.
//
// Per-component native mapping (behavior/state/keys/i18n preserved):
//   - XRayHeader (L1): web Grid of 3 StatCards (Activity/Layers/Clock icons) ->
//     a wrapping row of the canonical native MetricCard (its indicator dot
//     stands in for the lucide icon). Keeps the loading "—" guard, the
//     fmtInt(total_samples ?? 0) / fmtInt(unique_fields ?? 0) values, and the
//     `admin.xray.windowLabel.${windowSel}` window label.
//   - XRayControls (L2): web 3-up <Select> bar -> the native parity <Select>
//     (Modal option list). Keeps the vehicle/window/bucket option builders, the
//     server-accepted ALL_WINDOWS/ALL_BUCKETS literals, and the bucket>=window
//     auto-disable. The web `onChange(e.target.value)` maps to the native
//     `onValueChange(value)`; the per-control `aria-label` maps to the control
//     group's accessibilityLabel.
//   - XRayBucketChart (L3): web recharts BarChart inside ChartContainer ->
//     native static bars + an accessible data table (the ChartContainer a11y
//     fallback). Keeps the numeric-epoch series memo, the empty guard, the
//     title/subtitle/ariaLabel and the Bucket/Samples columns (fmtInt). PNG/CSV
//     export + fullscreen + hover Tooltip have no native analog (documented).
//   - XRayFieldsTable (L4): web sortable DataTable -> a native table with
//     tap-to-sort headers. Faithfully reproduces useSortToggle('sample_count',
//     'desc') and the field/sample_count/last_seen_at/value_kind comparator,
//     the mono field cell, fmtInt sample counts, a relative last-seen label, the
//     formatValueKind() Kind chip, and the loading/empty messages. DataTable
//     pagination + column menu + mobileColumns are simplified to the full
//     sorted list (documented).

import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {MetricCard} from '../../../../../components/ui/MetricCard';
import {colors, spacing} from '../../../../../theme/tokens';
import type {Vehicle} from '../../../../api/types';
import {
  formatValueKind,
  type IngestXRayBucket,
  type IngestXRayBucketPoint,
  type IngestXRayFieldStat,
  type IngestXRayResponse,
  type IngestXRayWindow,
} from '../../../../api/hooks/useIngestXRay';
import {Select, type SelectOption} from '../../../../components/ui/Select';

const el = React.createElement;

/* ─── native-safe i18n shim ───────────────────────────────────────────────
   The web siblings use react-i18next `t(key, fallback)`. The parity tree has no
   i18n provider, so we preserve the keys + English fallbacks (and {{var}}
   interpolation) and render the fallback string. */

type InterpolationValues = Record<string, string | number>;

function t(_key: string, fallback: string, vars?: InterpolationValues): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/* ─── ported integer formatting (web/src/lib/numberFormat.ts: fmtInt) ─────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Locale-aware integer (web `fmtInt` = `fmtNumber(v, 0)`). */
function fmtInt(value: unknown): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(safeNumber(value)));
  }
}

/* ─── time labels (web useDateFormat formatTime + data-display TimeStamp) ─── */

/** Short clock label for a bucket epoch (web chart X-axis `formatTime`). */
function formatTimeLabel(epoch: number): string {
  if (!Number.isFinite(epoch)) {
    return '—';
  }
  const date = new Date(epoch);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
}

/** Relative last-seen label (web `<TimeStamp format="relative" />`). */
function formatRelative(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return '—';
  }
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 0) {
    return t('time.relative.soon', 'just now');
  }
  if (diffSec < 45) {
    return t('time.relative.now', 'just now');
  }
  const mins = Math.round(diffSec / 60);
  if (mins < 60) {
    return t('time.relative.minutes', '{{n}}m ago', {n: mins});
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return t('time.relative.hours', '{{n}}h ago', {n: hours});
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return t('time.relative.days', '{{n}}d ago', {n: days});
  }
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/* ─── server-accepted literals (faithful from the web siblings) ──────────── */

const WINDOW_LABEL: Record<IngestXRayWindow, string> = {
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
};

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

/* ─── XRayHeader (web L1) ──────────────────────────────────────────────────
   Three summary cards: total samples, distinct fields, and the selected window
   echoed back. The lucide Activity/Layers/Clock icons map to MetricCard's
   accent indicator dot. */

export interface XRayHeaderProps {
  data: IngestXRayResponse | undefined;
  loading: boolean;
  windowSel: IngestXRayWindow;
}

export function XRayHeader({
  data,
  loading,
  windowSel,
}: XRayHeaderProps): React.ReactElement {
  return el(
    View,
    {style: styles.statGrid},
    el(MetricCard, {
      label: t('admin.xray.stats.samples', 'Total samples'),
      value: loading ? '—' : fmtInt(data?.total_samples ?? 0),
      helper: t('admin.xray.stats.samplesSub', 'within selected window'),
      tone: 'accent',
    }),
    el(MetricCard, {
      label: t('admin.xray.stats.fields', 'Distinct fields'),
      value: loading ? '—' : fmtInt(data?.unique_fields ?? 0),
      helper: t('admin.xray.stats.fieldsSub', 'unique signal names'),
      tone: 'accent',
    }),
    el(MetricCard, {
      label: t('admin.xray.stats.window', 'Window'),
      value: t(`admin.xray.windowLabel.${windowSel}`, WINDOW_LABEL[windowSel]),
      helper: t('admin.xray.stats.windowSub', 'observation horizon'),
      tone: 'neutral',
    }),
  );
}

/* ─── XRayControls (web L2) ────────────────────────────────────────────────
   Vehicle picker + window + bucket selectors. Each value is constrained to a
   server-accepted literal so we never round-trip a 400 over a typo; the bucket
   dropdown auto-disables any bucket >= the current window. */

export interface XRayControlsProps {
  vehicles: Vehicle[];
  vehicleId: number | null;
  windowSel: IngestXRayWindow;
  bucketSel: IngestXRayBucket;
  onVehicleChange: (id: number | null) => void;
  onWindowChange: (w: IngestXRayWindow) => void;
  onBucketChange: (b: IngestXRayBucket) => void;
}

export function XRayControls({
  vehicles,
  vehicleId,
  windowSel,
  bucketSel,
  onVehicleChange,
  onWindowChange,
  onBucketChange,
}: XRayControlsProps): React.ReactElement {
  const vehicleOptions: SelectOption[] = [
    {value: '', label: t('admin.xray.controls.selectVehicle', 'Select vehicle…')},
    ...vehicles.map(v => ({
      value: String(v.id),
      label: v.display_name || v.vin || `Vehicle ${v.id}`,
    })),
  ];

  const windowOptions: SelectOption[] = ALL_WINDOWS.map(w => ({
    value: w,
    label: t(`admin.xray.windowOption.${w}`, w),
  }));

  const bucketOptions: SelectOption[] = ALL_BUCKETS.map(b => {
    const tooBig = BUCKET_SECS[b] >= WINDOW_SECS[windowSel];
    return {
      value: b,
      label: t(`admin.xray.bucketOption.${b}`, b),
      disabled: tooBig,
    };
  });

  return el(
    View,
    {style: styles.controlsRow},
    el(
      View,
      {
        style: styles.controlVehicle,
        accessibilityLabel: t('admin.xray.controls.vehicleAria', 'Vehicle'),
      },
      el(Select, {
        value: vehicleId !== null ? String(vehicleId) : '',
        onValueChange: (next: string) => onVehicleChange(next ? Number(next) : null),
        options: vehicleOptions,
      }),
    ),
    el(
      View,
      {
        style: styles.controlSmall,
        accessibilityLabel: t('admin.xray.controls.windowAria', 'Window'),
      },
      el(Select, {
        value: windowSel,
        onValueChange: (next: string) => onWindowChange(next as IngestXRayWindow),
        options: windowOptions,
      }),
    ),
    el(
      View,
      {
        style: styles.controlSmall,
        accessibilityLabel: t('admin.xray.controls.bucketAria', 'Bucket'),
      },
      el(Select, {
        value: bucketSel,
        onValueChange: (next: string) => onBucketChange(next as IngestXRayBucket),
        options: bucketOptions,
      }),
    ),
  );
}

/* ─── XRayBucketChart (web L3) ─────────────────────────────────────────────
   Bar chart of `count` per `bucket_start`. The recharts time-series renders as
   native bars; the ChartContainer a11y fallback table is reproduced inline with
   the Bucket/Samples columns. */

export interface XRayBucketChartProps {
  buckets: IngestXRayBucketPoint[];
  loading: boolean;
}

export function XRayBucketChart({
  buckets,
  loading,
}: XRayBucketChartProps): React.ReactElement {
  // Pre-derive a numeric epoch so the labels sort + format cheaply without
  // re-parsing the ISO string per render (mirrors the web `series` memo).
  const series = React.useMemo(
    () =>
      (buckets ?? []).map(b => ({
        ts: Date.parse(b.bucket_start),
        bucket_start: b.bucket_start,
        count: b.count,
      })),
    [buckets],
  );

  const isEmpty = !loading && series.length === 0;
  const max = Math.max(...series.map(s => s.count), 1);

  const ariaLabel = t(
    'admin.xray.chart.ariaLabel',
    'Bar chart of ingest sample counts per time bucket.',
  );
  const bucketCol = t('admin.xray.chart.cols.bucket', 'Bucket');
  const countCol = t('admin.xray.chart.cols.count', 'Samples');

  let body: React.ReactElement;
  if (loading) {
    body = el(
      View,
      {style: styles.skeletonWrap},
      el(View, {style: styles.skeletonBar}),
      el(View, {style: styles.skeletonBar}),
      el(View, {style: styles.skeletonBar}),
    );
  } else if (isEmpty) {
    body = el(
      View,
      {style: styles.centeredEmpty},
      el(
        AppText,
        {tone: 'muted'},
        t('admin.xray.chart.empty', 'No samples in the selected window.'),
      ),
    );
  } else {
    body = el(
      View,
      {style: styles.chartBody},
      el(
        View,
        {style: styles.bars},
        ...series.map((s, i) =>
          el(
            View,
            {key: `${s.bucket_start}-${i}`, style: styles.barRow},
            el(
              AppText,
              {variant: 'caption', numberOfLines: 1, style: styles.barLabel},
              formatTimeLabel(s.ts),
            ),
            el(
              View,
              {style: styles.barTrack},
              el(View, {
                style: [
                  styles.barFill,
                  {width: `${Math.max((s.count / max) * 100, 4)}%`},
                ],
              }),
            ),
            el(
              AppText,
              {variant: 'caption', style: styles.barValue},
              fmtInt(s.count),
            ),
          ),
        ),
      ),
      renderDataTable(
        bucketCol,
        countCol,
        series.map(s => ({
          key: s.bucket_start,
          label: formatTimeLabel(s.ts),
          value: fmtInt(s.count),
        })),
      ),
    );
  }

  const header = el(
    View,
    {style: styles.chartHeader},
    el(
      AppText,
      {variant: 'body', weight: 'semibold'},
      t('admin.xray.chart.title', 'Samples per bucket'),
    ),
    el(
      AppText,
      {variant: 'caption', tone: 'muted'},
      t(
        'admin.xray.chart.subtitle',
        'Time-series of ingested telemetry rows over the selected window.',
      ),
    ),
  );

  return el(GlassPanel, {
    style: styles.chartPanel,
    accessible: true,
    accessibilityLabel: ariaLabel,
    children: el(React.Fragment, null, header, body),
  });
}

interface DataTableRow {
  key: string;
  label: string;
  value: string;
}

/** Accessible two-column fallback table (web ChartContainer dataColumns). */
function renderDataTable(
  labelHeader: string,
  valueHeader: string,
  rows: DataTableRow[],
): React.ReactElement {
  return el(
    View,
    {
      accessible: true,
      accessibilityRole: 'summary',
      accessibilityLabel: `${labelHeader} / ${valueHeader} (${rows.length})`,
      style: styles.dtTable,
    },
    el(
      View,
      {style: [styles.dtRow, styles.dtHeaderRow]},
      el(
        AppText,
        {variant: 'caption', tone: 'muted', weight: 'semibold', style: styles.dtCell},
        labelHeader,
      ),
      el(
        AppText,
        {
          variant: 'caption',
          tone: 'muted',
          weight: 'semibold',
          style: [styles.dtCell, styles.cellRight],
        },
        valueHeader,
      ),
    ),
    ...rows.map(row =>
      el(
        View,
        {key: row.key, style: styles.dtRow},
        el(
          AppText,
          {variant: 'caption', tone: 'secondary', style: styles.dtCell},
          row.label,
        ),
        el(
          AppText,
          {variant: 'caption', weight: 'semibold', style: [styles.dtCell, styles.cellRight]},
          row.value,
        ),
      ),
    ),
  );
}

/* ─── XRayFieldsTable (web L4) ──────────────────────────────────────────────
   Per-field stats, sortable by sample_count + last_seen_at so an operator can
   answer "which field hasn't arrived recently?" or "which is the loudest?".
   Reproduces useSortToggle('sample_count', 'desc') and the web comparator. */

type FieldSortKey = 'field' | 'sample_count' | 'last_seen_at' | 'value_kind';

export interface XRayFieldsTableProps {
  rows: IngestXRayFieldStat[];
  loading: boolean;
}

export function XRayFieldsTable({
  rows,
  loading,
}: XRayFieldsTableProps): React.ReactElement {
  const [sortKey, setSortKey] = React.useState<FieldSortKey>('sample_count');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  // Mirror web useSortToggle: same key toggles direction, a new key resets to desc.
  const onSort = (key: FieldSortKey) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = React.useMemo(() => {
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

  const headers: Array<{key: FieldSortKey; label: string; right?: boolean}> = [
    {key: 'field', label: t('admin.xray.fields.cols.field', 'Field')},
    {key: 'sample_count', label: t('admin.xray.fields.cols.count', 'Samples'), right: true},
    {key: 'last_seen_at', label: t('admin.xray.fields.cols.lastSeen', 'Last seen')},
    {key: 'value_kind', label: t('admin.xray.fields.cols.kind', 'Kind')},
  ];

  const emptyMessage = loading
    ? t('admin.xray.fields.loading', 'Loading…')
    : t(
        'admin.xray.fields.empty',
        'No samples in this window. Try widening the window or confirm the vehicle is publishing.',
      );

  return el(GlassPanel, {
    style: styles.tablePanel,
    children: el(
      View,
      {style: styles.fieldsTable},
      el(
        View,
        {style: styles.fieldsHeaderRow},
        ...headers.map(h => {
          const arrow = sortKey === h.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
          return el(
            Pressable,
            {
              key: h.key,
              style: styles.fieldsHeaderCell,
              accessibilityRole: 'button',
              accessibilityLabel: h.label,
              onPress: () => onSort(h.key),
            },
            el(
              AppText,
              {
                variant: 'caption',
                tone: 'muted',
                weight: 'semibold',
                style: h.right ? styles.cellRight : undefined,
              },
              `${h.label}${arrow}`,
            ),
          );
        }),
      ),
      sorted.length === 0
        ? el(
            View,
            {style: styles.fieldsEmpty},
            el(AppText, {tone: 'muted'}, emptyMessage),
          )
        : el(
            View,
            null,
            ...sorted.map(row =>
              el(
                View,
                {key: row.field, style: styles.fieldsRow},
                el(
                  AppText,
                  {variant: 'caption', numberOfLines: 1, style: [styles.fieldsCell, styles.mono]},
                  row.field,
                ),
                el(
                  AppText,
                  {variant: 'caption', style: [styles.fieldsCell, styles.cellRight]},
                  fmtInt(row.sample_count),
                ),
                el(
                  AppText,
                  {variant: 'caption', tone: 'secondary', style: styles.fieldsCell},
                  formatRelative(row.last_seen_at),
                ),
                el(
                  View,
                  {style: styles.fieldsCell},
                  el(
                    View,
                    {style: styles.kindBadge},
                    el(
                      AppText,
                      {variant: 'caption', tone: 'secondary'},
                      formatValueKind(row.value_kind),
                    ),
                  ),
                ),
              ),
            ),
          ),
    ),
  });
}

/* ─── capabilities (parity documentation, mirrors the devtools barrel) ────── */

export const nativeIngestXRayBarrelCapabilities = {
  chartExport: {
    available: false,
    reason:
      'The web XRayBucketChart uses ChartContainer PNG/CSV export, fullscreen, and a recharts time-axis + hover Tooltip; native renders static bars + an accessible Bucket/Samples data table instead.',
  },
  tablePagination: {
    available: false,
    reason:
      'The web XRayFieldsTable uses the shared DataTable pagination + column menu + mobileColumns; native renders the full sorted list with tap-to-sort headers (sort behavior preserved).',
  },
  selectControls: {
    available: true,
    reason:
      'The web <Select> dropdowns are reproduced by the native parity <Select> (Modal option list). The per-control aria-label maps to the control group accessibilityLabel.',
  },
} as const;

const styles = StyleSheet.create({
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  controlVehicle: {
    width: 256,
    maxWidth: '100%',
  },
  controlSmall: {
    width: 160,
    maxWidth: '100%',
  },
  chartPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  chartHeader: {
    gap: spacing.xs,
  },
  chartBody: {
    gap: spacing.md,
  },
  bars: {
    gap: spacing.sm,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  barLabel: {
    width: 72,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  barValue: {
    width: 48,
    textAlign: 'right',
  },
  dtTable: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  dtRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dtHeaderRow: {
    borderTopWidth: 0,
    backgroundColor: colors.surfaceRaised,
  },
  dtCell: {
    flex: 1,
  },
  centeredEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  skeletonWrap: {
    gap: spacing.sm,
  },
  skeletonBar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceHover,
  },
  tablePanel: {
    padding: spacing.lg,
  },
  fieldsTable: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  fieldsHeaderRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  fieldsHeaderCell: {
    flex: 1,
  },
  fieldsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  fieldsCell: {
    flex: 1,
  },
  fieldsEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  cellRight: {
    textAlign: 'right',
  },
  mono: {
    fontFamily: 'monospace',
  },
  kindBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
