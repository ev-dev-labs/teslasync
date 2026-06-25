// Native parity port of web/src/components/maps/AnimatedMarker.tsx.
//
// The web component renders a react-leaflet <Marker> whose icon is an
// L.divIcon — a pulsing CSS circle with a heading-rotated inner dot — and uses
// useMap() to imperatively setLatLng / setIcon and panTo the marker whenever it
// drifts outside the visible bounds.
//
// React Native has NO Leaflet / react-leaflet and NO map host in the parity
// tree, so the lat/lng->screen projection and the useMap()-driven auto-pan are
// browser/map-host-only and unavailable here (conversion contract rule 7). The
// portable part — the animated car marker glyph (pulsing ring + glowing,
// heading-rotated inner dot) — is reproduced with RN View/Animated primitives.
// The map-integration behavior is surfaced as an explicit host bridge:
// `onRecenterRequest(position)` mirrors the web `map.panTo(target)` keep-in-view
// call and is invoked whenever `position` changes; with no host wired it is a
// no-op — the explicit native unavailable state. See the .parity.json sidecar
// for the line-by-line source map.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const DEFAULT_COLOR = '#00b4d8';
const BORDER_COLOR = '#ffffff';
const MARKER_SIZE = 24;
const INNER_SIZE = MARKER_SIZE - 8; // web inner dot is inset:4px on all sides.
const PULSE_DURATION_MS = 1500;

export interface AnimatedMarkerProps {
  /** Marker location as [lat, lng], matching the web `position` prop. */
  position: [number, number];
  /** Optional heading in degrees; rotates the inner dot like the web icon. */
  heading?: number;
  /** Marker color (default `#00b4d8`, identical to the web default). */
  color?: string;
  /**
   * Native bridge for the web `map.panTo(target)` keep-in-view behavior:
   * invoked with the latest [lat, lng] whenever `position` changes so a native
   * map host can recenter on the marker. Optional — without a host this is the
   * explicit native unavailable state (no map projection / auto-pan).
   */
  onRecenterRequest?: (position: [number, number]) => void;
  /** Native style escape hatch applied to the marker wrapper. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/** Custom car icon rendered as a pulsing circle with optional heading rotation. */
function CarIcon({
  color,
  heading,
  reduceMotion,
}: {
  color: string;
  heading?: number;
  reduceMotion: boolean;
}): React.ReactElement {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.timing(pulse, {
        duration: PULSE_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
        toValue: 1,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  const ringStyle = reduceMotion
    ? {opacity: 0.3}
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.3, 0],
        }),
        transform: [
          {
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.7],
            }),
          },
        ],
      };

  return (
    <View pointerEvents="none" style={styles.icon}>
      <Animated.View
        style={[styles.pulseRing, {backgroundColor: color}, ringStyle]}
      />
      <View
        style={[
          styles.innerDot,
          {
            backgroundColor: color,
            shadowColor: color,
            transform:
              heading != null ? [{rotateZ: `${heading}deg`}] : undefined,
          },
        ]}
      />
    </View>
  );
}

CarIcon.displayName = 'CarIcon';

/**
 * Animated map marker that visualizes a vehicle position. On the web this is a
 * Leaflet marker that Leaflet positions and the page pans into view; in the
 * native parity tree it renders the same pulsing, heading-rotated car glyph and
 * delegates the keep-in-view pan to the optional `onRecenterRequest` bridge.
 */
export function AnimatedMarker({
  position,
  heading,
  color = DEFAULT_COLOR,
  onRecenterRequest,
  style,
  testID,
}: AnimatedMarkerProps): React.ReactElement {
  const reduceMotion = useReduceMotion();

  // Mirror the web effect: when the marker moves (or its heading/color change)
  // Leaflet calls marker.setLatLng + setIcon and, when out of bounds,
  // map.panTo(target). Native has no map host, so the keep-in-view pan is
  // delegated to the optional onRecenterRequest bridge; the glyph itself updates
  // declaratively from props.
  useEffect(() => {
    onRecenterRequest?.(position);
  }, [position, heading, color, onRecenterRequest]);

  const [lat, lng] = position;

  return (
    <View
      accessibilityLabel={`Vehicle marker at ${lat}, ${lng}`}
      accessibilityRole="image"
      accessible
      style={[styles.root, style]}
      testID={testID}>
      <CarIcon color={color} heading={heading} reduceMotion={reduceMotion} />
    </View>
  );
}

AnimatedMarker.displayName = 'AnimatedMarker';

const styles = StyleSheet.create({
  icon: {
    alignItems: 'center',
    height: MARKER_SIZE,
    justifyContent: 'center',
    position: 'relative',
    width: MARKER_SIZE,
  },
  innerDot: {
    borderColor: BORDER_COLOR,
    borderRadius: INNER_SIZE / 2,
    borderWidth: 2,
    elevation: 6,
    height: INNER_SIZE,
    position: 'absolute',
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.9,
    shadowRadius: 8,
    width: INNER_SIZE,
  },
  pulseRing: {
    borderRadius: MARKER_SIZE / 2,
    height: MARKER_SIZE,
    position: 'absolute',
    width: MARKER_SIZE,
  },
  root: {
    alignItems: 'center',
    height: MARKER_SIZE,
    justifyContent: 'center',
    width: MARKER_SIZE,
  },
});
