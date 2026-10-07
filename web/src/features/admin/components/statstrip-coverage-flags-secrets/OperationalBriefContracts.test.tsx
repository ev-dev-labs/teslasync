import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { FleetTelemetryCoverageResponse } from '@/api/types';
import type { FeatureFlagChange, FeatureFlagChangesResponse, FeatureFlagsListResponse } from '@/types/admin-diagnostics';
import type { SecretRotationStatus } from '@/types/admin-operator-confidence';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { CoverageOperationalBrief, coverageMetrics } from './CoverageOperationalBrief';
import { FeatureFlagsOperationalBrief, featureFlagMetrics } from './FeatureFlagsOperationalBrief';
import { secretRotationMetrics } from './SecretRotationOperationalBrief';

vi.mock('react-i18next', async () => {
  const { createInstance: create } = await import('i18next');
  const instance = create();
  await instance.init({ lng: 'en', fallbackLng: 'en', resources: {} });
  return { useTranslation: () => ({ t: instance.t, i18n: instance }) };
});
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/components/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, Tooltip: ({ children }: { children: ReactNode }) => <>{children}</> };
});
const translation = createInstance();
void translation.init({ lng: 'en', fallbackLng: 'en', resources: {}, initAsync: false });
const t = translation.t;
const preferences: MetricPreferences = {
  units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' },
  currency: { kind: 'symbol', value: '$' },
};
afterEach(cleanup);

const coverage: FleetTelemetryCoverageResponse = {
  categories: [{ category: 'driving', total_fields: 2, destinations: { signal_log: 2 }, fields: [
    { field: 'VehicleSpeed', destination: 'signal_log', column: '', also_signal_log: false, subscribed: true },
    { field: 'BrakePedal', destination: 'drive_telemetry', column: 'brake_pedal', also_signal_log: true, subscribed: false },
  ] }],
  destination_totals: { signal_log: 2, drive_telemetry: 1 },
  orphan_fields: ['UnroutedProtoField'],
};

