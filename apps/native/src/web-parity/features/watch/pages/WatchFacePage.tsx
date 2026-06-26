// Native parity port of web/src/features/watch/pages/WatchFacePage.tsx.
//
// Watch-optimized surface for Apple Watch / Wear OS. The web page is a
// chrome-less single screen (black OLED background, large battery gauge,
// tap-friendly 44px status icons, no scrolling, auto-refresh every 30s). Every
// behaviour is preserved one-for-one on native:
//   - State names + data flow: vehicleId (from the vehicle_id param),
//     useWatchSummary(vehicleId) -> data/isLoading/error, useWatchCommand() ->
//     commandMutation, sendCommand(command) -> commandMutation.mutate({vehicleId,
//     command}). API paths (/watch/summary, /watch/command) live in the ported
//     useWatch hook and are unchanged.
//   - SI boundary: range_km (km) -> *1000 -> convertDistanceFromSI; inside_temp_c
//     (already C) -> convertTempFromSI. Conversion happens only at the render
//     boundary via the useFormatPrefs() bridge (Phase-48 frontend SI-cutover
//     rule). SI stays on the wire.
//   - Section order: vehicle name -> battery gauge (center focus) + charging
//     line + state badge -> quick-action icons (lock/climate/sentry) -> last
//     updated. The opt-in <AIWatchFaceNLResponse /> Helix narrator renders as a
//     sibling AFTER the watch shell (it returns null when AI is off, preserving
//     the wearable chrome-less invariant; on AI-on it appears below, reachable by
//     scroll exactly like the web body-scroll).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-router-dom useSearchParams -> readVehicleIdParam(): feature-detects
//     globalThis.location.search (present on react-native-web, absent on bare
//     native) and parses vehicle_id the same way the web reads searchParams; on
//     bare native there is no URL, so the param is null and vehicleId stays
//     undefined (same nullish branch as the web `? Number(...) : undefined`).
//   - @/components/feedback Spinner -> ActivityIndicator.
//   - @/components/ui Badge/Button -> inline native WatchStateBadge (rounded
//     coloured chip) and StatusIcon (44px Pressable glyph button).
//   - @/lib/cn cn -> dropped (RN style arrays compose conditionally).
//   - @/hooks/useUnits useUnits -> useFormatPrefs() (distanceUnit/tempUnit).
//   - @/lib/unitConversion convertDistanceFromSI/convertTempFromSI/
//     DistanceUnitPref -> the shared _formatPrimitives port (DistanceUnit).
//   - lucide-react Zap/Lock/Unlock/Thermometer/Shield -> SemanticIcon 'bolt'
//     (charging) + short glyph chips ('LK'/'UL'/'CL'/'SH') coloured from the
//     source's emerald/red/amber/cyan/muted intent (lucide SVG has no native
//     renderer). The web SVG battery ring is approximated with positioned native
//     View segments (same technique as the shared native RadialGauge port).
//   - WatchPWAMeta document/meta/link manipulation -> feature-detected against
//     globalThis.document: applied verbatim on react-native-web, a no-op on bare
//     native where PWA meta/manifest tags are meaningless (renders null either
//     way).
//
// No DOM-only modules, HTML elements, react-router-dom, lucide-react, Recharts,
// or Leaflet are imported — only react, react-native primitives, the shared
// native SemanticIcon/AppText/theme tokens, and the ported parity useWatch /
// _formatPrimitives / AIWatchFaceNLResponse.

import React, {useEffect} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {AIWatchFaceNLResponse} from '../../../components/ai/AIWatchFaceNLResponse';
import {
  convertDistanceFromSI,
  convertTempFromSI,
  useFormatPrefs,
  type DistanceUnit,
} from '../../../components/data-display/format/_formatPrimitives';
import {useWatchCommand, useWatchSummary} from '../../../api/hooks/useWatch';

