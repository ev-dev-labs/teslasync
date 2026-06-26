// Native parity port of web/src/features/dashboard/components/WidgetPicker.tsx.
//
// `<WidgetPicker>` is the dashboard "Add Widget" drawer. It lets the user search
// the full widget catalogue, filter by category, re-add recently-added widgets,
// apply a layout preset, and add widgets one-by-one or by the bucket. It owns
// five pieces of state (search / categoryFilter / addedThisSessionIds /
// recentlyAddedIds / announcement), derives a stack of memoised views over the
// registry, persists "recently added" across sessions, and surfaces an aria-live
// announcement plus roving focus as widgets are added.
//
// The web original composes the shared DOM kit (Drawer, Badge, Button, Input),
// the a11y <VisuallyHidden> live region, lucide-react SVG icons (Check/Clock/
// Search + one icon per widget), the `cn()` class merge, react-i18next
// (`useTranslation('dashboard')`), Tailwind utility classes + CSS custom
// properties, browser `localStorage`, `window.requestAnimationFrame`, and DOM
// focus/keyboard handling. React Native has none of those, so this port keeps the
// same behavioural + visual contract with RN primitives:
//   - The shared <Drawer> (framer-motion right-spring slide + portal + focus
//     trap) becomes an inline <DrawerShell>: an RN <Modal animationType="slide">
//     with a tap-to-close backdrop <Pressable>, a right-anchored full-height
//     surface card, a header (title + "×" close), a scrollable body, and the
//     optional sticky footer. `onRequestClose` maps the Android back button to
//     the web Escape-closes-drawer behaviour.
//   - The shared <Input> (with its leading icon) becomes a labelled <TextInput>
//     inside a search box; `onChange(e) => setSearch(e.target.value)` maps onto
//     `onChangeText={setSearch}`, and the web Enter-adds-the-single-result
//     keydown maps onto `onSubmitEditing`.
//   - The shared <Button variant="ghost"> widget/preset cards and the "Add all"
//     buttons become Pressables; the shared <Badge variant="neutral"> "Added"
//     pill is inlined as a rounded chip. The category filter <button>s become
//     Pressable pills with the accent active palette.
//   - The per-widget lucide icon becomes a per-category text glyph in the accent
//     chip (118 widgets share ~40 lucide icons; a category glyph preserves the
//     "accent icon tile" intent without 40 SVG ports). The Check/Clock/Search
//     icons become "✓"/"🕘"/"🔍" glyphs.
//   - `highlightMatch` returns the matched substring wrapped in an accent +
//     semibold <AppText> (web: a `text-[var(--theme-primary)] font-semibold`
//     <span>) inside the surrounding label.
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so `useTranslation('dashboard')` is
//     replaced by a native `useWidgetsTranslation()` hook that returns each
//     call's English defaultValue with i18next-style `{{var}}` interpolation, so
//     every key, fallback, and interpolated value ({{name}}/{{count}}/{{query}})
//     is preserved verbatim.
//   - Browser `localStorage` (the "teslasync-widgets-recent" persistence) is not
//     available on native, so `loadRecentlyAdded`/`saveRecentlyAdded` resolve to
//     a process-scoped in-memory store (same idiom as the ported chart-legend
//     state); the key name, RECENTLY_ADDED_MAX cap, dedupe, most-recent-first
//     ordering, and registry validation are preserved.
//   - The `WidgetCategory`/`WidgetDef` types + the full `WIDGET_REGISTRY`
//     (118 widgets) and `DASHBOARD_PRESETS` (10 presets) are re-declared inline
//     as native-safe mirrors of ../widgets/types, ../widgets/registry and
//     ../hooks/useDashboardLayout — those web modules import lucide-react
//     (LucideIcon) and React.lazy() widget components, which are browser-only.
//     Only the fields this picker reads (id/name/description/category/defaultSize
//     and preset id/name/widgets) are reproduced.
//   - `window.requestAnimationFrame` + DOM `.focus()` roving focus becomes
//     `requestAnimationFrame` + `AccessibilityInfo.setAccessibilityFocus` over
//     `findNodeHandle`; the next-addable selection logic is preserved verbatim.
//     The web Ctrl/Meta+Enter quick-add-and-close has no touch analogue, so a
//     widget-card long-press stands in for it. The Escape-clears-search-first
//     nuance is browser-only and is dropped (the drawer still closes via the
//     backdrop / close button / Android back).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {VisuallyHidden} from '../../../components/a11y';

// ---------------------------------------------------------------------------
// Native-safe mirror of ../widgets/types (the web module imports lucide-react's
// LucideIcon + React.lazy widget components, which are browser-only). Only the
// fields this picker reads are reproduced.
// ---------------------------------------------------------------------------

export interface WidgetSize {
  cols: number;
  rows: number;
}

export type WidgetCategory =
  | 'vehicle'
  | 'battery'
  | 'energy'
  | 'driving'
  | 'charging'
  | 'climate'
  | 'tires'
  | 'security'
  | 'commands'
  | 'media'
  | 'telemetry'
  | 'analytics'
  | 'alerts'
  | 'automations'
  | 'system'
  | 'maps';

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
}

const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  vehicle: 'Vehicle',
  battery: 'Battery & Range',
  energy: 'Energy',
  driving: 'Driving',
  charging: 'Charging',
  climate: 'Climate',
  tires: 'Tires',
  security: 'Security',
  commands: 'Commands',
  media: 'Media',
  telemetry: 'Telemetry',
  analytics: 'Analytics',
  alerts: 'Alerts',
  automations: 'Automations',
  system: 'System',
  maps: 'Maps',
};

// Per-category accent glyph standing in for the per-widget lucide icon (the web
// renders `<w.icon className="... text-[var(--theme-primary)]" />`).
const CATEGORY_ICON: Record<WidgetCategory, string> = {
  vehicle: '🚗',
  battery: '🔋',
  energy: '⚡',
  driving: '🛣️',
  charging: '🔌',
  climate: '🌡️',
  tires: '🛞',
  security: '🛡️',
  commands: '🎛️',
  media: '🎵',
  telemetry: '📡',
  analytics: '📊',
  alerts: '🔔',
  automations: '⚙️',
  system: '🖥️',
  maps: '🗺️',
};

// Decorative glyphs replacing the lucide Check / Clock / Search / X icons.
const CHECK_GLYPH = '\u2713'; // ✓
const CLOCK_GLYPH = '\uD83D\uDD58'; // 🕘
const SEARCH_GLYPH = '\uD83D\uDD0D'; // 🔍
const CLOSE_GLYPH = '\u00D7'; // ×

