// Native parity port of
// web/src/features/analytics/pages/LifetimeStatsPage.tsx.
//
// The web page is the Analytics > Lifetime Stats dashboard: a deterministic,
// all-time summary of a vehicle's driving life. It is composed of a hero
// odometer-style headline, an opt-in AI Q&A block, and seven GlassPanel
// sections — Key Stats, Fun Facts, Savings vs Gasoline, Environmental Impact,
// Personal Records, Activity Summary, and the Achievement gallery. This port
// reproduces every section, the same data reads, the same SI->display unit
// handling, and the same i18n key/fallback intent using React Native
// primitives instead of DOM/Recharts/framer-motion/lucide.
//
// Behaviour preserved verbatim:
//   * Data hook `useLifetimeStats(vehicleId)` and the `/analytics/lifetime`
//     API path (via the ported web-parity hook).
//   * State names: `vehicleId`, `lifetimeQuery`, `data`, `isLoading`, `error`,
//     `stats`, `achievements`, `unlockedCount`, `pulsedId`/`setPulsedId`.
//   * SI math constants `SECONDS_PER_HOUR`/`METERS_PER_KM` and the `fromKm` /
//     `fromKmh` display converters (backend distance is SI km, speed SI km/h).
//   * Every conditional render (`stats ?`, `gas_equivalent_cost > 0`,
//     `earth_circumferences > 0`, `ownership_days > 0`, `achievements.length`).
//   * The deep-link pulse state machine: when a target achievement id is
//     present the badge pulses for 3s, then the pulse clears.
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, framer-motion,
// react-router, or web UI components in native output — contract rule 4):
//   * `useTranslation` (react-i18next) -> `useNativeT`, a `t(key, fallback,
//     vars?)` that returns the English fallback and interpolates `{{var}}`
//     placeholders, preserving every key/fallback/interpolation.
//   * `useUnits` + `useFormatting` (@/hooks/*) -> `useNativeFormat`, which
//     derives the SAME distance/speed/currency/locale values directly from the
//     ported `useSettings()` query (`unit_of_length`, `currency_symbol`,
//     `decimal_precision`, `locale`), with the web 'km'/'$'/'en-US' defaults.
//   * `convertDistanceFromSI` / `convertSpeedFromSI` / `fmtNumber` / `fmtInt`
//     (@/lib/*) -> value-identical native inlines (meters->km/mi, m/s->km/h/mph,
//     locale-grouped number formatting with NaN/Infinity coerced to 0).
//   * `useDateFormat` -> `useNativeDateFormat` (locale-aware
//     `toLocaleDateString`).
//   * `useSelectedVehicle` + `<VehicleSelect>` (global store + react-router URL
//     scope) -> `useNativeSelectedVehicle` (first-vehicle default + local
//     override) and a native pressable-chip `VehicleSelect`. The URL path/query
//     scope precedence is browser-only and documented in the sidecar.
//   * `usePageTitle` (document.title) -> the page header renders the title; the
//     document-title side effect is browser-only (no-op).
//   * `useMotionPreference` + framer-motion `<FadeIn>` / `<StaggerContainer>` /
//     `<StaggerItem>` -> static native layout (final-state render, equivalent
//     to the web reduced-motion branch). `FadeIn`/`StaggerItem` are kept as
//     thin pass-throughs; the achievement stagger grid becomes the native
//     `Grid`.
//   * The `?achievement={id}` deep link (`useSearchParams`/`useNavigate`/
//     `useLocation`) + `scrollIntoView` + DOM `badgeRefs` are browser-only;
//     `useDeepLinkAchievementId` resolves to `null` in native so the pulse
//     state machine is preserved but never auto-triggers (documented).
//   * lucide icons -> emoji glyphs (native-safe; the web page already mixes in
//     emoji such as 🌎/🌳/☕). Per-icon tint is not reproducible with emoji.
//   * `PageContainer`/`Grid`/`GlassPanel`/`StatCard`/`AnimatedNumber`/
//     `ProgressRing`/`Currency`/`EmptyState`/`DataFreshnessAuto`/`HelpTooltip`
//     -> native re-implementations below (GlassPanel + AppText + tokens are the
//     shared native primitives; the rest are local native-safe ports). The
//     circular SVG progress arc is approximated by a proportional disc inside a
//     ring track, the only sub-pixel visual not reproduced (documented).
//   * `AILifetimeStatsQA` is the already-ported native component.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {AILifetimeStatsQA} from '../../../components/ai/AILifetimeStatsQA';
import {
  useLifetimeStats,
  type LifetimeAchievement,
} from '../../../api/hooks/useAnalytics';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

// Tailwind `md:` breakpoint — at/above this width responsive grids use their
// `md` column count; below it they fall back to `default`.
const MD_BREAKPOINT = 768;
// Tailwind spacing scale: gap-N / p-N == N * 4px.
const TW_UNIT = 4;
const PULSE_DURATION_MS = 3000;

