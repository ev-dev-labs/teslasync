import type { FleetEndpoint, PollingConfig } from '@/api/hooks/useSettings';

export type FleetPermission = 'access' | 'smart' | 'auto';
export type FleetPermissionChange = 'keep' | 'enable' | 'disable';
export type FleetPermissionChanges = Record<FleetPermission, FleetPermissionChange>;

export const keepFleetPermissions: FleetPermissionChanges = { access: 'keep', smart: 'keep', auto: 'keep' };
export const fleetGuideRoutes: Readonly<Record<string, readonly string[]>> = {
  commute: ['vehicles.connectivity', 'command.navigation_request', 'vehicles.wake_up'],
  solar: ['energy.site_info', 'energy.live_status'],
  backup: ['energy.site_info', 'energy.live_status'],
};

export function planFleetPermissions(config: PollingConfig, endpointKeys: readonly string[], changes: FleetPermissionChanges) {
  const keys = new Set(endpointKeys);
  const fleet_endpoints = { ...config.fleet_endpoints };
  const auto_endpoints = { ...config.auto_endpoints };
  const smart_endpoints = config.smart_endpoints == null ? undefined : { ...config.smart_endpoints };
  const counts = { access: 0, smart: 0, auto: 0 };
  const skipped = { smartNoAccess: 0, autoNoAccess: 0, notPollable: 0 };
  const changed: FleetEndpoint[] = [];
  const writes: FleetEndpoint[] = [];
  const hasEdits = Object.values(changes).some(change => change !== 'keep');
  for (const route of config.endpoint_catalog) {
    const { key, pollable, method } = route;
    if (!hasEdits || !keys.has(key)) continue;
    const wasAllowed = Boolean(fleet_endpoints[key]);
    const wasSmart = Boolean(smart_endpoints?.[key]);
    const wasAuto = Boolean(auto_endpoints[key]) && pollable;
    const access = changes.access === 'keep' ? wasAllowed : changes.access === 'enable';
    const smart = Boolean(smart_endpoints && access && (changes.smart === 'enable' || (changes.smart === 'keep' && wasAllowed && wasSmart)));
    const auto = Boolean(pollable && access && (changes.auto === 'enable' || (changes.auto === 'keep' && wasAllowed && wasAuto)));
    if (smart_endpoints && changes.smart === 'enable' && !access) skipped.smartNoAccess++;
    if (!pollable && changes.auto !== 'keep') skipped.notPollable++;
    else if (changes.auto === 'enable' && !access) skipped.autoNoAccess++;

    if (wasAllowed !== access) { counts.access++; fleet_endpoints[key] = access; }
    if (smart_endpoints && wasSmart !== smart) {
      counts.smart++;
      if (smart) smart_endpoints[key] = true;
      else delete smart_endpoints[key];
    }
    if (pollable && wasAuto !== auto) { counts.auto++; auto_endpoints[key] = auto; }
    if (wasAllowed !== access || wasSmart !== smart || wasAuto !== auto) changed.push(route);
    if (method !== 'GET' && ((!wasAllowed && access) || (!wasSmart && smart))) writes.push(route);
  }
  return { config: { ...config, fleet_endpoints, auto_endpoints, smart_endpoints }, counts, skipped, changed, writes };
}
