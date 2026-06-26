// Native parity port of web/src/features/explore/featureCatalog.ts.
//
// The web module is the Feature Hub data layer: a DESCRIPTIONS map keyed by
// route plus three pure functions (buildFeatureCatalog, groupFeatureCatalog,
// filterFeatureCatalog) and a __DESCRIPTIONS_FOR_TEST export. It is non-visual
// logic/data — no JSX, no DOM, no state, no API path, no unit handling — so the
// DESCRIPTIONS map, all three functions, and the test-helper export are ported
// verbatim (every description string and every branch preserved byte-for-byte).
//
// Two browser-only import boundaries are made native-safe:
//
//   - web L23-24 `import type {ComponentType} from 'react'` +
//     `import type {LucideIcon} from 'lucide-react'` are dropped. lucide-react
//     is browser-only and must never enter native output, and the catalog's
//     `icon` field carried a live Lucide / custom React icon component. The
//     field becomes `iconName: string` (the icon's identity, e.g.
//     'layoutDashboard', 'HelixMark'), exactly matching the established
//     dashboard idiom (registry/battery.ts: `icon: LucideIcon` -> `iconName:
//     string`). Which icon each feature uses is preserved; mapping name->glyph
//     is a consumer concern.
//
//   - web L25 `import {navSections} from '@/components/layout/Layout'` is the
//     single source of truth for "every page". Layout.tsx is not ported to
//     native (it pulls in react-router, framer-motion, react-dom portals,
//     lucide-react, etc.), so its navSections data is mirrored inline here
//     native-safe as NAV_SECTIONS — every section title plus every item's
//     to / iconName / label / color and optional minVehicles / requiresAuth /
//     dataTour, transcribed verbatim from Layout.tsx. buildFeatureCatalog and
//     groupFeatureCatalog iterate NAV_SECTIONS, so the catalog's order and
//     contents are identical to the web build. This mirrors the battery.ts
//     idiom of inlining a browser-only dependency's data slice instead of
//     importing it.
//
// The exported surface mirrors the web file exactly: FeatureCatalogEntry,
// buildFeatureCatalog, groupFeatureCatalog, filterFeatureCatalog,
// __DESCRIPTIONS_FOR_TEST. No DOM, react-router, framer-motion, lucide-react,
// Recharts, Leaflet, or old web UI components are imported.

/* ─── Native-safe mirror of navSections (web @/components/layout/Layout) ───── */