// Emoji stand-ins for the web lucide icons (per-icon tint is not reproducible).
const ICONS = {
  car: '🚗',
  zap: '⚡',
  dollar: '💲',
  leaf: '🍃',
  globe: '🌐',
  moon: '🌙',
  clock: '🕐',
  award: '🏅',
  flame: '🔥',
  tree: '🌲',
  home: '🏠',
  trophy: '🏆',
  gauge: '📊',
  battery: '🔋',
} as const;

const ACHIEVEMENT_SIZES = {
  sm: {ring: 56, stroke: 3, icon: 20},
  md: {ring: 72, stroke: 4, icon: 30},
  lg: {ring: 96, stroke: 5, icon: 36},
} as const;

const FRESHNESS_DOT_COLOR: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

/* ── Native-safe inlines for unported web dependencies ─────────────────── */

type TVars = Record<string, string | number>;
type NativeT = (key: string, fallback: string, vars?: TVars) => string;

// react-i18next swap: returns the English fallback and interpolates `{{var}}`.
function useNativeT(): NativeT {
  return useMemo<NativeT>(
    () => (_key, fallback, vars) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
            vars[name] != null ? String(vars[name]) : `{{${name}}}`,
          )
        : fallback,
    [],
  );
}

type DistanceUnit = 'km' | 'mi';
type SpeedUnit = 'km/h' | 'mph';

interface NativeFormat {
  distance: DistanceUnit;
  speed: SpeedUnit;
  locale: string;
  currencySymbol: string;
  formatCurrency: (amount: number, decimals?: number) => string;
}

// Mirror of `useUnits().unitPrefs` + `useFormatting()` resolved directly from
// `useSettings()`: 'km'/'km/h' unless the user prefers miles, '$' currency
// symbol and 'en-US' locale when unset, decimal precision defaulting to 2.
function useNativeFormat(): NativeFormat {
  const {data: settings} = useSettings();
  return useMemo<NativeFormat>(() => {
    const unitOfLength = settings?.unit_of_length;
    const distance: DistanceUnit = unitOfLength === 'mi' ? 'mi' : 'km';
    const speed: SpeedUnit = unitOfLength === 'mi' ? 'mph' : 'km/h';
    const locale =
      typeof settings?.locale === 'string' && settings.locale.trim().length > 0
        ? settings.locale
        : 'en-US';
    const currencySymbol =
      settings?.currency_symbol && settings.currency_symbol.trim()
        ? settings.currency_symbol
        : '$';
    const precision =
      typeof settings?.decimal_precision === 'number' &&
      Number.isFinite(settings.decimal_precision) &&
      settings.decimal_precision >= 0
        ? Math.floor(settings.decimal_precision)
        : 2;
    return {
      distance,
      speed,
      locale,
      currencySymbol,
      formatCurrency: (amount, decimals) =>
        `${currencySymbol}${fmtNumber(amount, decimals ?? precision, locale)}`,
    };
  }, [settings]);
}

function useNativeDateFormat(): (value: string | null | undefined) => string {
  const {locale} = useNativeFormat();
  return useMemo(
    () => (value: string | null | undefined): string => {
      if (!value) {
        return '';
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return '';
      }
      const opts: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      };
      try {
        return date.toLocaleDateString(locale, opts);
      } catch {
        return date.toLocaleDateString('en-US', opts);
      }
    },
    [locale],
  );
}

// Web read `?achievement={id}` via react-router. Native has no URL query
// string, so the deep-link source resolves to null; the pulse state machine is
// preserved for a future native deep link.
function useDeepLinkAchievementId(): string | null {
  return null;
}

interface VehicleOption {
  id: number;
  label: string;
}

// Parity for `useSelectedVehicle`: defaults to the first vehicle once the
// fleet loads and allows a local override (the store/URL precedence is
// browser-only and documented in the sidecar).
function useNativeSelectedVehicle(): {
  vehicleId: number | null;
  options: VehicleOption[];
  setVehicleId: (id: number | null) => void;
} {
  const {data: vehicles} = useVehicles();
  const [override, setOverride] = useState<number | null>(null);
  const list = vehicles ?? [];
  const firstId = list.length > 0 ? list[0].id : null;
  const vehicleId = override ?? firstId;
  const options = list.map(v => ({
    id: v.id,
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));
  return {vehicleId, options, setVehicleId: setOverride};
}

function safeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Parity for @/lib/numberFormat `fmtNumber`: locale-grouped, NaN/Infinity -> 0.
function fmtNumber(value: unknown, decimals = 0, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

function fmtInt(value: unknown, locale = 'en-US'): string {
  return fmtNumber(value, 0, locale);
}

// Parity for @/lib/unitConversion `convertDistanceFromSI(meters, to)`.
function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// Parity for @/lib/unitConversion `convertSpeedFromSI(mps, to)`.
function convertSpeedFromSI(mps: number, to: SpeedUnit): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) {
    return hex;
  }
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.max(0, Math.min(100, pct));
}

/* ── Native shared-component re-implementations ────────────────────────── */

