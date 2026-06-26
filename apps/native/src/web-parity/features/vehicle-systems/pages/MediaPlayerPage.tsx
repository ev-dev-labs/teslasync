// Native parity port of web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx.
//
// `MediaPlayerPage` is the in-car audio surface. It resolves the active vehicle,
// derives a date window from a canonical range picker (default `'7d'` preset),
// fetches the latest media snapshot via `useQuery(['media','latest',activeId])`
// (GET `/media/latest?vehicle_id=`, polling every 10s) and the playback history
// via `useQuery(['media','history',activeId])` (GET `/media?vehicle_id=&limit=500`),
// then renders a Now-Playing hero card, a volume RadialGauge + four stat cards,
// a volume-over-time area chart + a source-distribution donut with a legend, and
// a sortable, paginated playback-history table. Every state name (`t`,
// `vehicleId`, `start`/`end`/`setRange`, `tableSortKey`/`tableSortDir`,
// `activeId`, `latest`/`latestLoading`/`latestError`, `history`/`historyLoading`/
// `historyError`, `anyError`, `isLoading`, `filtered`, `stats`, `volumeChartData`,
// `sourceData`, `columns`, `sortedHistory`, `isPlaying`, `progressPct`), the API
// paths + query gating + `refetchInterval`, and every i18n key + English fallback
// are preserved verbatim from the source. The `MediaSnapshot`/`SourceSlice`
// types, the `PRESET_IDS` constant, and the `fmtPlayTime`/`statusVariant`/
// `statusLabel` helpers keep byte-identical logic; `sourceIcon` keeps identical
// branch logic but resolves to native emoji glyphs instead of lucide SVGs.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4-7), each documented in the parity sidecar:
//   - react-i18next `useTranslation` (L2) -> a native i18n shim. i18next returns
//     the KEY when no translation/fallback exists, so the shim resolves
//     `t(key)` -> key and `t(key, 'English', params?)` -> the English fallback
//     with `{{token}}` interpolation (same shim as the sibling page ports).
//   - lucide-react icons (L4-7: Music/Disc3/Radio/Bluetooth/Podcast/Headphones/
//     Volume2/ListMusic/BarChart3/AlertCircle) are SVG with no native analog ->
//     decorative emoji glyphs via the local `Glyph` (accessibilityElementsHidden);
//     the adjacent label always carries the meaning. The `sourceIcon` colour
//     intent (spotify=green/bluetooth=blue/radio=amber/podcast=purple/other=cyan)
//     maps to DISTINCT glyphs (💿/🔵/📻/🎙️/🎧) since emoji ignore tint.
//   - `cn` from @/lib/cn (L8) is a className combiner with no native surface
//     (StyleSheet replaces Tailwind classes) -> dropped; conditional styling is
//     computed and applied via style arrays.
//   - `PageContainer` from @/components/layout (L10) -> the web-parity layout
//     PageContainer (reused; title/subtitle/error/actions/loading match).
//   - `GlassPanel` from @/components/ui (L11) -> the shared native GlassPanel. The
//     web `glow` prop (cyan when playing) -> a conditional accent border/shadow
//     style; Tailwind padding classes -> panel `padding` styles.
//   - `Badge` + `DataTable`/`Column` from @/components/ui (L12-13) -> the
//     web-parity ui ports (reused 1:1; same variant/size/sort/pagination API).
//   - `RangePicker`/`VehicleSelect` from @/components/forms (L14) -> local
//     read-only chips (RangePicker shows the resolved start->end window,
//     VehicleSelect shows the resolved vehicle name). Interactive calendar
//     selection + vehicle switching are UNAVAILABLE on native (documented);
//     `presetIds`/`align`/`onChange`/`triggerTestId` accepted for compatibility.
//   - `useRangeState` (L15) -> a local native-safe shim holding {start,end} in
//     component state, defaulting to the `'7d'` preset (today-6 .. today, ISO
//     yyyy-mm-dd) exactly as the web preset resolves. URL sync + localStorage
//     persistence are UNAVAILABLE on native (documented); `setRange` still
//     updates state for source compatibility.
//   - `useSelectedVehicle` (L16) -> a local first-vehicle native shim (URL
//     path/query + persisted-store selection is UNAVAILABLE on native).
//   - `MetricCard` from @/components/data-display (L17) -> a local component
//     mirroring the web public API (label/value/icon/color); the NeonColor maps
//     to the SI palette and only the icon chip is tinted (the value stays
//     text-primary, as on web).
//   - `TimeStamp` from @/components/data-display (L18) -> the web-parity port
//     (reused 1:1).
//   - `EmptyState` from @/components/feedback (L19) -> a local component mirroring
//     the web API ({ message, icon? }); the shared native EmptyState requires a
//     `title` the source never supplies, so a message-only shim stays faithful.
//   - `AlertBanner` from @/components/feedback (L20) -> a local component
//     mirroring the web API (variant/icon/children); the danger rail + icon are
//     tinted and the body carries the message.
//   - `getErrorMessage` (L21), `formatDateTime` (L31), `fmtInt`/`fmtNumber` (L32)
//     are inlined verbatim so rendered strings are byte-identical.
//   - `FadeIn` from @/components/motion (L22) -> the web-parity motion barrel
//     (reused; `delay` in seconds preserved).
//   - the chart primitives from @/components/charts (L23-29): RadialGauge/
//     ChartTooltip/ChartGradient/AreaChart/Area/XAxis/YAxis/Tooltip/
//     ResponsiveContainer/PieChart/Pie/Cell + chartGrid/axisTickSm/CHART_COLORS
//     -> the web-parity charts barrel, which preserves the Recharts public API
//     while rendering React-Native-safe primitives (no Recharts/SVG/DOM). The
//     recharts JSX is kept structurally faithful; leaf primitives render
//     accessible "unavailable" placeholders. RadialGauge renders a native arc.
//     Two native-specific adaptations: the SVG `<defs>` wrapper (a DOM element)
//     is dropped and `ChartGradient` (a native inert marker) is rendered directly
//     as an AreaChart child; and `<CartesianGrid {...chartGrid} />` becomes the
//     `{chartGrid}` element child, because the native `chartGrid` export is a
//     rendered grid placeholder rather than a spreadable props object. The volume
//     numbers stay reachable via the history table's Volume column; the source
//     distribution numbers stay reachable via the donut legend below the chart.
//   - `usePageTitle` (L30) -> a documented native-safe no-op (no DOM
//     document.title; the translated title still flows into PageContainer's
//     header).
//   - `request` from @/api/client (L33) -> the web-parity native api client
//     `request` (auto-prefixes /api/v1, camelCaseKeys preserves snake_case keys).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet: the `grid-cols-5` stat
// row -> a flex-wrap row of equal cells; the `lg:grid-cols-3` chart row ->
// stacked full-width panels; `p-4/p-6` -> panel padding; the `--text-primary/
// secondary/muted` tokens -> colors.text*; the long page body is wrapped in a
// ScrollView so every section stays reachable.

