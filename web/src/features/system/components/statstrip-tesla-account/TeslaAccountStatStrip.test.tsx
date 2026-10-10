import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import type { TeslaUserProfile } from '@/api/hooks/useUser';
import { formatDate, formatDateTime, formatRelative } from '@/lib/dateFormat';
import { TeslaAccountStatStrip } from './TeslaAccountStatStrip';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(vars?.[key] ?? `{{${key}}}`)),
}) }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km', speed: 'km/h', temperature: 'C',
    pressure: 'kPa', energy: 'kWh', duration: 's', power: 'kW', locale: 'de-DE', precision: 4 },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '€' }) }));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
const preferences: MetricPreferences = { units: { distance: 'km', speed: 'km/h', temperature: 'C',
  pressure: 'kPa', energy: 'kWh', duration: 's', power: 'kW', locale: 'de-DE', precision: 4 },
  currency: { kind: 'symbol', value: '€' } };
const PROFILE: TeslaUserProfile = Object.freeze({ id: 123456, email: 'fixture@example.test',
  full_name: 'Fixture Driver', profile_image_url: null, fetched_at: '2026-10-03T01:00:00Z',
  created_at: '2020-05-04T01:00:00Z', updated_at: '2026-10-02T01:00:00Z' });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup(overrides: Partial<Parameters<typeof TeslaAccountStatStrip>[0]> = {}) {
  return render(<TeslaAccountStatStrip profile={PROFILE} fetchedAt={PROFILE.fetched_at}
    hasData loading={false} error={null} retained={false} onRetry={vi.fn()} {...overrides} />,
  { wrapper: MemoryRouter });
}
describe('Tesla account canonical summary source preservation', () => {
  it('renders the actual OperationalBrief with source account evidence and review details', () => {
    const { container } = setup();
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-stat-strip]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument();
    expect(container).toHaveTextContent('Fleet API profile snapshot');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Account summary details' });
    expect(within(details).getByText('Account ID')).toBeInTheDocument();
    expect(within(details).getByText('#123456')).toBeInTheDocument();
    expect(details).toHaveTextContent('Fleet API identity');
    expect(details).toHaveTextContent(formatDateTime(PROFILE.created_at));
    expect(details).toHaveTextContent(formatDateTime(PROFILE.updated_at));
  });

  it('preserves exact source identifier, relative and absolute dates without browser-time freshness', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:00:00Z'));
    const { container } = setup();
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    const measurements = vi.mocked(useOperationalMetrics).mock.lastCall?.[0];
    expect(measurements?.map(metric => metric.metricId)).toEqual(['status', 'identifier', 'text', 'text']);
    expect(measurements?.[1]?.rawValue).toBe(123456);
    expect(measurements?.[1]?.display).toEqual({ identifierPrefix: '#' });
    expect(tiles.map(tile => tile.getAttribute('data-operational-metric'))).toEqual(['sync-status', 'account-id', 'member-since', 'last-updated']);
    expect(tiles[1]?.querySelector('[data-operational-value]')).toHaveTextContent('#123456');
    expect(tiles[0]).toHaveTextContent(formatRelative(PROFILE.fetched_at));
    expect(tiles[0]).toHaveTextContent(formatDateTime(PROFILE.fetched_at));
    expect(tiles[2]?.querySelector('[data-operational-value]')).toHaveTextContent(formatDate(PROFILE.created_at));
    expect(tiles[3]?.querySelector('[data-operational-value]')).toHaveTextContent(formatRelative(PROFILE.updated_at));
    expect(tiles[3]).toHaveTextContent(formatDate(PROFILE.updated_at));
    const strip = screen.getByTestId('tesla-account-summary');
    expect(strip).toHaveTextContent('Fleet API profile snapshot');
    expect(strip).toHaveTextContent(`Source fetched at ${formatDateTime(PROFILE.fetched_at)}`);
    expect(strip).not.toHaveTextContent('Source fetched at Oct 6');
    const formatted = formatMetric('identifier', PROFILE.id, preferences, undefined, { identifierPrefix: '#' });
    expect(formatted.rawValue).toBe(123456);
    expect(formatted.text).toBe('#123456');
    expect(PROFILE.id).toBe(123456);
  });

  it('distinguishes never-synced from an unavailable query, retaining missing identifiers and dates', () => {
    const retry = vi.fn();
    const { container, rerender } = setup({ profile: null, fetchedAt: null });
    expect(container).toHaveTextContent('Never synced');
    expect([...container.querySelectorAll('[data-operational-metric]')].map(tile => tile.getAttribute('data-value-state')))
      .toEqual(['value', 'missing', 'missing', 'missing']);
    expect(container).toHaveTextContent('freshness is unknown');
    rerender(<TeslaAccountStatStrip profile={null} fetchedAt={null} hasData={false}
      loading={false} error={new Error('profile unavailable')} retained={false} onRetry={retry} />);
    expect(screen.getByTestId('tesla-account-summary')).toHaveTextContent('Source unavailable');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect([...container.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'missing')).toBe(true);
    expect(container).not.toHaveTextContent('Never synced');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Review details', 'Retry']);
  });

  it('uses only the envelope source fetch timestamp when the profile has not been populated', () => {
    const { container } = setup({ profile: null });
    expect(container.querySelector('[data-operational-value]')).toHaveTextContent('Synced');
    expect(container).toHaveTextContent(formatRelative(PROFILE.fetched_at));
    expect(container.querySelectorAll('[data-operational-metric]')[1]).toHaveAttribute('data-value-state', 'missing');
  });

  it('preserves all four tiles during loading and retained refresh, and keeps read-only query retry', () => {
    const retry = vi.fn();
    const { container, rerender } = setup({ profile: null, hasData: false, fetchedAt: null, loading: true });
    expect(screen.getByTestId('tesla-account-summary')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('tesla-account-summary')).toHaveTextContent('Loading sources');
    expect([...container.querySelectorAll('[data-operational-metric]')].map(tile => tile.getAttribute('data-value-state')))
      .toEqual(['missing', 'missing', 'missing', 'missing']);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<TeslaAccountStatStrip profile={PROFILE} fetchedAt={PROFILE.fetched_at} hasData
      loading retained error={new Error('profile read failed')} onRetry={retry} />);
    expect(screen.getByTestId('tesla-account-summary')).toHaveTextContent('Retained source data');
    expect(screen.getByTestId('tesla-account-summary')).toHaveTextContent('Showing retained measurements');
    expect(screen.getByTestId('tesla-account-summary')).not.toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect([...container.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'value')).toBe(true);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Review details', 'Retry']);
  });
});
