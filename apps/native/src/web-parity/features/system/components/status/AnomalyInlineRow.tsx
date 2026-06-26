// Native parity port of
// web/src/features/system/components/status/AnomalyInlineRow.tsx.
//
// AnomalyInlineRow surfaces the most recent anomaly detected for the primary
// vehicle as a single Health row, and renders nothing when there are no
// anomalies in the last 24h or no vehicles to query. The sampling strategy
// (query only the first vehicle, since a self-hosted single-operator instance
// usually has one or two), the queryKey, the `/analytics/anomalies` endpoint
// with its snake_case `vehicle_id` + `days=1` params, the SLOW stale time, the
// severity->status mapping, the relative-time formatter, and the summary string
// are all preserved verbatim from the web source.
//
// Native adaptations vs. the web source (behaviour / keys kept):
//   - lucide-react `Activity` (web L13, L59 `<Activity className="h-4 w-4" />`)
//     -> the canonical SemanticIcon 'activity' glyph (ACTIVITY_GLYPH), rendered
//     as muted inline text in the row's icon slot.
//   - `@/lib/constants` STALE_TIMES (web L16) -> an inline STALE_TIMES.SLOW
//     constant (5 * 60_000), matching the sibling useAnomalies native port (the
//     parity tree has no shared constants module). Same 5-minute value as web.
//   - `@/components/status` HealthRow (web L18) -> an inline native HealthRow
//     equivalent: a Pressable "link" row with a status dot, an icon glyph slot,
//     a truncating label, a status-colored summary, and a trailing chevron. The
//     web component is a shared DOM/react-router widget; it is reproduced here
//     with RN primitives until a shared native HealthRow exists. The full
//     5-status dot/text color map from the web HealthRow is preserved.
//   - react-router `<Link to>` navigation -> a native-safe navigate fallback
//     (no-op) that preserves the `to="/anomaly-detection"` target on the row's
//     accessibilityHint, mirroring the sibling AlertRulesPage port.
// No DOM / Recharts / Leaflet / react-router / lucide / old web-UI imports reach
// the native output. See the .parity.json sidecar for the line-by-line map.

import React, {useCallback, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {request} from '../../../../api/client';
import type {
  AnomalyData,
  AnomalyEntry,
} from '../../../../api/hooks/useAnomalies';
import {useVehicles} from '../../../../api/hooks/useVehicles';
import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';

// Web `@/lib/constants` STALE_TIMES.SLOW (5 minutes) — inlined for the parity
// tree, matching the sibling useAnomalies port.
const STALE_TIMES = {
  SLOW: 5 * 60_000,
} as const;

// Web lucide <Activity/> -> canonical native SemanticIcon glyph (inline text).
const ACTIVITY_GLYPH = getSemanticIconDefinition('activity').glyph;

const SEVERITY_TO_STATUS = {
  critical: 'unhealthy',
  warning: 'degraded',
  info: 'unknown',
} as const;

// Web HealthRow status union (web StatusHero HeroStatus) plus its dot/text color
// maps, reproduced exactly (Tailwind {green,amber,red,zinc,blue}-400 hexes).
type HeroStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown'
  | 'maintenance';

const DOT_FOR_STATUS: Record<HeroStatus, string> = {
  degraded: '#fbbf24',
  healthy: '#4ade80',
  maintenance: '#60a5fa',
  unhealthy: '#f87171',
  unknown: '#a1a1aa',
};

const TEXT_FOR_STATUS: Record<HeroStatus, string> = {
  degraded: '#fbbf24',
  healthy: '#4ade80',
  maintenance: '#60a5fa',
  unhealthy: '#f87171',
  unknown: '#a1a1aa',
};

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return 'recently';
  }
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) {
    return `${secs}s ago`;
  }
  if (secs < 3600) {
    return `${Math.floor(secs / 60)}m ago`;
  }
  if (secs < 86400) {
    return `${Math.floor(secs / 3600)}h ago`;
  }
  return `${Math.floor(secs / 86400)}d ago`;
}

