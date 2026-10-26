// Shared invalidation keys must not pull the route-only setup hooks into the shell.
export const fleetSetupKeys = {
  apiInfo: ['fleet-setup', 'fleet-api-info'] as const,
  publicKey: ['fleet-setup', 'public-key-status'] as const,
  telemetryConfig: (vin: string) => ['fleet-setup', 'telemetry-config', vin] as const,
  telemetryErrors: (vin: string) => ['fleet-setup', 'telemetry-errors', vin] as const,
};
