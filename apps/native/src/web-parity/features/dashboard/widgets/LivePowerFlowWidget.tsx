// Native parity port of
// web/src/features/dashboard/widgets/LivePowerFlowWidget.tsx.
//
// The web widget is a Tesla Energy "Live Power Flow" dashboard tile. It resolves
// the first linked energy site (useTeslaEnergySites -> [0].energy_site_id), polls
// that site's live status (useTeslaEnergyLiveStatus(siteId)), and renders — inside
// a <WidgetShell> — a <WidgetFlowDiagram> of four nodes (Solar top, Grid left,
// Home right, Battery bottom) wired together by directional power arrows. solar /
// battery / grid / load power (watts) are read straight off the live status,
// divided by 1000 for kW display, and the arrows model the real flow direction:
// Solar->Home, Solar->Battery (charging), Battery->Home (discharging, batteryW<0),
// Grid->Home (importing, gridW>0), Home->Grid (exporting, gridW<0), Grid->Battery
// (charging from grid with no solar). When no energy site is linked it short-
// circuits to an EmptyState ("No Tesla Energy site linked"); when a site exists
// but has no live data the diagram shows its own "No live power data" empty body.
// Combined freshness (loading / fetching / stale / error / max(dataUpdatedAt)) and
// a manual refresh that refetches BOTH queries feed the shell header.
//
// This native port preserves that contract 1:1 — identical hook calls + API paths
// (/tesla/energy-sites + /tesla/energy-sites/{id}/live-status via the already-
// ported web-parity useEnergy hooks), the same siteId / isLoading / isFetching /
// isStale / isError / updatedAt / hasSites / handleRefresh derivations, the same
// solarW/batteryW/gridW/homeW reads + watts->kW (/1000) conversion, the same
// isCompact (size.cols <= 1) + hasData (liveStatus != null) flags, the byte-for-
// byte nodes/arrows useMemo bodies (every flow condition, Math.abs/Math.min, the
// 0.01 active threshold, and the dep arrays), the same two branches, and the same
// i18n keys + English defaults — using React Native primitives, the existing
// native AppText + design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     (fallback ?? key), preserving every key + English default. None interpolate.
//   - lucide-react Sun / Battery / Home / Zap (web L3): DOM SVG icons -> emoji /
//     glyph stand-ins (sun / battery / house / zap), tinted with the same
//     yellow-400 / purple-400 / emerald-400 / blue-400 intent.
//   - @/components/feedback EmptyState (web L4): reproduced as a native-safe
//     <EmptyState> (centered optional glyph + muted message, py-8 spacing).
//   - @/api/hooks/useEnergy useTeslaEnergyLiveStatus / useTeslaEnergySites (web
//     L5): the already-ported web-parity useEnergy hooks (same signatures +
//     /tesla/energy-sites + /tesla/energy-sites/{id}/live-status paths + types).
//   - @/lib/numberFormat fmtNumber (web L6): inline native fmtNumber (locale
//     fixed-fraction-digits) — used to build each node's formattedValue " kW".
//   - ./shared WidgetFlowDiagram + FlowNode + FlowArrow (web L7): reproduced as a
//     native-safe <WidgetFlowDiagram>. React Native has no inline SVG, so the
//     100x100 viewBox is replaced by a fixed-size square of absolutely-positioned
//     circular node Views + rotated line Views (the same technique the ported
//     RadialGauge uses). The position->coordinate map, node radius (compact vs
//     standard), strokeForValue thickness, arrowColor resolution, compact top-3
//     arrow cap + 3-char label truncation are all preserved; the SVG animated
//     dash (strokeDasharray '4 8' + dashFlow keyframes) and the AnimatedNumber
//     count-up have no native analogue and are reduced to a solid rounded bar
//     (active = full opacity, inactive = dimmed) + a static formatted value.
//   - ./WidgetShell (web L8): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the 1500ms pulse-on-update glow, and the
//     inline DataFreshness chip (its web Skeleton / QueryError / DataFreshness
//     internals reduced to native equivalents; dot-only compact when title-less).
//   - ./types WidgetProps (web L9): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {
  useTeslaEnergyLiveStatus,
  useTeslaEnergySites,
} from '../../../api/hooks/useEnergy';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L3)                             */
/* ------------------------------------------------------------------ */

