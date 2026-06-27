import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx.
//
// The web widget is a dashboard tile that summarises the linked Tesla Energy
// site (solar nameplate, Powerwall count/energy, gateway firmware, install
// timezone). It renders inside the shared <WidgetShell> and delegates the body
// to <WidgetDetailCard> (label/value rows + empty state), collapsing the header
// when the tile is 1 column wide (isCompact).
//
// None of the web imports are native-safe, so — mirroring the sibling native
// widget ports (AutomationStatusWidget, CostBreakdownWidget) — each consumed
// dependency is rebuilt with React Native primitives, AppText, the repo
// SemanticIcon glyphs, and the design tokens. The native Tesla-energy hooks
// (useTeslaEnergySites/useTeslaEnergySiteInfo) already exist under
// web-parity/api/hooks/useEnergy and are reused verbatim. The deps with no
// native port (react-i18next, lucide-react Home, @/lib/numberFormat
// fmtNumber/fmtInt, ./shared WidgetDetailCard+DetailEntry, ./WidgetShell,
// ./types WidgetProps) are inlined as self-contained native-safe parity here.
//
// Line-by-line coverage of the source:
//   L1-7   imports -> react-i18next useTranslation, lucide-react Home,
//          @/api/hooks/useEnergy useTeslaEnergySites+useTeslaEnergySiteInfo,
//          @/lib/numberFormat fmtNumber+fmtInt, ./shared WidgetDetailCard +
//          DetailEntry, ./WidgetShell WidgetShell, ./types WidgetProps are
//          replaced by RN primitives, AppText, the repo Home SemanticIcon glyph,
//          the native useEnergy hooks (same names), and inlined native-safe
//          parity for t/fmtNumber/fmtInt/WidgetDetailCard/WidgetShell/WidgetProps.
//   L9     default export EnergySiteInfoWidget({ size }: WidgetProps) preserved.
//   L10    useTranslation('dashboard') -> useNativeTranslationFallback (namespace
//          retained as ENERGY_SITE_INFO_WIDGET_I18N_NAMESPACE).
//   L11    isCompact = size.cols <= 1 -> ported verbatim.
//   L13-21 useTeslaEnergySites() destructure (data:sites, isLoading:sitesLoading,
//          isFetching:sitesFetching, isStale:sitesStale, isError:sitesIsError,
//          dataUpdatedAt:sitesUpdatedAt, refetch:refetchSites) -> ported verbatim.
//   L23    siteId = (sites ?? [])[0]?.energy_site_id -> ported verbatim.
//   L25-34 useTeslaEnergySiteInfo(siteId) destructure (data:infoResponse,
//          isLoading:infoLoading, error:infoError, isFetching:infoFetching,
//          isStale:infoStale, isError:infoIsError, dataUpdatedAt:infoUpdatedAt,
//          refetch:refetchInfo) -> ported verbatim.
//   L36-40 combined isLoading (sitesLoading || (!!siteId && infoLoading)),
//          isFetching, isStale, isError, updatedAt = Math.max(sitesUpdatedAt ?? 0,
//          infoUpdatedAt ?? 0) -> ported verbatim.
//   L42-45 handleRefresh -> refetchSites(); if (siteId) refetchInfo() preserved.
//   L47    info = infoResponse?.data ?? null -> ported verbatim.
//   L48    hasSites = (sites ?? []).length > 0 -> ported verbatim.
//   L50-56 installDate IIFE -> info?.installation_time_zone ?? null preserved
//          (timezone string used as location context, same comment intent).
//   L58-60 solarKw = nameplate_power != null ? fmtNumber(nameplate_power/1000, 1)
//          : null -> ported verbatim with the inlined fmtNumber.
//   L62-65 batteryCount = battery_count ?? 0; batteryKwh = nameplate_energy !=
//          null ? fmtNumber(nameplate_energy/1000, 1) : null -> ported verbatim.
//   L67    gatewayFirmware = info?.version ?? null -> ported verbatim.
//   L69-94 entries: DetailEntry[] build — empty when !hasSites && !isLoading,
//          else when info push solarSize ('{kW}'/'—'), powerwall
//          ('{n} × {kWh} kWh'/'—' via fmtInt), firmware (value, mono:true),
//          timezone (installDate). Same i18n keys and '—' fallbacks preserved.
//   L96-107 WidgetShell props: title/icon hidden when isCompact, loading,
//          error=infoError?String(infoError):null, updatedAt, isFetching, isStale,
//          isError, onRefresh=handleRefresh -> forwarded to the inlined shell. The
//          Home icon (h-3.5 w-3.5 text-neon-green) -> HOME glyph tone='green'.
//   L108-117 WidgetDetailCard: entries, compact=isCompact, emptyMessage (noSite
//          when !hasSites else noData), emptyIcon Home (h-5 w-5) -> inlined
//          WidgetDetailCard with emptyGlyph=HOME glyph. Same i18n keys preserved.
//   L118-120 closing -> preserved.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/Leaflet, no
// framer-motion, and no web UI components are imported.