/** Shape of a single sidebar item — `icon: LucideIcon` -> `iconName: string`. */
interface NavItem {
  to: string;
  iconName: string;
  label: string;
  color: string;
  minVehicles?: number;
  requiresAuth?: boolean;
  dataTour?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Home',
    items: [
      {to: '/', iconName: 'layoutDashboard', label: 'Dashboard', color: 'text-blue-400'},
      {to: '/explore', iconName: 'sparkles', label: 'Explore Features', color: 'text-amber-400'},
      {to: '/live', iconName: 'radar', label: 'Live Map', color: 'text-emerald-400'},
      {to: '/timeline', iconName: 'clock', label: 'Timeline', color: 'text-sky-400'},
      {to: '/weekly-digest', iconName: 'calendarCheck', label: 'Weekly Digest', color: 'text-purple-400'},
    ],
  },
  {
    title: 'Vehicles',
    items: [
      {to: '/vehicles', iconName: 'vehicle', label: 'My Vehicles', color: 'text-sky-400', dataTour: 'vehicle-section'},
      {to: '/digital-twin', iconName: 'monitor', label: 'Vehicle Live View', color: 'text-cyan-400'},
      {to: '/vehicle-comparison', iconName: 'arrowLeftRight', label: 'Compare Vehicles', color: 'text-orange-400', minVehicles: 2},
      {to: '/locations', iconName: 'location', label: 'Saved Locations', color: 'text-emerald-400'},
    ],
  },
  {
    title: 'Driving',
    items: [
      {to: '/drives', iconName: 'drive', label: 'Drives', color: 'text-violet-400'},
      {to: '/trips', iconName: 'trip', label: 'Trips', color: 'text-teal-400'},
      {to: '/trip-planner', iconName: 'mapPinned', label: 'Trip Planner', color: 'text-emerald-400'},
      {to: '/navigation', iconName: 'signpost', label: 'Navigation', color: 'text-teal-400'},
      {to: '/geofences', iconName: 'fence', label: 'Geofences', color: 'text-lime-400'},
      {to: '/mileage', iconName: 'trip', label: 'Mileage Log', color: 'text-teal-400'},
      {to: '/lifetime-stats', iconName: 'award', label: 'Lifetime Stats', color: 'text-yellow-400'},
      {to: '/drive-score', iconName: 'trophy', label: 'Drive Score', color: 'text-yellow-400'},
      {to: '/speed-profile', iconName: 'speed', label: 'Speed Profile', color: 'text-rose-400'},
      {to: '/driving-dynamics', iconName: 'efficiency', label: 'Driving Dynamics', color: 'text-red-400'},
      {to: '/regen-efficiency', iconName: 'recycle', label: 'Regen Braking', color: 'text-green-400'},
      {to: '/route-efficiency', iconName: 'navigationAlt', label: 'Route Efficiency', color: 'text-emerald-400'},
    ],
  },
  {
    title: 'Charging',
    items: [
      {to: '/charging', iconName: 'batteryCharging', label: 'Charging Overview', color: 'text-green-400'},
      {to: '/tesla-charging-history', iconName: 'receipt', label: 'Charge History', color: 'text-emerald-400'},
      {to: '/charging-curve', iconName: 'trendUp', label: 'Charging Curve', color: 'text-lime-400'},
      {to: '/charging-heatmap', iconName: 'calendarClock', label: 'Charging Patterns', color: 'text-cyan-400'},
      {to: '/smart-charge', iconName: 'calendarClock', label: 'Smart Charging', color: 'text-cyan-400'},
      {to: '/powershare', iconName: 'charging', label: 'Powershare', color: 'text-amber-400'},
    ],
  },
  {
    title: 'Battery',
    items: [
      {to: '/battery', iconName: 'heartPulse', label: 'Battery Health', color: 'text-rose-400'},
      {to: '/battery-cells', iconName: 'battery', label: 'Battery Cells', color: 'text-purple-400'},
      {to: '/battery-degradation', iconName: 'trendDown', label: 'Battery Degradation', color: 'text-orange-400'},
      {to: '/projected-range', iconName: 'target', label: 'Projected Range', color: 'text-pink-400'},
      {to: '/vampire-drain', iconName: 'moon', label: 'Vampire Drain', color: 'text-indigo-400'},
      {to: '/sleep-efficiency', iconName: 'bedDouble', label: 'Sleep Efficiency', color: 'text-purple-400'},
    ],
  },
  {
    title: 'Energy',
    items: [
      {to: '/energy', iconName: 'bolt', label: 'Energy Usage', color: 'text-yellow-400'},
      {to: '/energy-flow', iconName: 'arrowRightLeft', label: 'Energy Flow', color: 'text-yellow-400'},
      {to: '/power-flow', iconName: 'charging', label: 'Power Flow', color: 'text-orange-400'},
      {to: '/energy-products', iconName: 'home', label: 'Solar & Powerwall', color: 'text-lime-400'},
    ],
  },
  {
    title: 'Service',
    items: [
      {to: '/tire-pressure', iconName: 'tirePressure', label: 'Tire Pressure', color: 'text-orange-400'},
      {to: '/drivetrain-health', iconName: 'cpu', label: 'Drivetrain Health', color: 'text-red-400'},
      {to: '/software-updates', iconName: 'download', label: 'Software Updates', color: 'text-teal-400'},
      {to: '/maintenance', iconName: 'maintenance', label: 'Maintenance', color: 'text-amber-400'},
    ],
  },
  {
    title: 'Cabin',
    items: [
      {to: '/climate-control', iconName: 'climate', label: 'Climate Control', color: 'text-sky-400'},
      {to: '/media-player', iconName: 'headphones', label: 'Media Player', color: 'text-pink-400'},
    ],
  },
  {
    title: 'Reports',
    items: [
      {to: '/statistics', iconName: 'pieChart', label: 'Statistics', color: 'text-cyan-400'},
      {to: '/analytics', iconName: 'analytics', label: 'Analytics', color: 'text-indigo-400'},
      {to: '/period-compare', iconName: 'calendar', label: 'Period Comparison', color: 'text-orange-400'},
      {to: '/efficiency', iconName: 'leaf', label: 'Efficiency', color: 'text-amber-400'},
      {to: '/temperature-impact', iconName: 'climateHot', label: 'Temperature Impact', color: 'text-blue-400'},
      {to: '/cost-analysis', iconName: 'dollarSign', label: 'Cost Analysis', color: 'text-emerald-400'},
      {to: '/tco', iconName: 'wallet', label: 'Cost of Ownership', color: 'text-green-400'},
    ],
  },
  {
    title: 'Commands',
    items: [
      {to: '/commands', iconName: 'gamepad', label: 'Send Commands', color: 'text-fuchsia-400', dataTour: 'commands-section'},
      {to: '/command-history', iconName: 'history', label: 'Command History', color: 'text-violet-400'},
    ],
  },
  {
    title: 'Automation',
    items: [
      {to: '/automations', iconName: 'workflow', label: 'Automations', color: 'text-purple-400'},
      {to: '/notifications/studio', iconName: 'notificationsAdd', label: 'Alert Studio', color: 'text-fuchsia-400'},
      {to: '/notifications/rules', iconName: 'filter', label: 'Alert Rules', color: 'text-amber-400'},
    ],
  },
  {
    title: 'Notifications',
    items: [
      {to: '/notifications/inbox', iconName: 'notifications', label: 'Notification Inbox', color: 'text-purple-400'},
      {to: '/notifications/alerts', iconName: 'notificationsActive', label: 'Alert Center', color: 'text-red-400'},
      {to: '/notifications/channels', iconName: 'send', label: 'Notification Channels', color: 'text-cyan-400'},
      {to: '/notifications/webhooks', iconName: 'cloud', label: 'Webhooks', color: 'text-sky-400'},
      {to: '/notifications/browser', iconName: 'notificationsActive', label: 'Browser Notifications', color: 'text-fuchsia-400'},
      {to: '/notifications/quiet-hours', iconName: 'clock', label: 'Quiet Hours', color: 'text-indigo-400'},
    ],
  },
  {
    title: 'Security',
    items: [
      {to: '/security-access', iconName: 'locked', label: 'Security & Access', color: 'text-emerald-400'},
      {to: '/safety-settings', iconName: 'securityCheck', label: 'Safety Settings', color: 'text-amber-400'},
      {to: '/guard-mode', iconName: 'securityAlert', label: 'Guard Mode', color: 'text-red-400'},
    ],
  },
  {
    title: 'Account',
    items: [
      {to: '/tesla-account', iconName: 'user', label: 'Tesla Account', color: 'text-blue-400'},
      {to: '/tesla-orders', iconName: 'shoppingCart', label: 'Active Orders', color: 'text-teal-400'},
      {to: '/fleet-api', iconName: 'cloud', label: 'Fleet API', color: 'text-sky-400'},
      {to: '/tesla-region', iconName: 'globe', label: 'Region & API', color: 'text-emerald-400'},
      {to: '/tesla-features', iconName: 'flag', label: 'Feature Flags', color: 'text-purple-400'},
      {to: '/account/2fa', iconName: 'securityCheck', label: 'Two-Factor Auth', color: 'text-yellow-400', requiresAuth: true},
      {to: '/account/sessions', iconName: 'monitor', label: 'Active Sessions', color: 'text-cyan-400', requiresAuth: true},
      {to: '/account/privacy', iconName: 'security', label: 'Privacy', color: 'text-emerald-400'},
      {to: '/me/activity', iconName: 'history', label: 'My Activity', color: 'text-cyan-400', requiresAuth: true},
    ],
  },
  {
    title: 'Settings',
    items: [
      {to: '/settings', iconName: 'settings', label: 'General Settings', color: 'text-[var(--text-muted)]'},
      {to: '/chatbot', iconName: 'HelixMark', label: 'Helix Chat', color: 'text-purple-400'},
      {to: '/dev-tools', iconName: 'hammer', label: 'Developer Tools', color: 'text-cyan-400'},
    ],
  },
  {
    title: 'Integrations',
    items: [
      {to: '/integrations/helix', iconName: 'HelixMark', label: 'Helix', color: 'text-purple-400'},
      {to: '/api-keys', iconName: 'key', label: 'API Keys', color: 'text-amber-400'},
      {to: '/gas-price', iconName: 'fuel', label: 'Gas Prices', color: 'text-orange-400'},
    ],
  },
  {
    title: 'Data',
    items: [
      {to: '/data-export', iconName: 'hardDriveDownload', label: 'Data Export', color: 'text-lime-400'},
      {to: '/backup', iconName: 'databaseBackup', label: 'Backup & Restore', color: 'text-teal-400'},
      {to: '/data-repair', iconName: 'stethoscope', label: 'Data Repair', color: 'text-amber-400'},
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      {to: '/system-status', iconName: 'efficiency', label: 'System Status', color: 'text-emerald-400'},
      {to: '/db-health', iconName: 'hardDrive', label: 'Database Health', color: 'text-emerald-400'},
      {to: '/anomaly-detection', iconName: 'scanSearch', label: 'Anomaly Detection', color: 'text-red-400'},
      {to: '/signals', iconName: 'activity', label: 'Live Signals', color: 'text-neon-cyan', dataTour: 'live-signals-section'},
      {to: '/admin/live-signals', iconName: 'radioTower', label: 'Live Signal Inspector', color: 'text-cyan-400'},
      {to: '/admin/ingest-xray', iconName: 'scanSearch', label: 'Ingest X-Ray', color: 'text-sky-400'},
      {to: '/admin/dlq', iconName: 'severityCritical', label: 'DLQ Inspector', color: 'text-red-400'},
      {to: '/admin/flags', iconName: 'flag', label: 'Feature Flags', color: 'text-purple-400'},
      {to: '/admin/schema-drift', iconName: 'fingerprint', label: 'Schema Drift', color: 'text-purple-400'},
      {to: '/admin/slow-queries', iconName: 'timer', label: 'Slow Queries', color: 'text-amber-400'},
      {to: '/admin/vehicle-cost', iconName: 'wallet', label: 'Vehicle Cost', color: 'text-lime-400'},
      {to: '/admin/disk-forecast', iconName: 'hardDrive', label: 'Disk Forecast', color: 'text-teal-400'},
      {to: '/admin/secret-rotation', iconName: 'securityCheck', label: 'Secret Rotation', color: 'text-cyan-400'},
      {to: '/admin/audit-log', iconName: 'history', label: 'Audit Log', color: 'text-indigo-400'},
      {to: '/admin/gdpr-exports', iconName: 'hardDriveDownload', label: 'GDPR Exports', color: 'text-emerald-400'},
      {to: '/state-debugger', iconName: 'bug', label: 'State Debugger', color: 'text-purple-400'},
      {to: '/mqtt-inspector', iconName: 'radio', label: 'MQTT Inspector', color: 'text-blue-400'},
      {to: '/redis-signals', iconName: 'server', label: 'Redis Signals', color: 'text-orange-400'},
      {to: '/admin/telemetry/coverage', iconName: 'cloud', label: 'Telemetry Coverage', color: 'text-sky-400'},
      {to: '/api-logs', iconName: 'fileText', label: 'API Logs', color: 'text-amber-400'},
      {to: '/api-playground', iconName: 'terminal', label: 'API Playground', color: 'text-emerald-400'},
    ],
  },
  {
    title: 'About',
    items: [{to: '/roadmap', iconName: 'signpost', label: 'Roadmap', color: 'text-violet-400'}],
  },
];