// ---------------------------------------------------------------------------
// Native-safe mirror of ../widgets/registry (WIDGET_REGISTRY). The web modules
// attach a lucide `icon` + a React.lazy `component` to each entry; only the
// catalogue metadata the picker renders is reproduced here, in registry order.
// ---------------------------------------------------------------------------

export const WIDGET_REGISTRY: WidgetDef[] = [
  {
    id: 'vehicle-hero',
    name: 'Vehicle Card',
    description: 'Vehicle name, model, state, battery at a glance',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 9},
  },
  {
    id: 'vehicle-hero-card',
    name: 'Vehicle Hero Card',
    description: 'Vehicle name, model, state badge (online/asleep/driving/charging), battery, range, temp',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'vehicle-twin',
    name: 'Digital Twin',
    description: 'Visual car state: doors, windows, lights',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'digital-twin-mini',
    name: 'Digital Twin Mini',
    description: 'Small version of vehicle digital twin SVG: doors, windows, lock, charge port',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'software-update-status',
    name: 'Software Update',
    description: 'Current firmware version, update availability, download/install progress bar',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'software-update-history',
    name: 'Update History',
    description: 'Firmware update timeline: versions installed, dates, changelogs',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'odometer-counter',
    name: 'Odometer Counter',
    description: 'Animated odometer with rolling digit animation and distance breakdown',
    category: 'vehicle',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'drivetrain-health',
    name: 'Drivetrain Health',
    description: 'Motor temp, stator temp, inverter health, overall powertrain score',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'motor-performance',
    name: 'Motor Performance',
    description: 'Live motor data: torque, stator temp, gear state, g-forces',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'motor-history',
    name: 'Motor History',
    description: 'Motor torque and stator temp over time with danger zone highlighting',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'vehicle-specs',
    name: 'Vehicle Specs',
    description: 'Configuration reference: model, trim, paint, wheels, options',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'watch-summary',
    name: 'Watch Summary',
    description: 'Apple Watch-style compact view: battery, range, state, lock status',
    category: 'vehicle',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'maintenance-tracker',
    name: 'Maintenance',
    description: 'Upcoming maintenance reminders + recent service history',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'warranty-status',
    name: 'Warranty Status',
    description: 'Warranty countdown: time remaining, mileage remaining, coverage types',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    description: 'Tesla subscriptions: Premium Connectivity, FSD, expiry dates, renewal',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'vehicle-upgrades',
    name: 'Upgrades & Sharing',
    description: 'Available OTA upgrades with pricing + active drive share links',
    category: 'vehicle',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'battery-gauge',
    name: 'Battery Level',
    description: 'Battery percentage with radial gauge',
    category: 'battery',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'battery-radial-gauge',
    name: 'Battery Radial Gauge',
    description: 'Large radial gauge showing battery percentage with color gradient (green>amber>red)',
    category: 'battery',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'range-estimate',
    name: 'Range Estimate',
    description: 'Rated, ideal, and estimated range',
    category: 'battery',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'range-bar',
    name: 'Range Bar',
    description: 'Horizontal bar showing rated, ideal, and estimated range with EPA comparison',
    category: 'battery',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'battery-degradation-trend',
    name: 'Battery Degradation Trend',
    description: 'Line chart showing max range capacity over months',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'energy-flow',
    name: 'Energy Flow',
    description: 'Live power flow diagram',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'projected-range',
    name: 'Projected Range',
    description: 'Helix-predicted range based on driving habits, weather, elevation',
    category: 'battery',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'battery-cells',
    name: 'Battery Cells',
    description: 'Cell-level voltage heatmap, min/max/avg, temperature per module',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'battery-degradation-forecast',
    name: 'Battery Forecast',
    description: 'Predictive degradation: when battery hits 80%, risk factors, recommendations',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'battery-health-analytics',
    name: 'Battery Analytics',
    description: 'Deep battery health: cycles, charge depth, temp exposure, DC fast ratio',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'energy-flow-animated',
    name: 'Energy Flow Animated',
    description: 'Animated energy flow diagram: battery→drive, regen→battery, charger→battery',
    category: 'energy',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'vampire-drain',
    name: 'Vampire Drain',
    description: 'Phantom drain rate: avg %/day, recent drain events',
    category: 'energy',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'sleep-efficiency',
    name: 'Sleep Efficiency',
    description: 'How well the car sleeps: efficiency %, drain rate, wake events',
    category: 'energy',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'solar-production',
    name: 'Solar Production',
    description: 'Daily solar generation chart from Tesla Energy / Powerwall',
    category: 'energy',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'live-power-flow',
    name: 'Live Power Flow',
    description: 'Real-time solar→battery→home→grid power routing diagram',
    category: 'energy',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'energy-site-info',
    name: 'Energy Site',
    description: 'Tesla Energy system: solar capacity, Powerwall count, gateway firmware',
    category: 'energy',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'backup-history',
    name: 'Backup History',
    description: 'Power outage events: Powerwall backup triggers, duration, energy used',
    category: 'energy',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'power-flow-history',
    name: 'Power Flow History',
    description: 'Historical solar/battery/grid/home power routing over 24 hours',
    category: 'energy',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'energy-stats',
    name: 'Energy Stats',
    description: 'Energy overview: daily usage chart, total used/charged, efficiency, CO₂ saved',
    category: 'energy',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'recent-drives',
    name: 'Recent Drives',
    description: 'Last 5 drives with distance and efficiency',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'drive-score',
    name: 'Driving Score',
    description: 'Weekly efficiency and driving score',
    category: 'driving',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'recent-drives-list',
    name: 'Recent Drives List',
    description: 'Last 5-10 drives: distance, duration, efficiency, start/end locations',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'drive-score-gauge',
    name: 'Drive Score Gauge',
    description: 'Radial gauge showing weekly score (0-100) with efficiency, smoothness, and speed breakdown',
    category: 'driving',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'drive-efficiency-chart',
    name: 'Drive Efficiency Chart',
    description: 'Area chart of Wh/mi over last 30 days with rolling average overlay',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'speed-heatmap',
    name: 'Speed Heatmap',
    description: 'Heatmap: time-of-day vs day-of-week speed distribution',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'driving-dynamics',
    name: 'Driving Dynamics',
    description: 'Acceleration, braking, lateral g-forces with driving style indicator',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'speed-profile',
    name: 'Speed Profile',
    description: 'Speed distribution histogram with efficiency overlay — find your optimal speed',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'regen-efficiency',
    name: 'Regen Braking',
    description: 'Regenerative braking recovery rate, total kWh recovered, max regen power',
    category: 'driving',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'route-efficiency',
    name: 'Route Efficiency',
    description: 'Recurring routes ranked by energy efficiency with weather/elevation impact',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'driving-coach',
    name: 'Driving Coach',
    description: 'Helix-powered driving tips: personalized efficiency recommendations',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'trip-summary',
    name: 'Trip Summary',
    description: 'Recent trips: start→end, distance, duration, drive segments, charge stops',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'drive-telemetry',
    name: 'Drive Telemetry',
    description: 'Last drive replay: speed, power, battery over time with route',
    category: 'driving',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'charge-status',
    name: 'Charge Status',
    description: 'Current charge state, amps, time remaining',
    category: 'charging',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'charge-status-live',
    name: 'Charge Status Live',
    description: 'Live charging: current amps/volts/power, time remaining, energy added',
    category: 'charging',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'charge-history',
    name: 'Charge History',
    description: 'Recent charging sessions chart',
    category: 'charging',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'charge-session-chart',
    name: 'Charge Session Chart',
    description: 'Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)',
    category: 'charging',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'charge-cost-tracker',
    name: 'Charge Cost Tracker',
    description: 'Monthly charging cost breakdown: total kWh, total cost, cost per mile, vs gas savings',
    category: 'charging',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'charging-schedule',
    name: 'Charging Schedule',
    description: 'Shows scheduled charge time, departure time, charge limit',
    category: 'charging',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'cost-forecast',
    name: 'Cost Forecast',
    description: '6-month charging cost projection with seasonal trends',
    category: 'charging',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'charging-optimizer',
    name: 'Charging Optimizer',
    description: 'Smart charging schedule: optimal time, target SOC, cost savings',
    category: 'charging',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'wall-connector',
    name: 'Wall Connector',
    description: 'Home charging stats from Tesla Wall Connector: daily kWh, session history',
    category: 'charging',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'charging-telemetry',
    name: 'Charging Telemetry',
    description: 'Live charging metrics: voltage, amperage, power, phases, charger type',
    category: 'charging',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'supercharger-history',
    name: 'Supercharger History',
    description: 'Tesla Supercharger sessions: location, energy, cost from Tesla account',
    category: 'charging',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'charge-plans',
    name: 'Charge Plans',
    description: 'Active charge plan, rate schedule: peak/off-peak hours with rates',
    category: 'charging',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'charging-session-detail',
    name: 'Charge Session Detail',
    description: 'Last charge session power curve with SoC overlay, kWh added, peak power',
    category: 'charging',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'climate-status',
    name: 'Climate',
    description: 'Inside/outside temp, HVAC state',
    category: 'climate',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'climate-control-panel',
    name: 'Climate Control Panel',
    description: 'Inside/outside temp, HVAC on/off, fan speed, seat heaters, steering heat',
    category: 'climate',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'weather-at-car',
    name: 'Weather at Car',
    description: 'Current weather at vehicle location: temp, conditions icon',
    category: 'climate',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'climate-history',
    name: 'Climate History',
    description: 'Inside vs outside temperature chart over time',
    category: 'climate',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'tire-pressure-visual',
    name: 'Tire Pressure Visual',
    description: 'Four-tire diagram with pressure per tire, color-coded (green/amber/red)',
    category: 'tires',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'tire-pressure-history',
    name: 'Tire Pressure History',
    description: 'Pressure trends for all 4 tires over time with recommended range',
    category: 'tires',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'security-status',
    name: 'Security',
    description: 'Lock, sentry, doors, windows status',
    category: 'security',
    defaultSize: {cols: 1, rows: 2},
  },
  {
    id: 'door-window-status',
    name: 'Door & Window Status',
    description: 'Grid showing 4 doors + 4 windows with open/closed/partial badges',
    category: 'security',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'sentry-event-log',
    name: 'Sentry Event Log',
    description: 'Recent sentry events with timestamps',
    category: 'security',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'safety-features',
    name: 'Safety Features',
    description: 'ADAS status: autopilot, collision warning, lane departure, blind spot',
    category: 'security',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'safety-history',
    name: 'Safety History',
    description: 'ADAS event timeline: collision warnings, AEB, lane departures, disengagements',
    category: 'security',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'guard-mode',
    name: 'Guard Mode',
    description: 'Anti-theft guard status, recent security events, panic button',
    category: 'security',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'vehicle-access',
    name: 'Vehicle Access',
    description: 'Authorized drivers, pending invitations, mobile access status',
    category: 'security',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'command-quick-actions',
    name: 'Quick Actions',
    description: 'Grid of command buttons: Lock, Unlock, Climate, Frunk, Horn, Flash',
    category: 'commands',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'command-history',
    name: 'Command History',
    description: 'Recent vehicle commands: lock, unlock, climate — with success/fail status',
    category: 'commands',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'media-now-playing',
    name: 'Now Playing',
    description: 'Current media: song title, artist, source',
    category: 'media',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'media-history',
    name: 'Media History',
    description: 'Recently played tracks: title, artist, source, playback history',
    category: 'media',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'live-signals',
    name: 'Live Signals',
    description: 'Real-time signal values with sparklines',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'live-signal-sparklines',
    name: 'Live Signal Sparklines',
    description: 'Configurable list of 4-6 signals with mini sparkline charts (last 5 min)',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'signal-health',
    name: 'Signal Health',
    description: 'Telemetry signal coverage: active signals, data gaps, freshness',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'signal-catalog',
    name: 'Signal Catalog',
    description: 'Browse all available telemetry signals with categories and observation counts',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'signal-log',
    name: 'Signal Log',
    description: 'Live feed of raw signal updates: timestamp, signal, old→new value, source',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'fleet-stats',
    name: 'Fleet Stats',
    description: 'Fleet-wide metrics and totals',
    category: 'analytics',
    defaultSize: {cols: 4, rows: 2},
  },
  {
    id: 'fleet-stats-bar',
    name: 'Fleet Stats Bar',
    description: 'Fleet-wide: total vehicles, online count, total miles today, total energy',
    category: 'analytics',
    defaultSize: {cols: 4, rows: 2},
  },
  {
    id: 'weekly-summary-card',
    name: 'Weekly Summary',
    description: 'This week vs last week: total miles, kWh, cost, efficiency',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'weekly-digest',
    name: 'Weekly Digest',
    description: 'This week vs last week: distance, drives, energy, efficiency trends',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'monthly-mileage',
    name: 'Monthly Mileage',
    description: 'Bar chart of monthly driving distance over last 12 months',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'lifetime-stats',
    name: 'Lifetime Stats',
    description: 'All-time totals: distance, drives, energy, CO₂ saved, ownership days',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'mileage-stats',
    name: 'Mileage Stats',
    description: 'Driving averages: daily, weekly, monthly distance + milestone projection',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'state-timeline',
    name: 'State Timeline',
    description: 'Vehicle state distribution: driving, charging, asleep, idle breakdown',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'anomaly-detector',
    name: 'Anomaly Detector',
    description: 'Statistical outlier alerts: unusual battery, temp, or driving anomalies',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'fsm-distribution',
    name: 'State Distribution',
    description: 'Donut chart of time in each state + recent state transitions feed',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'cost-breakdown',
    name: 'Cost Breakdown',
    description: 'Charging cost by source: home vs Supercharger vs destination, gas savings',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'year-review',
    name: 'Year in Review',
    description: 'Annual recap: total miles, drives, energy, highlights, achievements',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'analytics-summary',
    name: 'Analytics Summary',
    description: 'Fleet-wide snapshot: distance, efficiency, energy, cost per mile',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'recently-unlocked-achievements',
    name: 'Recently Unlocked',
    description: 'Most recently unlocked achievements — click to view in Lifetime Stats',
    category: 'analytics',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'alert-feed',
    name: 'Alert Feed',
    description: 'Recent alerts reverse-chronological with severity badges',
    category: 'alerts',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'notification-stats',
    name: 'Notification Stats',
    description: 'Notification delivery rate, active channels, recent delivery log',
    category: 'alerts',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'automation-status',
    name: 'Automation Status',
    description: 'Active automations: last run, success/fail badge, next scheduled',
    category: 'automations',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'automation-history',
    name: 'Automation History',
    description: 'Recent automation runs: success/failure status, execution times',
    category: 'automations',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'onboarding-checklist',
    name: 'Setup Checklist',
    description: 'First-run setup checklist: connect Tesla, pick a theme, create an alert, and more',
    category: 'system',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'uptime-monitor',
    name: 'Uptime Monitor',
    description: 'System health: DB, MQTT, Tesla API, Fleet Telemetry status',
    category: 'system',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'mqtt-status',
    name: 'MQTT Status',
    description: 'Fleet Telemetry MQTT connection: status, message rate, throughput',
    category: 'system',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'quick-nav',
    name: 'Quick Navigation',
    description: 'Shortcut links to key pages',
    category: 'system',
    defaultSize: {cols: 4, rows: 2},
  },
  {
    id: 'api-usage',
    name: 'API Usage',
    description: 'API call volume, response times, error rates, top endpoints',
    category: 'system',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'system-health',
    name: 'System Health',
    description: 'Server health: DB, MQTT, Tesla API status, memory, connections',
    category: 'system',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'telemetry-errors',
    name: 'Telemetry Errors',
    description: 'Fleet Telemetry error monitor: VINs with errors, error types, counts',
    category: 'system',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'audit-log',
    name: 'Audit Log',
    description: 'Security audit trail: user actions, auth events, permission changes',
    category: 'system',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'backup-monitor',
    name: 'Backup Monitor',
    description: 'Database backup status: last run, size, retention, success/fail history',
    category: 'system',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'export-status',
    name: 'Export Status',
    description: 'Data export jobs: progress, format, size, success/fail status',
    category: 'system',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'version-info',
    name: 'Version Info',
    description: 'TeslaSync version, build info, uptime, data capture rates',
    category: 'system',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'dashboard-stats',
    name: 'Dashboard Stats',
    description: 'Meta-widget: dashboard usage, widgets placed, FSM current state',
    category: 'system',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'location-map',
    name: 'Vehicle Location Map',
    description: 'Live map of vehicle position with heading arrow',
    category: 'maps',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'location-favorites',
    name: 'Favorite Locations',
    description: 'Frequently visited places, current location status (home/work/other)',
    category: 'maps',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'geofence-status',
    name: 'Geofence Status',
    description: 'Configured geofences with inside/outside status for current vehicle',
    category: 'maps',
    defaultSize: {cols: 2, rows: 4},
  },
  {
    id: 'destination-eta',
    name: 'Destination ETA',
    description: 'Active navigation: destination, distance remaining, arrival countdown',
    category: 'maps',
    defaultSize: {cols: 2, rows: 2},
  },
  {
    id: 'position-heatmap',
    name: 'Position Heatmap',
    description: 'GPS position density heatmap: frequently visited locations glow brighter',
    category: 'maps',
    defaultSize: {cols: 2, rows: 4},
  },
];

