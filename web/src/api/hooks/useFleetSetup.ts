import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { onboardingKeys } from './useOnboarding';

/**
 * Operator setup against Tesla Fleet API + Fleet Telemetry.
 *
 * These endpoints already exist under `/dev-tools/*` (Dev Tools keeps them).
 * Fleet Setup is the guided Settings surface that calls the same contracts
 * with typed hooks instead of the ad-hoc `apiFetch` helper.
 */

export const fleetSetupKeys = {
  apiInfo: ['fleet-setup', 'fleet-api-info'] as const,
  publicKey: ['fleet-setup', 'public-key-status'] as const,
  telemetryConfig: (vin: string) => ['fleet-setup', 'telemetry-config', vin] as const,
  telemetryErrors: (vin: string) => ['fleet-setup', 'telemetry-errors', vin] as const,
};

export interface FleetApiInfo {
  base_url: string;
  client_id: string;
  has_valid_token: boolean;
  public_key_url: string;
  hostname?: string;
}

export interface PublicKeyStatus {
  configured: boolean;
  fingerprint: string;
  well_known_path: string;
  created_at: string | null;
}

export interface FleetTelemetrySubscribeInput {
  vins: string[];
  hostname?: string;
  port?: number;
  ca?: string;
  fields?: string[];
  interval_seconds?: number;
  field_intervals?: Record<string, number>;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBool(value: unknown): boolean {
  return value === true;
}

/**
 * Tesla's Fleet API info payload is snake_case. camelCaseKeys may also
 * expose camelCase aliases — read snake_case first, then the alias.
 */
export function normalizeFleetApiInfo(raw: unknown): FleetApiInfo {
  const row = asRecord(raw);
  return {
    base_url: asString(row.base_url ?? row.baseUrl),
    client_id: asString(row.client_id ?? row.clientId),
    has_valid_token: asBool(
      row.has_valid_token ?? row.hasValidToken ?? row.authenticated,
    ),
    public_key_url: asString(row.public_key_url ?? row.publicKeyUrl),
    hostname: asString(row.hostname) || undefined,
  };
}

export function normalizePublicKeyStatus(raw: unknown): PublicKeyStatus {
  const row = asRecord(raw);
  const created = row.created_at ?? row.createdAt;
  return {
    configured: asBool(row.configured),
    fingerprint: asString(row.fingerprint),
    well_known_path: asString(
      row.well_known_path ?? row.wellKnownPath ?? row.wellKnownUrl,
    ),
    created_at: typeof created === 'string' && created.trim() ? created : null,
  };
}

export function useFleetApiInfo() {
  return useQuery({
    queryKey: fleetSetupKeys.apiInfo,
    queryFn: ({ signal }) => request<unknown>('/dev-tools/fleet-api-info', { signal }),
    select: normalizeFleetApiInfo,
    ...queryPolicy('reference'),
  });
}

export function usePublicKeyStatus() {
  return useQuery({
    queryKey: fleetSetupKeys.publicKey,
    queryFn: ({ signal }) =>
      request<unknown>('/dev-tools/public-key-status', { signal }),
    select: normalizePublicKeyStatus,
    ...queryPolicy('reference'),
  });
}

export function useFleetTelemetryConfig(vin: string) {
  const trimmed = vin.trim();
  return useQuery({
    queryKey: fleetSetupKeys.telemetryConfig(trimmed),
    queryFn: ({ signal }) =>
      request<Record<string, unknown>>(
        `/dev-tools/fleet-telemetry-config?vin=${encodeURIComponent(trimmed)}`,
        { signal },
      ),
    enabled: trimmed.length > 0,
    ...queryPolicy('operational'),
  });
}

export interface TelemetryConfigSummary {
  hostname: string;
  port: number | null;
  field_count: number;
}

/**
 * Tesla's fleet_telemetry_config payload is nested under `response.config`
 * (and camelCaseKeys may duplicate keys). Empty hostname means "not subscribed".
 */
export function telemetryConfigSummary(raw: unknown): TelemetryConfigSummary {
  const row = asRecord(raw);
  const response = asRecord(row.response);
  const config = asRecord(row.config ?? response.config);
  const fields = config.fields ?? response.fields ?? row.fields;
  const fieldCount =
    fields && typeof fields === 'object' && !Array.isArray(fields)
      ? Object.keys(fields as object).length
      : Array.isArray(fields)
        ? fields.length
        : 0;
  const portRaw = config.port ?? row.port;
  const port =
    typeof portRaw === 'number' && Number.isFinite(portRaw) ? portRaw : null;
  return {
    hostname: asString(config.hostname ?? row.hostname),
    port,
    field_count: fieldCount,
  };
}

export interface FleetTelemetryError {
  code: string;
  message: string;
  timestamp: string;
}

function pickErrorString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

/**
 * Tesla wraps fleet-telemetry-errors as `{response:{errors:[]}}`, a root
 * `errors` array, or a bare array. Empty + parsed means the VIN is clean.
 */
export function telemetryErrorsFrom(raw: unknown): FleetTelemetryError[] {
  if (raw == null || typeof raw !== 'object') return [];
  const row = asRecord(raw);
  const response = asRecord(row.response);
  const candidates: unknown[] = [row.errors, response.errors, row.response, raw];
  const list = candidates.find((c) => Array.isArray(c)) as unknown[] | undefined;
  if (!list) return [];
  return list.map((item) => {
    const err = asRecord(item);
    return {
      code: pickErrorString(err, ['error_code', 'code', 'name', 'topic']),
      message: pickErrorString(err, ['error_message', 'message', 'body', 'description']),
      timestamp: pickErrorString(err, ['reported_at', 'timestamp', 'created_at', 'ts']),
    };
  }).filter((item) => item.code || item.message);
}

export function useFleetTelemetryErrors(vin: string) {
  const trimmed = vin.trim();
  return useQuery({
    queryKey: fleetSetupKeys.telemetryErrors(trimmed),
    queryFn: ({ signal }) =>
      request<unknown>(
        `/dev-tools/fleet-telemetry-errors?vin=${encodeURIComponent(trimmed)}`,
        { signal },
      ),
    select: telemetryErrorsFrom,
    enabled: trimmed.length > 0,
    ...queryPolicy('operational'),
  });
}

export function useUnsubscribeFleetTelemetry() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (vin: string) => {
      const trimmed = vin.trim();
      return request<unknown>(
        `/dev-tools/fleet-telemetry-config?vin=${encodeURIComponent(trimmed)}`,
        { method: 'DELETE', requiresLiveMode: true },
      );
    },
    networkMode: 'always',
    onSuccess: (_data, vin) => {
      const trimmed = vin.trim();
      if (trimmed) {
        invalidateAndBroadcast(qc, { queryKey: fleetSetupKeys.telemetryConfig(trimmed) });
        invalidateAndBroadcast(qc, { queryKey: fleetSetupKeys.telemetryErrors(trimmed) });
      }
      invalidateAndBroadcast(qc, { queryKey: onboardingKeys.status });
      success(
        'toast.fleetSetup.unsubscribe.success',
        'Telemetry config removed on Tesla',
      );
    },
    onError: (e) =>
      error(e, 'toast.fleetSetup.unsubscribe.error', 'Failed to remove telemetry config'),
  });
}

