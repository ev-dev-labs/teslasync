import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LifetimeStats } from '@/api/hooks/useAnalytics';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { LifetimeContextBrief } from './LifetimeContextBrief';

const preferences = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi', legacyHelp: false }));
vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return (key === 'error.retry' ? 'Erneut versuchen'
        : preferences.legacyHelp && key === 'help.lifetime.avgEfficiency'
        ? text.replace('{{unit}}', 'Wh/km') : text)
        .replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: preferences.distance, speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  } }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    precision: 2, fmtInt: (raw: number) => String(Math.round(raw)),
    fmtNumber: (raw: number) => raw.toFixed(2),
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});

const stats: LifetimeStats = {
  total_drives: 500, total_distance_km: 12000, total_driving_hours: 200, longest_drive_km: 300,
  highest_speed_kmh: 100, avg_efficiency_wh_km: 155, total_charge_sessions: 100,
  total_energy_kwh: 2000, total_charging_hours: 80, total_charging_cost: 200,
  gas_equivalent_cost: 500, total_savings: 100, co2_offset_kg: 250, trees_equivalent: 2.5,
  earth_circumferences: 2.5, moon_trips: 0.032, days_on_road: 88.4, homes_equivalent_days: 12.3,
  first_drive_date: null, ownership_days: 365, most_active_day_of_week: 'Saturday', most_active_hour: 0,
  longest_drive_record: { value: 300, date: null }, highest_speed_record: { value: 100, date: null },
  max_charge_record: { value: 50, date: null }, achievements: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  preferences.distance = 'km';
  preferences.legacyHelp = false;
});

