// Native parity port of web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx.
//
// The web widget is a dashboard tile that renders the weekly drive score as a
// radial gauge (via the shared <WidgetGaugeHero> -> <RadialGauge>) with a stats
// row (Efficiency / Smoothness / Speed Discipline) and, on tall tiles, a stack
// of <MetricBar> sub-scores. Data comes from useVehicles()/useDriveScore().
//
// The repo already ships a native parity <RadialGauge> in the charts barrel and
// a native <MetricBar> in data-display, so both are reused as-is. The remaining
// web deps have no native port (WidgetShell, ./shared WidgetGaugeHero, ./types,
// @/components/feedback EmptyState, lucide-react, react-i18next), so — mirroring
// the sibling native port (BatteryRadialGaugeWidget) — each is rebuilt inline
// with React Native primitives, AppText, the repo SemanticIcon glyphs and the
// design tokens.
//
// Line-by-line coverage of the source:
//   L1   `import { useMemo }` -> useMemo (plus useCallback/useEffect/useRef/
//        useState for the inlined WidgetShell + i18n fallback).
//   L2   useTranslation('dashboard') -> useNativeTranslationFallback (the
//        'dashboard' namespace is retained as I18N_NAMESPACE; every i18n key is
//        preserved, fallbacks returned verbatim).
//   L3   lucide Gauge -> repo SemanticIcon 'speedCircle' glyph (GAUGE_GLYPH): the
//        closest native glyph to lucide's circular speedometer dial.
//   L4   @/components/data-display MetricBar -> native parity MetricBar (reused).
//   L5   @/components/feedback EmptyState -> inlined EmptyState.
//   L6   useDriveScore -> native api hook (same import name + API path).
//   L7   useVehicles -> native api hook (same import name).
//   L8   ./WidgetShell -> inlined WidgetShell (freshness pill + pulse + error).
//   L9   ./shared WidgetGaugeHero + GaugeHeroConfig + GaugeHeroStat -> inlined
//        native WidgetGaugeHero (reusing the barrel RadialGauge) + the two types.
//   L10  ./types WidgetProps -> inlined WidgetSize/WidgetConfig/WidgetProps mirror.
//   L12-17 SCORE_COLORS (excellent #10b981 / good #22d3ee / fair #f59e0b /
//        poor #ef4444) -> ported verbatim.
//   L19-24 scoreColor(score) (>=80 excellent, >=60 good, >=40 fair, else poor)
//        -> ported verbatim.
//   L26  default export ({vehicleId,size}: WidgetProps) -> ported.
//   L27  t = useTranslation('dashboard') -> useNativeTranslationFallback.
//   L28  const { data: vehicles } = useVehicles() -> ported.
//   L29  vid = vehicleId ?? vehicles?.[0]?.id -> ported.
//   L30  vehicleIdStr = vid != null ? String(vid) : undefined -> ported.
//   L32  useDriveScore(vehicleIdStr) destructure (data:score/isLoading/error/
//        isFetching/isStale/isError/dataUpdatedAt/refetch) -> ported verbatim.
//   L34  overall = score?.overall ?? 0 -> ported.
//   L35  color useMemo (scoreColor(overall), [overall]) -> ported.
//   L37  isCompact = cols===1 && rows===1 -> ported.
//   L38  isTall = rows >= 2 -> ported.
//   L40-46 gauge useMemo<GaugeHeroConfig> (value overall, max 100, label
//        score?.grade ?? '—', unit widget.driveScoreGauge.weekly, color) -> ported
//        verbatim with the same deps.
//   L48-55 stats useMemo<GaugeHeroStat[]> (Efficiency/Smoothness/Speed Discipline
//        from score, empty when !score) -> ported verbatim with the same i18n keys.
//   L57-64 subScores useMemo ({key,label,value} for efficiency/smoothness/speed,
//        empty when !score) -> ported verbatim.
//   L66-77 WidgetShell props (conditional title/icon when !isCompact, loading,
//        error=error?String(error):null, updatedAt, isFetching, isStale, isError,
//        onRefresh=refetch) -> ported.
//   L78-94 body: score ? WidgetGaugeHero(gauge, stats, compact=isCompact) with a
//        tall-only full-width column of MetricBar sub-scores (value s.value ?? 0,
//        max 100, color scoreColor(s.value ?? 0), label, sublabel `${s.value ?? 0}`)
//        as children -> ported. WidgetGaugeHero renders children below the stats
//        gated behind !compact, exactly like the web `{!compact && children}`.
//   L95-101 : EmptyState(gauge glyph, widget.driveScoreGauge.noData) -> ported.
//   L102-104 closing tags -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported — only RN primitives plus
// existing apps/native components (RadialGauge, MetricBar, AppText, SemanticIcon),
// tokens and native hooks.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';