// `<Grid cols={{ default, md }} gap>` — chunks children into rows so columns
// stay aligned regardless of width (RN `gap` + percentage widths overflow).
function Grid({
  cols,
  gap = 4,
  children,
}: {
  cols?: {default?: number; md?: number};
  gap?: number;
  children: ReactNode;
}) {
  const {width} = useWindowDimensions();
  const columns =
    width >= MD_BREAKPOINT
      ? cols?.md ?? cols?.default ?? 1
      : cols?.default ?? 1;
  const gapPx = gap * TW_UNIT;
  const items = React.Children.toArray(children);
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return (
    <View style={{gap: gapPx}}>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.gridRow, {gap: gapPx}]}>
          {row.map((child, ci) => (
            <View key={ci} style={styles.gridCell}>
              {child}
            </View>
          ))}
          {row.length < columns
            ? Array.from({length: columns - row.length}).map((_pad, k) => (
                <View key={`pad-${k}`} style={styles.gridCell} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

// framer-motion `<FadeIn>` -> static final-state wrapper (delay is a no-op).
function FadeIn({children}: {children: ReactNode}) {
  return <View style={styles.section}>{children}</View>;
}

// framer-motion `<StaggerItem>` -> static final-state wrapper.
function StaggerItem({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

// Shared `<EmptyState message>` (message-only call sites): a centred muted line.
function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.empty}>
      <AppText tone="muted" style={styles.emptyText}>
        {message}
      </AppText>
    </View>
  );
}

// `<Currency>` — user currency symbol + locale-grouped value (no FX).
function Currency({
  value,
  precision = 2,
  style,
  fallback = '—',
}: {
  value?: number | null;
  precision?: number;
  style?: StyleProp<TextStyle>;
  fallback?: string;
}) {
  const {currencySymbol, locale} = useNativeFormat();
  if (value == null || !Number.isFinite(value)) {
    return <AppText style={style}>{fallback}</AppText>;
  }
  return (
    <AppText style={style}>{`${currencySymbol}${fmtNumber(
      value,
      precision,
      locale,
    )}`}</AppText>
  );
}

// `<AnimatedNumber>` — ease-out-quad count-up from 0 (rAF, same as web).
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  locale = 'en-US',
  style,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  locale?: string;
  style?: StyleProp<TextStyle>;
}) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = Date.now();
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = durationMs > 0 ? Math.min(elapsed / durationMs, 1) : 1;
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(to * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value, duration]);

  return (
    <AppText style={style}>{`${prefix ?? ''}${fmtNumber(
      display,
      decimals,
      locale,
    )}${suffix ?? ''}`}</AppText>
  );
}

