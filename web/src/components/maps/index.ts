import 'leaflet/dist/leaflet.css';

export { MapLayerSwitcher } from './MapLayerSwitcher';
export { MapTileLayer, MapInvalidator, type MapStyle } from './MapTileLayer';
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
export { latLngBounds } from 'leaflet';
export type { LatLngExpression } from 'leaflet';
// Re-export react-leaflet components through shared maps module
export {
  MapContainer,
  Polyline,
  Marker,
  Popup,
  CircleMarker,
  Circle,
  Rectangle,
  FeatureGroup,
  useMap,
} from 'react-leaflet';
