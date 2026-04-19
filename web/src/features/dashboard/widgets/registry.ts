import { lazy } from 'react';
import {
  Battery, Zap, Car, MapPin, Shield, Thermometer,
  Activity, BarChart3, Gauge, Wifi, TrendingUp, Monitor,
} from 'lucide-react';
import type { WidgetDef } from './types';

export const WIDGET_REGISTRY: WidgetDef[] = [
  // ── Vehicle ──
  {
    id: 'vehicle-hero',
    name: 'Vehicle Card',
    description: 'Vehicle name, model, state, battery at a glance',
    icon: Car,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 2 },
    component: lazy(() => import('./VehicleHeroWidget')),
  },
  {
    id: 'vehicle-twin',
    name: 'Digital Twin',
    description: 'Visual car state: doors, windows, lights',
    icon: Monitor,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 3, rows: 3 },
    component: lazy(() => import('./DigitalTwinWidget')),
  },

  // ── Battery ──
  {
    id: 'battery-gauge',
    name: 'Battery Level',
    description: 'Battery percentage with radial gauge',
    icon: Battery,
    category: 'battery',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 2 },
    component: lazy(() => import('./BatteryGaugeWidget')),
  },
  {
    id: 'range-estimate',
    name: 'Range Estimate',
    description: 'Rated, ideal, and estimated range',
    icon: Gauge,
    category: 'battery',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 1 },
    component: lazy(() => import('./RangeEstimateWidget')),
  },
  {
    id: 'energy-flow',
    name: 'Energy Flow',
    description: 'Live power flow diagram',
    icon: Activity,
    category: 'battery',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./EnergyFlowWidget')),
  },

  // ── Driving ──
  {
    id: 'recent-drives',
    name: 'Recent Drives',
    description: 'Last 5 drives with distance and efficiency',
    icon: Car,
    category: 'driving',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./RecentDrivesWidget')),
  },
  {
    id: 'drive-score',
    name: 'Driving Score',
    description: 'Weekly efficiency and driving score',
    icon: TrendingUp,
    category: 'driving',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 2 },
    component: lazy(() => import('./DriveScoreWidget')),
  },

  // ── Charging ──
  {
    id: 'charge-status',
    name: 'Charge Status',
    description: 'Current charge state, amps, time remaining',
    icon: Zap,
    category: 'charging',
    defaultSize: { cols: 2, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 3, rows: 2 },
    component: lazy(() => import('./ChargeStatusWidget')),
  },
  {
    id: 'charge-history',
    name: 'Charge History',
    description: 'Recent charging sessions chart',
    icon: BarChart3,
    category: 'charging',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./ChargeHistoryWidget')),
  },

  // ── Climate ──
  {
    id: 'climate-status',
    name: 'Climate',
    description: 'Inside/outside temp, HVAC state',
    icon: Thermometer,
    category: 'climate',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 1 },
    component: lazy(() => import('./ClimateStatusWidget')),
  },

  // ── Security ──
  {
    id: 'security-status',
    name: 'Security',
    description: 'Lock, sentry, doors, windows status',
    icon: Shield,
    category: 'security',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 2 },
    component: lazy(() => import('./SecurityStatusWidget')),
  },

  // ── Telemetry ──
  {
    id: 'live-signals',
    name: 'Live Signals',
    description: 'Real-time signal values with sparklines',
    icon: Wifi,
    category: 'telemetry',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./LiveSignalsWidget')),
  },

  // ── Analytics ──
  {
    id: 'fleet-stats',
    name: 'Fleet Stats',
    description: 'Fleet-wide metrics and totals',
    icon: BarChart3,
    category: 'analytics',
    defaultSize: { cols: 4, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 1 },
    component: lazy(() => import('./FleetStatsWidget')),
  },

  // ── System ──
  {
    id: 'quick-nav',
    name: 'Quick Navigation',
    description: 'Shortcut links to key pages',
    icon: MapPin,
    category: 'system',
    defaultSize: { cols: 4, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 1 },
    component: lazy(() => import('./QuickNavWidget')),
  },
  {
    id: 'location-map',
    name: 'Vehicle Location',
    description: 'Live vehicle location on map',
    icon: MapPin,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./LocationMapWidget')),
  },
];

export function getWidgetDef(widgetId: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((w) => w.id === widgetId);
}