import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { getSemanticIconDefinition } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import {
  useTeslaEnergySiteInfo,
  useTeslaEnergySites,
} from '../../../api/hooks/useEnergy';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` usage (no interpolation by the
// widget itself; the inlined freshness chip interpolates manually).
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
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

/* ------------------------------------------------------------------ */
/*  lucide Home -> repo SemanticIcon glyph stand-in                    */
/* ------------------------------------------------------------------ */

// Repo-canonical native stand-in for the lucide <Home> glyph, resolved once. The
// web widget tinted it text-neon-green in the header; the green tone is applied
// at the call site via glyphToneStyles.
const HOME_GLYPH = getSemanticIconDefinition('home').glyph;

type GlyphTone = 'green' | 'muted';

function GlyphLegacyUnused({
  glyph,
  style,
  tone,
}: {
  glyph: string;
  style?: TextStyle | TextStyle[];
  tone: GlyphTone;
}) {
  return (
    <AppText style={[styles.glyph, glyphToneStyles[tone], style]} weight="bold">
      {glyph}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  @/lib/numberFormat fmtNumber/fmtInt (ported)                       */
/* ------------------------------------------------------------------ */

// safeNumber + fmtNumber + fmtInt ported from web @/lib/numberFormat. The web
// fmtNumber pulls the global precision/locale from useSettings; native parity
// has no settings runtime so it uses the same defaults (2 decimals, 'en-US').
// fmtNumber is only ever called here with an explicit decimals argument (1) and
// fmtInt forwards 0, so the global default is never the active path.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    // Bad locale tag — fall back to en-US so we still produce a string.
    return safeNumber(value).toFixed(decimals);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

/* ------------------------------------------------------------------ */
/*  ./shared WidgetDetailCard + DetailEntry (inlined)                  */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./shared WidgetDetailCard so the port keeps
// the full DetailEntry contract (label/value/badge/mono).
interface DetailEntry {
  label: string;
  value: string | number | null;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'neutral' };
  mono?: boolean;
}

type BadgeVariant = 'success' | 'danger' | 'warning' | 'neutral';

// web WidgetDetailCard badgeVariantMap: 'error' -> danger; others pass through.
const badgeVariantMap: Record<
  'success' | 'warning' | 'error' | 'neutral',
  BadgeVariant
> = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
};

// web Badge (size="sm"): token surface/border/text per variant.
function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant: BadgeVariant;
}) {
  return (
    <View style={[styles.badge, badgeContainerStyles[variant]]}>
      <AppText
        style={[styles.badgeText, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// web ./shared WidgetDetailCard: a list of label/value rows with a hairline
// divider between rows, optional per-row badge + mono value, compact slice(0,4),
// and a centred EmptyState when there are no entries.
function WidgetDetailCard({
  compact = false,
  emptyGlyph,
  emptyMessage,
  entries,
}: {
  compact?: boolean;
  emptyGlyph?: string;
  emptyMessage?: string;
  entries: DetailEntry[];
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        glyph={emptyGlyph}
        message={emptyMessage ?? 'No details available'}
      />
    );
  }

  const visible = compact ? entries.slice(0, 4) : entries;

  return (
    <View style={styles.detailCard}>
      {visible.map((entry, i) => (
        <View
          key={entry.label}
          style={[
            styles.detailRow,
            i < visible.length - 1 && styles.detailRowDivider,
          ]}>
          <AppText numberOfLines={1} style={styles.detailLabel}>
            {entry.label}
          </AppText>
          <View style={styles.detailValueWrap}>
            <AppText
              numberOfLines={1}
              style={[styles.detailValue, entry.mono && styles.detailValueMono]}>
              {entry.value ?? '—'}
            </AppText>
            {entry.badge ? (
              <Badge variant={badgeVariantMap[entry.badge.variant]}>
                {entry.badge.text}
              </Badge>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  @/components/feedback EmptyState (inlined)                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon, message, className="py-4"): a centred icon glyph above a
// muted message line.
function EmptyState({ glyph, message }: { glyph?: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      {glyph ? (
        <Glyph glyph={glyph} style={styles.emptyGlyph} tone="muted" />
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ./WidgetShell (inlined)                                             */
/* ------------------------------------------------------------------ */

// Native parity of the web <DataFreshness> chip the shell renders in its header:
// a pressable refresh affordance + a status dot (error -> danger, fetching ->
// accent, stale -> warning, fresh -> success) and, when not compact, a relative
// "updated" caption. The relative-time helper mirrors web DataFreshness'
// freshness.* i18n keys (justNow/minutes/hours/days/weeks, updating…).
function formatFreshness(updatedAt: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - updatedAt) / 1000);
  if (seconds < 60) return t('freshness.justNow', 'just now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t('freshness.minutes', '{{m}}m ago').replace('{{m}}', String(minutes));
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t('freshness.hours', '{{h}}h ago').replace('{{h}}', String(hours));
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return t('freshness.days', '{{d}}d ago').replace('{{d}}', String(days));
  }
  const weeks = Math.floor(days / 7);
  return t('freshness.weeks', '{{w}}w ago').replace('{{w}}', String(weeks));
}

function DataFreshness({
  compact,
  isError,
  isFetching,
  isStale,
  onRefresh,
  updatedAt,
}: {
  compact: boolean;
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  onRefresh?: () => void;
  updatedAt: number | null;
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
      accessibilityLabel={t('freshness.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {isFetching
            ? t('freshness.updating', 'updating…')
            : formatFreshness(updatedAt, t)}
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
  children,
  error,
  icon,
  isError,
  isFetching,
  isStale,
  loading,
  onRefresh,
  title,
  updatedAt,
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
            <AppText
              style={styles.shellTitle}
              variant="caption"
              weight="semibold">
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

export default function EnergySiteInfoWidget({ size }: WidgetProps) {
  const t = useNativeTranslationFallback();
  const isCompact = size.cols <= 1;

  const {
    data: sites,
    isLoading: sitesLoading,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;

  const {
    data: infoResponse,
    isLoading: infoLoading,
    error: infoError,
    isFetching: infoFetching,
    isStale: infoStale,
    isError: infoIsError,
    dataUpdatedAt: infoUpdatedAt,
    refetch: refetchInfo,
  } = useTeslaEnergySiteInfo(siteId);

  const isLoading = sitesLoading || (!!siteId && infoLoading);
  const isFetching = sitesFetching || infoFetching;
  const isStale = sitesStale || infoStale;
  const isError = sitesIsError || infoIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, infoUpdatedAt ?? 0);

  const handleRefresh = () => {
    refetchSites();
    if (siteId) refetchInfo();
  };

  const info = infoResponse?.data ?? null;
  const hasSites = (sites ?? []).length > 0;

  // Format installation date if present
  const installDate = (() => {
    const raw = info?.installation_time_zone;
    // installation_time_zone is just a timezone string, not a date
    // The actual install date may come from other fields; show timezone as location context
    return raw ?? null;
  })();

  const solarKw =
    info?.nameplate_power != null
      ? fmtNumber(info.nameplate_power / 1000, 1)
      : null;

  const batteryCount = info?.battery_count ?? 0;
  const batteryKwh =
    info?.nameplate_energy != null
      ? fmtNumber(info.nameplate_energy / 1000, 1)
      : null;

  const gatewayFirmware = info?.version ?? null;

  // Build entries for WidgetDetailCard
  const entries: DetailEntry[] = [];

  if (!hasSites && !isLoading) {
    // No sites — show empty via WidgetDetailCard (entries is [])
  } else if (info) {
    entries.push({
      label: t('widget.energySiteInfo.solarSize', 'Solar System'),
      value: solarKw != null ? `${solarKw} kW` : '—',
    });
    entries.push({
      label: t('widget.energySiteInfo.powerwall', 'Powerwalls'),
      value:
        batteryCount > 0
          ? `${fmtInt(batteryCount)} × ${batteryKwh ?? '—'} kWh`
          : '—',
    });
    entries.push({
      label: t('widget.energySiteInfo.firmware', 'Gateway Firmware'),
      value: gatewayFirmware,
      mono: true,
    });
    entries.push({
      label: t('widget.energySiteInfo.timezone', 'Installation Timezone'),
      value: installDate,
    });
  }

  return (
    <WidgetShell
      error={infoError ? String(infoError) : null}
      icon={
        isCompact ? undefined : (
          <Glyph glyph={HOME_GLYPH} style={styles.headerIcon} tone="green" />
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={
        isCompact ? undefined : t('widget.energySiteInfo.title', 'Energy Site')
      }
      updatedAt={updatedAt}>
      <WidgetDetailCard
        compact={isCompact}
        emptyGlyph={HOME_GLYPH}
        emptyMessage={
          !hasSites
            ? t('widget.energySiteInfo.noSite', 'No Tesla Energy site linked')
            : t('widget.energySiteInfo.noData', 'No site info available')
        }
        entries={entries}
      />
    </WidgetShell>
  );
}

EnergySiteInfoWidget.displayName = 'EnergySiteInfoWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const ENERGY_SITE_INFO_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Glyph base ---
  glyph: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
  headerIcon: {
    fontSize: 10,
    lineHeight: 14,
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

  // --- WidgetDetailCard ---
  detailCard: {
    flex: 1,
    minHeight: 0,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
  },
  detailRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  detailLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  detailValueWrap: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  detailValue: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'right',
    color: colors.textPrimary,
  },
  detailValueMono: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },

  // --- Badge ---
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  emptyMessage: {
    textAlign: 'center',
  },
});

const glyphToneStyles = StyleSheet.create<Record<GlyphTone, TextStyle>>({
  green: {
    color: colors.success,
  },
  muted: {
    color: colors.textMuted,
  },
});

const badgeContainerStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
  warning: {
    color: colors.warning,
  },
  neutral: {
    color: colors.textSecondary,
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
