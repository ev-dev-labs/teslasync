// VehicleSpecsWidget — native parity port of
// web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx.
//
// The dashboard "Vehicle Specs" widget. It resolves a vehicle from the explicit
// `vehicleId` prop, falling back to the first vehicle (`useVehicles`), then reads
// three static-spec sources for that vehicle in parallel — the decoded specs
// (`GET /vehicles/{id}/specs` via useVehicleSpecs), the decoded option codes
// (`GET /vehicles/{id}/options` via useVehicleOptions), and the latest config
// snapshot (`GET /vehicle-config/latest?vehicle_id=` via useVehicleConfigLatest,
// 60s refetch) — combining their loading / fetching / stale / error / updatedAt
// flags exactly like the web source. It then builds a label/value DetailEntry
// list (Model, Trim, Paint Color, Wheels, Interior, Aux Battery, Car Version +
// up to 8 decoded option badges) and renders one of three branches, preserved
// verbatim from the web source:
//   1. hasAnyData && isCompact (cols <= 1) -> a centered FileText glyph over the
//      model name + a "Trim: <trim>" caption (CompactView).
//   2. hasAnyData && !isCompact -> the shared WidgetDetailCard of the entries.
//   3. !hasAnyData -> an EmptyState (FileText glyph + "No specs available").
// Every state name (vehicles, numericId, stringId, specsEnvelope/optionsEnvelope/
// configData and each of their query flags, isLoading, isFetching, isStale,
// isError, updatedAt, specs, options, isCompact, entries, hasAnyData,
// handleRefresh), every /specs //options //vehicle-config API path, the
// specs-then-config field-precedence for each row, the slice(0, isCompact ? 0 : 8)
// option cap, the i18n key + English fallback for every label, the `'—'`
// placeholder, and each render branch is preserved; all 201 source lines are
// mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react useMemo (web L1) -> react useMemo (unchanged); the entries memo keeps
//     the identical [specs, options, configData, isCompact, t] dependency array.
//   - react-i18next useTranslation('dashboard') (web L2) -> the native
//     t(key, fallback) shim used across the parity tree (the 'dashboard'
//     namespace is accepted-and-ignored — there is no i18n runtime in RN); the
//     same `t` is handed to CompactView, whose (k, f) => string contract is kept.
//   - lucide-react FileText (web L3) -> the native SemanticIcon 'fileText' glyph
//     via getSemanticIconDefinition/glyphNode (lucide is browser-only); the title
//     + compact glyphs are tinted with the accent token (web text-neon-cyan) and
//     the empty-state glyphs with the muted token.
//   - @/components/feedback EmptyState (web L4) -> an inline native EmptyState
//     (icon chip + muted centered message); the feedback barrel is a DOM tree and
//     is not in the native parity manifest (DoorWindowStatusWidget precedent).
//   - @/components/motion FadeIn (web L5) -> an inline passthrough FadeIn (the web
//     framer-motion entrance animation has no drop-in RN equivalent in this parity
//     layer; the BatteryHealthPage precedent renders children in a flex View).
//   - @/api/hooks useVehicles/useVehicleSpecs/useVehicleOptions/
//     useVehicleConfigLatest (web L6) -> imported from the canonical converted
//     native hook file (../../../api/hooks/useVehicles) — same query keys, same
//     /vehicles + /specs + /options + /vehicle-config/latest paths, same
//     VehicleInfoEnvelope<Record<string, unknown>> + VehicleConfigSnapshot shapes,
//     same 60_000 ms config refetch interval.
//   - ./WidgetShell (web L7) -> reproduced self-contained here (per the
//     SafetyFeaturesWidget inline-reproduction precedent): the browser-only
//     DataFreshness / PinButton / HelpTooltip / Skeleton / QueryError chrome
//     becomes a native-safe freshness pill (relative "updated" time + a refresh
//     Pressable wired to onRefresh, with stale/error/fetching markers), a dimmed
//     skeleton box, and a centered error message; the title-aware header matches
//     the web shell's title vs. title-less branches.
//   - ./shared WidgetDetailCard + type DetailEntry (web L8) -> imported from the
//     converted native shared primitive (./shared/WidgetDetailCard), whose
//     DetailEntry shape + badge variant set + `?? '—'` value fallback match.
//   - ./types WidgetProps (web L9) -> reproduced inline (WidgetSize + WidgetProps);
//     `config` stays in the contract but, like the web source, is unread.
//
// No DOM / lucide / react-i18next / framer-motion / Recharts / Leaflet / old
// web-UI imports reach the native output — only react, react-native primitives,
// the canonical AppText + GlassPanel + SemanticIcon, the converted shared
// WidgetDetailCard, the parity hooks, and theme tokens.

