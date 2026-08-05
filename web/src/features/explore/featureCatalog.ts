/**
 * featureCatalog — Feature Hub data layer.
 *
 * The single source of truth for "every page in the app" is the existing
 * `navSections` array exported from Layout.tsx. We re-use it verbatim and
 * decorate each entry with a 1-line description so the Explore page can
 * render a discoverable card grid.
 *
 * Why this file exists (and isn't just inlined into the page):
 *   1. Keeps the description map next to its data — easy to edit, easy
 *      to test for completeness.
 *   2. Lets the test suite assert every navSections route has a
 *      description (no orphans).
 *   3. Lets future "Recently used", "Suggested", or "Quick action"
 *      surfaces share the same enriched catalog.
 *
 * Discipline:
 *   - 1 line, ≤ 90 characters, plain prose.
 *   - Describe WHAT the page shows / does, not HOW.
 *   - Verb-first when the page is an action ("Send commands to your car").
 *   - Noun-first when the page is a view ("Charging session timeline + curve").
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { navSections } from '@/components/layout/Layout';

/** Shape of a single sidebar item — re-derived from navSections so it stays in sync. */
type NavItem = (typeof navSections)[number]['items'][number];

export interface FeatureCatalogEntry {
  to: string;
  label: string;
  /** Section title from navSections (e.g. "Home", "Driving"). */
  section: string;
  /** Lucide icon component OR a custom React icon. */
  icon: LucideIcon | ComponentType<{ className?: string }>;
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
  '/action-center': 'Prioritized decisions with evidence, confidence, safe actions, and no fabricated impact.',
  '/explore': 'Browse and search every feature in TeslaSync with a 1-line description for each.',
  '/live': 'Real-time map of where your vehicle is right now.',
  '/timeline': 'Hour-by-hour history of drives, charges, and events.',
  '/weekly-digest': 'A printable weekly recap of usage, range, and cost.',

  // ── Vehicles ───────────────────────────────────────────────────────
  '/vehicles': 'Manage every Tesla on your account — VIN, options, status.',
  '/digital-twin': 'A live 3D model of your car mirroring doors, lights, and motion.',
  '/vehicle-comparison': 'Side-by-side stats for two or more of your vehicles.',
  '/locations': 'Frequent destinations — home, work, favorite Superchargers.',
  '/parking': 'Parking patterns, dwell time, location mix, and recurring occupancy.',
  '/utilization': 'Vehicle availability and productive use across your fleet.',
  '/time-machine': 'Reconstruct vehicle state at any recorded point in time.',
  '/fleet-operations': 'Coordinate drivers, bookings, policies, work orders, and utilization.',
  '/resale-vault': 'Create verifiable, selectively disclosed vehicle-history reports.',

  // ── Advanced Intelligence ──────────────────────────────────────────
  '/intelligence/twin-lab': 'Run calibrated vehicle counterfactuals with explicit uncertainty and sensitivity.',
  '/intelligence/firmware-canary': 'Gate firmware rollout using matched pre/post cohorts instead of simple averages.',
  '/intelligence/component-survival': 'Model event-free component horizons, competing risks, and intervention sensitivity.',
  '/intelligence/road-hazards': 'Reveal privacy-safe crash and airbag clusters without exposing exact coordinates.',
  '/intelligence/behavioral-sentinel': 'Detect command and telemetry behavior shifts without claiming attack attribution.',
  '/intelligence/charging-forensics': 'Separate recorded charging facts from unsupported meter and billing assumptions.',
  '/intelligence/journey-assurance': 'Stress-test departure readiness against reserve, climate, and uncertainty.',
  '/intelligence/charging-site-twin': 'Simulate charging-site queues, failures, and fallback capacity before deployment.',
  '/intelligence/federated-learning': 'Train local aggregate models with explicit privacy-budget accounting.',
  '/intelligence/emergency-resilience': 'Build confirmed emergency energy plans from vehicles, home reserve, and loads.',
  '/intelligence/causal-lab': 'Run confirmed treatment/control analyses with transparent effect limitations.',
  '/intelligence/tco-optimizer': 'Compare ownership scenarios without inventing prices, tariffs, or depreciation.',

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
  '/logbook': 'Review and annotate a searchable chronological trip log.',
  '/mileage-budget': 'Track distance budgets and forecast when thresholds will be reached.',
  '/driving-rhythm': 'See recurring departure, duration, and travel-time patterns.',
  '/speed-sweetspot': 'Find the speed band where your vehicle is most efficient.',
  '/efficiency-target': 'Set an efficiency goal and measure progress toward it.',
  '/cold-start': 'Quantify the energy and range cost of cold departures.',
  '/drive-compare': 'Compare two drives across route, speed, energy, and conditions.',
  '/explorer': 'Slice and inspect drive history with advanced filters.',
  '/drive-calendar': 'Browse driving activity and totals on a calendar.',
  '/milestones': 'Celebrate distance, efficiency, and ownership achievements.',
  '/drive-dna': 'Profile the repeatable characteristics of your driving style.',
  '/what-if': 'Simulate how speed, weather, load, and climate change efficiency.',
  '/departure-forecast': 'Predict likely departure times from historical routines.',
  '/arrival-reliability': 'Estimate arrival-time reliability and route uncertainty.',
  '/destination-transitions': 'Map recurring movement between destinations and likely next stops.',
  '/journey-fragmentation': 'Measure trip chains, stopovers, and avoidable journey fragments.',
  '/seasonal-efficiency': 'Compare efficiency patterns across seasons and weather regimes.',
  '/segments': 'Race your historical best on repeated road segments.',