import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn} from '../../../components/motion';
import {Badge} from '../../../components/ui/Badge';
import {DataTable, type Column} from '../../../components/ui/DataTable';
import {TimeStamp} from '../../../components/data-display/TimeStamp';
import {
  Area,
  AreaChart,
  Cell,
  ChartGradient,
  ChartTooltip,
  chartGrid,
  CHART_COLORS,
  Pie,
  PieChart,
  RadialGauge,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTickSm,
} from '../../../components/charts';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English'.
// `{{token}}` placeholders are interpolated from the optional params bag.
type TParams = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, params?: TParams) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

const translate: TFunc = (key, fallback, params) =>
  interpolate(typeof fallback === 'string' ? fallback : key, params);

function useTranslation(): {t: TFunc} {
  return {t: translate};
}

/* ── usePageTitle shim ─────────────────────────────────────────── */
// The web hook writes `document.title`; native has no DOM document, so this is a
// documented native-safe no-op. The translated title is still computed at the
// call site and rendered by PageContainer as the on-screen header.
function usePageTitle(title: string): void {
  React.useEffect(() => {
    return undefined;
  }, [title]);
}

/* ── numberFormat (inlined from web @/lib/numberFormat) ────────── */
// `safeNumber` collapses non-finite/non-number values to 0; `fmtNumber` is the
// locale-aware fixed-precision formatter (default precision 2); `fmtInt` is
// `fmtNumber(v, 0)`.
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ── dateFormat (inlined from web @/lib/dateFormat) ────────────── */
// Full date + time: "Apr 4, 2026, 2:30 AM". Returns the universal "—"
// placeholder for unrenderable input, matching the web contract.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ── errorMessage (inlined from web @/lib/errorMessage) ────────── */
// Safely extract a human-readable message from an unknown error.
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ── useSelectedVehicle shim (native-safe; first vehicle in the fleet) ── */
// The web hook resolves URL path/query > persisted store > first vehicle. Native
// has no DOM URL and no cross-page selected-vehicle store, so selection falls
// back to the first vehicle in the fleet. The VehicleSelect chip is
// non-interactive on native (documented in the sidecar).
function useSelectedVehicle(): {vehicleId: number | null} {
  const {data: vehicles} = useVehicles();
  const vehicleId = vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  return {vehicleId};
}

