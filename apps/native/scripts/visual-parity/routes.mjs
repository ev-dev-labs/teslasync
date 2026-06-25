export const schemaVersion = 1;

export const viewport = {
  width: 1440,
  height: 1100,
  deviceScaleFactor: 1,
};

export const visualThreshold = 0.985;

export const representativeRoutes = [
  {
    id: 'root-layout',
    group: 'command',
    label: 'Dashboard shell',
    route: '/',
    nativeTarget: 'dashboard',
    evidence:
      'V0003 dashboard widgets use native premium cards, metric grids, loading/error/empty states, and dashboard route readiness.',
  },
  {
    id: 'explore',
    group: 'command',
    label: 'Explore',
    route: '/explore',
    nativeTarget: 'dashboard',
  },
  {
    id: 'vehicles',
    group: 'fleet',
    label: 'Vehicles',
    route: '/vehicles',
    nativeTarget: 'vehicles',
    evidence:
      'V0003 vehicle visuals cover garage overview cards, selectable vehicle rows, detail metrics, live-state panels, and empty/error states.',
  },
  {
    id: 'drives',
    group: 'fleet',
    label: 'Drives',
    route: '/drives',
    nativeTarget: 'driving',
    evidence:
      'V0003 driving visuals cover drive list rows, overview metrics, drive detail cards, trip summaries, route replay summaries, and empty/error states.',
  },
  {
    id: 'trips',
    group: 'fleet',
    label: 'Trips',
    route: '/trips',
    nativeTarget: 'driving',
    evidence:
      'V0003 trip-list parity is represented by the native driving/trips surface with shared premium list rows and trip summary cards.',
  },
  {
    id: 'drive-detail',
    group: 'fleet',
    label: 'Drive detail',
    route: '/drives/1',
    nativeTarget: 'driving',
    evidence:
      'V0003 drive-detail parity maps to the selected native drive detail, telemetry, and route replay summary cards.',
  },
  {
    id: 'trip-detail',
    group: 'fleet',
    label: 'Trip detail',
    route: '/trips/1',
    nativeTarget: 'driving',
    evidence:
      'V0003 trip-detail parity maps to the selected native drive-backed trip detail and summary cards without WebView embedding.',
  },
  {
    id: 'charging',
    group: 'operations',
    label: 'Charging',
    route: '/charging',
    nativeTarget: 'charging',
    evidence:
      'V0003 charging visuals cover overview metrics, selectable charging rows, charging detail panels, curve summaries, heatmap/cost panels, and empty/error states.',
  },
  {
    id: 'charging-detail',
    group: 'operations',
    label: 'Charging detail',
    route: '/charging/1',
    nativeTarget: 'charging',
    evidence:
      'V0003 charging-detail parity maps to the selected native session detail, telemetry curve, power metrics, and unavailable-action states.',
  },
  {
    id: 'energy',
    group: 'operations',
    label: 'Energy',
    route: '/energy',
    nativeTarget: 'energy',
  },
  {
    id: 'notifications-inbox',
    group: 'operations',
    label: 'Notifications inbox',
    route: '/notifications/inbox',
    nativeTarget: 'alerts',
  },
  {
    id: 'system-status',
    group: 'platform',
    label: 'System status',
    route: '/system-status',
    nativeTarget: 'system',
  },
  {
    id: 'account-2fa',
    group: 'platform',
    label: 'Two-factor auth',
    route: '/account/2fa',
    nativeTarget: 'auth',
  },
  {
    id: 'settings',
    group: 'platform',
    label: 'Settings',
    route: '/settings',
    nativeTarget: 'settings',
  },
];