import {RadialGauge} from '../../../components/charts';
import {MetricBar} from '../../../components/data-display/MetricBar';
import {useDriveScore} from '../../../api/hooks/useDriving';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` type exactly.
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  ./types + ./shared mirrors (no native port yet)                    */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./types so the port stays self-contained.
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

// Mirrored from web ./shared WidgetGaugeHero.
interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

interface GaugeHeroStat {
  label: string;
  value: string | number;
  unit?: string;
}

/* ------------------------------------------------------------------ */
/*  lucide Gauge -> repo SemanticIcon glyph                            */
/* ------------------------------------------------------------------ */

// web rendered <Gauge className="… text-neon-cyan" /> — a circular speedometer
// dial in the accent (cyan) hue. The closest native glyph is 'speedCircle'.
const GAUGE_GLYPH = getSemanticIconDefinition('speedCircle').glyph;

/* ------------------------------------------------------------------ */
/*  Pure logic (ported verbatim)                                       */
/* ------------------------------------------------------------------ */

const SCORE_COLORS = {
  excellent: '#10b981',
  good: '#22d3ee',
  fair: '#f59e0b',
  poor: '#ef4444',
} as const;

function scoreColor(score: number): string {
  if (score >= 80) return SCORE_COLORS.excellent;
  if (score >= 60) return SCORE_COLORS.good;
  if (score >= 40) return SCORE_COLORS.fair;
  return SCORE_COLORS.poor;
}

// Freshness caption helper for the inlined WidgetShell (the web <DataFreshness>
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

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback <EmptyState>                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon Gauge, message, className="py-4"): a centred icon glyph
// above a muted message line.
function EmptyState({glyph, message}: {glyph: string; message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.emptyGlyph} tone="muted" weight="bold">
        {glyph}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared <WidgetGaugeHero>                                 */
/* ------------------------------------------------------------------ */

// web WidgetGaugeHero: a RadialGauge (size 70 compact / 100 standard) with an
// optional stats row and, last, overlay/extra children — both gated behind
// `!compact` (web `{!compact && children}`). The gauge is the repo native parity
// <RadialGauge>; the children (the MetricBar sub-scores) render below the stats
// as a full-width block, exactly like the web flex column.
function WidgetGaugeHero({
  gauge,
  stats,
  compact,
  children,
}: {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
  children?: ReactNode;
}) {
  const size = compact ? 70 : 100;

  return (
    <View style={styles.gaugeHero}>
      <RadialGauge
        color={gauge.color}
        label={gauge.label}
        max={gauge.max}
        size={size}
        unit={gauge.unit}
        value={gauge.value}
      />

      {!compact && stats && stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statItem}>
              <AppText
                numberOfLines={1}
                style={styles.statLabel}
                tone="secondary"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText numberOfLines={1} style={styles.statValue} weight="semibold">
                {stat.value}
                {stat.unit ? (
                  <AppText
                    style={styles.statUnit}
                    tone="secondary"
                    variant="caption">
                    {stat.unit}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact && children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Native parity for the freshness pill the web WidgetShell renders in its header
// (web <DataFreshness>). A pressable refresh affordance with a status dot
// (error -> danger, fetching -> accent, stale -> warning, fresh -> success) and,
// when not compact, a short relative "updated" caption. Consumes every freshness
// prop so the refresh-on-press behaviour is preserved.
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

export default function DriveScoreGaugeWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data: score,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useDriveScore(vehicleIdStr);

  const overall = score?.overall ?? 0;
  const color = useMemo(() => scoreColor(overall), [overall]);

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const gauge = useMemo<GaugeHeroConfig>(
    () => ({
      value: overall,
      max: 100,
      label: score?.grade ?? '—',
      unit: t('widget.driveScoreGauge.weekly', 'Weekly score'),
      color,
    }),
    [overall, score?.grade, color, t],
  );

  const stats = useMemo<GaugeHeroStat[]>(() => {
    if (!score) return [];
    return [
      {
        label: t('widget.driveScoreGauge.efficiency', 'Efficiency'),
        value: score.efficiency ?? 0,
      },
      {
        label: t('widget.driveScoreGauge.smoothness', 'Smoothness'),
        value: score.smoothness ?? 0,
      },
      {
        label: t('widget.driveScoreGauge.speed', 'Speed Discipline'),
        value: score.speedDiscipline ?? 0,
      },
    ];
  }, [score, t]);

  const subScores = useMemo(() => {
    if (!score) return [];
    return [
      {
        key: 'efficiency',
        label: t('widget.driveScoreGauge.efficiency', 'Efficiency'),
        value: score.efficiency,
      },
      {
        key: 'smoothness',
        label: t('widget.driveScoreGauge.smoothness', 'Smoothness'),
        value: score.smoothness,
      },
      {
        key: 'speed',
        label: t('widget.driveScoreGauge.speed', 'Speed Discipline'),
        value: score.speedDiscipline,
      },
    ];
  }, [score, t]);

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        isCompact ? undefined : (
          <AppText style={styles.headerIcon} tone="accent" weight="bold">
            {GAUGE_GLYPH}
          </AppText>
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.driveScoreGauge.title', 'Drive Score')}
      updatedAt={dataUpdatedAt}>
      <View style={styles.body}>
        {score ? (
          <WidgetGaugeHero compact={isCompact} gauge={gauge} stats={stats}>
            {isTall ? (
              <View style={styles.subScores}>
                {subScores.map(s => (
                  <MetricBar
                    color={scoreColor(s.value ?? 0)}
                    key={s.key}
                    label={s.label}
                    max={100}
                    sublabel={`${s.value ?? 0}`}
                    value={s.value ?? 0}
                  />
                ))}
              </View>
            ) : null}
          </WidgetGaugeHero>
        ) : (
          <EmptyState
            glyph={GAUGE_GLYPH}
            message={t('widget.driveScoreGauge.noData', 'No score yet')}
          />
        )}
      </View>
    </WidgetShell>
  );
}

DriveScoreGaugeWidget.displayName = 'DriveScoreGaugeWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const DRIVE_SCORE_GAUGE_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Body ---
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  subScores: {
    width: '100%',
    gap: spacing.sm,
  },
  headerIcon: {
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 0.4,
  },

  // --- WidgetGaugeHero ---
  gaugeHero: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
  },
  statItem: {
    flexShrink: 1,
    alignItems: 'center',
  },
  statLabel: {
    textAlign: 'center',
  },
  statValue: {
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  statUnit: {
    marginLeft: 2,
    fontWeight: '400',
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  emptyGlyph: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.5,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  shellState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },

  // --- DataFreshness ---
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
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
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