export function useSubscribeFleetTelemetry() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (input: FleetTelemetrySubscribeInput) => {
      const body: Record<string, unknown> = {
        vins: input.vins,
      };
      const hostname = input.hostname?.trim();
      if (hostname) body.hostname = hostname;
      if (input.port && input.port > 0) body.port = input.port;
      const ca = input.ca?.trim();
      if (ca) body.ca = ca;
      if (input.fields && input.fields.length > 0) body.fields = input.fields;
      if (input.interval_seconds && input.interval_seconds > 0) {
        body.interval_seconds = input.interval_seconds;
      }
      if (input.field_intervals && Object.keys(input.field_intervals).length > 0) {
        body.field_intervals = input.field_intervals;
      }
      return request<Record<string, unknown>>('/dev-tools/fleet-telemetry-subscribe', {
        method: 'POST',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    networkMode: 'always',
    onSuccess: (_data, input) => {
      const vin = input.vins[0] ?? '';
      if (vin) {
        invalidateAndBroadcast(qc, { queryKey: fleetSetupKeys.telemetryConfig(vin) });
        invalidateAndBroadcast(qc, { queryKey: fleetSetupKeys.telemetryErrors(vin) });
      }
      invalidateAndBroadcast(qc, { queryKey: onboardingKeys.status });
      success(
        'toast.fleetSetup.subscribe.success',
        'Telemetry subscribe sent to Tesla',
      );
    },
    onError: (e) =>
      error(e, 'toast.fleetSetup.subscribe.error', 'Failed to subscribe telemetry'),
  });
}