export default function WatchFacePage() {
  // react-router useSearchParams has no native analogue; readVehicleIdParam
  // feature-detects the URL (react-native-web) and returns null on bare native,
  // preserving the web `vehicleIdParam ? Number(...) : undefined` branch.
  const vehicleIdParam = readVehicleIdParam();
  const vehicleId = vehicleIdParam ? Number(vehicleIdParam) : undefined;
  const {data, isLoading, error} = useWatchSummary(vehicleId);
  const commandMutation = useWatchCommand();
  const {distanceUnit, tempUnit} = useFormatPrefs();

  const sendCommand = (command: string) => {
    commandMutation.mutate({vehicleId, command});
  };

  // Render the wearable WatchShell first as the primary surface; the opt-in
  // Helix narrator is appended as a sibling AFTER so off-mode users see ONLY the
  // chrome-less wearable shell (AIWatchFaceNLResponse returns null in off mode →
  // the sibling is absent from the tree, preserving the wearable invariant).
  let watchContent: React.ReactNode;
  if (isLoading) {
    watchContent = (
      <View style={styles.fill}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  } else if (error || !data) {
    watchContent = (
      <View style={styles.fill}>
        <AppText style={styles.errorText} tone="secondary">
          {error ? String(error) : 'No vehicle found'}
        </AppText>
      </View>
    );
  } else {
    // SI boundary: backend `range_km` is in km, derived in watch_handler.go as
    // RatedRange*1.60934. Multiply by 1000 before passing it to
    // convertDistanceFromSI.
    const displayRange = convertDistanceFromSI(
      (data.range_km ?? 0) * 1000,
      distanceUnit,
    );
    // SI boundary: backend `inside_temp_c` is already °C (SI for temp).
    const displayInsideTemp = convertTempFromSI(
      data.inside_temp_c ?? 0,
      tempUnit,
    );

    const isLocked = data.is_locked ?? false;
    const isClimateOn = data.is_climate_on ?? false;
    const sentryMode = data.sentry_mode ?? false;

    watchContent = (
      <>
        {/* Vehicle name */}
        <AppText
          numberOfLines={1}
          style={styles.vehicleName}
          tone="muted"
          variant="caption">
          {data.vehicle_name ?? ''}
        </AppText>

        {/* Battery gauge — center focus */}
        <View style={styles.batterySection}>
          <BatteryGauge
            distanceUnit={distanceUnit}
            level={data.battery_level ?? 0}
            rangeDisplay={displayRange}
          />

          {/* Charging status */}
          {(data.is_charging ?? false) && (
            <View style={styles.chargingRow}>
              <SemanticIcon decorative name="bolt" size="sm" />
              <AppText style={styles.chargingText} variant="caption">
                {Math.round(data.time_to_full ?? 0)}m to full
              </AppText>
            </View>
          )}

          {/* State badge */}
          <WatchStateBadge state={data.state ?? ''} />
        </View>

        {/* Quick action icons */}
        <View style={styles.quickActions}>
          <StatusIcon
            accessibilityLabel={isLocked ? 'Locked, tap to unlock' : 'Unlocked, tap to lock'}
            active={isLocked}
            color={isLocked ? 'emerald' : 'red'}
            glyph={isLocked ? 'LK' : 'UL'}
            loading={commandMutation.isPending}
            onPress={() => sendCommand(isLocked ? 'unlock' : 'lock')}
          />
          <StatusIcon
            accessibilityLabel={`${Math.round(displayInsideTemp)}°`}
            active={isClimateOn}
            glyph="CL"
            label={`${Math.round(displayInsideTemp)}°`}
            loading={commandMutation.isPending}
            onPress={() => sendCommand(isClimateOn ? 'climate_off' : 'climate_on')}
          />
          <StatusIcon
            accessibilityLabel="Sentry mode"
            active={sentryMode}
            color={sentryMode ? 'amber' : undefined}
            glyph="SH"
          />
        </View>

        {/* Last updated */}
        <AppText style={styles.lastUpdated} tone="muted">
          {formatRelativeTime(data.last_updated ?? '')}
        </AppText>

        {/* PWA meta tags (injected via effect; no-op on bare native) */}
        <WatchPWAMeta />
      </>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={styles.outer}>
      <WatchShell>{watchContent}</WatchShell>
      {/*
        Opt-in Helix narrator. Rendered as a sibling AFTER <WatchShell> so the
        chrome-less wearable layout above is unaffected. AIWatchFaceNLResponse
        returns null when ai_mode='off' or the per-feature toggle is off, keeping
        the wearable invariant ("single screen, no scroll") intact. On AI-on it
        renders below the watch shell for opt-in natural-language Q&A about the
        current watch face (reachable by scroll).
      */}
      <AIWatchFaceNLResponse />
    </ScrollView>
  );
}

// --- Sub-components ---

function WatchShell({children}: {children: React.ReactNode}) {
  const {height} = useWindowDimensions();
  // Web `h-screen`: the shell fills exactly one viewport so the opt-in narrator
  // sibling sits below (reachable only by scroll on AI-on).
  return <View style={[styles.shell, {minHeight: height}]}>{children}</View>;
}

const GAUGE_SIZE = 128;
const GAUGE_STROKE = 8;
const GAUGE_SEGMENT_COUNT = 72;
const GAUGE_BACKGROUND = 'rgba(255, 255, 255, 0.1)';

interface GaugeSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

// Mirror of the shared native RadialGauge segment builder: the web SVG stroke
// arc (r=42, circumference≈264, dash = level*2.64 → fraction level/100) becomes
// positioned View segments rotated around the ring, starting at the top (web
// `-rotate-90`).
function buildGaugeSegments(
  size: number,
  stroke: number,
  count: number,
): GaugeSegment[] {
  const radius = (size - stroke) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const segmentWidth = Math.max(2, (circumference / count) * 0.62);

  return Array.from({length: count}, (_, index) => {
    const angle = -90 + (index / count) * 360;
    const radians = (angle * Math.PI) / 180;
    const left = center + radius * Math.cos(radians) - segmentWidth / 2;
    const top = center + radius * Math.sin(radians) - stroke / 2;

    return {
      angle: `${angle + 90}deg`,
      key: `battery-seg-${index}`,
      left,
      top,
      width: segmentWidth,
    };
  });
}

const GAUGE_SEGMENTS = buildGaugeSegments(
  GAUGE_SIZE,
  GAUGE_STROKE,
  GAUGE_SEGMENT_COUNT,
);

function BatteryGauge({
  level,
  rangeDisplay,
  distanceUnit,
}: {
  level: number;
  rangeDisplay: number;
  distanceUnit: DistanceUnit;
}) {
  const color = getBatteryColor(level);
  const fraction = Math.max(0, Math.min(1, level / 100));
  const activeSegmentCount = Math.round(fraction * GAUGE_SEGMENT_COUNT);

  return (
    <View
      pointerEvents="none"
      style={[styles.gauge, {height: GAUGE_SIZE, width: GAUGE_SIZE}]}>
      {GAUGE_SEGMENTS.map((segment, index) => (
        <View
          key={segment.key}
          style={[
            styles.gaugeSegment,
            {
              backgroundColor:
                index < activeSegmentCount ? color : GAUGE_BACKGROUND,
              left: segment.left,
              top: segment.top,
              transform: [{rotateZ: segment.angle}],
              width: segment.width,
            },
          ]}
        />
      ))}
      <View
        style={[styles.gaugeOverlay, {height: GAUGE_SIZE, width: GAUGE_SIZE}]}>
        <AppText style={styles.gaugeLevel} weight="bold">
          {level}%
        </AppText>
        <AppText style={styles.gaugeRange}>
          {Math.round(rangeDisplay)} {distanceUnit}
        </AppText>
      </View>
    </View>
  );
}

const STATUS_ICON_COLORS = {
  emerald: colors.success,
  red: colors.danger,
  amber: colors.warning,
} as const;

interface StatusIconProps {
  glyph: string;
  active: boolean;
  color?: 'emerald' | 'red' | 'amber';
  label?: string;
  onPress?: () => void;
  loading?: boolean;
  accessibilityLabel?: string;
}

function StatusIcon({
  glyph,
  active,
  color,
  label,
  onPress,
  loading,
  accessibilityLabel,
}: StatusIconProps) {
  // Web: emerald/red/amber when a color is set, otherwise cyan when active and
  // muted when inactive.
  const activeColor = color ? STATUS_ICON_COLORS[color] : colors.accent;
  const tint = active ? activeColor : colors.textMuted;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.statusButton,
        loading === true && styles.statusButtonDisabled,
        pressed && onPress != null && styles.statusButtonPressed,
      ]}>
      <AppText style={[styles.statusGlyph, {color: tint}]} weight="semibold">
        {glyph}
      </AppText>
      {label != null && (
        <AppText style={[styles.statusLabel, {color: tint}]}>{label}</AppText>
      )}
    </Pressable>
  );
}