import React, {useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {
  useVehicleConfigLatest,
  useVehicleOptions,
  useVehicles,
  useVehicleSpecs,
} from '../../../api/hooks/useVehicles';
import {WidgetDetailCard, type DetailEntry} from './shared/WidgetDetailCard';

// ── Ported widget types (web ./types WidgetProps / WidgetSize) ────────────────

/** Grid footprint in cols/rows (web `./types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Widget render props (web `./types` WidgetProps). `config` is accepted for
 *  source parity but, like the web source, this widget reads only vehicleId +
 *  size. */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ──────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── SemanticIcon glyph node (web lucide icon nodes) ───────────────────────────

/**
 * Renders a decorative glyph in the given color, replacing a web lucide
 * `<Icon className="…" />` node.
 */
function glyphNode(
  name: SemanticIconName,
  color: string,
  glyphStyle: StyleProp<TextStyle>,
): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[glyphStyle, {color}]}
      weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

// ── FadeIn (web @/components/motion FadeIn) — no RN entrance animation ─────────

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  // The web FadeIn is a framer-motion entrance animation. React Native has no
  // drop-in equivalent in this parity layer, so this is a passthrough; the
  // `delay` prop is accepted and ignored to preserve every call site.
  return <View style={styles.fadeIn}>{children}</View>;
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ────────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative "updated" time: <1m "Just now", <60m "Xm ago", <24h "Xh ago",
 *  else the absolute date-time. */
function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return formatDateTime(isoStr);
}