// ---- Native-safe navigate (web react-router-dom Link `to`) ------------------
// Web routes the row through react-router <Link to>; React Native has no router
// history here, so navigation funnels to a no-op fallback while the `to` target
// is preserved on the row for a future native wire-up.
function useNativeNavigateFallback(): (path: string) => void {
  return useCallback((_path: string) => {
    // Intentional native-safe no-op — see comment above.
  }, []);
}

// ---- Inline HealthRow (web @/components/status HealthRow) --------------------

interface HealthRowProps {
  status: HeroStatus;
  icon?: ReactNode;
  label: string;
  summary: string;
  to?: string;
  onNavigate?: (path: string) => void;
}

function HealthRow({
  status,
  icon,
  label,
  summary,
  to,
  onNavigate,
}: HealthRowProps): React.ReactElement {
  const dotColor = DOT_FOR_STATUS[status];
  const summaryColor = TEXT_FOR_STATUS[status];

  const handlePress = useCallback(() => {
    if (to) {
      onNavigate?.(to);
    }
  }, [onNavigate, to]);

  const inner = (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.dot, {backgroundColor: dotColor}]}
      />
      {icon != null && icon !== false ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.iconSlot}>
          {typeof icon === 'string' || typeof icon === 'number' ? (
            <AppText style={styles.iconGlyph} variant="caption" weight="bold">
              {icon}
            </AppText>
          ) : (
            icon
          )}
        </View>
      ) : null}
      <AppText numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
      <AppText style={[styles.summary, {color: summaryColor}]}>
        {summary}
      </AppText>
      {to ? <AppText style={styles.chevron}>›</AppText> : null}
    </>
  );

  if (to) {
    return (
      <Pressable
        accessibilityHint={to}
        accessibilityLabel={`${label} — ${summary}`}
        accessibilityRole="link"
        onPress={handlePress}
        style={({pressed}) => [styles.row, pressed && styles.pressed]}>
        {inner}
      </Pressable>
    );
  }

  return <View style={styles.row}>{inner}</View>;
}

export function AnomalyInlineRow(): React.ReactElement | null {
  const navigate = useNativeNavigateFallback();
  const {data: vehicles} = useVehicles();
  const firstVehicle = vehicles?.[0];
  const firstVehicleId =
    firstVehicle?.id != null ? String(firstVehicle.id) : null;

  const {data} = useQuery<AnomalyData>({
    queryKey: ['system-status', 'anomalies-summary', firstVehicleId],
    queryFn: ({signal}) =>
      request<AnomalyData>(
        `/analytics/anomalies?vehicle_id=${firstVehicleId}&days=1`,
        {signal},
      ),
    enabled: firstVehicleId !== null,
    staleTime: STALE_TIMES.SLOW,
  });

  if (!data || data.anomalies_last_24h === 0) {
    return null;
  }

  const top: AnomalyEntry | undefined = data.anomalies?.[0];
  if (!top) {
    return null;
  }

  const summary = `${data.anomalies_last_24h} in 24h · ${top.signal} ${formatRelative(top.detected_at)}`;

  return (
    <HealthRow
      icon={ACTIVITY_GLYPH}
      label="Anomalies"
      onNavigate={navigate}
      status={SEVERITY_TO_STATUS[top.severity]}
      summary={summary}
      to="/anomaly-detection"
    />
  );
}

AnomalyInlineRow.displayName = 'AnomalyInlineRow';

const styles = StyleSheet.create({
  chevron: {
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: 16,
  },
  dot: {
    borderRadius: 999,
    flexShrink: 0,
    height: 10,
    width: 10,
  },
  iconGlyph: {
    color: colors.textSecondary,
  },
  iconSlot: {
    flexShrink: 0,
  },
  label: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  pressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  row: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  summary: {
    flexShrink: 0,
    fontSize: 12,
  },
});