describe('coverage shared OperationalBrief contract', () => {
  it('retains raw catalogue counts and percentage denominator, not fan-out totals', () => {
    const metrics = coverageMetrics(coverage, t);
    expect(metrics.map(metric => metric.rawValue)).toEqual([1, 2, 1, 1, 1, 50]);
    expect(metrics.map(metric => metric.metricId)).toEqual(['count', 'count', 'count', 'count', 'count', 'percent']);
    expect(metrics[5]?.context).toBe('1 subscribed / 2 routed fields');
    expect(coverageMetrics(undefined, t).every(metric => metric.rawValue === null)).toBe(true);
    expect(coverageMetrics({ categories: [], destination_totals: {}, orphan_fields: [] }, t)
      .map(metric => metric.rawValue)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('uses the actual renderer with configuration provenance and retained measurements', () => {
    const { rerender } = render(<MemoryRouter><CoverageOperationalBrief query={{ data: coverage, dataUpdatedAt: 1 }} /></MemoryRouter>);
    const strip = screen.getByTestId('coverage-summary');
    expect(strip).toHaveAttribute('data-operational-brief');
    expect(strip.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(strip.querySelector('[data-operational-metric="coverage"] [data-operational-value]')).toHaveTextContent('50');
    expect(screen.getByText('1 subscribed / 2 routed fields')).toBeInTheDocument();
    expect(screen.getByText(/not per-vehicle telemetry/)).toBeInTheDocument();
    rerender(<MemoryRouter><CoverageOperationalBrief query={{ data: coverage, error: new Error('snapshot refresh failed') }} /></MemoryRouter>);
    expect(strip.closest('[data-retained]')).toHaveAttribute('data-retained', 'true');
    expect(strip.querySelectorAll('[data-value-state="value"]')).toHaveLength(6);
    expect(screen.getByRole('alert')).toHaveTextContent('snapshot refresh failed');
    rerender(<MemoryRouter><CoverageOperationalBrief query={{ error: new Error('initial failure') }} /></MemoryRouter>);
    expect(strip.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
  });

  it('opens the shared review drawer with the coverage denominator and package provenance', async () => {
    render(<MemoryRouter><CoverageOperationalBrief query={{ data: coverage }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('1 subscribed / 2 routed fields')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/routing.yaml and teslaconfig.Builder/).length).toBeGreaterThan(0);
  });
});

describe('feature flags shared OperationalBrief contract', () => {
  const flags: FeatureFlagsListResponse = { count: 7, flags: [
    { key: 'yes', value: true }, { key: 'no', value: false },
    { key: 'object', value: {} }, { key: 'array', value: [] },
    { key: 'number', value: 0 }, { key: 'string', value: '' }, { key: 'null', value: null },
  ] };
  const changes: FeatureFlagChangesResponse = { count: 0, flag_key: '', limit: 50, rows: [] };
  it('keeps every value type, both boolean values, empty audits and unavailable audit counts distinct', () => {
    const metrics = featureFlagMetrics(flags.flags, changes.rows, t);
    expect(metrics.map(metric => metric.rawValue)).toEqual([7, 2, 2, 0, 0, 0]);
    expect(metrics.every(metric => metric.metricId === 'count')).toBe(true);
    expect(metrics[0]?.context).toBe('2 boolean values · 1 number values · 1 string values · 1 object values · 1 array values · 1 null values');
    expect(featureFlagMetrics(flags.flags, undefined, t).slice(3).every(metric => metric.rawValue === null)).toBe(true);
    expect(metrics[3]?.context).toContain('limit 50');
  });

  it('retains the independent registry when the audit feed fails, with a working audit retry', () => {
    const retry = vi.fn();
    render(<MemoryRouter><FeatureFlagsOperationalBrief flags={{ data: flags }}
      changes={{ error: new Error('audit unavailable'), refetch: retry }} /></MemoryRouter>);
    const strip = screen.getByTestId('feature-flags-summary');
    expect(strip.querySelectorAll('[data-value-state="value"]')).toHaveLength(3);
    expect(strip.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3);
    expect(strip).toHaveTextContent('limit 50');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('counts deletions and distinct trimmed non-empty actors only within the returned audit subset', () => {
    const audit = [' operator ', 'operator', '', 'second'].map((actor, index): FeatureFlagChange => ({
      id: index + 1, changed_at: '2026-10-01T00:00:00Z', actor, actor_ip: '',
      flag_key: 'test.flag', operation: index < 2 ? 'delete' : 'set',
      old_value: null, new_value: null, reason: 'test', trace_id: '',
    }));
    const metrics = featureFlagMetrics(undefined, audit, t);
    expect(metrics.map(metric => metric.rawValue)).toEqual([null, null, null, 4, 2, 2]);
    expect(metrics[3]?.context).toContain('not lifetime totals');
  });

  it('opens the shared review drawer with all value types and the audit subset limitation', async () => {
    render(<MemoryRouter><FeatureFlagsOperationalBrief flags={{ data: flags }} changes={{ data: changes }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByText(/2 boolean values/).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(/limit 50/).length).toBeGreaterThan(0);
  });
});

describe('secret rotation numeric source and fixed-day display contract', () => {
  const row = (overrides: Partial<SecretRotationStatus> = {}): SecretRotationStatus => ({
    kind: 'session_jwk', age_days: 0, last_rotated: '2026-10-01T00:00:00Z',
    days_to_expiry: 0, severity: 'ok', warn_days: 30, critical_days: 60, ...overrides,
  });
  const label = (secret: SecretRotationStatus) => `${secret.kind} · ${secret.target_id ?? 'deployment'}`;
  it('keeps healthy/soon/overdue counts, unknown severity denominator and source identity', () => {
    const metrics = secretRotationMetrics([
      row(), row({ age_days: 9, severity: 'warn' }),
      row({ age_days: 30, days_to_expiry: -2, severity: 'critical', target_id: 'old-key' }),
      row({ severity: 'unknown' }),
    ], t, label);
    expect(metrics.map(metric => metric.rawValue)).toEqual([4, 1, 1, 1, 30 * 86400, -2 * 86400]);
    expect(metrics[1]?.context).toBe('25% of tracked');
    expect(metrics[4]?.context).toBe('session_jwk · old-key');
    expect(metrics[5]?.context).toBe('session_jwk · old-key');
    for (const metric of metrics.slice(4)) {
      expect(metric.metricId).toBe('duration');
      expect(typeof metric.rawValue).toBe('number');
      expect(metric.display?.units?.duration).toBe('d');
    }
    const expiry = metrics[5]!;
    expect(formatMetric(expiry.metricId, expiry.rawValue, preferences, undefined, expiry.display).text).toBe('-2.00 d');
  });

  it('distinguishes missing, measured zero and absent expiry without fabricating ages', () => {
    expect(secretRotationMetrics(undefined, t, label).every(metric => metric.rawValue === null)).toBe(true);
    expect(secretRotationMetrics([], t, label).map(metric => metric.rawValue)).toEqual([0, 0, 0, 0, null, null]);
    const zero = secretRotationMetrics([row()], t, label);
    expect(zero.map(metric => metric.rawValue)).toEqual([1, 1, 0, 0, 0, 0]);
    expect(formatMetric('duration', zero[4]!.rawValue, preferences, undefined, zero[4]!.display).text).toBe('0.00 d');
    const absent = secretRotationMetrics([row({ days_to_expiry: null })], t, label);
    expect(absent[5]?.rawValue).toBeNull();
    expect(absent[5]?.context).toBe('No expiry tracked');
    const invalid = secretRotationMetrics([row({ age_days: Number.NaN, days_to_expiry: Infinity })], t, label);
    expect(invalid.slice(4).map(metric => metric.rawValue)).toEqual([null, null]);
  });
});
