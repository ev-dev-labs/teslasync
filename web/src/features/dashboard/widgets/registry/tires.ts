import { lazy } from 'react';
import { CircleDot } from 'lucide-react';
import type { WidgetDef } from '../types';

export const TIRE_WIDGETS: WidgetDef[] = [
  {
    id: 'tire-pressure-visual',
    name: 'Tire Pressure Visual',
    description: 'Four-tire diagram with pressure per tire, color-coded (green/amber/red)',
    icon: CircleDot,
    category: 'tires',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../TirePressureVisualWidget')),
  },
  {
    id: 'tire-pressure-history',
    name: 'Tire Pressure History',
    description: 'Pressure trends for all 4 tires over time with recommended range',
    icon: CircleDot,
    category: 'tires',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../TirePressureHistoryWidget')),
  },
];