const ICON_SUN = '\u2600'; // ☀ (Sun)
const ICON_BATTERY = '\uD83D\uDD0B'; // 🔋 (Battery)
const ICON_HOME = '\uD83C\uDFE0'; // 🏠 (Home)
const ICON_ZAP = '\u26A1'; // ⚡ (Zap)

/* per-node lucide tints (web text-yellow/purple/emerald/blue-400) */
const TINT_SOLAR = '#facc15'; // yellow-400
const TINT_GRID = '#60a5fa'; // blue-400
const TINT_HOME = '#34d399'; // emerald-400
const TINT_BATTERY = '#c084fc'; // purple-400
const TINT_RED = '#f87171'; // red-400 (arrowColor negative branch)

const PULSE_GLOW = '#22c55e';

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  native-safe formatter (web @/lib/numberFormat fmtNumber)           */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Port of web fmtNumber — locale number with fixed fraction digits. */
function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? 2;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  ported: ./shared FlowNode + FlowArrow (web L6-21 of WidgetFlowDiagram) */
/* ------------------------------------------------------------------ */

export interface FlowNode {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  icon?: ReactNode;
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export interface FlowArrow {
  from: string;
  to: string;
  value: number;
  active: boolean;
  color?: string;
}

/* ── position → coordinate mapping (web 100×100 viewBox) ── */

const POSITION_COORDS: Record<FlowNode['position'], {cx: number; cy: number}> = {
  top: {cx: 50, cy: 12},
  bottom: {cx: 50, cy: 88},
  left: {cx: 12, cy: 50},
  right: {cx: 88, cy: 50},
  center: {cx: 50, cy: 50},
};

const MIN_STROKE = 1;
const MAX_STROKE = 4;

/**
 * Resolve a FlowArrow.color into a concrete hex (web arrowColor returned a
 * Tailwind class string; native needs a real colour). The class strings this
 * widget supplies map 1:1; the value-sign fallbacks mirror web exactly.
 */
const CLASS_TO_HEX: Record<string, string> = {
  'text-yellow-400': TINT_SOLAR,
  'text-blue-400': TINT_GRID,
  'text-emerald-400': TINT_HOME,
  'text-purple-400': TINT_BATTERY,
  'text-red-400': TINT_RED,
};

function arrowColor(value: number, override?: string): string {
  if (override) {
    return CLASS_TO_HEX[override] ?? override;
  }
  if (value > 0) {
    return TINT_HOME; // text-emerald-400
  }
  if (value < 0) {
    return TINT_RED; // text-red-400
  }
  return colors.textMuted; // text-[var(--text-muted)]
}

function strokeForValue(value: number, maxValue: number): number {
  if (maxValue === 0) {
    return MIN_STROKE;
  }
  const ratio = Math.abs(value) / maxValue;
  return MIN_STROKE + ratio * (MAX_STROKE - MIN_STROKE);
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

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
  // Pulse on data change (web L59-80).
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
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
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
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={[styles.body, !title ? styles.bodyTopPad : null]}>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

function EmptyState({icon, message}: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetFlowDiagram (web ./shared/WidgetFlowDiagram)          */
/*                                                                     */
/*  React Native has no inline SVG, so the 100×100 viewBox is rebuilt   */
/*  as a fixed-size square of absolutely-positioned circular node Views */
/*  + rotated line Views (the technique the ported RadialGauge uses).   */
/* ------------------------------------------------------------------ */

interface WidgetFlowDiagramProps {
  nodes: FlowNode[];
  arrows: FlowArrow[];
  compact?: boolean;
  emptyMessage?: string;
}

const DIAGRAM_SIZE_STANDARD = 200;
const DIAGRAM_SIZE_COMPACT = 150;
const NODE_RADIUS_STANDARD = 26;
const NODE_RADIUS_COMPACT = 18;
const LABEL_FONT_STANDARD = 10;
const LABEL_FONT_COMPACT = 8;
const VALUE_FONT_STANDARD = 12;
const VALUE_FONT_COMPACT = 9;
const ICON_FONT = 12; // web lucide h-3 w-3 (≈12px, constant for compact + standard)
const MIN_STROKE_PX = 1.5;

function WidgetFlowDiagram({
  nodes,
  arrows,
  compact = false,
  emptyMessage = 'No flow data available',
}: WidgetFlowDiagramProps) {
  const nodeMap = useMemo(
    () => new Map(nodes.map(n => [n.id, n])),
    [nodes],
  );

  const visibleArrows = useMemo(() => {
    if (!compact) {
      return arrows;
    }
    return [...arrows]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3);
  }, [arrows, compact]);

  const maxArrowValue = useMemo(
    () => Math.max(...arrows.map(a => Math.abs(a.value)), 1),
    [arrows],
  );

  if (nodes.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  // Geometry: an inset square so node circles + their labels never clip.
  const diagramSize = compact ? DIAGRAM_SIZE_COMPACT : DIAGRAM_SIZE_STANDARD;
  const nodeRadius = compact ? NODE_RADIUS_COMPACT : NODE_RADIUS_STANDARD;
  const labelFont = compact ? LABEL_FONT_COMPACT : LABEL_FONT_STANDARD;
  const valueFont = compact ? VALUE_FONT_COMPACT : VALUE_FONT_STANDARD;
  const pad = nodeRadius + labelFont + 6;
  const drawSize = diagramSize - pad * 2;
  const strokeScale = drawSize / 100;
  const toPx = (coord: number) => pad + (coord / 100) * drawSize;

  return (
    <View
      accessibilityLabel="Energy flow diagram"
      accessibilityRole="image"
      style={[styles.diagram, {height: diagramSize, width: diagramSize}]}>
      {/* ── arrows ── */}
      {visibleArrows.map(arrow => {
        const fromNode = nodeMap.get(arrow.from);
        const toNode = nodeMap.get(arrow.to);
        if (!fromNode || !toNode) {
          return null;
        }

        const fromPos = POSITION_COORDS[fromNode.position];
        const toPos = POSITION_COORDS[toNode.position];

        const fromCx = toPx(fromPos.cx);
        const fromCy = toPx(fromPos.cy);
        const toCx = toPx(toPos.cx);
        const toCy = toPx(toPos.cy);

        const dx = toCx - fromCx;
        const dy = toCy - fromCy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;

        // offset start/end by node radius so lines don't overlap circles
        const x1 = fromCx + ux * nodeRadius;
        const y1 = fromCy + uy * nodeRadius;
        const x2 = toCx - ux * nodeRadius;
        const y2 = toCy - uy * nodeRadius;

        const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

        const sw = Math.max(
          MIN_STROKE_PX,
          strokeForValue(arrow.value, maxArrowValue) * strokeScale,
        );
        const color = arrowColor(arrow.value, arrow.color);

        return (
          <View
            key={`${arrow.from}-${arrow.to}`}
            style={[
              styles.arrow,
              {
                backgroundColor: color,
                borderRadius: sw / 2,
                height: sw,
                left: midX - length / 2,
                opacity: arrow.active ? 1 : 0.45,
                top: midY - sw / 2,
                transform: [{rotateZ: `${angleDeg}deg`}],
                width: length,
              },
            ]}
          />
        );
      })}

      {/* ── nodes + labels ── */}
      {nodes.map(node => {
        const pos = POSITION_COORDS[node.position];
        const cx = toPx(pos.cx);
        const cy = toPx(pos.cy);
        const label =
          compact && node.label.length > 3
            ? node.label.slice(0, 3).toUpperCase()
            : node.label;
        const labelWidth = nodeRadius * 2 + 28;
        const labelTop =
          node.position === 'bottom'
            ? cy + nodeRadius + 2
            : cy - nodeRadius - (labelFont + 2);

        return (
          <React.Fragment key={node.id}>
            <View
              style={[
                styles.node,
                {
                  borderRadius: nodeRadius,
                  height: nodeRadius * 2,
                  left: cx - nodeRadius,
                  top: cy - nodeRadius,
                  width: nodeRadius * 2,
                },
              ]}>
              {node.icon}
              <AppText
                numberOfLines={1}
                style={[styles.nodeValue, {fontSize: valueFont}]}>
                {fmtNumber(node.value, 1)}
              </AppText>
            </View>
            <AppText
              numberOfLines={1}
              style={[
                styles.nodeLabel,
                {
                  fontSize: labelFont,
                  left: cx - labelWidth / 2,
                  top: labelTop,
                  width: labelWidth,
                },
              ]}>
              {label}
            </AppText>
          </React.Fragment>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  LivePowerFlowWidget (web L11-215)                                  */
/* ------------------------------------------------------------------ */

export default function LivePowerFlowWidget({size}: WidgetProps) {
  const t = useNativeTranslation();

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
    data: liveStatus,
    isLoading: liveLoading,
    isFetching: liveFetching,
    isStale: liveStale,
    isError: liveIsError,
    dataUpdatedAt: liveUpdatedAt,
    refetch: refetchLive,
  } = useTeslaEnergyLiveStatus(siteId);

  const isLoading = sitesLoading || (!!siteId && liveLoading);
  const isFetching = sitesFetching || liveFetching;
  const isStale = sitesStale || liveStale;
  const isError = sitesIsError || liveIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, liveUpdatedAt ?? 0);

  const hasSites = (sites ?? []).length > 0;

  const handleRefresh = () => {
    refetchSites();
    if (siteId) {
      refetchLive();
    }
  };

  const solarW = liveStatus?.solar_power ?? 0;
  const batteryW = liveStatus?.battery_power ?? 0;
  const gridW = liveStatus?.grid_power ?? 0;
  const homeW = liveStatus?.load_power ?? 0;

  // Convert watts → kW for display
  const solarKw = solarW / 1000;
  const batteryKw = batteryW / 1000;
  const gridKw = gridW / 1000;
  const homeKw = homeW / 1000;

  const isCompact = size.cols <= 1;

  const hasData = liveStatus != null;

  const nodes = useMemo<FlowNode[]>(() => {
    if (!hasData) {
      return [];
    }
    return [
      {
        id: 'solar',
        label: t('widget.livePowerFlow.solar', 'Solar'),
        value: Math.abs(solarKw),
        formattedValue: `${fmtNumber(Math.abs(solarKw), 1)} kW`,
        icon: (
          <AppText style={[styles.nodeIconGlyph, {color: TINT_SOLAR}]}>
            {ICON_SUN}
          </AppText>
        ),
        position: 'top' as const,
      },
      {
        id: 'grid',
        label: t('widget.livePowerFlow.grid', 'Grid'),
        value: Math.abs(gridKw),
        formattedValue: `${fmtNumber(Math.abs(gridKw), 1)} kW`,
        icon: (
          <AppText style={[styles.nodeIconGlyph, {color: TINT_GRID}]}>
            {ICON_ZAP}
          </AppText>
        ),
        position: 'left' as const,
      },
      {
        id: 'home',
        label: t('widget.livePowerFlow.home', 'Home'),
        value: Math.abs(homeKw),
        formattedValue: `${fmtNumber(Math.abs(homeKw), 1)} kW`,
        icon: (
          <AppText style={[styles.nodeIconGlyph, {color: TINT_HOME}]}>
            {ICON_HOME}
          </AppText>
        ),
        position: 'right' as const,
      },
      {
        id: 'battery',
        label: t('widget.livePowerFlow.battery', 'Battery'),
        value: Math.abs(batteryKw),
        formattedValue: `${fmtNumber(Math.abs(batteryKw), 1)} kW`,
        icon: (
          <AppText style={[styles.nodeIconGlyph, {color: TINT_BATTERY}]}>
            {ICON_BATTERY}
          </AppText>
        ),
        position: 'bottom' as const,
      },
    ];
  }, [hasData, solarKw, gridKw, homeKw, batteryKw, t]);

  const arrows = useMemo<FlowArrow[]>(() => {
    if (!hasData) {
      return [];
    }

    const result: FlowArrow[] = [];

    // Solar → Home (solar producing)
    if (solarKw > 0) {
      result.push({
        from: 'solar',
        to: 'home',
        value: solarKw,
        active: solarKw > 0.01,
        color: 'text-yellow-400',
      });
    }

    // Solar → Battery (excess solar charging battery)
    if (solarKw > 0 && batteryW > 0) {
      result.push({
        from: 'solar',
        to: 'battery',
        value: Math.min(solarKw, Math.abs(batteryKw)),
        active: true,
        color: 'text-yellow-400',
      });
    }

    // Battery → Home (discharging, batteryW < 0)
    if (batteryW < 0) {
      result.push({
        from: 'battery',
        to: 'home',
        value: Math.abs(batteryKw),
        active: true,
        color: 'text-purple-400',
      });
    }

    // Grid → Home (importing, gridW > 0)
    if (gridW > 0) {
      result.push({
        from: 'grid',
        to: 'home',
        value: gridKw,
        active: true,
        color: 'text-blue-400',
      });
    }

    // Home → Grid (exporting, gridW < 0)
    if (gridW < 0) {
      result.push({
        from: 'home',
        to: 'grid',
        value: Math.abs(gridKw),
        active: true,
        color: 'text-emerald-400',
      });
    }

    // Grid → Battery (charging from grid, batteryW > 0 && no solar)
    if (batteryW > 0 && solarKw <= 0) {
      result.push({
        from: 'grid',
        to: 'battery',
        value: Math.abs(batteryKw),
        active: true,
        color: 'text-blue-400',
      });
    }

    return result;
    // web L174 also lists homeKw, but the body never reads it; native
    // react-hooks/exhaustive-deps (error-level) rejects the unnecessary dep, so
    // it is dropped here. Behaviour is identical — homeKw never affected the
    // memo result — this is the only deviation from the verbatim web dep array.
  }, [hasData, solarKw, batteryKw, gridKw, batteryW, gridW]);

  // No energy sites linked
  if (!hasSites && !isLoading) {
    return (
      <WidgetShell
        error={null}
        isError={sitesIsError}
        isFetching={sitesFetching}
        isStale={sitesStale}
        loading={false}
        onRefresh={() => refetchSites()}
        updatedAt={sitesUpdatedAt}>
        <EmptyState
          message={t('widget.livePowerFlow.noSite', 'No Tesla Energy site linked')}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      error={null}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={t('widget.livePowerFlow.title', 'Live Power Flow')}
      updatedAt={updatedAt}>
      <WidgetFlowDiagram
        arrows={arrows}
        compact={isCompact}
        emptyMessage={t('widget.livePowerFlow.noData', 'No live power data')}
        nodes={nodes}
      />
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  arrow: {
    position: 'absolute',
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  diagram: {
    alignSelf: 'center',
    position: 'relative',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  node: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    position: 'absolute',
  },
  nodeIconGlyph: {
    fontSize: ICON_FONT,
    lineHeight: ICON_FONT + 2,
  },
  nodeLabel: {
    color: colors.textSecondary,
    fontWeight: '500',
    position: 'absolute',
    textAlign: 'center',
  },
  nodeValue: {
    color: colors.textPrimary,
    fontWeight: '600',
    textAlign: 'center',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
});
