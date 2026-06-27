// Native parity port of web/src/features/dashboard/widgets/shared/WidgetMapView.tsx.
//
// WidgetMapView is the dashboard widgets' shared map wrapper: when isEmpty it
// renders an EmptyState, otherwise it frames a dark Leaflet map (MapContainer +
// MapTileLayer style="dark") at a given center/zoom and paints the caller's
// overlay children (markers/polylines) on top. `compact` collapses leaflet's
// interactivity (scroll-wheel zoom, the zoom control, dragging).
//
// Web -> native mapping (contract rules 3, 4, 5 & 7); every browser-only
// dependency is replaced with a React Native-safe equivalent and documented in
// the sidecar:
//   - `@/components/maps` MapContainer + MapTileLayer (web L2, L31-40): leaflet
//     renders tiles to the DOM and has no native analogue, so the interactive
//     tile map is reimplemented as a static native "map surface" View — the same
//     dark-canvas + faint map-grid treatment the sibling TripPlannerMap port uses.
//     The web MapContainer style={{ background: '#1a1a2e' }} backdrop is
//     preserved verbatim; MapTileLayer style="dark" becomes the faint GRID_LINES
//     overlay; `center`/`zoom` are surfaced in the canvas accessibilityLabel
//     (TripPlannerMap precedent) since leaflet's viewport framing is unreachable;
//     `compact`'s scrollWheelZoom/zoomControl/dragging toggles are DOM-only
//     interactivity that has no static analogue and is intentionally dropped
//     (documented), with `compact` itself surfaced in the a11y label.
//   - `@/components/feedback` EmptyState (web L3, L26) -> native EmptyState
//     (../../../../../components/feedback/EmptyState). The web message is
//     preserved verbatim; native EmptyState additionally requires a title, so a
//     concise native-additive title is supplied (TripPlannerMap precedent). The
//     web className="py-4" maps to native EmptyState's built-in vertical padding.
//   - `@/lib/cn` (web L4) only merged the DOM className onto the wrapper; a
//     React Native View has no className, so cn is unnecessary here and dropped.
//   - The `className` prop is DOM-only; it is kept in the prop contract for shape
//     parity but is inert in native (mirrors the sibling shared/index.ts barrel).
//
// No DOM-only modules, HTML elements, react-leaflet/Leaflet, Recharts, or web UI
// components are imported — only react, react-native primitives, the shared
// native EmptyState, and the native theme tokens.

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {colors, spacing} from '../../../../../theme/tokens';

// web default zoom (L18)
const DEFAULT_ZOOM = 13;
// web default empty copy (L22) — preserved verbatim.
const DEFAULT_EMPTY_MESSAGE = 'No location data available';
// Concise native-additive title for native EmptyState (which requires a title);
// the web message is still shown verbatim beneath it.
const EMPTY_TITLE = 'No map data';
// web MapContainer style={{ background: '#1a1a2e' }} (L38) — dark map surface.
const MAP_BACKGROUND = '#1a1a2e';
// Faint dark-tile grid (percent positions) evoking MapTileLayer style="dark".
const GRID_LINES = [25, 50, 75];

interface WidgetMapViewProps {
  center: [number, number];
  zoom?: number;
  compact?: boolean;
  children?: ReactNode;
  // Web passes a DOM className merged via cn(); inert in native, kept only for
  // prop-shape parity (mirrors the shared/index.ts barrel contract).
  className?: string;
  emptyMessage?: string;
  isEmpty?: boolean;
}

export function WidgetMapView({
  center,
  zoom = DEFAULT_ZOOM,
  compact = false,
  children,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
  isEmpty = false,
}: WidgetMapViewProps) {
  if (isEmpty) {
    // no-action: transient empty state — surfaces when source data is missing;
    // no specific recovery action available.
    return <EmptyState title={EMPTY_TITLE} message={emptyMessage} />;
  }

  const [lat, lng] = center ?? [0, 0];

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${
        compact ? 'Compact map' : 'Map'
      } preview centered near ${lat.toFixed(2)}, ${lng.toFixed(
        2,
      )} at zoom ${zoom}`}
      style={styles.container}>
      {/* MapTileLayer style="dark" evocation — faint grid over the dark backdrop. */}
      <View pointerEvents="none" style={styles.tileGrid}>
        {GRID_LINES.map(line => (
          <React.Fragment key={line}>
            <View
              style={[
                styles.gridLineVertical,
                {left: `${line}%` as DimensionValue},
              ]}
            />
            <View
              style={[
                styles.gridLineHorizontal,
                {top: `${line}%` as DimensionValue},
              ]}
            />
          </React.Fragment>
        ))}
      </View>

      {/* Caller overlay children — the native analogue of leaflet's overlay panes. */}
      {children ? (
        <View pointerEvents="box-none" style={styles.overlay}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // web h-full w-full -> fill the parent; minHeight is a native-additive
    // safeguard so the dark map surface stays visible when the parent leaves
    // height unconstrained (web h-full has no intrinsic height).
    flex: 1,
    width: '100%',
    minHeight: 160,
    borderRadius: 8, // web rounded-lg
    overflow: 'hidden', // web overflow-hidden
    backgroundColor: MAP_BACKGROUND, // web style={{ background: '#1a1a2e' }}
  },
  tileGrid: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  gridLineHorizontal: {
    position: 'absolute',
    right: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    padding: spacing.sm,
  },
});
