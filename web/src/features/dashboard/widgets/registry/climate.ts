import { lazy } from 'react';
import { Thermometer, CloudSun, ThermometerSun } from 'lucide-react';
import type { WidgetDef } from '../types';

export const CLIMATE_WIDGETS: WidgetDef[] = [
  {
    id: 'climate-status',
    name: 'Climate',
    description: 'Inside/outside temp, HVAC state',
    icon: Thermometer,
    category: 'climate',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 2, rows: 40 },
    component: lazy(() => import('../ClimateStatusWidget')),
  },
  {
    id: 'climate-control-panel',
    name: 'Climate Control Panel',
    description: 'Inside/outside temp, HVAC on/off, fan speed, seat heaters, steering heat',
    icon: Thermometer,
    category: 'climate',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../ClimateControlPanelWidget')),
  },
  {
    id: 'weather-at-car',
    name: 'Weather at Car',
    description: 'Current weather at vehicle location: temp, conditions icon',
    icon: CloudSun,
    category: 'climate',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 3, rows: 40 },
    component: lazy(() => import('../WeatherAtCarWidget')),
  },
  {
    id: 'climate-history',
    name: 'Climate History',
    description: 'Inside vs outside temperature chart over time',
    icon: ThermometerSun,
    category: 'climate',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../ClimateHistoryWidget')),
  },
];