// ---------------------------------------------------------------------------
// Native-safe mirror of ../hooks/useDashboardLayout (DASHBOARD_PRESETS). The
// picker only reads each preset's id, name, and widget count.
// ---------------------------------------------------------------------------

export interface DashboardPreset {
  id: string;
  name: string;
  widgets: {widgetId: string}[];
}

export const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: 'default',
    name: 'Default',
    widgets: [
      {widgetId: 'onboarding-checklist'},
      {widgetId: 'vehicle-hero'},
      {widgetId: 'battery-gauge'},
      {widgetId: 'climate-status'},
      {widgetId: 'recent-drives'},
      {widgetId: 'charge-status'},
      {widgetId: 'security-status'},
      {widgetId: 'quick-nav'},
    ],
  },
  {
    id: 'commuter',
    name: 'Daily Commuter',
    widgets: [
      {widgetId: 'battery-gauge'},
      {widgetId: 'range-estimate'},
      {widgetId: 'charge-status'},
      {widgetId: 'climate-status'},
      {widgetId: 'security-status'},
      {widgetId: 'location-map'},
      {widgetId: 'quick-nav'},
    ],
  },
  {
    id: 'fleet_manager',
    name: 'Fleet Manager',
    widgets: [
      {widgetId: 'fleet-stats'},
      {widgetId: 'recent-drives'},
      {widgetId: 'charge-history'},
      {widgetId: 'drive-score'},
      {widgetId: 'vehicle-hero'},
      {widgetId: 'quick-nav'},
    ],
  },
  {
    id: 'data_nerd',
    name: 'Data Nerd',
    widgets: [
      {widgetId: 'live-signals'},
      {widgetId: 'energy-flow'},
      {widgetId: 'vehicle-twin'},
      {widgetId: 'battery-gauge'},
      {widgetId: 'drive-score'},
    ],
  },
  {
    id: 'charging_focus',
    name: 'Charging Hub',
    widgets: [
      {widgetId: 'charge-status-live'},
      {widgetId: 'battery-radial-gauge'},
      {widgetId: 'charge-session-chart'},
      {widgetId: 'charge-cost-tracker'},
      {widgetId: 'charging-schedule'},
      {widgetId: 'range-bar'},
      {widgetId: 'energy-flow-animated'},
    ],
  },
  {
    id: 'security_monitor',
    name: 'Security Monitor',
    widgets: [
      {widgetId: 'door-window-status'},
      {widgetId: 'sentry-event-log'},
      {widgetId: 'location-map'},
      {widgetId: 'vehicle-hero-card'},
      {widgetId: 'alert-feed'},
      {widgetId: 'command-quick-actions'},
    ],
  },
  {
    id: 'road_trip',
    name: 'Road Trip',
    widgets: [
      {widgetId: 'battery-radial-gauge'},
      {widgetId: 'range-bar'},
      {widgetId: 'location-map'},
      {widgetId: 'weather-at-car'},
      {widgetId: 'tire-pressure-visual'},
      {widgetId: 'climate-control-panel'},
      {widgetId: 'recent-drives-list'},
      {widgetId: 'drive-efficiency-chart'},
    ],
  },
  {
    id: 'performance',
    name: 'Performance',
    widgets: [
      {widgetId: 'drive-score-gauge'},
      {widgetId: 'speed-heatmap'},
      {widgetId: 'drive-efficiency-chart'},
      {widgetId: 'battery-degradation-trend'},
      {widgetId: 'energy-flow-animated'},
      {widgetId: 'live-signal-sparklines'},
    ],
  },
  {
    id: 'kiosk_wall',
    name: 'Wall Display',
    widgets: [
      {widgetId: 'vehicle-hero'},
      {widgetId: 'battery-radial-gauge'},
      {widgetId: 'charge-status-live'},
      {widgetId: 'location-map'},
      {widgetId: 'weather-at-car'},
      {widgetId: 'uptime-monitor'},
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    widgets: [
      {widgetId: 'battery-radial-gauge'},
      {widgetId: 'charge-status'},
      {widgetId: 'climate-status'},
      {widgetId: 'quick-nav'},
    ],
  },
];