/** Native-safe freshness pill: relative "updated" time + refresh affordance,
 *  reflecting the query's fetching/stale/error flags. Replaces the web
 *  DataFreshness chrome (which depends on browser-only timers/icons). */
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  if (isError) label = 'Error';
  else if (isFetching) label = 'Updating…';
  else if (updatedAt > 0)
    label = formatRelativeTime(new Date(updatedAt).toISOString());
  else label = 'Never';

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onRefresh}
      style={styles.freshness}>
      <AppText
        style={[
          styles.freshnessText,
          isError
            ? styles.freshnessError
            : isStale
              ? styles.freshnessStale
              : null,
        ]}>
        {label}
      </AppText>
      <AppText style={styles.refreshGlyph} weight="bold">
        {getSemanticIconDefinition('refresh').glyph}
      </AppText>
    </Pressable>
  );
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
}: {
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
}) {
  if (loading) {
    return <View accessibilityLabel="Loading" style={styles.skeleton} />;
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.errorBox}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.shell}>
      <View style={[styles.shellHeader, !title && styles.shellHeaderEnd]}>
        {title ? (
          <View style={styles.shellTitleGroup}>
            {icon}
            <AppText style={styles.shellTitle}>{title}</AppText>
          </View>
        ) : null}
        <DataFreshness
          isError={isError ?? false}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          onRefresh={onRefresh}
          updatedAt={updatedAt ?? 0}
        />
      </View>
      <View style={styles.shellBody}>{children}</View>
    </GlassPanel>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export default function VehicleSpecsWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const numericId = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const stringId = numericId > 0 ? String(numericId) : undefined;

  const {
    data: specsEnvelope,
    isLoading: specsLoading,
    isFetching: specsFetching,
    isStale: specsStale,
    isError: specsError,
    dataUpdatedAt: specsUpdatedAt,
    refetch: refetchSpecs,
  } = useVehicleSpecs(stringId);

  const {
    data: optionsEnvelope,
    isLoading: optionsLoading,
    isFetching: optionsFetching,
    isStale: optionsStale,
    isError: optionsError,
    dataUpdatedAt: optionsUpdatedAt,
    refetch: refetchOptions,
  } = useVehicleOptions(stringId);

  const {
    data: configData,
    isLoading: configLoading,
    isFetching: configFetching,
    isStale: configStale,
    isError: configError,
    dataUpdatedAt: configUpdatedAt,
    refetch: refetchConfig,
  } = useVehicleConfigLatest(numericId, 60_000);

  const isLoading = specsLoading || optionsLoading || configLoading;
  const isFetching = specsFetching || optionsFetching || configFetching;
  const isStale = specsStale || optionsStale || configStale;
  const isError = specsError || optionsError || configError;
  const updatedAt = Math.max(
    specsUpdatedAt ?? 0,
    optionsUpdatedAt ?? 0,
    configUpdatedAt ?? 0,
  );

  const specs = specsEnvelope?.data ?? null;
  const options = optionsEnvelope?.data ?? null;

  const isCompact = size.cols <= 1;

  const entries: DetailEntry[] = useMemo(() => {
    const items: DetailEntry[] = [];

    // Model from specs
    const model =
      asString(specs?.car_type) ??
      asString(specs?.model) ??
      asString(configData?.car_type);
    items.push({
      label: t('widget.specs.model', 'Model'),
      value: model ?? '—',
    });

    // Trim from specs or config
    const trim =
      asString(specs?.trim_badging) ??
      asString(specs?.trim) ??
      asString(configData?.trim);
    items.push({
      label: t('widget.specs.trim', 'Trim'),
      value: trim ?? '—',
    });

    // Paint color
    const paint =
      asString(specs?.exterior_color) ?? asString(configData?.exterior_color);
    items.push({
      label: t('widget.specs.paint', 'Paint Color'),
      value: paint ?? '—',
    });

    // Wheels
    const wheels =
      asString(specs?.wheel_type) ?? asString(configData?.wheel_type);
    items.push({
      label: t('widget.specs.wheels', 'Wheels'),
      value: wheels ?? '—',
    });

    // Interior
    const interior =
      asString(specs?.interior) ?? asString(specs?.interior_color);
    items.push({
      label: t('widget.specs.interior', 'Interior'),
      value: interior ?? '—',
    });

    // Aux battery from specs (not on config snapshot type)
    const auxBattery = asString(specs?.aux_battery_type);
    items.push({
      label: t('widget.specs.auxBattery', 'Aux Battery'),
      value: auxBattery ?? '—',
    });

    // Car version from config
    const carVersion =
      asString(configData?.version) ?? asString(specs?.car_version);
    items.push({
      label: t('widget.specs.carVersion', 'Car Version'),
      value: carVersion ?? '—',
      mono: true,
    });

    // Options as badges (decoded option codes)
    if (options && typeof options === 'object') {
      const optionKeys = Object.keys(options);
      for (const key of optionKeys.slice(0, isCompact ? 0 : 8)) {
        const decoded = asString(options[key]) ?? key;
        items.push({
          label: key,
          value: decoded,
          badge: {text: t('widget.specs.option', 'Option'), variant: 'neutral'},
        });
      }
    }

    return items;
  }, [specs, options, configData, isCompact, t]);

  const hasAnyData =
    specs !== null || options !== null || configData !== null;

  const handleRefresh = () => {
    refetchSpecs();
    refetchOptions();
    refetchConfig();
  };

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vehicleSpecs', 'Vehicle Specs')}
      icon={isCompact ? undefined : glyphNode('fileText', colors.accent, styles.titleGlyph)}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}>
      {hasAnyData ? (
        <FadeIn>
          {isCompact ? (
            <CompactView
              specs={specs}
              configData={(configData ?? null) as Record<string, unknown> | null}
              t={t}
            />
          ) : (
            <WidgetDetailCard
              entries={entries}
              emptyMessage={t('widget.specs.noData', 'No specs available')}
              emptyIcon={glyphNode('fileText', colors.textMuted, styles.emptyGlyph)}
            />
          )}
        </FadeIn>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={glyphNode('fileText', colors.textMuted, styles.emptyGlyph)}
          message={t('widget.specs.noData', 'No specs available')}
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: 1-col layout — Model + Trim centered ── */
function CompactView({
  specs,
  configData,
  t,
}: {
  specs: Record<string, unknown> | null;
  configData: Record<string, unknown> | null;
  t: (k: string, f: string) => string;
}) {
  const model =
    asString(specs?.car_type) ??
    asString(specs?.model) ??
    asString(configData?.car_type) ??
    '—';
  const trim =
    asString(specs?.trim_badging) ??
    asString(specs?.trim) ??
    asString(configData?.trim) ??
    '—';

  return (
    <View style={styles.compactContainer}>
      {glyphNode('fileText', colors.accent, styles.compactGlyph)}
      <AppText
        numberOfLines={1}
        style={styles.compactModel}
        weight="bold">
        {model}
      </AppText>
      <AppText numberOfLines={1} style={styles.compactTrim}>
        {t('widget.specs.trim', 'Trim')}: {trim}
      </AppText>
    </View>
  );
}

/** Safely extract a string from an unknown value */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number') return String(val);
  return null;
}

const styles = StyleSheet.create({
  compactContainer: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  compactGlyph: {
    fontSize: 16,
    letterSpacing: 0.2,
    lineHeight: 20,
    textAlign: 'center',
  },
  compactModel: {
    color: colors.textPrimary,
    fontSize: 14,
    maxWidth: '100%',
    textAlign: 'center',
  },
  compactTrim: {
    color: colors.textSecondary,
    fontSize: 12,
    maxWidth: '100%',
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyGlyph: {
    fontSize: 11,
    letterSpacing: 0.2,
    lineHeight: 14,
    textAlign: 'center',
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  fadeIn: {
    flex: 1,
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessError: {
    color: colors.danger,
  },
  freshnessStale: {
    color: colors.warning,
  },
  freshnessText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  refreshGlyph: {
    color: colors.accent,
    fontSize: 10,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  shellHeaderEnd: {
    justifyContent: 'flex-end',
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  shellTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    flex: 1,
    minHeight: 120,
  },
  titleGlyph: {
    fontSize: 12,
    letterSpacing: 0.2,
    lineHeight: 16,
  },
});