// `<ProgressRing>` — SVG arc swapped for a proportional disc inside a ring
// track; the optional centre label overlays it (web overlays the icon there).
function ProgressRing({
  value,
  max = 100,
  size = 48,
  strokeWidth = 4,
  color = '#3b82f6',
  centerLabel,
}: {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  centerLabel?: ReactNode;
}) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(safeNumber(value), safeMax));
  const progress = clamped / safeMax;
  const inner = Math.max(0, size - strokeWidth * 4);
  const discSize = Math.max(strokeWidth, inner * progress);
  return (
    <View style={[styles.ringRoot, {width: size, height: size}]}>
      <View
        style={[
          styles.ringTrack,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: strokeWidth,
            borderColor: withAlpha(color, 0.22),
          },
        ]}
      />
      <View
        style={[
          styles.ringDisc,
          {
            width: discSize,
            height: discSize,
            borderRadius: discSize / 2,
            backgroundColor: withAlpha(color, 0.85),
          },
        ]}
      />
      {centerLabel != null ? (
        <View style={styles.ringCenter}>
          <AppText variant="caption" weight="bold">
            {centerLabel}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

// `<StatCard label value unit icon sublabel>`.
function StatCard({
  label,
  value,
  unit,
  icon,
  sublabel,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  sublabel?: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardHead}>
        <AppText variant="caption" tone="muted" weight="semibold">
          {label}
        </AppText>
        {icon ? <AppText style={styles.statCardIcon}>{icon}</AppText> : null}
      </View>
      <View style={styles.statCardValueRow}>
        <AppText variant="title" weight="bold">
          {String(value)}
        </AppText>
        {unit ? (
          <AppText variant="caption" tone="muted" style={styles.statCardUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
      {sublabel ? (
        <AppText variant="caption" tone="muted">
          {sublabel}
        </AppText>
      ) : null}
    </View>
  );
}

interface HelpTooltipProps {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  size?: 'xs' | 'sm' | 'md';
  ariaLabel?: string;
}

// `<HelpTooltip>` -> an info glyph carrying the help body as an a11y label
// (RN has no hover; the explanatory text is exposed to assistive tech).
function HelpTooltip({text, defaultValue, ariaLabel}: HelpTooltipProps) {
  const body = text ?? defaultValue ?? '';
  return (
    <AppText
      tone="muted"
      style={styles.helpGlyph}
      accessibilityLabel={ariaLabel ?? body}
      accessibilityHint={body}>
      {' ⓘ'}
    </AppText>
  );
}

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

interface FreshnessQuery {
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
}

function formatRelativeTime(ms: number, t: NativeT): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

// `<DataFreshnessAuto>` — status dot + relative time derived from the query,
// honouring `forceStaleAfterMs` (cagg-driven amber after the window).
function DataFreshnessAuto({
  query,
  forceStaleAfterMs,
}: {
  query: FreshnessQuery;
  forceStaleAfterMs?: number;
}) {
  const t = useNativeT();
  const isStale =
    query.isStale ||
    (forceStaleAfterMs != null && query.dataUpdatedAt
      ? Date.now() - query.dataUpdatedAt > forceStaleAfterMs
      : false);
  const status: FreshnessStatus = query.isError
    ? 'error'
    : query.isFetching
    ? 'fetching'
    : isStale
    ? 'stale'
    : 'fresh';
  const updatedAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;
  const relativeTime =
    updatedAt && !query.isFetching
      ? formatRelativeTime(updatedAt, t)
      : query.isFetching
      ? t('freshness.updating', 'updating…')
      : query.isError
      ? t('freshness.error', 'error')
      : '';
  return (
    <View
      style={styles.freshness}
      accessibilityLabel={t('a11y.dataFreshness', 'Data freshness: {{state}}', {
        state: status,
      })}>
      <View
        style={[
          styles.freshnessDot,
          {backgroundColor: FRESHNESS_DOT_COLOR[status]},
        ]}
      />
      <AppText variant="caption" tone="muted">
        {relativeTime}
      </AppText>
    </View>
  );
}

// `<VehicleSelect>` — pressable-chip scope picker (web's <Select> + store).
function VehicleSelect({
  options,
  vehicleId,
  onChange,
}: {
  options: VehicleOption[];
  vehicleId: number | null;
  onChange: (id: number | null) => void;
}) {
  const t = useNativeT();
  if (options.length === 0) {
    return null;
  }
  return (
    <View
      style={styles.vehicleSelect}
      accessibilityLabel={t('vehicleSelect.aria', 'Select vehicle')}>
      {options.map(option => {
        const selected = option.id === vehicleId;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="button"
            accessibilityState={{selected}}
            style={[
              styles.vehicleChip,
              selected ? styles.vehicleChipSelected : null,
            ]}>
            <AppText
              variant="caption"
              weight={selected ? 'semibold' : 'regular'}
              tone={selected ? 'accent' : 'secondary'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// `<PageContainer>` — header (title/subtitle/actions) + loading/error/body.
function PageContainer({
  title,
  subtitle,
  loading,
  error,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText weight="bold" style={styles.pageTitle}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="muted" style={styles.pageSubtitle}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {loading ? (
        <View style={styles.centerPad}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <AppText style={styles.errorText}>{error.message}</AppText>
        </View>
      ) : (
        <View style={styles.pageBody}>{children}</View>
      )}
    </ScrollView>
  );
}

function SectionHeader({glyph, title}: {glyph: string; title: string}) {
  return (
    <View style={styles.sectionHeader}>
      <AppText style={styles.sectionGlyph}>{glyph}</AppText>
      <AppText weight="semibold" style={styles.sectionTitle}>
        {title}
      </AppText>
    </View>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function LifetimeStatsPage() {
  const t = useNativeT();
  const fmtDate = useNativeDateFormat();
  const {
    distance: distanceUnit,
    speed: speedUnit,
    locale,
    formatCurrency,
  } = useNativeFormat();
  // backend `total_distance_km` and `longest_drive_record.value` are SI km;
  // `highest_speed_record.value` is SI km/h. Convert via meter/second floor.
  const fromKm = (km: number) =>
    convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);
  const fromKmh = (kmh: number) =>
    convertSpeedFromSI((kmh * METERS_PER_KM) / SECONDS_PER_HOUR, speedUnit);
  const fmt = (value: unknown, decimals: number) =>
    fmtNumber(value, decimals, locale);
  const fmtI = (value: unknown) => fmtInt(value, locale);

  const {vehicleId, options: vehicleOptions, setVehicleId} =
    useNativeSelectedVehicle();
  const lifetimeQuery = useLifetimeStats(
    vehicleId != null ? String(vehicleId) : undefined,
  );
  const {data, isLoading, error} = lifetimeQuery;

  const stats = data;
  const achievements = stats?.achievements ?? [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;

  // Deep-link `?achievement={id}`: pulse the target badge for 3s, then clear.
  // The URL source is browser-only, so `targetAchievementId` is null in native
  // and this never auto-triggers; the state machine is preserved.
  const targetAchievementId = useDeepLinkAchievementId();
  const [pulsedId, setPulsedId] = useState<string | null>(null);

  useEffect(() => {
    if (!targetAchievementId) {
      return;
    }
    if (achievements.length === 0) {
      return; // wait for data
    }
    setPulsedId(targetAchievementId);
    const timeout = setTimeout(() => setPulsedId(null), PULSE_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [targetAchievementId, achievements.length]);

  return (
    <PageContainer
      title={t('lifetime.title', 'Lifetime Stats')}
      subtitle={t(
        'lifetime.subtitle',
        'Your all-time driving achievements and milestones',
      )}
      loading={isLoading}
      error={
        error instanceof Error
          ? error
          : error
          ? new Error(String(error))
          : null
      }
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect
            options={vehicleOptions}
            vehicleId={vehicleId}
            onChange={setVehicleId}
          />
          {/* Lifetime stats are cagg-driven; force amber after 6h. */}
          <DataFreshnessAuto
            query={lifetimeQuery}
            forceStaleAfterMs={6 * 60 * 60 * 1000}
          />
        </View>
      }>
      {/* ── Hero Section ─────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.heroPanel}>
          <View style={styles.heroValueRow}>
            <AppText style={styles.heroGlyph}>{ICONS.car}</AppText>
            <AnimatedNumber
              value={stats ? fromKm(stats.total_distance_km) : 0}
              duration={1.5}
              decimals={0}
              locale={locale}
              style={styles.heroValue}
            />
            <AppText style={styles.heroUnit}>{distanceUnit}</AppText>
          </View>
          <AppText tone="muted" style={styles.heroSubtitle}>
            {t('lifetime.heroSubtitle', 'driven across {{drives}} drives', {
              drives: fmtI(stats?.total_drives ?? 0),
            })}
          </AppText>
          {stats && stats.earth_circumferences > 0 ? (
            <AppText style={styles.heroEarth}>
              {t('lifetime.earthCompare', "🌎 That's {{x}}x around the Earth!", {
                x: fmt(stats.earth_circumferences, 2),
              })}
            </AppText>
          ) : null}
          {stats && stats.ownership_days > 0 ? (
            <AppText tone="muted" style={styles.heroSince}>
              {t(
                'lifetime.since',
                'Tracking since {{date}} ({{days}} days)',
                {
                  date: fmtDate(stats.first_drive_date),
                  days: fmtI(stats.ownership_days),
                },
              )}
            </AppText>
          ) : null}
        </GlassPanel>
      </FadeIn>

      {/* ── AI Q&A (opt-in; absent when AI is off) ───────────────── */}
      <View style={styles.aiBlock}>
        <AILifetimeStatsQA vehicleId={vehicleId ?? undefined} />
      </View>

      {/* ── Key Stats Grid ───────────────────────────────────────── */}
      <FadeIn>
        <Grid cols={{default: 2, md: 4}} gap={4}>
          <StatCard
            label={t('lifetime.totalDrives', 'Total Drives')}
            value={fmtI(stats?.total_drives ?? 0)}
            icon={ICONS.car}
            sublabel={`${fmt(stats?.total_driving_hours ?? 0, 1)} ${t(
              'lifetime.hours',
              'hrs',
            )}`}
          />
          <StatCard
            label={t('lifetime.totalDistance', 'Total Distance')}
            value={fmt(stats ? fromKm(stats.total_distance_km) : 0, 0)}
            unit={distanceUnit}
            icon={ICONS.gauge}
          />
          <StatCard
            label={t('lifetime.totalEnergy', 'Total Energy')}
            value={fmt(stats?.total_energy_kwh ?? 0, 1)}
            unit="kWh"
            icon={ICONS.zap}
            sublabel={`${fmtI(stats?.total_charge_sessions ?? 0)} ${t(
              'lifetime.sessions',
              'sessions',
            )}`}
          />
          <StatCard
            label={t('lifetime.totalSavings', 'Total Savings')}
            value={formatCurrency(stats?.total_savings ?? 0, 0)}
            icon={ICONS.dollar}
            sublabel={t('lifetime.vsGas', 'vs gasoline')}
          />
        </Grid>
      </FadeIn>

      {/* ── Fun Facts ────────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <SectionHeader glyph={ICONS.flame} title={t('lifetime.funFacts', 'Fun Facts')} />
          {stats ? (
            <Grid cols={{default: 2, md: 4}} gap={4}>
              <FunFactCard
                icon={ICONS.globe}
                value={fmt(stats.earth_circumferences * 100, 1)}
                unit="%"
                label={t('lifetime.earthProgress', 'around the Earth')}
              />
              <FunFactCard
                icon={ICONS.moon}
                value={fmt(stats.moon_trips * 100, 2)}
                unit="%"
                label={t('lifetime.moonProgress', 'to the Moon')}
              />
              <FunFactCard
                icon={ICONS.tree}
                value={fmtI(stats.trees_equivalent)}
                unit=""
                label={t('lifetime.treesPlanted', 'trees equivalent planted')}
              />
              <FunFactCard
                icon={ICONS.home}
                value={fmt(stats.homes_equivalent_days, 1)}
                unit={t('lifetime.days', 'days')}
                label={t('lifetime.homesPowered', 'of home energy used')}
              />
            </Grid>
          ) : (
            <EmptyState message={t('lifetime.noData', 'No driving data yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Savings Comparison ───────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <SectionHeader
            glyph={ICONS.dollar}
            title={t('lifetime.savingsComparison', 'Savings vs Gasoline')}
          />
          {stats && stats.gas_equivalent_cost > 0 ? (
            <SavingsBar
              evCost={stats.total_charging_cost}
              gasCost={stats.gas_equivalent_cost}
              savings={stats.total_savings}
              co2Kg={stats.co2_offset_kg}
            />
          ) : (
            <EmptyState
              message={t(
                'lifetime.noSavingsData',
                'Complete some drives to see savings',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Environmental Impact ─────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <SectionHeader
            glyph={ICONS.leaf}
            title={t('lifetime.environmentalImpact', 'Environmental Impact')}
          />
          {stats ? (
            <Grid cols={{default: 1, md: 3}} gap={4}>
              <View style={styles.envRow}>
                <ProgressRing
                  value={Math.min((stats.co2_offset_kg / 1000) * 100, 100)}
                  size={64}
                  strokeWidth={5}
                  color="#22c55e"
                />
                <View>
                  <AnimatedNumber
                    value={stats.co2_offset_kg}
                    decimals={0}
                    suffix=" kg"
                    locale={locale}
                    style={styles.envValue}
                  />
                  <AppText variant="caption" tone="muted">
                    {t('lifetime.co2Offset', 'CO₂ offset')}
                  </AppText>
                </View>
              </View>
              <View style={styles.envRow}>
                <AppText style={styles.envEmoji}>🌳</AppText>
                <View>
                  <AppText style={styles.envValue}>
                    {fmtI(stats.trees_equivalent)}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {t('lifetime.treesEquiv', 'trees equivalent')}
                  </AppText>
                </View>
              </View>
              <View style={styles.envRow}>
                <AppText style={styles.envEmoji}>☕</AppText>
                <View>
                  <AppText style={styles.envValue}>
                    {fmtI(Math.round(stats.total_savings / 5))}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {t('lifetime.coffeesEquiv', 'cups of coffee saved')}
                  </AppText>
                </View>
              </View>
            </Grid>
          ) : (
            <EmptyState message={t('lifetime.noData', 'No driving data yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Personal Records ─────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <SectionHeader
            glyph={ICONS.award}
            title={t('lifetime.personalRecords', 'Personal Records')}
          />
          {stats ? (
            <Grid cols={{default: 1, md: 3}} gap={4}>
              <RecordCard
                title={t('lifetime.longestDrive', 'Longest Drive')}
                value={`${fmt(
                  fromKm(stats.longest_drive_record?.value ?? 0),
                  1,
                )} ${distanceUnit}`}
                date={stats.longest_drive_record?.date}
                icon={ICONS.car}
              />
              <RecordCard
                title={t('lifetime.highestSpeed', 'Highest Speed')}
                value={`${fmt(
                  fromKmh(stats.highest_speed_record?.value ?? 0),
                  0,
                )} ${speedUnit}`}
                date={stats.highest_speed_record?.date}
                icon={ICONS.gauge}
              />
              <RecordCard
                title={t('lifetime.biggestCharge', 'Biggest Charge')}
                value={`${fmt(stats.max_charge_record?.value ?? 0, 1)} kWh`}
                date={stats.max_charge_record?.date}
                icon={ICONS.battery}
              />
            </Grid>
          ) : (
            <EmptyState message={t('lifetime.noData', 'No driving data yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Activity Summary ─────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <SectionHeader
            glyph={ICONS.clock}
            title={t('lifetime.activitySummary', 'Activity Summary')}
          />
          {stats ? (
            <Grid cols={{default: 2, md: 4}} gap={4}>
              <MiniStat
                label={t('lifetime.mostActiveDay', 'Most Active Day')}
                value={stats.most_active_day_of_week || '—'}
              />
              <MiniStat
                label={t('lifetime.mostActiveHour', 'Peak Hour')}
                value={
                  stats.most_active_hour != null
                    ? `${stats.most_active_hour}:00`
                    : '—'
                }
              />
              <MiniStat
                label={t('lifetime.daysOnRoad', 'Days on Road')}
                value={fmt(stats.days_on_road, 1)}
              />
              <MiniStat
                label={t('lifetime.avgEfficiency', 'Avg Efficiency')}
                value={
                  stats.avg_efficiency_wh_km > 0
                    ? `${fmt(stats.avg_efficiency_wh_km, 0)} Wh/km`
                    : '—'
                }
                help={{
                  i18nKey: 'help.lifetime.avgEfficiency',
                  defaultValue:
                    'Average energy used per unit distance across the whole driving history (Wh/km). Lower is better — temperature, speed, and terrain are the main drivers.',
                }}
              />
            </Grid>
          ) : (
            <EmptyState message={t('lifetime.noData', 'No driving data yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Achievement Gallery ──────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.achievementsHead}>
            <SectionHeader
              glyph={ICONS.trophy}
              title={t('lifetime.achievements', 'Achievements')}
            />
            <AppText variant="caption" tone="muted">
              {`${unlockedCount}/${achievements.length} ${t(
                'lifetime.unlocked',
                'unlocked',
              )}`}
            </AppText>
          </View>
          {achievements.length > 0 ? (
            <Grid cols={{default: 2, md: 4}} gap={3}>
              {achievements.map(a => {
                const isPulsing = pulsedId === a.id;
                return (
                  <StaggerItem
                    key={a.id}
                    style={isPulsing ? styles.badgePulse : undefined}>
                    <AchievementBadge achievement={a} size="md" />
                  </StaggerItem>
                );
              })}
            </Grid>
          ) : (
            <EmptyState
              message={t(
                'lifetime.noAchievements',
                'Start driving to unlock achievements',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────── */

function FunFactCard({
  icon,
  value,
  unit,
  label,
}: {
  icon: string;
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <View style={styles.funFact}>
      <AppText style={styles.funFactIcon}>{icon}</AppText>
      <View style={styles.funFactBody}>
        <AppText weight="bold" style={styles.funFactValue}>
          {value}
          {unit ? (
            <AppText variant="caption" tone="muted">{` ${unit}`}</AppText>
          ) : null}
        </AppText>
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
      </View>
    </View>
  );
}

function SavingsBar({
  evCost,
  gasCost,
  savings,
  co2Kg,
}: {
  evCost: number;
  gasCost: number;
  savings: number;
  co2Kg: number;
}) {
  const t = useNativeT();
  const {locale} = useNativeFormat();
  const maxCost = Math.max(evCost, gasCost, 1);
  const evPct = Math.round((evCost / maxCost) * 100);
  const gasPct = Math.round((gasCost / maxCost) * 100);

  return (
    <View style={styles.savings}>
      <View>
        <View style={styles.savingsLabelRow}>
          <AppText variant="caption" style={styles.textGreen}>
            {t('lifetime.electricCost', 'Electric Cost')}
          </AppText>
          <Currency value={evCost} style={styles.secondaryText} />
        </View>
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              styles.barFillGreen,
              {width: `${clampPct(evPct)}%` as DimensionValue},
            ]}
          />
        </View>
      </View>
      <View>
        <View style={styles.savingsLabelRow}>
          <AppText variant="caption" style={styles.textRed}>
            {t('lifetime.gasCost', 'Gasoline Equivalent')}
          </AppText>
          <Currency value={gasCost} style={styles.secondaryText} />
        </View>
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              styles.barFillRed,
              {width: `${clampPct(gasPct)}%` as DimensionValue},
            ]}
          />
        </View>
      </View>
      <View style={styles.savingsTotal}>
        <View style={styles.savingsTotalLeft}>
          <AppText weight="semibold" style={styles.textGreen}>
            {`${t('lifetime.youSaved', 'You saved')} `}
          </AppText>
          <Currency value={savings} style={styles.textGreen} />
        </View>
        <AppText variant="caption" tone="muted">
          {`${fmtNumber(co2Kg, 0, locale)} kg CO₂ ${t(
            'lifetime.avoided',
            'avoided',
          )}`}
        </AppText>
      </View>
    </View>
  );
}

function RecordCard({
  title,
  value,
  date,
  icon,
}: {
  title: string;
  value: string;
  date: string | null | undefined;
  icon: string;
}) {
  const fmtDate = useNativeDateFormat();
  return (
    <View style={styles.recordCard}>
      <AppText style={styles.recordIcon}>{icon}</AppText>
      <View style={styles.recordBody}>
        <AppText variant="caption" tone="muted">
          {title}
        </AppText>
        <AppText weight="bold" style={styles.recordValue}>
          {value}
        </AppText>
        {date ? (
          <AppText variant="caption" tone="muted">
            {fmtDate(date)}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function MiniStat({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: HelpTooltipProps;
}) {
  return (
    <View style={styles.miniStat}>
      <View style={styles.miniStatLabelRow}>
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
        {help ? (
          <HelpTooltip
            {...help}
            ariaLabel={help.ariaLabel ?? `More info about ${label}`}
          />
        ) : null}
      </View>
      <AppText weight="semibold" style={styles.miniStatValue}>
        {value}
      </AppText>
    </View>
  );
}

function AchievementBadge({
  achievement,
  size = 'md',
}: {
  achievement: LifetimeAchievement;
  size?: 'sm' | 'md' | 'lg';
}) {
  const t = useNativeT();
  const cfg = ACHIEVEMENT_SIZES[size];
  const isNearComplete = !achievement.unlocked && achievement.progress >= 0.8;
  const pct = Math.round(achievement.progress * 100);

  return (
    <View
      style={[
        styles.badge,
        achievement.unlocked ? styles.badgeUnlocked : styles.badgeLocked,
      ]}>
      <View style={[styles.badgeCircle, {minHeight: cfg.ring}]}>
        {achievement.unlocked ? (
          <AppText
            accessibilityLabel={achievement.name}
            style={{fontSize: cfg.icon}}>
            {achievement.icon}
          </AppText>
        ) : (
          <>
            <ProgressRing
              value={pct}
              max={100}
              size={cfg.ring}
              strokeWidth={cfg.stroke}
              color={isNearComplete ? '#eab308' : '#6b7280'}
            />
            <AppText
              accessibilityLabel={achievement.name}
              style={[styles.badgeIconOverlay, {fontSize: cfg.icon}]}>
              {achievement.icon}
            </AppText>
          </>
        )}
      </View>

      <AppText
        variant="caption"
        weight="semibold"
        numberOfLines={2}
        style={[
          styles.badgeName,
          achievement.unlocked ? styles.textGold : styles.secondaryText,
        ]}>
        {achievement.name}
      </AppText>

      <AppText
        variant="caption"
        tone="muted"
        numberOfLines={3}
        style={styles.badgeDesc}>
        {achievement.description}
      </AppText>

      {achievement.unlocked ? (
        <AppText variant="caption" style={styles.textGoldDim}>
          {t('lifetime.unlocked', '✓ Unlocked')}
        </AppText>
      ) : (
        <AppText variant="caption" tone="muted">
          {`${pct}%`}
        </AppText>
      )}
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const CARD_BG = 'rgba(255, 255, 255, 0.03)';
const TRACK_BG = 'rgba(255, 255, 255, 0.05)';
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.06)';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  pageHeaderText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  pageTitle: {
    fontSize: 24,
    lineHeight: 30,
  },
  pageSubtitle: {
    maxWidth: 480,
  },
  pageActions: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  pageBody: {
    gap: spacing.lg,
  },
  centerPad: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
  },
  section: {
    width: '100%',
  },
  aiBlock: {
    marginTop: spacing.xs,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionGlyph: {
    fontSize: 18,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
  },
  // Hero.
  heroPanel: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  heroGlyph: {
    fontSize: 30,
  },
  heroValue: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  heroUnit: {
    fontSize: 18,
    color: colors.textSecondary,
  },
  heroSubtitle: {
    fontSize: 18,
    textAlign: 'center',
  },
  heroEarth: {
    fontSize: 13,
    textAlign: 'center',
    color: withAlpha('#35d5ff', 0.85),
  },
  heroSince: {
    fontSize: 12,
    textAlign: 'center',
  },
  // Grid.
  gridRow: {
    flexDirection: 'row',
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  // StatCard.
  statCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statCardIcon: {
    fontSize: 14,
  },
  statCardValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  statCardUnit: {
    marginBottom: 2,
  },
  // EmptyState.
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
  },
  // FunFactCard.
  funFact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 12,
    backgroundColor: CARD_BG,
    padding: spacing.md,
  },
  funFactIcon: {
    fontSize: 22,
  },
  funFactBody: {
    flexShrink: 1,
    gap: 2,
  },
  funFactValue: {
    fontSize: 18,
  },
  // SavingsBar.
  savings: {
    gap: spacing.md,
  },
  savingsLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  barTrack: {
    height: 24,
    borderRadius: 999,
    backgroundColor: TRACK_BG,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  barFillGreen: {
    backgroundColor: '#22c55e',
  },
  barFillRed: {
    backgroundColor: '#ef4444',
  },
  savingsTotal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: BORDER_SUBTLE,
    gap: spacing.sm,
  },
  savingsTotalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  // RecordCard.
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 12,
    backgroundColor: CARD_BG,
    padding: spacing.md,
  },
  recordIcon: {
    fontSize: 20,
  },
  recordBody: {
    flexShrink: 1,
    gap: 2,
  },
  recordValue: {
    fontSize: 18,
  },
  // MiniStat.
  miniStat: {
    borderRadius: 12,
    backgroundColor: CARD_BG,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  miniStatLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStatValue: {
    fontSize: 18,
  },
  helpGlyph: {
    fontSize: 12,
  },
  // Environmental Impact.
  envRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  envEmoji: {
    fontSize: 34,
  },
  envValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  // ProgressRing.
  ringRoot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTrack: {
    position: 'absolute',
  },
  ringDisc: {
    // centred by ringRoot.
  },
  ringCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Freshness.
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // VehicleSelect.
  vehicleSelect: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  vehicleChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  vehicleChipSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  // Achievements.
  achievementsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  badge: {
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  badgeUnlocked: {
    backgroundColor: 'rgba(234, 179, 8, 0.08)',
    borderColor: 'rgba(234, 179, 8, 0.30)',
  },
  badgeLocked: {
    backgroundColor: CARD_BG,
    borderColor: BORDER_SUBTLE,
  },
  badgePulse: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(250, 204, 21, 0.80)',
  },
  badgeCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIconOverlay: {
    position: 'absolute',
    opacity: 0.5,
  },
  badgeName: {
    textAlign: 'center',
  },
  badgeDesc: {
    textAlign: 'center',
  },
  // Semantic text colours.
  secondaryText: {
    color: colors.textSecondary,
  },
  textGreen: {
    color: '#4ade80',
  },
  textRed: {
    color: '#f87171',
  },
  textGold: {
    color: '#facc15',
  },
  textGoldDim: {
    color: 'rgba(234, 179, 8, 0.70)',
  },
});
