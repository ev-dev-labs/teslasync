import 'maplibre-gl/dist/maplibre-gl.css';

// ── Shared map building blocks (MapLibre GL) ────────────────────────────────
export { MapLayerSwitcher } from './MapLayerSwitcher';
export { AnimatedMarker } from './AnimatedMarker';
export { vehicleIcon } from './vehicleIcon';
export {
  MarkerCluster,
  type ClusterPoint,
  type MarkerClusterProps,
} from './MarkerCluster';
export {
  GeofenceDrawer,
  describeFence,
  type DrawableGeofence,
  type NewGeofence,
  type GeofenceDrawerProps,
  type GeofenceMode,
} from './GeofenceDrawer';
export {
  RoutePlayback,
  type PlaybackPoint,
  type RoutePlaybackProps,
} from './RoutePlayback';

// ── MapLibre GL map core + Leaflet-compatible primitives ────────────────────
// The whole maps module renders on a single engine (MapLibre GL via
// react-map-gl). MapContainer/Marker/Popup/Polyline/CircleMarker/Circle/
// Rectangle/FeatureGroup/useMap/latLngBounds keep the previous Leaflet-style
// external prop API so the 268+ call-sites across 20 feature domains compose
// them unchanged.
export { MapInvalidator } from './MapInvalidator';
export {
  MapContainer,
  MapTileLayer,
  MapFullscreenControl,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  Circle,
  Rectangle,
  FeatureGroup,
  useMap,
  latLngBounds,
  LatLngBoundsCompat,
  type MapStyle,
  type LatLngExpression,
  type LatLngLike,
  type MapContainerProps,
  type MapTileLayerProps,
  type MapFullscreenControlProps,
  type MarkerProps,
  type PopupProps,
  type PolylineProps,
  type CircleMarkerProps,
  type CircleProps,
  type RectangleProps,
  type FeatureGroupProps,
  type PathOptions,
  type LeafletMapCompat,
} from './MapTileLayer';

// ── Low-level MapLibre GL primitives (via react-map-gl/maplibre) ────────────
// Direct GeoJSON <Source>/<Layer> access + map controls for advanced overlays.
export {
  Source,
  Layer,
  NavigationControl,
  ScaleControl,
  AttributionControl,
  useControl,
  MapProvider,
} from 'react-map-gl/maplibre';
export type { MapRef, SourceProps, LayerProps } from 'react-map-gl/maplibre';
