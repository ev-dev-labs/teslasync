// Native parity port of web/src/features/dashboard/widgets/VersionInfoWidget.tsx.
//
// The web widget is a dashboard tile that surfaces the running build (chart
// version, build date, git SHA, Go version, uptime, OS/arch) alongside live
// telemetry-capture throughput (signals/sec, messages today, bytes processed,
// avg latency). It renders inside the shared <WidgetShell> and switches between:
//   * Compact (cols <= 1): the chart version + a neutral SHA chip, centred.
//   * Standard/Wide (cols >= 2; "wide" at cols >= 4): a <KVList> of five
//     build facts, an OS/Arch line (wide only), and a bottom-aligned
//     <WidgetStatGrid> of 2 capture stats (4 when wide).
//
// None of the web visual deps are native-safe, so — mirroring the sibling native
// widget ports (LifetimeStatsWidget, EnergySiteInfoWidget) — each consumed
// dependency is rebuilt with React Native primitives, AppText, the repo
// SemanticIcon glyphs and the design tokens. The native settings hooks
// (useVersionInfo/useCaptureStats) already exist under web-parity/api/hooks/
// useSettings and are reused verbatim. The deps with no native port
// (react-i18next, lucide-react Info, @/components/data-display KVList,
// @/components/ui Badge, @/components/feedback EmptyState, @/lib/numberFormat
// fmtNumber/fmtInt, ./WidgetShell, ./shared WidgetStatGrid+StatGridItem,
// ./types WidgetProps) are inlined as self-contained native-safe parity here.
//
// Line-by-line coverage of the source:
//   L1     `import { useMemo }` -> useMemo (plus useCallback/useEffect/useRef/
//          useState for the inlined WidgetShell + i18n fallback).
//   L2     useTranslation('dashboard') -> useNativeTranslationFallback (namespace
//          retained as VERSION_INFO_WIDGET_I18N_NAMESPACE; every i18n key
//          preserved, English fallbacks returned verbatim).
//   L3     lucide-react Info -> repo SemanticIcon 'info' glyph ('i').
//   L4     @/components/data-display KVList -> inlined native KVList (divide-y
//          label/value rows; ReactNode values, incl. the font-bold version + the
//          font-mono SHA).
//   L5     @/components/ui Badge -> inlined native neutral Badge (the source only
//          uses variant="neutral" with a text-[10px] override).
//   L6     @/components/feedback EmptyState -> inlined native EmptyState.
//   L7     useVersionInfo + useCaptureStats (@/api/hooks/useSettings) -> native
//          web-parity hooks of the same name (/system/version and
//          /dev-tools/telemetry-capture/stats paths preserved).
//   L8     fmtNumber/fmtInt (@/lib/numberFormat) -> inlined value-identical
//          natives (safeNumber coerces non-finite -> 0; locale-grouped). The web
//          module-global locale is threaded explicitly via useNativeLocale (reads
//          the ported useSettings().locale, defaulting to 'en-US' like web).
//   L9     ./WidgetShell -> inlined native WidgetShell (freshness pill + pulse).
//   L10    ./shared WidgetStatGrid + StatGridItem -> inlined native parity.
//   L11    ./types WidgetProps -> inlined WidgetSize/WidgetConfig/WidgetProps mirror.
//   L13-18 formatBytes(bytes) -> ported verbatim (B/KB/MB/GB thresholds), with an
//          explicit `locale` arg replacing the web module-global locale.
//   L20    default export VersionInfoWidget({ size }: WidgetProps) -> ported.
//   L21    const { t } = useTranslation('dashboard') -> useNativeTranslationFallback.
//   L23-24 version = useVersionInfo(); capture = useCaptureStats() -> ported verbatim.
//   L26-27 isCompact = size.cols <= 1; isWide = size.cols >= 4 -> ported verbatim.
//   L29-30 versionData/captureData = data ?? {} as Record<string, unknown> -> ported.
//   L32-38 chartVersion/goVersion/buildDate/gitSha/uptime/osInfo/archInfo casts ->
//          ported verbatim (same `?? '—'` fallbacks; gitSha left undefined-able).
//   L40-43 signalsPerSec/messagesToday/bytesProcessed/avgLatency casts -> ported
//          verbatim (same `?? 0` fallbacks).
//   L45    truncatedSha = gitSha?.slice(0, 7) ?? '—' -> ported verbatim.
//   L47-68 kvItems useMemo: 5 rows (Version font-bold, Build Date, Git SHA
//          font-mono break-all, Go Version, Uptime) with identical i18n keys ->
//          ported verbatim (deps [t, chartVersion, buildDate, truncatedSha,
//          goVersion, uptime]; the font-bold/font-mono spans become styled
//          AppText value nodes).
//   L70-96 statItems useMemo<StatGridItem[]>: Signals/sec + Messages Today, plus
//          Bytes Processed (formatBytes) + Avg Latency ("{n} ms") when isWide ->
//          ported verbatim (deps add `locale`).
//   L98    isLoading = version.isLoading -> ported verbatim.
//   L99    hasError = version.error ? String(version.error) : null -> ported verbatim.
//   L100   hasData = version.data != null -> ported verbatim.
//   L102-148 WidgetShell(title hidden when compact, info glyph text-neon-green ->
//          green, loading/error/freshness props) -> hasData ? (compact: version +
//          neutral SHA Badge | standard/wide: KVList + wide OS/Arch line + mt-auto
//          WidgetStatGrid(stats, compact=isCompact, cols=isWide?4:2)) :
//          EmptyState(info glyph, noData) -> ported verbatim.
//   L150   closing brace -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported — only RN primitives plus
// existing apps/native components (AppText, SemanticIcon), tokens and native hooks.

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
  Platform,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {
  useCaptureStats,
  useSettings,
  useVersionInfo,
} from '../../../api/hooks/useSettings';
import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` usage exactly.
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

// Mirrored field-for-field from web ./shared WidgetStatGrid. `icon` is a repo
// SemanticIcon glyph string instead of the web lucide ReactNode.
interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

/* ------------------------------------------------------------------ */
/*  Parity for @/lib/numberFormat fmtNumber / fmtInt                    */
/* ------------------------------------------------------------------ */

// web safeNumber: non-finite / non-number -> 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web fmtNumber(v, decimals, locale): locale-grouped fixed-precision string,
// falling back to en-US when the locale tag is rejected by Intl.
function fmtNumber(value: unknown, decimals = 0, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

// web fmtInt(v): fmtNumber(v, 0).
function fmtInt(value: unknown, locale = 'en-US'): string {
  return fmtNumber(value, 0, locale);
}

// web module-global locale (_globalLocale, set from settings) -> resolved from
// the ported useSettings() query so grouped numbers match the user's locale
// exactly like the web runtime; 'en-US' when unset (the web default).
function useNativeLocale(): string {
  const {data: settings} = useSettings();
  return useMemo(() => {
    const locale = settings?.locale;
    return typeof locale === 'string' && locale.trim().length > 0
      ? locale
      : 'en-US';
  }, [settings]);
}

/* ------------------------------------------------------------------ */
/*  Local helper: formatBytes (source L13-18)                          */
/* ------------------------------------------------------------------ */

// Ported verbatim from the source. The web helper relied on the module-global
// locale inside fmtNumber/fmtInt; native threads it explicitly.
function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${fmtInt(bytes, locale)} B`;
  if (bytes < 1024 * 1024) return `${fmtNumber(bytes / 1024, 1, locale)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${fmtNumber(bytes / (1024 * 1024), 1, locale)} MB`;
  return `${fmtNumber(bytes / (1024 * 1024 * 1024), 2, locale)} GB`;
}

