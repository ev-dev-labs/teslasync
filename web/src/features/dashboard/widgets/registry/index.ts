import type { WidgetDef } from '../types';

import { VEHICLE_WIDGETS } from './vehicle';
import { BATTERY_WIDGETS } from './battery';
import { ENERGY_WIDGETS } from './energy';
import { DRIVING_WIDGETS } from './driving';
import { CHARGING_WIDGETS } from './charging';
import { CLIMATE_WIDGETS } from './climate';
import { TIRE_WIDGETS } from './tires';
import { SECURITY_WIDGETS } from './security';
import { COMMAND_WIDGETS } from './commands';
import { MEDIA_WIDGETS } from './media';
import { TELEMETRY_WIDGETS } from './telemetry';
import { ANALYTICS_WIDGETS } from './analytics';
import { ALERT_WIDGETS } from './alerts';
import { AUTOMATION_WIDGETS } from './automations';
import { SYSTEM_WIDGETS } from './system';
import { MAP_WIDGETS } from './maps';

export const WIDGET_REGISTRY: WidgetDef[] = [
  ...VEHICLE_WIDGETS,
  ...BATTERY_WIDGETS,
  ...ENERGY_WIDGETS,
  ...DRIVING_WIDGETS,
  ...CHARGING_WIDGETS,
  ...CLIMATE_WIDGETS,
  ...TIRE_WIDGETS,
  ...SECURITY_WIDGETS,
  ...COMMAND_WIDGETS,
  ...MEDIA_WIDGETS,
  ...TELEMETRY_WIDGETS,
  ...ANALYTICS_WIDGETS,
  ...ALERT_WIDGETS,
  ...AUTOMATION_WIDGETS,
  ...SYSTEM_WIDGETS,
  ...MAP_WIDGETS,
];

// O(1) id → definition index. getWidgetDef runs once per widget instance on
// every dashboard render (DashboardGrid, MiniGridPreview, TemplateGallery,
// useDashboardLayout), so a linear WIDGET_REGISTRY.find() rescans all 100+
// definitions on each lookup. Build the index once at module load, mirroring
// the WIDGET_BY_ID pattern in WidgetPicker. First occurrence wins, preserving
// the previous find() semantics for the (currently impossible) duplicate-id case.
const WIDGET_BY_ID: ReadonlyMap<string, WidgetDef> = (() => {
  const index = new Map<string, WidgetDef>();
  for (const widget of WIDGET_REGISTRY) {
    if (!index.has(widget.id)) index.set(widget.id, widget);
  }
  return index;
})();

export function getWidgetDef(widgetId: string): WidgetDef | undefined {
  return WIDGET_BY_ID.get(widgetId);
}

export {
  VEHICLE_WIDGETS,
  BATTERY_WIDGETS,
  ENERGY_WIDGETS,
  DRIVING_WIDGETS,
  CHARGING_WIDGETS,
  CLIMATE_WIDGETS,
  TIRE_WIDGETS,
  SECURITY_WIDGETS,
  COMMAND_WIDGETS,
  MEDIA_WIDGETS,
  TELEMETRY_WIDGETS,
  ANALYTICS_WIDGETS,
  ALERT_WIDGETS,
  AUTOMATION_WIDGETS,
  SYSTEM_WIDGETS,
  MAP_WIDGETS,
};