/* ── useRangeState shim (native-safe; in-state {start,end} window) ── */
// The web hook syncs the range to the URL + localStorage and resolves named
// presets. Native has no DOM URL or localStorage, so both are UNAVAILABLE; the
// shim holds the window in component state, defaulting to the `'7d'` preset
// (today-6 .. today) exactly as the web preset resolves. `setRange` still updates
// state for source compatibility. `persistKey`/`defaultPresetId` are accepted but
// the default window is always the documented 7-day window this page requests.
interface RangeValue {
  start: string;
  end: string;
}

interface UseRangeStateOptions {
  persistKey?: string;
  defaultPresetId?: string;
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveDefaultRange(): RangeValue {
  const now = new Date();
  const s = new Date(now);
  s.setDate(s.getDate() - 6);
  return {start: isoFromDate(s), end: isoFromDate(now)};
}

function useRangeState(_options: UseRangeStateOptions = {}): {
  start: string;
  end: string;
  setRange: (range: RangeValue) => void;
} {
  const [range, setRange] = React.useState<RangeValue>(resolveDefaultRange);
  const setRangeCb = React.useCallback(
    (next: RangeValue) => setRange(next),
    [],
  );
  return {start: range.start, end: range.end, setRange: setRangeCb};
}

/* ── Decorative glyph (lucide icon substitute) ─────────────────── */
function Glyph({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={style}>
      {children}
    </AppText>
  );
}

/* ── Local EmptyState (web @/components/feedback EmptyState) ────── */
// Mirrors the web API (`{ message, icon? }`): a centred muted message with an
// optional decorative glyph. The shared native EmptyState requires a `title` the
// source never supplies, so this message-only shim stays faithful.
function EmptyState({message, icon}: {message: string; icon?: string}) {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      {icon ? <Glyph style={styles.emptyIcon}>{icon}</Glyph> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── Local AlertBanner (web @/components/feedback AlertBanner) ──── */
// Mirrors the web public API (variant/icon/children + optional title). The
// variant tints the leading rail + icon; children carries the body message.
function AlertBanner({
  variant,
  icon,
  title,
  children,
}: {
  variant: 'info' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
  title?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const accent =
    variant === 'warning'
      ? colors.warning
      : variant === 'danger'
        ? colors.danger
        : variant === 'success'
          ? colors.success
          : colors.accent;
  return (
    <View
      accessibilityRole="summary"
      style={[styles.alertBanner, {borderLeftColor: accent}]}>
      <View style={styles.alertHeader}>
        {icon ? <View style={styles.alertIcon}>{icon}</View> : null}
        {title ? (
          <AppText style={[styles.alertTitle, {color: accent}]} weight="semibold">
            {title}
          </AppText>
        ) : null}
      </View>
      {children != null ? (
        <AppText style={styles.alertBody} tone="secondary">
          {children}
        </AppText>
      ) : null}
    </View>
  );
}

/* ── Local MetricCard (web @/components/data-display MetricCard) ── */
// Mirrors the web MetricCard public API. The web NeonColor maps to the SI palette;
// only the icon chip is tinted (the value stays text-primary, as on the web).
type MetricColor = 'cyan' | 'green' | 'amber' | 'purple' | 'red';

const METRIC_TINT: Record<MetricColor, string> = {
  cyan: colors.accent,
  green: colors.success,
  amber: colors.warning,
  purple: colors.violet,
  red: colors.danger,
};

function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
}: {
  label: string;
  value: string | number;
  icon?: string;
  color?: MetricColor;
}) {
  const tint = METRIC_TINT[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricRow}>
        <View style={styles.metricTextBlock}>
          <AppText
            numberOfLines={1}
            style={styles.metricLabel}
            tone="muted"
            variant="caption">
            {label}
          </AppText>
          <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
            {value}
          </AppText>
        </View>
        {icon ? (
          <View
            style={[
              styles.metricIcon,
              {borderColor: `${tint}55`, backgroundColor: `${tint}1f`},
            ]}>
            <Glyph style={[styles.metricIconGlyph, {color: tint}]}>{icon}</Glyph>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ── Local RangePicker (web @/components/forms RangePicker) ─────── */
// Read-only on native: shows the resolved start->end window. Interactive calendar
// selection is UNAVAILABLE (documented in the sidecar); `presetIds`/`onChange`/
// `align` are accepted for source compatibility.
function RangePicker({
  value,
  triggerTestId,
}: {
  value: RangeValue;
  onChange?: (range: RangeValue) => void;
  presetIds?: string[];
  align?: 'start' | 'end';
  triggerTestId?: string;
}) {
  return (
    <View accessibilityRole="text" style={styles.rangeChip} testID={triggerTestId}>
      <Glyph style={styles.rangeChipGlyph}>📅</Glyph>
      <AppText
        numberOfLines={1}
        style={styles.rangeChipText}
        variant="caption"
        weight="semibold">
        {`${value.start} → ${value.end}`}
      </AppText>
    </View>
  );
}

/* ── Local VehicleSelect (web @/components/forms VehicleSelect) ── */
// Read-only on native: shows the resolved vehicle name. Interactive selection is
// UNAVAILABLE (documented in the sidecar).
function VehicleSelect() {
  const {data: vehicles} = useVehicles();
  const {vehicleId} = useSelectedVehicle();
  const name =
    vehicles?.find(v => v.id === vehicleId)?.display_name ??
    translate('All Vehicles');
  return (
    <View accessibilityRole="text" style={styles.vehicleChip}>
      <Glyph style={styles.vehicleChipGlyph}>🚗</Glyph>
      <AppText
        numberOfLines={1}
        style={styles.vehicleChipText}
        variant="caption"
        weight="semibold">
        {name}
      </AppText>
    </View>
  );
}

/* ── Types ─────────────────────────────────────────────────────── */

interface MediaSnapshot {
  id: number;
  playback_status?: string;
  playback_source?: string;
  now_playing_title?: string;
  now_playing_artist?: string;
  now_playing_album?: string;
  now_playing_station?: string;
  now_playing_elapsed?: number;
  now_playing_duration?: number;
  audio_volume?: number;
  audio_volume_max?: number;
  audio_volume_increment?: number;
  created_at: string;
}

interface SourceSlice {
  name: string;
  value: number;
  color: string;
}

/* ── Constants ─────────────────────────────────────────────────── */

const PRESET_IDS = ['today', '7d', '30d', '90d', 'mtd', 'ytd', 'all'];

/* ── Helpers ───────────────────────────────────────────────────── */

function fmtPlayTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// The web `sourceIcon` returns a coloured lucide icon. Native has no lucide SVGs
// and emoji ignore tint, so each colour branch maps to a DISTINCT recognisable
// glyph: spotify (Disc3/green) -> 💿, bluetooth (Bluetooth/blue) -> 🔵,
// radio/fm/am (Radio/amber) -> 📻, podcast (Podcast/purple) -> 🎙️,
// other (Headphones/cyan) -> 🎧. Branch logic is byte-identical to the source.
function sourceIcon(source: string): React.ReactNode {
  const s = (source ?? '').toLowerCase();
  if (s.includes('spotify')) {
    return <Glyph style={styles.sourceGlyph}>💿</Glyph>;
  }
  if (s.includes('bluetooth')) {
    return <Glyph style={styles.sourceGlyph}>🔵</Glyph>;
  }
  if (s.includes('radio') || s.includes('fm') || s.includes('am')) {
    return <Glyph style={styles.sourceGlyph}>📻</Glyph>;
  }
  if (s.includes('podcast')) {
    return <Glyph style={styles.sourceGlyph}>🎙️</Glyph>;
  }
  return <Glyph style={styles.sourceGlyph}>🎧</Glyph>;
}

function statusVariant(status: string): 'success' | 'warning' | 'neutral' {
  const s = (status ?? '').toLowerCase();
  if (s.includes('playing')) {
    return 'success';
  }
  if (s.includes('paused')) {
    return 'warning';
  }
  return 'neutral';
}

function statusLabel(status: string, t: TFunc): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('playing')) {
    return t('Playing');
  }
  if (s.includes('paused')) {
    return t('Paused');
  }
  return t('Stopped');
}

/* ── Section header (web `<h3>` with leading icon) ─────────────── */
function SectionHeader({glyph, children}: {glyph: string; children: string}) {
  return (
    <View style={styles.sectionHeader}>
      <Glyph style={styles.sectionHeaderGlyph}>{glyph}</Glyph>
      <AppText style={styles.sectionHeaderText} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

export default function MediaPlayerPage() {
  const {t} = useTranslation();
  usePageTitle(t('Media Player'));

  const {vehicleId} = useSelectedVehicle();
  const {start, end, setRange} = useRangeState({
    persistKey: 'media-player.range',
    defaultPresetId: '7d',
  });
  const [tableSortKey, setTableSortKey] = useState('created_at');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');

  /* ── Queries ──────────────────────────────────────────────── */

  const activeId = vehicleId != null ? String(vehicleId) : '';

  const {
    data: latest,
    isLoading: latestLoading,
    error: latestError,
  } = useQuery({
    queryKey: ['media', 'latest', activeId],
    queryFn: () => request<MediaSnapshot>(`/media/latest?vehicle_id=${activeId}`),
    enabled: !!activeId,
    refetchInterval: 10_000,
  });

  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
  } = useQuery({
    queryKey: ['media', 'history', activeId],
    queryFn: () =>
      request<MediaSnapshot[]>(`/media?vehicle_id=${activeId}&limit=500`),
    enabled: !!activeId,
  });

  const anyError = [latestError, historyError].find(Boolean);

  const isLoading = latestLoading || historyLoading;

  /* ── Filtered history ─────────────────────────────────────── */

  const filtered = useMemo(() => {
    if (!history?.length) {
      return [];
    }
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return history.filter(s => {
      // `ts` is the source's local `t` (timestamp ms) renamed to avoid shadowing
      // the i18n `t`; pure-local, behaviour identical.
      const ts = new Date(s.created_at).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [history, start, end]);

  /* ── Derived stats ────────────────────────────────────────── */

  const stats = useMemo(() => {
    if (!filtered.length) {
      return {uniqueTracks: 0, topSource: '--', avgVolume: 0};
    }

    const titles = new Set(
      filtered.map(s => s.now_playing_title).filter(Boolean),
    );

    const sources = filtered.reduce<Record<string, number>>((acc, s) => {
      if (s.playback_source) {
        acc[s.playback_source] = (acc[s.playback_source] ?? 0) + 1;
      }
      return acc;
    }, {});

    const topSource =
      Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '--';

    const avgVol =
      filtered.reduce((sum, s) => sum + (s.audio_volume ?? 0), 0) /
      filtered.length;

    return {uniqueTracks: titles.size, topSource, avgVolume: avgVol};
  }, [filtered]);

  /* ── Volume chart data ────────────────────────────────────── */

  const volumeChartData = useMemo(() => {
    if (!filtered.length) {
      return [];
    }
    const sorted = [...filtered].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    return sorted.map(s => ({
      time: formatDateTime(s.created_at),
      volume: s.audio_volume ?? 0,
    }));
  }, [filtered]);

  /* ── Source distribution ──────────────────────────────────── */

  const sourceData = useMemo<SourceSlice[]>(() => {
    if (!filtered.length) {
      return [];
    }
    const counts = filtered.reduce<Record<string, number>>((acc, s) => {
      const src = s.playback_source || 'Unknown';
      acc[src] = (acc[src] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name,
        value,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [filtered]);

  /* ── Table columns ────────────────────────────────────────── */

  const columns = useMemo<Column<MediaSnapshot>[]>(
    () => [
      {
        key: 'created_at',
        header: t('Time'),
        sortable: true,
        render: row => <TimeStamp style={styles.timeCell} value={row.created_at} />,
      },
      {
        key: 'now_playing_title',
        header: t('Track'),
        sortable: true,
        render: row => (
          <AppText numberOfLines={1} style={styles.trackCell} weight="semibold">
            {row.now_playing_title || '--'}
          </AppText>
        ),
      },
      {
        key: 'now_playing_artist',
        header: t('Artist'),
        sortable: true,
        render: row => (
          <AppText numberOfLines={1} tone="secondary" variant="caption">
            {row.now_playing_artist || '--'}
          </AppText>
        ),
      },
      {
        key: 'playback_source',
        header: t('Source'),
        sortable: true,
        render: row => (
          <View style={styles.sourceCell}>
            {sourceIcon(row.playback_source ?? '')}
            <AppText tone="secondary" variant="caption">
              {row.playback_source || '--'}
            </AppText>
          </View>
        ),
      },
      {
        key: 'audio_volume',
        header: t('Volume'),
        sortable: true,
        render: row => (
          <AppText style={styles.volumeCell}>
            {`${row.audio_volume ?? '—'}/${row.audio_volume_max ?? '—'}`}
          </AppText>
        ),
      },
      {
        key: 'playback_status',
        header: t('Status'),
        sortable: true,
        render: row => (
          <Badge size="sm" variant={statusVariant(row.playback_status ?? '')}>
            {statusLabel(row.playback_status ?? '', t)}
          </Badge>
        ),
      },
    ],
    [t],
  );

  /* ── Table sort handler ───────────────────────────────────── */

  const handleSort = (key: string) => {
    if (key === tableSortKey) {
      setTableSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortKey(key);
      setTableSortDir('desc');
    }
  };

  const sortedHistory = useMemo(() => {
    const data = [...filtered];
    data.sort((a, b) => {
      const aVal = a[tableSortKey as keyof MediaSnapshot];
      const bVal = b[tableSortKey as keyof MediaSnapshot];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return tableSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal ?? '');
      const bStr = String(bVal ?? '');
      return tableSortDir === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
    return data;
  }, [filtered, tableSortKey, tableSortDir]);

  /* ── Derived state ────────────────────────────────────────── */

  const isPlaying = latest?.playback_status?.toLowerCase().includes('playing');
  const progressPct =
    latest?.now_playing_duration && latest.now_playing_duration > 0
      ? ((latest.now_playing_elapsed ?? 0) / latest.now_playing_duration) * 100
      : 0;

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('Media Player')}
      subtitle={t('Now playing, volume, and listening history')}
      loading={isLoading}
      error={latestError instanceof Error ? latestError : null}
      actions={
        <View style={styles.actions}>
          <VehicleSelect />
          <RangePicker
            value={{start, end}}
            onChange={r => setRange(r)}
            presetIds={PRESET_IDS}
            align="end"
            triggerTestId="media-player-range"
          />
        </View>
      }>
      <ScrollView contentContainerStyle={styles.body}>
        {anyError ? (
          <AlertBanner
            variant="danger"
            icon={<Glyph style={styles.alertGlyph}>⚠️</Glyph>}>
            {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(
              anyError,
            )}`}
          </AlertBanner>
        ) : null}

        {/* ── Now Playing card ─────────────────────────────────── */}
        <FadeIn>
          <GlassPanel
            style={[
              styles.nowPlayingPanel,
              isPlaying ? styles.nowPlayingPanelGlow : null,
            ]}>
            <View style={styles.nowPlayingRow}>
              {/* Album art placeholder */}
              <View style={styles.albumArt}>
                <Glyph style={styles.albumArtGlyph}>🎵</Glyph>
              </View>

              {/* Track info */}
              <View style={styles.trackInfo}>
                <View style={styles.trackTitleRow}>
                  <AppText
                    numberOfLines={1}
                    style={styles.trackTitle}
                    weight="bold">
                    {latest?.now_playing_title || t('No track')}
                  </AppText>
                  {latest?.playback_status ? (
                    <Badge dot variant={statusVariant(latest.playback_status)}>
                      {statusLabel(latest.playback_status, t)}
                    </Badge>
                  ) : null}
                </View>

                <AppText numberOfLines={1} style={styles.artistText} tone="secondary">
                  {`${latest?.now_playing_artist || t('Unknown artist')}${
                    latest?.now_playing_album
                      ? ` — ${latest.now_playing_album}`
                      : ''
                  }`}
                </AppText>

                {latest?.now_playing_station ? (
                  <AppText
                    numberOfLines={1}
                    style={styles.stationText}
                    tone="muted"
                    variant="caption">
                    {latest.now_playing_station}
                  </AppText>
                ) : null}

                {/* Source */}
                {latest?.playback_source ? (
                  <View style={styles.sourceRow}>
                    {sourceIcon(latest.playback_source)}
                    <AppText style={styles.sourceText} tone="secondary" variant="caption">
                      {latest.playback_source}
                    </AppText>
                  </View>
                ) : null}

                {/* Progress bar */}
                {latest?.now_playing_duration ? (
                  <View style={styles.progressRow}>
                    <AppText style={styles.progressTime} tone="secondary" variant="caption">
                      {fmtPlayTime(latest.now_playing_elapsed ?? 0)}
                    </AppText>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, {width: `${progressPct}%`}]} />
                    </View>
                    <AppText style={styles.progressTime} tone="secondary" variant="caption">
                      {fmtPlayTime(latest.now_playing_duration)}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
          </GlassPanel>
        </FadeIn>

        {/* ── Volume + Stats row ───────────────────────────────── */}
        <FadeIn delay={0.05}>
          <View style={styles.statsRow}>
            <View style={styles.statsCell}>
              <GlassPanel style={styles.gaugePanel}>
                <RadialGauge
                  value={latest?.audio_volume ?? 0}
                  max={latest?.audio_volume_max || 11}
                  label={t('Volume')}
                  unit=""
                  color={CHART_COLORS[0]}
                  size={120}
                />
              </GlassPanel>
            </View>

            <View style={styles.statsCell}>
              <MetricCard
                label={t('Unique Tracks')}
                value={stats.uniqueTracks}
                icon="🎶"
                color="purple"
              />
            </View>

            <View style={styles.statsCell}>
              <MetricCard
                label={t('Top Source')}
                value={stats.topSource}
                icon="📻"
                color="green"
              />
            </View>

            <View style={styles.statsCell}>
              <MetricCard
                label={t('Avg Volume')}
                value={fmtInt(stats.avgVolume)}
                icon="🔊"
                color="cyan"
              />
            </View>

            <View style={styles.statsCell}>
              <MetricCard
                label={t('Volume Step', 'Volume Step')}
                value={
                  latest?.audio_volume_increment != null
                    ? fmtNumber(latest.audio_volume_increment, 2)
                    : '—'
                }
                icon="🔊"
                color="purple"
              />
            </View>
          </View>
        </FadeIn>

        {/* ── Charts row ───────────────────────────────────────── */}
        <FadeIn delay={0.1}>
          <View style={styles.chartsColumn}>
            {/* Volume over Time */}
            <GlassPanel style={styles.chartPanel}>
              <SectionHeader glyph="🔊">{t('Volume over Time')}</SectionHeader>
              {volumeChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={volumeChartData}>
                    <ChartGradient id="volGrad" color={CHART_COLORS[0]} />
                    {chartGrid}
                    <XAxis dataKey="time" {...axisTickSm} />
                    <YAxis
                      {...axisTickSm}
                      domain={[0, latest?.audio_volume_max ?? 11]}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="volume"
                      name={t('Volume')}
                      stroke={CHART_COLORS[0]}
                      fill="url(#volGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon="📊"
                  message={t('No volume data for this period')}
                />
              )}
            </GlassPanel>

            {/* Source Distribution */}
            <GlassPanel style={styles.chartPanel}>
              <SectionHeader glyph="💿">{t('Source Distribution')}</SectionHeader>
              {sourceData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={sourceData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={80}
                        paddingAngle={3}
                        strokeWidth={0}>
                        {sourceData.map(entry => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <View style={styles.legendRow}>
                    {sourceData.map(s => (
                      <View key={s.name} style={styles.legendItem}>
                        <View
                          style={[styles.legendDot, {backgroundColor: s.color}]}
                        />
                        <AppText tone="secondary" variant="caption">
                          {s.name}
                        </AppText>
                        <AppText tone="muted" variant="caption">
                          {`(${s.value})`}
                        </AppText>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <EmptyState
                  /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon="💿"
                  message={t('No source data available')}
                />
              )}
            </GlassPanel>
          </View>
        </FadeIn>

        {/* ── Playback History table ───────────────────────────── */}
        <FadeIn delay={0.15}>
          <GlassPanel style={styles.historyPanel}>
            <View style={styles.historyHeaderRow}>
              <SectionHeader glyph="🎶">{t('Playback History')}</SectionHeader>
              <Badge size="sm" style={styles.recordsBadge} variant="neutral">
                {`${filtered.length} ${t('records')}`}
              </Badge>
            </View>
            {sortedHistory.length > 0 ? (
              <DataTable<MediaSnapshot>
                tableId="vehicle-systems:media-history"
                columns={columns}
                data={sortedHistory}
                keyExtractor={row => row.id}
                sortKey={tableSortKey}
                sortDir={tableSortDir}
                onSort={handleSort}
                emptyMessage={t('No playback history')}
                compact
                pagination
              />
            ) : (
              <EmptyState
                /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon="🎵"
                message={t('No playback history for this period')}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: 16,
    paddingBottom: spacing.xl,
  },
  /* alert banner */
  alertBanner: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: 12,
    gap: spacing.xs,
    padding: spacing.md,
  },
  alertHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  alertIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertGlyph: {
    fontSize: 16,
  },
  alertTitle: {
    fontSize: 14,
  },
  alertBody: {
    fontSize: 12,
  },
  /* now playing */
  nowPlayingPanel: {
    padding: 24,
  },
  nowPlayingPanelGlow: {
    borderColor: colors.borderAccent,
    shadowColor: colors.glowCyan,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.4,
    shadowRadius: 18,
  },
  nowPlayingRow: {
    flexDirection: 'row',
    gap: 24,
  },
  albumArt: {
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.6)',
    borderRadius: 12,
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  albumArtGlyph: {
    fontSize: 44,
  },
  trackInfo: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  trackTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  trackTitle: {
    flexShrink: 1,
    fontSize: 20,
  },
  artistText: {
    fontSize: 14,
  },
  stationText: {},
  sourceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sourceText: {},
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  progressTime: {
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    backgroundColor: '#374151',
    borderRadius: 999,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  /* volume + stats row */
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statsCell: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  gaugePanel: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 152,
    padding: spacing.md,
  },
  /* metric cards */
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 152,
    padding: spacing.md,
  },
  metricRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  metricTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  metricIconGlyph: {
    fontSize: 14,
  },
  /* charts */
  chartsColumn: {
    gap: 16,
  },
  chartPanel: {
    padding: spacing.md,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionHeaderGlyph: {
    fontSize: 14,
  },
  sectionHeaderText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendDot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  /* playback history */
  historyPanel: {
    padding: spacing.md,
  },
  historyHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  recordsBadge: {
    marginLeft: 'auto',
  },
  /* table cells */
  timeCell: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  trackCell: {
    color: colors.textPrimary,
    maxWidth: 200,
  },
  sourceCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sourceGlyph: {
    fontSize: 14,
  },
  volumeCell: {
    color: '#22d3ee',
  },
  /* empty states */
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    color: colors.textMuted,
    fontSize: 32,
  },
  emptyMessage: {
    maxWidth: 360,
    textAlign: 'center',
  },
  /* header chips */
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  rangeChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 240,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rangeChipGlyph: {
    fontSize: 12,
  },
  rangeChipText: {
    color: colors.textSecondary,
  },
  vehicleChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  vehicleChipGlyph: {
    fontSize: 12,
  },
  vehicleChipText: {
    color: colors.textSecondary,
  },
});
