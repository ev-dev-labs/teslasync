import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActivityOverview } from '../activity-timeline/ActivityOverview';
import { MyActivityKpiBand } from '../my-activity/MyActivityKpiBand';
import { RepairCaseStats } from '../RepairCaseStats';
import { RepairDiagnosisOverview } from '../RepairDiagnosisOverview';
import { CommandCenterHero } from '../command-center/CommandCenterHero';
import { BackgroundWorkersCard } from '../status/BackgroundWorkersCard';
import { TeslaApiUsageCard } from '../status/TeslaApiUsageCard';
import type { APIUsage } from '@/api/types';
import type { ActivityItem } from '@/types/activity';

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback: string, vars?: Record<string, unknown>) =>
      (fallback ?? key).replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match),
  }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: {
    locale: 'en-US', decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', currency_symbol: '$',
  }, settingsUnavailable: false }),
}));
afterEach(cleanup);

const item: ActivityItem = {
  id: 'alerts:1', kind: 'alert', severity: 'critical', occurred_at: '2026-01-15T12:00:00Z',
  vehicle_id: 7, title: 'Critical alert', summary: 'Recorded alert', status: 'recorded', source_table: 'alerts', source_id: 1,
};
const usage: APIUsage = {
  current: { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z',
    signals: 150000, commands: 1000, data_requests: 500, wakes: 50, estimated_usd: 4 },
  history: [], rate_source: 'https://developer.tesla.com/', disclaimer: 'Not an invoice.',
};

describe('retained production summary contracts', () => {
  it('keeps range totals distinct from loaded page and event-type counts in the real review drawer', () => {
    const { container } = render(<MemoryRouter><ActivityOverview items={[item]} total={75} offset={50}
      loading={false} error={false} available retained scope="2026-01-01 – 2026-02-01" /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(2);
    expect(container.querySelector('[data-operational-metric="range-total"] [data-operational-value]')).toHaveTextContent('75');
    expect(container.querySelector('[data-operational-metric="page-events"] [data-operational-value]')).toHaveTextContent('1');
    expect(container.querySelector('[data-operational-metric="alert"] [data-operational-value]')).toHaveTextContent('1');
    expect(screen.getAllByText('Retained source')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Review details' })[0]);
    expect(within(screen.getByRole('dialog')).getByText('2026-01-01 – 2026-02-01')).toBeInTheDocument();
  });

  it('distinguishes unavailable personal activity from successful empty activity without hiding labels', () => {
    const { container, rerender } = render(<MemoryRouter><MyActivityKpiBand isLoading={false} available={false} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(5);
    rerender(<MemoryRouter><MyActivityKpiBand isLoading={false}
      kpis={{ total: 0, activeDays: 0, actionTypes: 0, entitiesTouched: 0, lastActivityTs: null }} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('0');
    expect(container.querySelector('[data-operational-metric="last-active"]')).toHaveAttribute('data-value-state', 'missing');
  });

  it('preserves repair hints, scan-limit warning, and the source-specific blocked meaning', () => {
    const { container } = render(<MemoryRouter>
      <RepairCaseStats />
      <RepairDiagnosisOverview totalSuggestions={0} driveSuggestions={0} chargingSuggestions={0} blocked={null} truncated />
    </MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="case-3"]')).toHaveAttribute('data-value-state', 'missing');
    expect(container.querySelector('[data-operational-metric="suggestions"] [data-operational-value]')).toHaveTextContent('0');
    expect(container.querySelector('[data-operational-metric="blocked"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Active review workload')).toBeInTheDocument();
    expect(screen.getAllByText(/scan hit its per-request limit/)).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Review details' })[0]);
    expect(within(screen.getByRole('dialog')).getByText('Active review workload')).toBeInTheDocument();
  });

  it('keeps SI range and temperature display and distinguishes false access state from missing readings', () => {
    const { container } = render(<MemoryRouter><CommandCenterHero
      vehicle={{ id: 7, vin: 'TEST-VIN', display_name: 'Selected car', model: 'Model 3', state: 'online', updated_at: '2026-01-01T00:00:00Z' }}
      state={{
        vehicle_id: 7, state: null, latitude: null, longitude: null, speed: null, power: null,
        battery_level: 0, rated_range: 400000, ideal_range: null, odometer: null, inside_temp: 21,
        outside_temp: null, is_climate_on: null, is_charging: null, charger_power: null,
        charge_rate: null, time_to_full_charge: null, is_locked: false, sentry_mode: null, software_version: null,
      }}
      stateTrust={undefined} loading={false} error={new Error('background refresh')} onRetry={vi.fn()}
    /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="battery"] [data-operational-value]')).toHaveTextContent('0.00%');
    expect(container.querySelector('[data-operational-metric="range"] [data-operational-value]')).toHaveTextContent('400 km');
    expect(container.querySelector('[data-operational-metric="cabin"] [data-operational-value]')).toHaveTextContent('21 °C');
    expect(container.querySelector('[data-operational-metric="access"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="access"] [data-operational-value]')).toHaveTextContent('Unlocked');
    expect(screen.getByText(/Retained source/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('400 km')).toBeInTheDocument();
  });

  it('keeps genuine empty worker denominators at zero while unavailable health is missing', () => {
    const { container, rerender } = render(<MemoryRouter><BackgroundWorkersCard health={undefined} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3);
    rerender(<MemoryRouter><BackgroundWorkersCard health={{ workers: [], total: 0, healthy_count: 0 }} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(3);
    expect(container.querySelector('[data-operational-metric="instances"] [data-operational-value]')).toHaveTextContent('0/0');
  });

  it('retains recorded cycle counts, denomination, categories, and source caveats on refresh failure', () => {
    const { container } = render(<MemoryRouter><TeslaApiUsageCard apiUsage={usage} now={0} error={new Error('refresh failed')} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="estimate"] [data-operational-value]')).toHaveTextContent('$4.00');
    expect(container.querySelector('[data-operational-metric="api-calls"] [data-operational-value]')).toHaveTextContent('1,550');
    expect(screen.getByText('Commands · 1,000 / $1')).toBeInTheDocument();
    expect(screen.getByText('Data requests · 500 / $1')).toBeInTheDocument();
    expect(screen.getByText('Wakes · 50 / $1')).toBeInTheDocument();
    expect(screen.getByText(/Retained source/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('1,550')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getAllByText(/not a Tesla invoice/).length).toBeGreaterThan(0);
  });
});