describe('LifetimeContextBrief efficiency preferences', () => {
  it.each([
    ['km', false, '155.00 Wh/km'],
    ['mi', false, '249.45 Wh/mi'],
    ['mi', true, '249.45 Wh/mi'],
  ] as const)('matches %s display and help (legacy catalog: %s)', (distance, legacyHelp, expected) => {
    preferences.distance = distance;
    preferences.legacyHelp = legacyHelp;
    const original = JSON.stringify(stats);
    const { container } = render(<MemoryRouter><LifetimeContextBrief mode="activity" stats={stats}
      source={deriveDataState({ data: stats })} onRetry={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByText('Saturday')).toBeInTheDocument();
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByText('88.40')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    const metrics = vi.mocked(useOperationalMetrics).mock.calls.at(-1)?.[0];
    expect(metrics?.find(metric => metric.occurrenceId === 'lifetime-activity-efficiency')?.rawValue).toBe(0.155);
    const unit = distance === 'mi' ? 'Wh/mi' : 'Wh/km';
    const help = `Average energy used per unit distance across the whole driving history (${unit}). Lower is better — temperature, speed, and terrain are the main drivers.`;
    fireEvent.focus(screen.getByRole('button', { name: 'More info about Avg efficiency' }));
    expect(screen.getAllByText(help).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText(help)).toBeInTheDocument();
    expect(JSON.stringify(stats)).toBe(original);
  });

  it.each([0, -1])('keeps non-positive efficiency %s unavailable', efficiency => {
    const { container } = render(<MemoryRouter><LifetimeContextBrief mode="activity"
      stats={{ ...stats, avg_efficiency_wh_km: efficiency }} source={deriveDataState({ data: stats })}
      onRetry={vi.fn()} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="lifetime-activity-efficiency"]')).toBeNull();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const efficiencyDialog = screen.getByRole('dialog');
    expect(within(efficiencyDialog).queryByRole('group', { name: 'Avg efficiency' })).not.toBeInTheDocument();
    expect(within(efficiencyDialog).getByText(/^1 empty fields? (is|are) hidden\.$/)).toBeInTheDocument();
    fireEvent.keyDown(efficiencyDialog, { key: 'Escape' });
  });

  it.each([['funfacts', 4], ['environment', 3]] as const)('preserves the populated %s band', (mode, count) => {
    const { container } = render(<MemoryRouter><LifetimeContextBrief mode={mode} stats={stats}
      source={deriveDataState({ data: stats, error: new Error('refresh failed') })} onRetry={vi.fn()} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(count);
    expect(screen.getAllByText('Refresh failed; retained evidence')).toHaveLength(1);
    assertOperationalBriefDisclosure(document.body, 'Refresh failed; retained evidence');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  const retry = vi.fn();
  function brief(query: DataStateSource<LifetimeStats | null>) {
    const source = deriveDataState(query, {
      provenance: 'historical', maxAgeMs: 3600000, now: () => 7200000,
      unavailable: query.isSuccess && query.data === null,
    });
    return <MemoryRouter><LifetimeContextBrief mode="funfacts" stats={source.data}
      source={source} onRetry={retry} /></MemoryRouter>;
  }

  describe('LifetimeContextBrief source trust', () => {
    it('shows active loading without authoritative empty or fabricated zero', () => {
      const { container } = render(brief({ isPending: true, isLoading: true, fetchStatus: 'fetching' }));
      assertOperationalBriefDisclosure(document.body, 'Loading evidence');
      expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
      expect(container.querySelector('[data-empty-state]')).toBeNull();
      expect(container.querySelector('[data-value-state="value"]')).toBeNull();
    });

    it('does not call a paused initial request empty or busy', () => {
      const { container } = render(brief({ isPending: true, fetchStatus: 'paused' }));
      assertOperationalBriefDisclosure(document.body, 'Request paused');
      expect(container.querySelector('[data-empty-state]')).toBeNull();
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      expect(screen.queryByText('No driving data yet')).not.toBeInTheDocument();
      expect(screen.queryByText('Returned evidence')).not.toBeInTheDocument();
    });

    it('shows authoritative empty only for a successful empty response', () => {
      const { container } = render(brief({ data: null, isSuccess: true }));
      expect(container.querySelector('[data-empty-state]')).not.toBeNull();
      expect(screen.getAllByText('No driving data yet').length).toBeGreaterThan(0);
    });

    it('keeps successful zero measurements rather than declaring them empty', () => {
      const { container } = render(brief({ data: {
        ...stats, earth_circumferences: 0, moon_trips: 0, trees_equivalent: 0, homes_equivalent_days: 0,
      }, isSuccess: true }));
      assertOperationalBriefDisclosure(document.body, 'Returned evidence');
      expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
      expect(container.querySelector('[data-empty-state]')).toBeNull();
    });

    it('retains values, localized individual retry, and recovers without losing the brief', () => {
      const { rerender } = render(brief({ data: stats, error: new Error('offline'), dataUpdatedAt: 6600000 }));
      expect(screen.getAllByText('Refresh failed; retained evidence')).toHaveLength(1);
      assertOperationalBriefDisclosure(document.body, 'Refresh failed; retained evidence');
      expect(screen.getByText('250.00%')).toBeInTheDocument();
      assertOperationalBriefDisclosure(document.body, 'Loaded 10 minutes ago');
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      expect(retry).toHaveBeenCalledTimes(1);
      rerender(brief({ data: stats, isFetching: true, fetchStatus: 'fetching', dataUpdatedAt: 6600000 }));
      assertOperationalBriefDisclosure(document.body, 'Refreshing retained evidence');
      expect(screen.getByText('250.00%')).toBeInTheDocument();
      rerender(brief({ data: stats, isSuccess: true, dataUpdatedAt: 7200000 }));
      assertOperationalBriefDisclosure(document.body, 'Returned evidence');
      assertOperationalBriefDisclosure(document.body, 'Loaded 0 minutes ago');
      expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).not.toBeInTheDocument();
    });

    it.each([
      [{ fetchStatus: 'paused' as const, dataUpdatedAt: 6600000 }, 'Request paused'],
      [{ dataUpdatedAt: 1 }, 'Evidence may be outdated'],
    ])('retains blocked and aged values without inventing a failure', (query, label) => {
      render(brief({ ...query, data: stats }));
      assertOperationalBriefDisclosure(document.body, label);
      expect(screen.getByText('250.00%')).toBeInTheDocument();
      expect(screen.queryByText('Refresh failed; retained evidence')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      expect(retry).toHaveBeenCalledTimes(1);
    });

    it('provides local recovery for a fatal initial failure', () => {
      render(brief({ error: new Error('offline'), isError: true }));
      assertOperationalBriefDisclosure(document.body, 'Evidence unavailable');
      fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }));
      expect(retry).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('No driving data yet')).not.toBeInTheDocument();
    });
  });
});