function WatchStateBadge({state}: {state: string}) {
  const variant = watchStateVariant(state);
  const palette = watchStateBadgeColors(state, variant);

  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: palette.background, borderColor: palette.border},
      ]}>
      <AppText style={[styles.badgeText, {color: palette.text}]} weight="semibold">
        {state}
      </AppText>
    </View>
  );
}

// --- PWA Meta ---

interface DomElementLike {
  rel?: string;
  href?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

interface DomDocumentLike {
  head: {appendChild(element: DomElementLike): void};
  querySelector(selector: string): DomElementLike | null;
  createElement(tagName: string): DomElementLike;
}

function getDocument(): DomDocumentLike | null {
  const candidate = (globalThis as typeof globalThis & {document?: unknown})
    .document;
  if (candidate == null || typeof candidate !== 'object') {
    return null;
  }
  const doc = candidate as Partial<DomDocumentLike>;
  if (
    doc.head == null ||
    typeof doc.querySelector !== 'function' ||
    typeof doc.createElement !== 'function'
  ) {
    return null;
  }
  return doc as DomDocumentLike;
}

function WatchPWAMeta() {
  useEffect(() => {
    const doc = getDocument();
    if (doc == null) {
      // Bare native: no DOM. PWA meta/manifest tags are a browser-only concern.
      return () => {};
    }

    const setMeta = (name: string, content: string) => {
      let tag = doc.querySelector(`meta[name="${name}"]`);
      const existed = Boolean(tag);
      const previous = tag?.getAttribute('content') ?? null;
      if (tag == null) {
        tag = doc.createElement('meta');
        tag.setAttribute('name', name);
        doc.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
      return () => {
        if (tag == null) {
          return;
        }
        if (!existed) {
          tag.remove();
        } else if (previous != null) {
          tag.setAttribute('content', previous);
        }
      };
    };

    const cleanupMeta = [
      setMeta('apple-mobile-web-app-capable', 'yes'),
      setMeta('apple-mobile-web-app-status-bar-style', 'black'),
      setMeta('theme-color', '#000000'),
    ];

    let link = doc.querySelector('link[rel="manifest"]');
    const linkExisted = Boolean(link);
    const previousHref = link?.getAttribute('href') ?? null;
    if (link == null) {
      link = doc.createElement('link');
      link.rel = 'manifest';
      doc.head.appendChild(link);
    }
    link.href = '/watch-manifest.json';

    return () => {
      cleanupMeta.forEach(cleanup => cleanup());
      if (link == null) {
        return;
      }
      if (!linkExisted) {
        link.remove();
      } else if (previousHref != null) {
        link.href = previousHref;
      }
    };
  }, []);

  return null;
}

// --- Utilities ---

// react-router useSearchParams replacement: feature-detect the URL query string
// (present on react-native-web) and parse vehicle_id; null on bare native.
function readVehicleIdParam(): string | null {
  const loc = (globalThis as typeof globalThis & {location?: {search?: string}})
    .location;
  const search = typeof loc?.search === 'string' ? loc.search : '';
  if (!search) {
    return null;
  }
  const query = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of query.split('&')) {
    const [rawName, rawValue = ''] = pair.split('=');
    if (decodeURIComponent(rawName.replace(/\+/g, ' ')) === 'vehicle_id') {
      return decodeURIComponent(rawValue.replace(/\+/g, ' '));
    }
  }
  return null;
}

function getBatteryColor(level: number): string {
  if (level > 40) {
    return '#22c55e'; // green
  }
  if (level > 20) {
    return '#f59e0b'; // amber
  }
  return '#ef4444'; // red
}

function watchStateVariant(state: string): 'info' | 'success' | 'neutral' {
  if (state === 'driving') {
    return 'info';
  }
  if (state === 'charging') {
    return 'success';
  }
  return 'neutral';
}

interface BadgePalette {
  background: string;
  border: string;
  text: string;
}

// Native analogue of the web watchStateClassName bg/text map (the Badge variant
// provides the neutral fallback for unknown states).
function watchStateBadgeColors(
  state: string,
  variant: 'info' | 'success' | 'neutral',
): BadgePalette {
  switch (state) {
    case 'driving':
      return {
        background: 'rgba(59, 130, 246, 0.2)',
        border: 'rgba(59, 130, 246, 0.2)',
        text: '#60a5fa',
      };
    case 'charging':
      return {
        background: 'rgba(52, 211, 153, 0.2)',
        border: 'rgba(52, 211, 153, 0.2)',
        text: colors.success,
      };
    case 'asleep':
      return {
        background: colors.surfaceRaised,
        border: colors.border,
        text: colors.textMuted,
      };
    case 'online':
      return {
        background: colors.surfaceRaised,
        border: colors.border,
        text: colors.textSecondary,
      };
    default:
      return variant === 'success'
        ? {
            background: colors.successSurface,
            border: colors.successBorder,
            text: colors.success,
          }
        : variant === 'info'
          ? {
              background: colors.accentSoft,
              border: colors.borderAccent,
              text: colors.accent,
            }
          : {
              background: colors.surfaceRaised,
              border: colors.border,
              text: colors.textSecondary,
            };
  }
}

function formatRelativeTime(isoTimestamp: string): string {
  if (!isoTimestamp) {
    return '';
  }
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) {
    return 'just now';
  }
  if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m ago`;
  }
  if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)}h ago`;
  }
  return `${Math.floor(diffSec / 86400)}d ago`;
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: '#000000',
    flex: 1,
  },
  shell: {
    backgroundColor: '#000000',
    padding: spacing.md,
  },
  fill: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
  },
  vehicleName: {
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
  },
  batterySection: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  chargingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chargingText: {
    color: colors.success,
  },
  badge: {
    alignSelf: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    paddingBottom: spacing.sm,
  },
  statusButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  statusButtonDisabled: {
    opacity: 0.5,
  },
  statusButtonPressed: {
    transform: [{scale: 0.95}],
  },
  statusGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  statusLabel: {
    fontSize: 8,
    lineHeight: 10,
    marginTop: 1,
  },
  lastUpdated: {
    fontSize: 8,
    lineHeight: 12,
    textAlign: 'center',
  },
  gauge: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  gaugeSegment: {
    borderRadius: GAUGE_STROKE / 2,
    height: GAUGE_STROKE,
    position: 'absolute',
  },
  gaugeOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  gaugeLevel: {
    color: colors.textPrimary,
    fontSize: 30,
    lineHeight: 36,
  },
  gaugeRange: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
  },
});