/* ------------------------------------------------------------------ */
/*  lucide Info -> repo SemanticIcon glyph                              */
/* ------------------------------------------------------------------ */

const INFO_GLYPH = getSemanticIconDefinition('info').glyph;

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback EmptyState                            */
/* ------------------------------------------------------------------ */

// web EmptyState(icon Info, message, className="py-4"): a centred icon glyph
// above a muted message line.
function EmptyState({glyph, message}: {glyph?: string; message: string}) {
  return (
    <View style={styles.emptyState}>
      {glyph ? (
        <AppText style={styles.emptyGlyph} tone="muted" weight="bold">
          {glyph}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge (neutral variant only)               */
/* ------------------------------------------------------------------ */

// web Badge variant="neutral" className="text-[10px]" -> a pill-shaped neutral
// chip with 10px text. The source only ever uses the neutral variant, so the
// other web Badge variants are intentionally not reproduced here.
function Badge({children}: {children: ReactNode}) {
  return (
    <View style={styles.badge}>
      <AppText style={styles.badgeText} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display KVList                            */
/* ------------------------------------------------------------------ */

interface KVItem {
  label: string;
  value: ReactNode;
}

// web KVList: a <dl> of label/value rows separated by `divide-y` hairlines. The
// label is muted; the value is medium-weight text-primary. Values are
// ReactNodes, so the source's font-bold version + font-mono SHA spans are passed
// in pre-styled. columns (1|2) is preserved from the web API though the source
// only uses the default single column.
function KVList({items, columns = 1}: {items: KVItem[]; columns?: 1 | 2}) {
  return (
    <View style={[styles.kvList, columns === 2 && styles.kvListTwoCol]}>
      {items.map((item, i) => (
        <View
          key={item.label}
          style={[
            styles.kvRow,
            columns === 2 && styles.kvRowTwoCol,
            i > 0 && styles.kvRowDivider,
          ]}>
          <AppText numberOfLines={1} style={styles.kvLabel} tone="muted">
            {item.label}
          </AppText>
          <View style={styles.kvValueWrap}>
            {typeof item.value === 'string' || typeof item.value === 'number' ? (
              <AppText style={styles.kvValueText} weight="semibold">
                {item.value}
              </AppText>
            ) : (
              item.value
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display StatCard                          */
/* ------------------------------------------------------------------ */

// web StatCard: muted label + optional icon header, a large bold value with an
// optional muted unit suffix.
function StatCard({
  label,
  value,
  unit,
  glyph,
}: {
  label: string;
  value: string | number;
  unit?: string;
  glyph?: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardHeader}>
        <AppText
          numberOfLines={1}
          style={styles.statCardLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        {glyph ? (
          <AppText style={styles.statCardGlyph} tone="muted" weight="bold">
            {glyph}
          </AppText>
        ) : null}
      </View>
      <View style={styles.statCardValueRow}>
        <AppText numberOfLines={1} style={styles.statCardValue} weight="bold">
          {value}
        </AppText>
        {unit ? (
          <AppText style={styles.statCardUnit} tone="muted" variant="caption">
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared WidgetStatGrid                                    */
/* ------------------------------------------------------------------ */

// web autoCols: 3 when divisible by 3, 4 when divisible by 4, else 2.
function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 2;
}

// web container-query column class -> native flex-basis. Each card grows to fill
// its row, so an N-up grid wraps to 2-up on narrow tiles just like the web
// @container breakpoints.
function colBasis(cols: 1 | 2 | 3 | 4): DimensionValue {
  switch (cols) {
    case 1:
      return '100%';
    case 2:
      return '47%';
    case 3:
      return '31%';
    case 4:
      return '22%';
  }
}

function WidgetStatGrid({
  stats,
  compact,
  cols,
}: {
  stats: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}) {
  if (stats.length === 0) {
    return <EmptyState message="No stats available" />;
  }

  const resolvedCols: 1 | 2 | 3 | 4 = compact
    ? 1
    : cols ?? autoCols(stats.length);
  const basis = colBasis(resolvedCols);

  return (
    <View style={[styles.statGrid, compact && styles.statGridCompact]}>
      {stats.map(stat => (
        <View key={stat.label} style={[styles.statGridCell, {flexBasis: basis}]}>
          <StatCard
            glyph={stat.icon}
            label={stat.label}
            unit={stat.unit}
            value={stat.value}
          />
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Freshness caption helper for the inlined WidgetShell (web <DataFreshness>
// renders a relative "updated" time when not compact).
function formatFreshness(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

// Native parity for the freshness pill the web WidgetShell renders in its header
// (web <DataFreshness>): a pressable refresh affordance with a status dot
// (error -> danger, fetching -> accent, stale -> warning, fresh -> success) and,
// when not compact, a short relative "updated" caption.
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact: boolean;
}) {
  const t = useNativeTranslationFallback();
  const dotStyle = isError
    ? freshnessDotStyles.error
    : isFetching
      ? freshnessDotStyles.fetching
      : isStale
        ? freshnessDotStyles.stale
        : freshnessDotStyles.fresh;

  return (
    <Pressable
      accessibilityLabel={t('widget.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {formatFreshness(updatedAt, t)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse-on-data-change effect (web `justUpdated`): ported verbatim; the
  // transient flag drives a subtle border highlight in place of the web box
  // shadow.
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return (
      <View style={styles.shellState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.shellState}>
        <AppText tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function VersionInfoWidget({size}: WidgetProps) {
  const t = useNativeTranslationFallback();

  const version = useVersionInfo();
  const capture = useCaptureStats();

  const locale = useNativeLocale();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const versionData = version.data ?? ({} as Record<string, unknown>);
  const captureData = capture.data ?? ({} as Record<string, unknown>);

  const chartVersion =
    (versionData as {chart_version?: string}).chart_version ?? '—';
  const goVersion = (versionData as {go_version?: string}).go_version ?? '—';
  const buildDate = (versionData as {build_date?: string}).build_date ?? '—';
  const gitSha = (versionData as {git_commit?: string}).git_commit;
  const uptime = (versionData as {uptime?: string}).uptime ?? '—';
  const osInfo = (versionData as {os?: string}).os ?? '—';
  const archInfo = (versionData as {arch?: string}).arch ?? '—';

  const signalsPerSec =
    (captureData as {signals_per_sec?: number}).signals_per_sec ?? 0;
  const messagesToday =
    (captureData as {messages_today?: number}).messages_today ?? 0;
  const bytesProcessed =
    (captureData as {bytes_processed?: number}).bytes_processed ?? 0;
  const avgLatency =
    (captureData as {avg_processing_latency_ms?: number})
      .avg_processing_latency_ms ?? 0;

  const truncatedSha = gitSha?.slice(0, 7) ?? '—';

  const kvItems = useMemo<KVItem[]>(
    () => [
      {
        label: t('widget.versionInfo.version', 'Version'),
        value: (
          <AppText style={styles.kvValueText} weight="bold">
            {chartVersion}
          </AppText>
        ),
      },
      {
        label: t('widget.versionInfo.buildDate', 'Build Date'),
        value: buildDate,
      },
      {
        label: t('widget.versionInfo.gitSha', 'Git SHA'),
        value: (
          <AppText style={[styles.kvValueText, styles.kvValueMono]}>
            {truncatedSha}
          </AppText>
        ),
      },
      {
        label: t('widget.versionInfo.goVersion', 'Go Version'),
        value: goVersion,
      },
      {
        label: t('widget.versionInfo.uptime', 'Uptime'),
        value: uptime,
      },
    ],
    [t, chartVersion, buildDate, truncatedSha, goVersion, uptime],
  );

  const statItems = useMemo<StatGridItem[]>(() => {
    const items: StatGridItem[] = [
      {
        label: t('widget.versionInfo.signalsPerSec', 'Signals/sec'),
        value: fmtNumber(signalsPerSec, 1, locale),
      },
      {
        label: t('widget.versionInfo.messagesToday', 'Messages Today'),
        value: fmtInt(messagesToday, locale),
      },
    ];

    if (isWide) {
      items.push(
        {
          label: t('widget.versionInfo.bytesProcessed', 'Bytes Processed'),
          value: formatBytes(bytesProcessed, locale),
        },
        {
          label: t('widget.versionInfo.avgLatency', 'Avg Latency'),
          value: `${fmtNumber(avgLatency, 1, locale)} ms`,
        },
      );
    }

    return items;
  }, [t, signalsPerSec, messagesToday, bytesProcessed, avgLatency, isWide, locale]);

  const isLoading = version.isLoading;
  const hasError = version.error ? String(version.error) : null;
  const hasData = version.data != null;

  return (
    <WidgetShell
      error={hasError}
      icon={
        <AppText style={styles.headerGlyph} weight="bold">
          {INFO_GLYPH}
        </AppText>
      }
      isError={version.isError}
      isFetching={version.isFetching}
      isStale={version.isStale}
      loading={isLoading}
      onRefresh={() => version.refetch()}
      title={
        isCompact ? undefined : t('widget.versionInfo.title', 'Version Info')
      }
      updatedAt={version.dataUpdatedAt}>
      {hasData ? (
        isCompact ? (
          // ── Compact layout (1×2) ──
          <View style={styles.compact}>
            <AppText
              numberOfLines={1}
              style={styles.compactVersion}
              weight="bold">
              {chartVersion}
            </AppText>
            <Badge>{truncatedSha}</Badge>
          </View>
        ) : (
          // ── Standard / Wide layout ──
          <View style={styles.standard}>
            <KVList items={kvItems} />

            {isWide ? (
              <View style={styles.osArchRow}>
                <AppText
                  style={styles.osArchText}
                  tone="secondary"
                  variant="caption">
                  {`${t('widget.versionInfo.os', 'OS')}: ${osInfo}`}
                </AppText>
                <AppText
                  style={styles.osArchText}
                  tone="secondary"
                  variant="caption">
                  •
                </AppText>
                <AppText
                  style={styles.osArchText}
                  tone="secondary"
                  variant="caption">
                  {`${t('widget.versionInfo.arch', 'Arch')}: ${archInfo}`}
                </AppText>
              </View>
            ) : null}

            <View style={styles.statGridWrap}>
              <WidgetStatGrid
                cols={isWide ? 4 : 2}
                compact={isCompact}
                stats={statItems}
              />
            </View>
          </View>
        )
      ) : (
        <EmptyState
          glyph={INFO_GLYPH}
          message={t(
            'widget.versionInfo.noData',
            'No version data available',
          )}
        />
      )}
    </WidgetShell>
  );
}

VersionInfoWidget.displayName = 'VersionInfoWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const VERSION_INFO_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Compact body ---
  compact: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactVersion: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },

  // --- Standard / Wide body ---
  standard: {
    flex: 1,
    gap: spacing.md,
  },
  osArchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  osArchText: {
    color: colors.textSecondary,
  },
  statGridWrap: {
    marginTop: 'auto',
  },

  // --- Header icon (green info) ---
  headerGlyph: {
    color: colors.success,
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 14,
  },

  // --- KVList ---
  kvList: {
    width: '100%',
  },
  kvListTwoCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  kvRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  kvRowTwoCol: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  kvRowDivider: {
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: 1,
  },
  kvLabel: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  kvValueWrap: {
    alignItems: 'flex-end',
    flexShrink: 1,
    minWidth: 0,
  },
  kvValueText: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'right',
  },
  kvValueMono: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },

  // --- Badge (neutral) ---
  badge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
  },

  // --- WidgetStatGrid ---
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statGridCompact: {
    gap: spacing.xs,
  },
  statGridCell: {
    flexGrow: 1,
  },

  // --- StatCard ---
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCardLabel: {
    flexShrink: 1,
  },
  statCardGlyph: {
    fontSize: 12,
    lineHeight: 14,
    marginLeft: spacing.xs,
  },
  statCardValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  statCardUnit: {
    flexShrink: 1,
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 20,
    letterSpacing: 0.5,
    lineHeight: 24,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderColor: colors.successBorder,
    borderRadius: 12,
    borderWidth: 1,
  },
  shellState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  shellFreshnessOverlay: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // --- DataFreshness ---
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
});

const freshnessDotStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.danger,
  },
  fetching: {
    backgroundColor: colors.accent,
  },
  stale: {
    backgroundColor: colors.warning,
  },
  fresh: {
    backgroundColor: colors.success,
  },
});