  // ── Charging ───────────────────────────────────────────────────────
  '/charging': 'All charging sessions — Supercharger, home, third-party.',
  '/tesla-charging-history': 'Tesla-provided charging history pulled from your account.',
  '/charging-curve': 'Power vs SOC curve for any charging session.',
  '/charging-heatmap': 'When and where you charge, visualised as a heatmap.',
  '/smart-charge': 'Schedule charging for off-peak or solar-surplus windows.',
  '/powershare': 'Use your vehicle as a backup home battery (V2H).',
  '/charger-health': 'Track charging-site performance, faults, and declining power.',
  '/charge-interruption': 'Explain incomplete sessions and recurring charging interruptions.',
  '/charger-resilience': 'Measure dependence on individual sites and charging alternatives.',
  '/charge-departure-alignment': 'Check whether charging finishes before predicted departures.',
  '/charging-thermal-tax': 'Quantify battery-heating overhead during charging sessions.',

  // ── Battery ────────────────────────────────────────────────────────
  '/battery': 'Pack health: SoH, full-charge capacity, and degradation curve.',
  '/battery-cells': 'Per-cell voltage and temperature spread.',
  '/battery-degradation': 'Capacity loss over time vs fleet average.',
  '/projected-range': 'Range forecast adjusted for weather, terrain, and driving style.',
  '/vampire-drain': 'Standby energy loss while parked and asleep.',
  '/sleep-efficiency': 'How quickly the car drops into low-power sleep when parked.',
  '/battery-passport': 'Issue a verifiable battery health and provenance certificate.',
  '/pack-capacity': 'Estimate usable pack capacity from charging and driving evidence.',
  '/cycle-stress': 'Measure depth-of-discharge and cycle stress on the battery.',
  '/range-buffer': 'Track reserve-range habits and low-state-of-charge exposure.',
  '/battery-care': 'Turn battery behavior into practical longevity recommendations.',
  '/charge-advisor': 'Recommend charging limits and timing for battery care.',

  // ── Energy ─────────────────────────────────────────────────────────
  '/energy': 'Daily kWh in and out of the pack.',
  '/energy-flow': 'Animated flow diagram showing where the energy is going right now.',
  '/power-flow': 'Live power draw and regen at the wheels.',
  '/energy-products': 'Solar production and Powerwall stats from your Tesla account.',
  '/energy-ledger': 'Reconcile vehicle energy, cost, charging losses, and sources.',
  '/energy-orchestrator': 'Optimize vehicles, solar, Powerwall, tariffs, and panel capacity.',

  // ── Service ────────────────────────────────────────────────────────
  '/tire-pressure': 'Current and historical pressure per tire.',
  '/drivetrain-health': 'Motor temperatures, inverter status, and fault codes.',
  '/software-updates': 'Available firmware updates and changelog.',
  '/maintenance': 'Tire rotations, brake fluid, cabin filter — overdue items first.',
  '/tire-differential-drift': 'Detect persistent pressure drift between tires.',
  '/firmware-impact': 'Compare efficiency and reliability before and after firmware updates.',
  '/service-intelligence': 'Match recalls and service bulletins to vehicle evidence.',
  '/diagnostics/service-evidence': 'Export an integrity-checked package of service evidence.',

  // ── Cabin ──────────────────────────────────────────────────────────
  '/climate-control': 'Pre-heat, pre-cool, or run Dog Mode remotely.',
  '/media-player': 'See what is playing and control playback.',
  '/cabin-thermal': 'Model cabin heating, cooling, and heat-retention behavior.',
  '/hvac-cycling': 'Detect excessive compressor cycling and unstable HVAC operation.',
  '/comfort-consistency': 'Measure how consistently the cabin holds its target temperature.',
  '/preconditioning-effectiveness': 'Score cabin and battery readiness before departure.',

