export type RouteId =
  | 'dashboard'
  | 'vehicles'
  | 'charging'
  | 'driving'
  | 'energy'
  | 'alerts'
  | 'system'
  | 'auth'
  | 'settings';

export type RouteGroup = 'command' | 'fleet' | 'operations' | 'platform';

export interface RouteDefinition {
  id: RouteId;
  group: RouteGroup;
  label: string;
  shortDescription: string;
  description: string;
  icon: string;
  webPaths: string[];
}

export const routes: RouteDefinition[] = [
  {
    id: 'dashboard',
    group: 'command',
    label: 'Dashboard',
    shortDescription: 'Fleet command',
    description: 'Live fleet health, alerts, and premium operational overview.',
    icon: 'D',
    webPaths: ['/', '/quick-stats', '/glance'],
  },
  {
    id: 'vehicles',
    group: 'fleet',
    label: 'Vehicles',
    shortDescription: 'Garage state',
    description: 'Native vehicle cards, health state, and route-ready telemetry shells.',
    icon: 'V',
    webPaths: ['/vehicles', '/vehicles/:id', '/vehicles/:id/access', '/digital-twin'],
  },
  {
    id: 'charging',
    group: 'fleet',
    label: 'Charging',
    shortDescription: 'Sessions',
    description: 'Charging sessions, energy added, cost-ready states, and live session shells.',
    icon: 'C',
    webPaths: ['/charging', '/charging/:id', '/charging/curve', '/charging/heatmap'],
  },
  {
    id: 'driving',
    group: 'fleet',
    label: 'Driving',
    shortDescription: 'Trips',
    description: 'Recent drives, distance, energy, speed, scoring, and replay-ready metadata.',
    icon: 'R',
    webPaths: ['/drives', '/drives/:id', '/drives/:id/replay', '/trips'],
  },
  {
    id: 'energy',
    group: 'operations',
    label: 'Energy',
    shortDescription: 'Battery',
    description: 'Battery health, energy usage, sleep efficiency, and range intelligence.',
    icon: 'E',
    webPaths: ['/energy', '/battery', '/battery/health', '/battery/degradation'],
  },
  {
    id: 'alerts',
    group: 'operations',
    label: 'Alerts',
    shortDescription: 'Inbox',
    description: 'Notification inbox, alert severity, unread state, and escalation surfaces.',
    icon: 'A',
    webPaths: ['/notifications/inbox', '/notifications/alerts', '/notifications/rules'],
  },
  {
    id: 'system',
    group: 'platform',
    label: 'System',
    shortDescription: 'Ops',
    description: 'Backend status, service health, version, and operational readiness.',
    icon: 'O',
    webPaths: ['/system', '/system/status', '/commands', '/command-history'],
  },
  {
    id: 'auth',
    group: 'platform',
    label: 'Auth',
    shortDescription: 'Identity',
    description: 'Forward-auth/open-mode state, subject, capabilities, and account readiness.',
    icon: 'I',
    webPaths: ['/account/2fa', '/account/sessions', '/account/privacy', '/settings'],
  },
  {
    id: 'settings',
    group: 'platform',
    label: 'Settings',
    shortDescription: 'Platform',
    description: 'API base, platform support, and React Native parity milestones.',
    icon: 'S',
    webPaths: ['/settings', '/settings/safety', '/integrations/helix'],
  },
];

export const routeGroupLabels: Record<RouteGroup, string> = {
  command: 'Command',
  fleet: 'Fleet',
  operations: 'Operations',
  platform: 'Platform',
};
