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
  },
  {
    id: 'drives',
    group: 'fleet',
    label: 'Drives',
    route: '/drives',
    nativeTarget: 'driving',
  },
  {
    id: 'charging',
    group: 'operations',
    label: 'Charging',
    route: '/charging',
    nativeTarget: 'charging',
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