  // ── Reports ────────────────────────────────────────────────────────
  '/statistics': 'Bar and pie charts across every metric in the system.',
  '/analytics': 'Long-range trends and correlations you can drill into.',
  '/period-compare': 'Pick two date ranges and see what changed.',
  '/efficiency': 'Wh/mile broken down by speed, climate, and elevation.',
  '/temperature-impact': 'How outside temperature affects range and efficiency.',
  '/cost-analysis': 'Electricity cost per drive and per mile.',
  '/tco': 'Total cost of ownership — energy, insurance, service, depreciation.',
  '/share-card': 'Design privacy-aware visual summaries ready to share.',
  '/analytics/carbon': 'Track charging emissions and lower-carbon alternatives.',
  '/drive-archetypes': 'Discover recurring drive patterns and representative journeys.',
  '/benchmarks/privacy': 'Compare with similar vehicles without uploading raw trips.',

  // ── Commands ───────────────────────────────────────────────────────
  '/commands': 'Send a remote command (wake, lock, climate, port, …).',
  '/command-history': 'Audit log of every command sent and its result.',
  '/command-reliability': 'Measure command latency, success rate, and recurring failures.',

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
  '/alert-fatigue': 'Identify noisy alert rules and reduce repetitive notifications.',
  '/notification-burn-rate': 'Track notification reliability against its error budget.',
  '/notification-latency': 'Measure delivery speed and tail latency by channel.',

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
  '/integrations/helix': 'Configure the Helix AI assistant — provider, model, API key, and cost cap.',
  '/api-keys': 'Issue and revoke API keys for external integrations.',
  '/gas-price': 'Compare your $/mile against gasoline at current prices.',
  '/intelligence-packs': 'Install signed, sandboxed community analytics and automations.',

  // ── Data ───────────────────────────────────────────────────────────
  '/data-export': 'Export drives, charging sessions, and signals to CSV.',
  '/backup': 'Take a full backup of the database or restore from one.',
  '/data-repair': 'Re-derive trips, sessions, and analytics from raw signals.',

  // ── Diagnostics ────────────────────────────────────────────────────
  '/system-status': 'Health of every dependent service — MQTT, Redis, DB, Tesla API.',
  '/db-health': 'Database size, query latency, and replication lag.',
  '/anomaly-detection': 'Auto-detected outliers in charging, range, and drives.',
  '/diagnostics/rul': 'Estimate remaining useful life for monitored components.',
  '/diagnostics/root-cause': 'Rank evidence-backed explanations for vehicle anomalies.',
  '/dashcam': 'Search, redact, and reconstruct Dashcam and Sentry incidents locally.',
  '/signal-correlation': 'Find signals that move together across a selected time window.',
  '/signal-entropy': 'Measure signal variability and information density.',
  '/signal-trend': 'Detect robust long-term telemetry trends and direction changes.',
  '/signal-change-points': 'Locate statistically meaningful shifts in signal behavior.',
  '/signal-deadband': 'Recommend noise thresholds that preserve meaningful telemetry.',
  '/signal-mutual-information': 'Discover nonlinear dependencies between telemetry signals.',
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
  for (const section of navSections) {
    for (const raw of section.items) {
      const item = raw as NavItem & {
        minVehicles?: number;
        requiresAuth?: boolean;
      };
      out.push({
        to: item.to,
        label: item.label,
        section: section.title,
        icon: item.icon,
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
): { section: string; entries: FeatureCatalogEntry[] }[] {
  const order = navSections.map((s) => s.title);
  const buckets = new Map<string, FeatureCatalogEntry[]>();
  for (const e of entries) {
    const bucket = buckets.get(e.section);
    if (bucket) bucket.push(e);
    else buckets.set(e.section, [e]);
  }
  return order
    .filter((title) => buckets.has(title))
    .map((title) => ({ section: title, entries: buckets.get(title)! }));
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
  const exactSection = entries.find((entry) => entry.section.toLowerCase() === q)?.section;
  if (exactSection) return entries.filter((entry) => entry.section === exactSection);
  const tokens = q.split(/\s+/);
  return entries.filter((e) => {
    const haystack = `${e.label} ${e.section} ${e.description} ${e.to}`.toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}

/** Test helper — expose the description map so tests can assert keys. */
export const __DESCRIPTIONS_FOR_TEST = DESCRIPTIONS;
