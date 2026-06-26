// Native parity port of web/src/types/location.ts.
//
// Pure TypeScript wire-type declarations for the saved-location & geofence
// domain — no DOM, React, Recharts, Leaflet, browser APIs, or runtime imports —
// so every exported interface is ported 1:1 with identical names, members,
// optionality, and field names (contract rules 3 & 6). These domain DTOs use
// camelCase member names exactly as the web source declares them (the camelCase
// form is preserved verbatim rather than re-cased). totalDurationS is the
// SI-canonical seconds field; any display-unit conversion happens only at the
// render boundary, never in these wire types.

export interface Location {
  id: string;
  addressName: string;
  latitude: number;
  longitude: number;
  visitCount: number;
  totalDurationS: number;
  lastVisited: string | null;
}

export interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  alertOnEntry: boolean;
  alertOnExit: boolean;
  enabled: boolean;
  costPerKwh: number | null;
  createdAt: string;
}