const WIDGET_BY_ID = new Map(WIDGET_REGISTRY.map(widget => [widget.id, widget]));

const RECENTLY_ADDED_KEY = 'teslasync-widgets-recent';
const RECENTLY_ADDED_MAX = 8;

// Process-scoped in-memory replacement for browser localStorage (RN has none).
// Keyed by RECENTLY_ADDED_KEY so the persistence contract reads identically.
const recentlyAddedStore = new Map<string, string[]>();

function loadRecentlyAdded(): string[] {
  const raw = recentlyAddedStore.get(RECENTLY_ADDED_KEY);
  if (!raw) {
    return [];
  }
  return raw.filter(
    (id): id is string => typeof id === 'string' && WIDGET_BY_ID.has(id),
  );
}

function saveRecentlyAdded(ids: string[]): void {
  recentlyAddedStore.set(RECENTLY_ADDED_KEY, [...ids]);
}

/** Test/utility helper: clears the in-memory recently-added store (the native
 * analogue of `localStorage.removeItem`). Not part of the web API surface. */
export function resetWidgetPickerRecentlyAdded(): void {
  recentlyAddedStore.clear();
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) {
    return text;
  }
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return text;
  }
  return (
    <>
      {text.slice(0, idx)}
      <AppText style={styles.highlight}>
        {text.slice(idx, idx + query.length)}
      </AppText>
      {text.slice(idx + query.length)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Native translation fallback. react-i18next is not wired in native; this
// returns each call's English defaultValue with i18next-style {{var}}
// interpolation (web: useTranslation('dashboard')).
// ---------------------------------------------------------------------------

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

function useWidgetsTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  }, []);
}