/* ─── Feature Hub data layer (web featureCatalog.ts) ───────────────────────── */

export interface FeatureCatalogEntry {
  to: string;
  label: string;
  /** Section title from navSections (e.g. "Home", "Driving"). */
  section: string;
  /** Identity of the icon this entry uses (web `icon` component -> name). */
  iconName: string;
  /** Color class for the icon (Tailwind text-XYZ). */
  color: string;
  /** 1-line description shown under the label on a feature card. */
  description: string;
  /** Optional gating from navSections — surfaced to the page so it can hide rows. */
  minVehicles?: number;
  requiresAuth?: boolean;
}

/**
 * Plain-prose descriptions keyed by route. Keep these short (≤ 90 chars).
 *
 * Any new sidebar entry MUST have a matching key here — the
 * `everyRouteHasDescription` test asserts this and will fail loudly when
 * someone adds a page without a hub blurb.
 */
const DESCRIPTIONS: Record<string, string> = {
  // ── Home ───────────────────────────────────────────────────────────
  '/': 'Your daily summary — battery, last drive, charging, and alerts at a glance.',
  '/explore': 'Browse and search every feature in TeslaSync with a 1-line description for each.',
  '/live': 'Real-time map of where your vehicle is right now.',
  '/timeline': 'Hour-by-hour history of drives, charges, and events.',
  '/weekly-digest': 'A printable weekly recap of usage, range, and cost.',

  // ── Vehicles ───────────────────────────────────────────────────────
  '/vehicles': 'Manage every Tesla on your account — VIN, options, status.',
  '/digital-twin': 'A live 3D model of your car mirroring doors, lights, and motion.',
  '/vehicle-comparison': 'Side-by-side stats for two or more of your vehicles.',
  '/locations': 'Frequent destinations — home, work, favorite Superchargers.',

  // ── Driving ────────────────────────────────────────────────────────
  '/drives': 'Every drive with route, energy used, and efficiency.',
  '/trips': 'Multi-leg trips grouped into a single journey.',
  '/trip-planner': 'Plan a route with charging stops and ETA before you leave.',
  '/navigation': 'Send a destination to the car or save it for later.',
  '/geofences': 'Trigger automations when the car enters or leaves a zone.',
  '/mileage': 'Odometer log with monthly and yearly totals.',
  '/lifetime-stats': 'Every drive ever — distance, energy, and time totals.',
  '/drive-score': 'Smoothness rating per drive (acceleration, braking, cornering).',
  '/speed-profile': 'Speed-vs-time chart for any drive.',
  '/driving-dynamics': 'G-forces, lateral and longitudinal acceleration analysis.',
  '/regen-efficiency': 'How much energy regenerative braking recaptures.',
  '/route-efficiency': 'Compare actual vs predicted Wh/mile for a route.',

  // ── Charging ───────────────────────────────────────────────────────
  '/charging': 'All charging sessions — Supercharger, home, third-party.',
  '/tesla-charging-history': 'Tesla-provided charging history pulled from your account.',
  '/charging-curve': 'Power vs SOC curve for any charging session.',
  '/charging-heatmap': 'When and where you charge, visualised as a heatmap.',
  '/smart-charge': 'Schedule charging for off-peak or solar-surplus windows.',
  '/powershare': 'Use your vehicle as a backup home battery (V2H).',

  // ── Battery ────────────────────────────────────────────────────────
  '/battery': 'Pack health: SoH, full-charge capacity, and degradation curve.',
  '/battery-cells': 'Per-cell voltage and temperature spread.',
  '/battery-degradation': 'Capacity loss over time vs fleet average.',
  '/projected-range': 'Range forecast adjusted for weather, terrain, and driving style.',
  '/vampire-drain': 'Standby energy loss while parked and asleep.',
  '/sleep-efficiency': 'How quickly the car drops into low-power sleep when parked.',

  // ── Energy ─────────────────────────────────────────────────────────
  '/energy': 'Daily kWh in and out of the pack.',
  '/energy-flow': 'Animated flow diagram showing where the energy is going right now.',
  '/power-flow': 'Live power draw and regen at the wheels.',
  '/energy-products': 'Solar production and Powerwall stats from your Tesla account.',

  // ── Service ────────────────────────────────────────────────────────
  '/tire-pressure': 'Current and historical pressure per tire.',
  '/drivetrain-health': 'Motor temperatures, inverter status, and fault codes.',
  '/software-updates': 'Available firmware updates and changelog.',
  '/maintenance': 'Tire rotations, brake fluid, cabin filter — overdue items first.',

  // ── Cabin ──────────────────────────────────────────────────────────
  '/climate-control': 'Pre-heat, pre-cool, or run Dog Mode remotely.',
  '/media-player': 'See what is playing and control playback.',

  // ── Reports ────────────────────────────────────────────────────────
  '/statistics': 'Bar and pie charts across every metric in the system.',
  '/analytics': 'Long-range trends and correlations you can drill into.',
  '/period-compare': 'Pick two date ranges and see what changed.',
  '/efficiency': 'Wh/mile broken down by speed, climate, and elevation.',
  '/temperature-impact': 'How outside temperature affects range and efficiency.',
  '/cost-analysis': 'Electricity cost per drive and per mile.',
  '/tco': 'Total cost of ownership — energy, insurance, service, depreciation.',

  // ── Commands ───────────────────────────────────────────────────────
  '/commands': 'Send a remote command (wake, lock, climate, port, …).',
  '/command-history': 'Audit log of every command sent and its result.',

  // ── Automation ─────────────────────────────────────────────────────
  '/automations': 'Trigger actions on geofence, time, or vehicle state.',
  '/notifications/studio': 'Build a custom alert rule with conditions and channels.',
  '/notifications/rules': 'Manage existing alert rules.',

  // ── Notifications ──────────────────────────────────────────────────
  '/notifications/inbox': 'Recent alerts and system messages.',
  '/notifications/alerts': 'Active and acknowledged alerts grouped by severity.',
  '/notifications/channels': 'Where alerts are sent — email, SMS, push, webhook.',
  '/notifications/webhooks': 'POST alerts to your own URL for downstream automation.',
  '/notifications/browser': 'Enable browser push notifications for this device.',
  '/notifications/quiet-hours': 'Mute non-critical alerts during set times.',

  // ── Security ───────────────────────────────────────────────────────
  '/security-access': 'Manage who can drive, charge, and unlock your vehicle.',
  '/safety-settings': 'Speed limit, valet mode, and safety-related preferences.',
  '/guard-mode': 'Sentry Mode, dashcam, and event-recording settings.',

  // ── Account ────────────────────────────────────────────────────────
  '/tesla-account': 'Linked Tesla account, refresh-token status, and re-auth.',
  '/tesla-orders': 'Active orders on your Tesla account.',
  '/fleet-api': 'Fleet API rate-limit usage and registration details.',
  '/tesla-region': 'Switch Fleet API region (NA, EU, China).',
  '/tesla-features': 'Tesla feature-flag previews exposed by your firmware version.',
  '/account/2fa': 'Enroll or disable two-factor authentication on your account.',
  '/account/sessions': 'Browser and device sessions — revoke any of them.',
  '/account/privacy': 'Recently viewed pages, cookies, and analytics consent.',
  '/me/activity': 'Your recent page views and actions in this app.',

  // ── Settings ───────────────────────────────────────────────────────
  '/settings': 'Units, theme, locale, density, and every app preference.',
  '/chatbot': 'Ask Helix anything about your car or this app.',
  '/dev-tools': 'In-app developer surface — flags, debuggers, and inspectors.',

  // ── Integrations ───────────────────────────────────────────────────
  '/api-keys': 'Issue and revoke API keys for external integrations.',
  '/gas-price': 'Compare your $/mile against gasoline at current prices.',

  // ── Data ───────────────────────────────────────────────────────────
  '/data-export': 'Export drives, charging sessions, and signals to CSV.',
  '/backup': 'Take a full backup of the database or restore from one.',
  '/data-repair': 'Re-derive trips, sessions, and analytics from raw signals.',

  // ── Diagnostics ────────────────────────────────────────────────────
  '/system-status': 'Health of every dependent service — MQTT, Redis, DB, Tesla API.',
  '/db-health': 'Database size, query latency, and replication lag.',
  '/anomaly-detection': 'Auto-detected outliers in charging, range, and drives.',
  '/signals': 'Live values for every telemetry signal the car publishes.',
  '/admin/live-signals': 'Inspect a single signal in real time with history.',
  '/admin/ingest-xray': 'See every payload as it lands from Fleet Telemetry.',
  '/admin/dlq': 'Dead-letter queue — messages that failed to ingest.',
  '/admin/flags': 'Runtime feature flags — toggle without redeploy.',
  '/admin/schema-drift': 'Detect divergence between code models and the live DB schema.',
  '/admin/slow-queries': 'Top slow SQL queries with explain plans.',
  '/admin/vehicle-cost': 'Per-vehicle infrastructure cost attribution.',
  '/admin/disk-forecast': 'When will the database run out of disk?',
  '/admin/secret-rotation': 'Track and rotate secrets, tokens, and credentials.',
  '/admin/audit-log': 'Every privileged action with actor, target, and timestamp.',
  '/admin/gdpr-exports': 'Generate and download a complete user-data export.',
  '/state-debugger': 'Inspect the per-vehicle finite-state machine in real time.',
  '/mqtt-inspector': 'Subscribe to any MQTT topic and watch messages flow.',
  '/redis-signals': 'Dump the Redis live-signal cache for a vehicle.',
  '/admin/telemetry/coverage': 'Which Fleet Telemetry fields are wired vs missing.',
  '/api-logs': 'Recent HTTP requests with status, duration, and payload size.',
  '/api-playground': 'Try any API endpoint with parameter forms.',

  // ── About ──────────────────────────────────────────────────────────
  '/roadmap': 'Upcoming features grouped by quarter.',
};

