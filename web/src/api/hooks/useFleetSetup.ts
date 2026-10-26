import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { onboardingKeys } from './useOnboarding';
import { fleetSetupKeys } from './fleetSetupKeys';
export { fleetSetupKeys } from './fleetSetupKeys';

/**
 * Operator setup against Tesla Fleet API + Fleet Telemetry.
 *
 * These endpoints already exist under `/dev-tools/*` (Dev Tools keeps them).
 * Fleet Setup is the guided Settings surface that calls the same contracts
 * with typed hooks instead of the ad-hoc `apiFetch` helper.
 */

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

/**
 * Tesla's System Behavior uses an elapsed interval plus a changed value, then
 * batches in 500ms buckets (developer.tesla.com/docs/fleet-api/fleet-telemetry).
 * Zero is not 0.5 seconds. Our subscribe handler accepts Go integer seconds,
 * so fractional/negative cadences are unsupported.
 */
export function fleetTelemetrySubscribeBody(input: FleetTelemetrySubscribeInput): Record<string, unknown> {
  const body: Record<string, unknown> = { vins: input.vins };
  const hostname = input.hostname?.trim();
  if (hostname) body.hostname = hostname;
  if (input.port && input.port > 0) body.port = input.port;
  const ca = input.ca?.trim();
  if (ca) body.ca = ca;
  if (input.fields?.length) body.fields = input.fields;

  const validateInterval = (value: number, field: string) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field}: unsupported telemetry interval; expected a non-negative whole number of seconds`);
    }
  };
  const intervals = { ...input.field_intervals };
  for (const [field, interval] of Object.entries(intervals)) {
    validateInterval(interval, field);
  }
  if (input.interval_seconds !== undefined) {
    validateInterval(input.interval_seconds, 'interval_seconds');
    if (input.interval_seconds === 0) {
      // internal/api/devtools/handler.go defaults a master zero to 10, but
      // forwards per-field zero verbatim. Preserve that exact protocol value.
      if (!input.fields?.length) {
        throw new Error('Zero telemetry interval requires explicit fields; the default-field subscription cannot preserve zero');
      }
      for (const field of input.fields) {
        if (intervals[field] === undefined) intervals[field] = 0;
      }
    } else {
      body.interval_seconds = input.interval_seconds;
    }
  }
  if (Object.keys(intervals).length) body.field_intervals = intervals;
  return body;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function requiredBool(value: unknown, source: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${source} response: expected a boolean status`);
  }
  return value;
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
    has_valid_token: requiredBool(
      row.has_valid_token ?? row.hasValidToken ?? row.authenticated,
      'Fleet API info',
    ),
    public_key_url: asString(row.public_key_url ?? row.publicKeyUrl),
    hostname: asString(row.hostname) || undefined,
  };
}

export function normalizePublicKeyStatus(raw: unknown): PublicKeyStatus {
  const row = asRecord(raw);
  const created = row.created_at ?? row.createdAt;
  return {
    configured: requiredBool(row.configured, 'public key status'),
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
    queryFn: async ({ signal }) => {
      const raw = await request<unknown>('/dev-tools/fleet-api-info', { signal });
      normalizeFleetApiInfo(raw);
      return raw;
    },
    select: normalizeFleetApiInfo,
    ...queryPolicy('reference'),
  });
}

export function usePublicKeyStatus() {
  return useQuery({
    queryKey: fleetSetupKeys.publicKey,
    queryFn: async ({ signal }) => {
      const raw = await request<unknown>('/dev-tools/public-key-status', { signal });
      normalizePublicKeyStatus(raw);
      return raw;
    },
    select: normalizePublicKeyStatus,
    ...queryPolicy('reference'),
  });
}

