// Native parity port of web/src/components/data-display/RouteDisplay.tsx.
//
// Replaces the DOM <div>/<span>, the lucide-react MapPin icon, the Tailwind
// utility classes (text-[11px], text-[var(--text-secondary)], flex/gap/
// truncate, opacity-60) and the `cn` helper with React Native primitives,
// native tokens, and a View-drawn map-pin glyph. Preserves the RouteEndpoint /
// RouteDisplayProps contracts, the haversine round-trip detection, the
// endpointLabel formatter, and the four render states (no-location /
// round-trip / single / from->to).

import React, {useCallback, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

export interface RouteEndpoint {
  /** Resolved street address or place name (preferred). */
  address?: string | null;
  /** Latitude in decimal degrees, used as fallback. */
  lat?: number | null;
  /** Longitude in decimal degrees, used as fallback. */
  lon?: number | null;
}

export interface RouteDisplayProps {
  start: RouteEndpoint;
  end?: RouteEndpoint;
  /**
   * Threshold (in metres) below which start≈end is considered a round trip
   * when only coordinates are available. Default 100 m.
   */
  roundTripThresholdM?: number;
  /**
   * Show the leading map-pin icon. Default `true`.
   */
  showIcon?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testId?: string;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/** Haversine distance between two lat/lon pairs, in metres. */
function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * Pretty-print a single endpoint. Prefers a resolved address; falls back
 * to a `📍 lat, lon` coord string; returns `null` when neither is
 * available so the caller can render a single placeholder.
 */
export function endpointLabel(endpoint: RouteEndpoint): string | null {
  const addr = endpoint.address?.trim();
  if (addr) {
    return addr;
  }
  if (endpoint.lat != null && endpoint.lon != null) {
    return `📍 ${endpoint.lat.toFixed(2)}, ${endpoint.lon.toFixed(2)}`;
  }
  return null;
}

/**
 * `RouteDisplay` — generic "From → To" / "↻ round trip" / "📍 single
 * location" / "No location data" line. Used by every history-style
 * row (Drives, Charging, Trips).
 *
 * Round-trip detection rules (in order):
 *   1. Both endpoints resolve to the same address text → round trip
 *   2. Coordinates within `roundTripThresholdM` metres → round trip
 *
 * For charging sessions where there's only a single location (the
 * charger), pass only `start`; the component renders just that line.
 */
export function RouteDisplay({
  start,
  end,
  roundTripThresholdM = 100,
  showIcon = true,
  className: _className,
  style,
  testId,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: RouteDisplayProps) {
  const t = useNativeTranslationFallback();
  const startLabel = endpointLabel(start);
  const endLabel = end ? endpointLabel(end) : null;
  const noLocation = t('route.noLocationData', 'No location data');

  const hasCoords = (
    e: RouteEndpoint | undefined,
  ): e is {lat: number; lon: number} =>
    !!e && e.lat != null && e.lon != null;

  // Treat as round trip if (a) caller passes only `start` AND it has
  // some representation, OR (b) start/end addresses match, OR
  // (c) coordinates are within the threshold and we have at least one
  // endpoint label to show.
  const addressesMatch = !!startLabel && !!endLabel && startLabel === endLabel;
  const coordsClose =
    hasCoords(start) &&
    hasCoords(end) &&
    haversineMeters(start.lat, start.lon, end.lat, end.lon) <
      roundTripThresholdM;
  const isExplicitSingle = !end;
  const isRoundTrip =
    !!startLabel &&
    (isExplicitSingle || addressesMatch || (coordsClose && !!startLabel));

  let body: ReactNode;
  let summary: string;
  if (!startLabel && !endLabel) {
    summary = noLocation;
    body = (
      <AppText
        numberOfLines={1}
        style={[styles.text, styles.dim]}
        tone="secondary">
        {noLocation}
      </AppText>
    );
  } else if (isRoundTrip) {
    const roundTrip = t('route.roundTrip', 'round trip');
    summary = isExplicitSingle
      ? startLabel ?? ''
      : `${startLabel ?? ''} ↻ ${roundTrip}`;
    body = (
      <AppText numberOfLines={1} style={styles.text} tone="secondary">
        {startLabel}
        {!isExplicitSingle ? (
          <AppText style={[styles.text, styles.dim]} tone="secondary">
            {' '}
            ↻ {roundTrip}
          </AppText>
        ) : null}
      </AppText>
    );
  } else {
    summary = `${startLabel ?? noLocation} → ${endLabel ?? noLocation}`;
    body = (
      <AppText numberOfLines={1} style={styles.text} tone="secondary">
        {startLabel ?? noLocation} → {endLabel ?? noLocation}
      </AppText>
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel ?? summary}
      accessibilityRole="text"
      accessible
      style={[styles.root, style]}
      testID={testID ?? testId ?? dataTestID ?? 'route-display'}>
      {showIcon ? <MapPinGlyph color={colors.textSecondary} size={10} /> : null}
      {body}
    </View>
  );
}

RouteDisplay.displayName = 'RouteDisplay';

// View-drawn equivalent of lucide-react's <MapPin> (a teardrop pin outline with
// a centered hole). The web icon is `h-2.5 w-2.5 shrink-0 opacity-60`, so the
// glyph renders at 10dp, never shrinks, and is dimmed to 60% — and is hidden
// from the accessibility tree since the route text already conveys meaning.
function MapPinGlyph({color, size}: {color: string; size: number}) {
  const stroke = Math.max(1, size * 0.16);
  const bodyD = size * 0.66;
  const dotD = Math.max(2, size * 0.22);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.iconBox, {height: size, width: size}]}
      testID="route-display-icon">
      <View
        style={[
          styles.pinBody,
          {
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: bodyD,
            borderColor: color,
            borderTopLeftRadius: bodyD,
            borderTopRightRadius: bodyD,
            borderWidth: stroke,
            height: bodyD,
            width: bodyD,
          },
        ]}>
        <View
          style={[
            styles.pinDot,
            {
              backgroundColor: color,
              borderRadius: dotD / 2,
              height: dotD,
              width: dotD,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    opacity: 0.6,
  },
  iconBox: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    opacity: 0.6,
    position: 'relative',
  },
  pinBody: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    transform: [{rotate: '-45deg'}],
  },
  pinDot: {
    backgroundColor: colors.textSecondary,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  text: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 15,
  },
});