/**
 * Build the flat catalog from `navSections` + DESCRIPTIONS. Anything in
 * navSections without a description gets a placeholder so the page never
 * blanks out, but the test suite will fail to keep us honest.
 */
export function buildFeatureCatalog(): FeatureCatalogEntry[] {
  const out: FeatureCatalogEntry[] = [];
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      out.push({
        to: item.to,
        label: item.label,
        section: section.title,
        iconName: item.iconName,
        color: item.color,
        description:
          DESCRIPTIONS[item.to] ??
          `Open ${item.label}.` /* visible fallback so the page never breaks */,
        minVehicles: item.minVehicles,
        requiresAuth: item.requiresAuth,
      });
    }
  }
  return out;
}

/** Group a flat catalog by section, preserving navSections order. */
export function groupFeatureCatalog(
  entries: FeatureCatalogEntry[],
): {section: string; entries: FeatureCatalogEntry[]}[] {
  const order = NAV_SECTIONS.map(s => s.title);
  const buckets = new Map<string, FeatureCatalogEntry[]>();
  for (const e of entries) {
    const bucket = buckets.get(e.section);
    if (bucket) bucket.push(e);
    else buckets.set(e.section, [e]);
  }
  return order
    .filter(title => buckets.has(title))
    .map(title => ({section: title, entries: buckets.get(title) ?? []}));
}

/**
 * Case-insensitive AND-token match against label, section, and
 * description. Returns the catalog filtered by `query`. Empty query
 * returns the full catalog.
 */
export function filterFeatureCatalog(
  entries: FeatureCatalogEntry[],
  query: string,
): FeatureCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const tokens = q.split(/\s+/);
  return entries.filter(e => {
    const haystack = `${e.label} ${e.section} ${e.description} ${e.to}`.toLowerCase();
    return tokens.every(tok => haystack.includes(tok));
  });
}

/** Test helper — expose the description map so tests can assert keys. */
export const __DESCRIPTIONS_FOR_TEST = DESCRIPTIONS;
