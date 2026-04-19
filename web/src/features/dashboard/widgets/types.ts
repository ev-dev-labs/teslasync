import type { LucideIcon } from 'lucide-react';
import type { LazyExoticComponent, ComponentType } from 'react';

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-3
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
}

export type WidgetCategory =
  | 'vehicle'
  | 'battery'
  | 'driving'
  | 'charging'
  | 'climate'
  | 'security'
  | 'telemetry'
  | 'analytics'
  | 'system';

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
}

export interface WidgetInstance {
  id: string;
  widgetId: string;
  position: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

export interface DashboardLayout {
  id: string;
  name: string;
  widgets: WidgetInstance[];
  createdAt: string;
  updatedAt: string;
}