export function useFleetTelemetryConfig(vin: string) {
  const trimmed = vin.trim();
  return useQuery({
    queryKey: fleetSetupKeys.telemetryConfig(trimmed),
    queryFn: async ({ signal }) => {
      const raw = await request<Record<string, unknown>>(
        `/dev-tools/fleet-telemetry-config?vin=${encodeURIComponent(trimmed)}`,
        { signal },
      );
      if (telemetryConfigSummary(raw).hostname === null) {
        throw new Error('Invalid telemetry config response: expected a configuration envelope');
      }
      return raw;
    },
    enabled: trimmed.length > 0,
    ...queryPolicy('operational'),
  });
}

export interface TelemetryConfigSummary {
  hostname: string | null;
  port: number | null;
  field_count: number | null;
}

/**
 * Tesla's fleet_telemetry_config payload is nested under `response.config`
 * (and camelCaseKeys may duplicate keys). Root config and flat config are also
 * supported. An explicit null/empty config means "not subscribed"; an unknown
 * envelope has a null hostname, not an authoritative empty string.
 */
export function telemetryConfigSummary(raw: unknown): TelemetryConfigSummary {
  const row = asRecord(raw);
  const response = asRecord(row.response);
  const unknown = { hostname: null, port: null, field_count: null };
  const nested = 'config' in row || 'config' in response;
  const configRaw = 'config' in row ? row.config : response.config;
  if (nested && configRaw === null) {
    return { hostname: '', port: null, field_count: 0 };
  }
  if (nested && (!configRaw || typeof configRaw !== 'object' || Array.isArray(configRaw))) {
    return unknown;
  }
  const config = nested ? asRecord(configRaw) : row;
  if (!nested && typeof config.hostname !== 'string') return unknown;
  if ('hostname' in config && typeof config.hostname !== 'string') return unknown;
  if (!('hostname' in config) && Object.keys(config).length > 0) return unknown;
  const fields = config.fields ?? response.fields ?? row.fields;
  if (fields != null && typeof fields !== 'object') return unknown;
  const fieldCount =
    fields && typeof fields === 'object' && !Array.isArray(fields)
      ? Object.keys(fields as object).length
      : Array.isArray(fields)
        ? fields.length
        : 0;
  const portRaw = config.port ?? row.port;
  if (portRaw != null && (typeof portRaw !== 'number' || !Number.isFinite(portRaw))) return unknown;
  const port =
    typeof portRaw === 'number' && Number.isFinite(portRaw) ? portRaw : null;
  return {
    hostname: asString(config.hostname),
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
 * `errors` array, a response array, or a bare array. Only a parsed empty array
 * means the VIN is clean; malformed envelopes/rows fail the query so retained
 * errors and their last-success timestamp survive a failed refresh.
 */
export function telemetryErrorsFrom(raw: unknown): FleetTelemetryError[] {
  const row = asRecord(raw);
  const response = asRecord(row.response);
  const list = 'errors' in row ? row.errors
    : 'errors' in response ? response.errors
      : Array.isArray(row.response) ? row.response : raw;
  if (!Array.isArray(list)) {
    throw new Error('Invalid telemetry errors response: expected an errors array');
  }
  return list.map((item) => {
    const err = asRecord(item);
    const normalized = {
      code: pickErrorString(err, ['error_code', 'code', 'name', 'topic']),
      message: pickErrorString(err, ['error_message', 'message', 'body', 'description']),
      timestamp: pickErrorString(err, ['reported_at', 'timestamp', 'created_at', 'ts']),
    };
    if (!normalized.code && !normalized.message) {
      throw new Error('Invalid telemetry errors response: expected an error code or message');
    }
    return normalized;
  });
}

export function useFleetTelemetryErrors(vin: string) {
  const trimmed = vin.trim();
  return useQuery({
    queryKey: fleetSetupKeys.telemetryErrors(trimmed),
    queryFn: async ({ signal }) => {
      const raw = await request<unknown>(
        `/dev-tools/fleet-telemetry-errors?vin=${encodeURIComponent(trimmed)}`,
        { signal },
      );
      telemetryErrorsFrom(raw);
      return raw;
    },
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
      const body = fleetTelemetrySubscribeBody(input);
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