// ---------------------------------------------------------------------------
// DrawerShell — native replacement for the shared web <Drawer> (framer-motion
// slide + portal + focus trap). A right-anchored full-height surface with a
// tap-to-close backdrop, header, scrollable body, and optional sticky footer.
// ---------------------------------------------------------------------------

interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  footer?: ReactNode;
  closeLabel: string;
  children: ReactNode;
}

function DrawerShell({
  open,
  onClose,
  title,
  footer,
  closeLabel,
  children,
}: DrawerShellProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.drawerOverlay}>
        <Pressable
          accessibilityLabel={closeLabel}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.drawerBackdrop}
        />
        <View
          accessibilityViewIsModal
          style={styles.drawerPanel}
          testID="widget-picker-drawer">
          <View style={styles.drawerHeader}>
            <AppText style={styles.drawerTitle} weight="bold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel={closeLabel}
              accessibilityRole="button"
              onPress={onClose}
              style={({pressed}) => [
                styles.drawerClose,
                pressed && styles.pressed,
              ]}
              testID="widget-picker-close">
              <AppText
                accessible={false}
                allowFontScaling={false}
                style={styles.drawerCloseGlyph}>
                {CLOSE_GLYPH}
              </AppText>
            </Pressable>
          </View>
          <View style={styles.drawerBody}>{children}</View>
          {footer ? <View style={styles.drawerFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// WidgetCard — one selectable widget row (web: the ghost <Button> card). Kept a
// top-level component so the roving-focus ref + press handlers stay stable.
// ---------------------------------------------------------------------------

interface WidgetCardProps {
  widget: WidgetDef;
  isAdded: boolean;
  query: string;
  addedLabel: string;
  categoryLabel: string;
  iconGlyph: string;
  onAdd: (widget: WidgetDef) => void;
  onAddAndClose: (widget: WidgetDef) => void;
  registerRef: (id: string, node: View | null) => void;
}

function WidgetCard({
  widget,
  isAdded,
  query,
  addedLabel,
  categoryLabel,
  iconGlyph,
  onAdd,
  onAddAndClose,
  registerRef,
}: WidgetCardProps) {
  return (
    <Pressable
      accessibilityLabel={widget.name}
      accessibilityRole="button"
      accessibilityState={{disabled: isAdded}}
      disabled={isAdded}
      onLongPress={() => onAddAndClose(widget)}
      onPress={() => onAdd(widget)}
      ref={node => {
        registerRef(widget.id, node);
      }}
      style={({pressed}) => [
        styles.widgetCard,
        isAdded ? styles.widgetCardDisabled : pressed && styles.cardPressed,
      ]}
      testID={`widget-picker-card-${widget.id}`}>
      <View style={styles.widgetCardRow}>
        <View style={styles.iconChip}>
          <AppText
            accessible={false}
            allowFontScaling={false}
            style={styles.iconGlyph}>
            {iconGlyph}
          </AppText>
        </View>
        <View style={styles.widgetCardMain}>
          <View style={styles.widgetTitleRow}>
            <AppText style={styles.widgetName} weight="semibold">
              {highlightMatch(widget.name, query)}
            </AppText>
            {isAdded ? (
              <View style={styles.addedBadge}>
                <AppText style={styles.addedBadgeText}>{addedLabel}</AppText>
              </View>
            ) : null}
          </View>
          <AppText style={styles.widgetDesc}>
            {highlightMatch(widget.description, query)}
          </AppText>
          <AppText style={styles.widgetMeta}>
            {widget.defaultSize.cols}×{widget.defaultSize.rows} grid
            {query ? `  ${categoryLabel}` : ''}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

export interface WidgetPickerProps {
  open: boolean;
  onClose: () => void;
  onAddWidgets: (widgetIds: string[]) => void;
  onApplyPreset: (presetId: string) => void;
  activeWidgetIds: string[];
}

export function WidgetPicker({
  open,
  onClose,
  onAddWidgets,
  onApplyPreset,
  activeWidgetIds,
}: WidgetPickerProps) {
  const t = useWidgetsTranslation();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<WidgetCategory | 'all'>(
    'all',
  );
  const [addedThisSessionIds, setAddedThisSessionIds] = useState<string[]>([]);
  const [recentlyAddedIds, setRecentlyAddedIds] =
    useState<string[]>(loadRecentlyAdded);
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<TextInput>(null);
  const widgetButtonRefs = useRef(new Map<string, View>());
  const focusFrameRef = useRef<number | null>(null);

  // Reset search and auto-focus when drawer opens
  useEffect(() => {
    if (open) {
      setSearch('');
      setCategoryFilter('all');
      setAddedThisSessionIds([]);
      setAnnouncement('');
      setRecentlyAddedIds(loadRecentlyAdded());
      // Small delay to let the drawer animate in before focusing
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
    setAddedThisSessionIds([]);
    setAnnouncement('');
  }, [open]);

  // Cancel any pending roving-focus frame on unmount.
  useEffect(
    () => () => {
      if (focusFrameRef.current != null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    },
    [],
  );

  const query = search.trim().toLowerCase();

  const activeWidgetIdSet = useMemo(
    () => new Set(activeWidgetIds),
    [activeWidgetIds],
  );

  const inCategory = useCallback(
    (w: WidgetDef) => categoryFilter === 'all' || w.category === categoryFilter,
    [categoryFilter],
  );

  const filteredWidgets = useMemo(() => {
    let pool = WIDGET_REGISTRY;
    if (categoryFilter !== 'all') {
      pool = pool.filter(inCategory);
    }
    if (!query) {
      return pool;
    }
    return pool.filter(
      w =>
        w.name.toLowerCase().includes(query) ||
        w.description.toLowerCase().includes(query) ||
        w.category.toLowerCase().includes(query),
    );
  }, [categoryFilter, inCategory, query]);

  const grouped = useMemo(
    () =>
      WIDGET_REGISTRY.filter(inCategory).reduce(
        (acc, w) => {
          if (!acc[w.category]) {
            acc[w.category] = [];
          }
          acc[w.category].push(w);
          return acc;
        },
        {} as Record<string, WidgetDef[]>,
      ),
    [inCategory],
  );

  const groupedEntries = useMemo(
    () => Object.entries(grouped) as [WidgetCategory, WidgetDef[]][],
    [grouped],
  );

  const visibleWidgets = useMemo(
    () =>
      query
        ? filteredWidgets
        : groupedEntries.flatMap(([, widgets]) => widgets),
    [filteredWidgets, groupedEntries, query],
  );

  const addableSearchWidgets = useMemo(
    () => filteredWidgets.filter(widget => !activeWidgetIdSet.has(widget.id)),
    [activeWidgetIdSet, filteredWidgets],
  );

  /** Recently added widgets that aren't already on the active dashboard. */
  const recentlyAddedVisible = useMemo(() => {
    if (query || categoryFilter !== 'all') {
      return [];
    }
    return recentlyAddedIds
      .map(id => WIDGET_BY_ID.get(id))
      .filter(
        (w): w is WidgetDef => Boolean(w) && !activeWidgetIdSet.has(w!.id),
      )
      .slice(0, RECENTLY_ADDED_MAX);
  }, [activeWidgetIdSet, categoryFilter, query, recentlyAddedIds]);

  /** Categories that actually have widgets — used to render the filter pills. */
  const availableCategories = useMemo(() => {
    const set = new Set<WidgetCategory>();
    for (const w of WIDGET_REGISTRY) {
      set.add(w.category);
    }
    return Array.from(set);
  }, []);

  const registerWidgetRef = useCallback((id: string, node: View | null) => {
    if (node) {
      widgetButtonRefs.current.set(id, node);
    } else {
      widgetButtonRefs.current.delete(id);
    }
  }, []);

  const focusNextAddableWidget = useCallback(
    (addedIds: string[], anchorId: string) => {
      const unavailableIds = new Set(activeWidgetIdSet);
      for (const id of addedIds) {
        unavailableIds.add(id);
      }

      const anchorIndex = visibleWidgets.findIndex(
        widget => widget.id === anchorId,
      );
      const orderedWidgets =
        anchorIndex === -1
          ? visibleWidgets
          : [
              ...visibleWidgets.slice(anchorIndex + 1),
              ...visibleWidgets.slice(0, anchorIndex),
            ];
      const nextWidget = orderedWidgets.find(
        widget => !unavailableIds.has(widget.id),
      );
      if (!nextWidget) {
        return;
      }

      if (focusFrameRef.current != null) {
        cancelAnimationFrame(focusFrameRef.current);
      }
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = null;
        try {
          const node = widgetButtonRefs.current.get(nextWidget.id);
          const handle = node ? findNodeHandle(node) : null;
          if (handle != null) {
            AccessibilityInfo.setAccessibilityFocus(handle);
          }
        } catch {
          // Accessibility focus is best-effort on native.
        }
      });
    },
    [activeWidgetIdSet, visibleWidgets],
  );

  const handleAddMany = useCallback(
    (
      widgetIds: string[],
      options?: {closeAfterAdd?: boolean; focusAnchorId?: string},
    ) => {
      const seen = new Set<string>();
      const addableIds = widgetIds.filter(widgetId => {
        if (
          seen.has(widgetId) ||
          activeWidgetIdSet.has(widgetId) ||
          !WIDGET_BY_ID.has(widgetId)
        ) {
          return false;
        }
        seen.add(widgetId);
        return true;
      });

      if (addableIds.length === 0) {
        return;
      }

      onAddWidgets(addableIds);
      setAddedThisSessionIds(prev => {
        const next = new Set(prev);
        for (const id of addableIds) {
          next.add(id);
        }
        return Array.from(next);
      });
      // Persist recently-added across sessions (most-recent first, deduped, capped).
      setRecentlyAddedIds(prev => {
        const next = [
          ...addableIds,
          ...prev.filter(id => !addableIds.includes(id)),
        ].slice(0, RECENTLY_ADDED_MAX);
        saveRecentlyAdded(next);
        return next;
      });

      if (addableIds.length === 1) {
        const widget = WIDGET_BY_ID.get(addableIds[0]);
        if (widget) {
          setAnnouncement(
            t('widgets.addedAnnouncement', '{{name}} added to dashboard', {
              name: widget.name,
            }),
          );
        }
      } else {
        setAnnouncement(
          t('widgets.addedBatchAnnouncement', '{{count}} widgets added to dashboard', {
            count: addableIds.length,
          }),
        );
      }

      focusNextAddableWidget(
        addableIds,
        options?.focusAnchorId ?? addableIds[addableIds.length - 1],
      );

      if (options?.closeAfterAdd) {
        onClose();
      }
    },
    [activeWidgetIdSet, focusNextAddableWidget, onAddWidgets, onClose, t],
  );

  const handleAdd = useCallback(
    (widget: WidgetDef, closeAfterAdd = false) => {
      handleAddMany([widget.id], {closeAfterAdd, focusAnchorId: widget.id});
    },
    [handleAddMany],
  );

  const handleAddAndClose = useCallback(
    (widget: WidgetDef) => handleAdd(widget, true),
    [handleAdd],
  );

  // web: Enter on the search input adds the single addable result. The
  // Escape-clears-search-first nuance is browser-only and is dropped.
  const handleSubmitEditing = useCallback(() => {
    if (query) {
      const addable = filteredWidgets.filter(w => !activeWidgetIdSet.has(w.id));
      if (addable.length === 1) {
        handleAdd(addable[0]);
      }
    }
  }, [query, filteredWidgets, activeWidgetIdSet, handleAdd]);

  const addedLabel = t('dashboard.added', 'Added');

  const renderWidgetCard = (w: WidgetDef) => (
    <WidgetCard
      addedLabel={addedLabel}
      categoryLabel={CATEGORY_LABELS[w.category]}
      iconGlyph={CATEGORY_ICON[w.category]}
      isAdded={activeWidgetIdSet.has(w.id)}
      key={w.id}
      onAdd={handleAdd}
      onAddAndClose={handleAddAndClose}
      query={query}
      registerRef={registerWidgetRef}
      widget={w}
    />
  );

  const addedThisSessionCount = addedThisSessionIds.length;
  const addedCountText =
    addedThisSessionCount === 1
      ? t('widgets.addedCount_one', '{{count}} widget added', {
          count: addedThisSessionCount,
        })
      : t('widgets.addedCount_other', '{{count}} widgets added', {
          count: addedThisSessionCount,
        });

  const searchPlaceholder = t(
    'widgets.search',
    'Search widgets... (e.g. battery, chart, map)',
  );

  return (
    <DrawerShell
      closeLabel={t('common.close', 'Close')}
      footer={
        addedThisSessionCount > 0 ? (
          <View style={styles.footerRow}>
            <View style={styles.footerLeft}>
              <AppText
                accessible={false}
                allowFontScaling={false}
                style={styles.footerCheck}>
                {CHECK_GLYPH}
              </AppText>
              <AppText style={styles.footerCountText} weight="semibold">
                {addedCountText}
              </AppText>
            </View>
            <Pressable
              accessibilityLabel={t('dashboard.done', 'Done')}
              accessibilityRole="button"
              onPress={onClose}
              style={({pressed}) => [
                styles.doneButton,
                pressed && styles.pressed,
              ]}
              testID="widget-picker-done">
              <AppText style={styles.doneButtonText} weight="semibold">
                {t('dashboard.done', 'Done')}
              </AppText>
            </Pressable>
          </View>
        ) : undefined
      }
      onClose={onClose}
      open={open}
      title={t('dashboard.addWidget', 'Add Widget')}>
      <VisuallyHidden as="div" liveRegion>
        <AppText>{announcement}</AppText>
      </VisuallyHidden>

      {/* Search input — fixed at the top of the drawer body (web: sticky) */}
      <View style={styles.searchHeader}>
        <View style={styles.searchBox}>
          <AppText
            accessible={false}
            allowFontScaling={false}
            style={styles.searchGlyph}>
            {SEARCH_GLYPH}
          </AppText>
          <TextInput
            accessibilityLabel={searchPlaceholder}
            onChangeText={setSearch}
            onSubmitEditing={handleSubmitEditing}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.textMuted}
            ref={inputRef}
            returnKeyType="done"
            style={styles.searchInput}
            testID="widget-picker-search"
            value={search}
          />
        </View>
        <AppText style={styles.availableCaption}>
          {filteredWidgets.length} {t('widgets.available', 'widgets available')}
        </AppText>
      </View>

      <ScrollView
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        style={styles.bodyScroll}>
        {/* Category filter pills */}
        <View
          accessibilityLabel={t('widgets.categoryFilter', 'Filter by category')}
          style={styles.pillsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: categoryFilter === 'all'}}
            onPress={() => setCategoryFilter('all')}
            style={({pressed}) => [
              styles.pill,
              categoryFilter === 'all' ? styles.pillActive : styles.pillIdle,
              pressed && styles.pressed,
            ]}
            testID="widget-picker-category-all">
            <AppText
              style={[
                styles.pillText,
                categoryFilter === 'all'
                  ? styles.pillTextActive
                  : styles.pillTextIdle,
              ]}>
              {t('widgets.allCategories', 'All')}
            </AppText>
          </Pressable>
          {availableCategories.map(cat => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{selected: categoryFilter === cat}}
              key={cat}
              onPress={() => setCategoryFilter(cat)}
              style={({pressed}) => [
                styles.pill,
                categoryFilter === cat ? styles.pillActive : styles.pillIdle,
                pressed && styles.pressed,
              ]}
              testID={`widget-picker-category-${cat}`}>
              <AppText
                style={[
                  styles.pillText,
                  categoryFilter === cat
                    ? styles.pillTextActive
                    : styles.pillTextIdle,
                ]}>
                {CATEGORY_LABELS[cat]}
              </AppText>
            </Pressable>
          ))}
        </View>

        {/* Recently Added — only on the unfiltered, unsearched view */}
        {recentlyAddedVisible.length > 0 ? (
          <View>
            <View style={styles.recentHeader}>
              <AppText
                accessible={false}
                allowFontScaling={false}
                style={styles.clockGlyph}>
                {CLOCK_GLYPH}
              </AppText>
              <AppText style={styles.sectionTitle} weight="semibold">
                {t('widgets.recentlyAdded', 'Recently Added')}
              </AppText>
            </View>
            <View style={styles.cardsGrid}>
              {recentlyAddedVisible.map(renderWidgetCard)}
            </View>
            <View style={styles.dividerSpaced} />
          </View>
        ) : null}

        {/* Layout Presets — hide when searching or filtering by category */}
        {!query && categoryFilter === 'all' ? (
          <View>
            <View>
              <AppText style={styles.sectionTitleBlock} weight="semibold">
                {t('dashboard.presets', 'Layout Presets')}
              </AppText>
              <View style={styles.cardsGrid}>
                {DASHBOARD_PRESETS.map(preset => (
                  <Pressable
                    accessibilityLabel={preset.name}
                    accessibilityRole="button"
                    key={preset.id}
                    onPress={() => {
                      onApplyPreset(preset.id);
                      onClose();
                    }}
                    style={({pressed}) => [
                      styles.presetCard,
                      pressed && styles.cardPressed,
                    ]}
                    testID={`widget-picker-preset-${preset.id}`}>
                    <AppText style={styles.presetName} weight="semibold">
                      {preset.name}
                    </AppText>
                    <AppText style={styles.presetMeta}>
                      {preset.widgets.length}{' '}
                      {t('dashboard.widgets', 'widgets')}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.divider} />
          </View>
        ) : null}

        {/* Widgets — flat list when searching, grouped by category otherwise */}
        {query ? (
          filteredWidgets.length > 0 ? (
            <View style={styles.sectionGap}>
              {filteredWidgets.length > 1 ? (
                <View style={styles.searchResultsBar}>
                  <AppText style={styles.searchResultsText}>
                    {t('widgets.searchResults', '{{count}} results for "{{query}}"', {
                      count: filteredWidgets.length,
                      query: search.trim(),
                    })}
                  </AppText>
                  <Pressable
                    accessibilityLabel={t('widgets.addAllCount', '+ Add all {{count}}', {
                      count: addableSearchWidgets.length,
                    })}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: addableSearchWidgets.length === 0,
                    }}
                    disabled={addableSearchWidgets.length === 0}
                    onPress={() =>
                      handleAddMany(
                        addableSearchWidgets.map(widget => widget.id),
                      )
                    }
                    style={({pressed}) => [
                      styles.addAllButton,
                      addableSearchWidgets.length === 0 &&
                        styles.addAllButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                    testID="widget-picker-add-all-search">
                    <AppText style={styles.addAllText}>
                      {t('widgets.addAllCount', '+ Add all {{count}}', {
                        count: addableSearchWidgets.length,
                      })}
                    </AppText>
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.cardsGrid}>
                {filteredWidgets.map(renderWidgetCard)}
              </View>
            </View>
          ) : (
            <AppText style={styles.noResults}>
              {t('widgets.noResults', 'No widgets match "{{query}}"', {
                query: search.trim(),
              })}
            </AppText>
          )
        ) : (
          groupedEntries.map(([cat, widgets]) => {
            const addableCategoryWidgets = widgets.filter(
              widget => !activeWidgetIdSet.has(widget.id),
            );
            return (
              <View key={cat}>
                <View style={styles.categoryHeaderRow}>
                  <AppText style={styles.sectionTitle} weight="semibold">
                    {CATEGORY_LABELS[cat]}
                  </AppText>
                  <Pressable
                    accessibilityLabel={t('widgets.addAllCount', '+ Add all {{count}}', {
                      count: addableCategoryWidgets.length,
                    })}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: addableCategoryWidgets.length === 0,
                    }}
                    disabled={addableCategoryWidgets.length === 0}
                    onPress={() =>
                      handleAddMany(
                        addableCategoryWidgets.map(widget => widget.id),
                      )
                    }
                    style={({pressed}) => [
                      styles.addAllButton,
                      addableCategoryWidgets.length === 0 &&
                        styles.addAllButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                    testID={`widget-picker-add-all-${cat}`}>
                    <AppText style={styles.addAllText}>
                      {t('widgets.addAllCount', '+ Add all {{count}}', {
                        count: addableCategoryWidgets.length,
                      })}
                    </AppText>
                  </Pressable>
                </View>
                <View style={styles.cardsGrid}>
                  {widgets.map(renderWidgetCard)}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </DrawerShell>
  );
}

WidgetPicker.displayName = 'WidgetPicker';

const styles = StyleSheet.create({
  addAllButton: {
    borderRadius: 8,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  addAllButtonDisabled: {
    opacity: 0.4,
  },
  addAllText: {
    color: colors.textSecondary,
    fontSize: 10,
  },
  addedBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  addedBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  availableCaption: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: spacing.xs,
  },
  bodyContent: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  bodyScroll: {
    flex: 1,
  },
  cardPressed: {
    backgroundColor: colors.surfaceHover,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  cardsGrid: {
    gap: spacing.sm,
  },
  categoryHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  clockGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    height: 1,
  },
  dividerSpaced: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    height: 1,
    marginTop: spacing.md,
  },
  doneButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  doneButtonText: {
    color: colors.background,
    fontSize: 14,
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  drawerBody: {
    flex: 1,
  },
  drawerClose: {
    borderRadius: 8,
    padding: spacing.xs,
  },
  drawerCloseGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 22,
  },
  drawerFooter: {
    backgroundColor: colors.surface,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  drawerHeader: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerPanel: {
    backgroundColor: colors.surface,
    borderLeftColor: 'rgba(255, 255, 255, 0.06)',
    borderLeftWidth: 1,
    height: '100%',
    maxWidth: 448,
    width: '100%',
    ...shadows.panel,
  },
  drawerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  footerCheck: {
    color: colors.success,
    fontSize: 14,
  },
  footerCountText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  footerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  highlight: {
    color: colors.accent,
    fontWeight: '600',
  },
  iconChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 10,
    padding: spacing.sm,
  },
  iconGlyph: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 20,
  },
  noResults: {
    color: colors.textMuted,
    fontSize: 14,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  pillActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  pillIdle: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: colors.border,
  },
  pillText: {
    fontSize: 11,
  },
  pillTextActive: {
    color: colors.accent,
  },
  pillTextIdle: {
    color: colors.textSecondary,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  presetCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  presetMeta: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  presetName: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  pressed: {
    opacity: 0.82,
  },
  recentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  searchGlyph: {
    color: colors.textMuted,
    fontSize: 14,
    marginRight: spacing.sm,
  },
  searchHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  searchResultsBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchResultsText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 12,
  },
  sectionGap: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionTitleBlock: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.6,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
  },
  widgetCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  widgetCardDisabled: {
    opacity: 0.4,
  },
  widgetCardMain: {
    flex: 1,
    minWidth: 0,
  },
  widgetCardRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  widgetDesc: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  widgetMeta: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: spacing.xs,
  },
  widgetName: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  widgetTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});

export default WidgetPicker;
