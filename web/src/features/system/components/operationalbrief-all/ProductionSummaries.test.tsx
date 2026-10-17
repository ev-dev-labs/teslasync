import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
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
    // Support every call form the subjects use: (key, fallback, vars),
    // (key, vars with defaultValue), and counted plurals.
    t: (key: string, fallback?: unknown, opts?: unknown) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const vars = (
        opts && typeof opts === 'object'
          ? opts
          : fallback && typeof fallback === 'object'
            ? fallback
            : undefined
      ) as Record<string, unknown> | undefined;
      let resolved = template;
      if (vars && typeof vars.defaultValue === 'string') resolved = vars.defaultValue;
      if (vars && typeof vars.count === 'number') {
        if (vars.count === 1 && typeof vars.defaultValue_one === 'string') resolved = vars.defaultValue_one;
        else if (typeof vars.defaultValue_other === 'string') resolved = vars.defaultValue_other;
      }
      if (!vars) return resolved;
      return resolved.replace(/{{(\w+)}}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match);
    },
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

// Open one brief's real Review-details dialog, run assertions against it,
// then close it again.
function withDrawer(strip: HTMLElement, assert: (dialog: HTMLElement) => void): void {
  expect(screen.queryByRole('dialog'), 'Finish any open interaction before inspecting evidence').not.toBeInTheDocument();
  fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  try {
    assert(dialog);
  } finally {
    fireEvent.keyDown(dialog, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

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
    const briefs = [...container.querySelectorAll('[data-operational-brief]')];
    assertOperationalBriefDisclosure(briefs[0], 'Retained source');
    assertOperationalBriefDisclosure(briefs[1], 'Retained source');
    fireEvent.click(within(screen.getByRole('region', { name: 'Range and page counts' })).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog', { name: 'Range and page counts details' })).getByText('2026-01-01 – 2026-02-01', { selector: '[data-drawer-header] span' })).toBeInTheDocument();
  });

  it('distinguishes unavailable personal activity from successful empty activity without hiding labels', () => {
    const { container, rerender } = render(<MemoryRouter><MyActivityKpiBand isLoading={false} available={false} /></MemoryRouter>);
    // All five readings are omitted tiles with a counted drawer explanation.
    const brief = container.querySelector('[data-operational-brief]') as HTMLElement;
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(brief).toHaveTextContent('No metric values are available yet.');
    assertOperationalMetricUnavailable(brief, 'Total actions');
    assertOperationalMetricUnavailable(brief, 'Active days');
    assertOperationalMetricUnavailable(brief, 'Action types');
    assertOperationalMetricUnavailable(brief, 'Entities touched');
    assertOperationalMetricUnavailable(brief, 'Last active');
    withDrawer(brief, (dialog) => {
      expect(within(dialog).getByText('5 empty fields are hidden.')).toBeInTheDocument();
    });
    rerender(<MemoryRouter><MyActivityKpiBand isLoading={false}
      kpis={{ total: 0, activeDays: 0, actionTypes: 0, entitiesTouched: 0, lastActivityTs: null }} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('0');
    assertOperationalMetricUnavailable(container.querySelector('[data-operational-brief]'), 'Last active');
  });

  it('preserves repair hints, scan-limit warning, and the source-specific blocked meaning', () => {
    const { container, rerender } = render(<MemoryRouter>
      <RepairCaseStats />
      <RepairDiagnosisOverview totalSuggestions={0} driveSuggestions={0} chargingSuggestions={0} blocked={null} truncated />
    </MemoryRouter>);
    const repairBriefs = [...container.querySelectorAll('[data-operational-brief]')];
    assertOperationalMetricUnavailable(repairBriefs[0], 'Active cases');
    expect(container.querySelector('[data-operational-metric="suggestions"] [data-operational-value]')).toHaveTextContent('0');
    assertOperationalMetricUnavailable(repairBriefs[1], 'Blocked');
    // The hint lives in the case-stats drawer group; the truncated scope
    // lives in the diagnosis drawer header while the callout keeps one face
    // copy.
    expect(screen.getAllByText(/scan hit its per-request limit/)).toHaveLength(1);
    assertOperationalBriefDisclosure(repairBriefs[1], 'scan hit its per-request limit', { contains: true });
    // The unknown tile's hint has no drawer group under the visible-metrics
    // contract; pin the measured tile's hint with a populated render.
    rerender(<MemoryRouter>
      <RepairCaseStats statistics={{ total: 3, open: 2, in_review: 1, quarantined: 0 }} />
      <RepairDiagnosisOverview totalSuggestions={0} driveSuggestions={0} chargingSuggestions={0} blocked={null} truncated />
    </MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="case-3"] [data-operational-value]')).toHaveTextContent('3');
    withDrawer(container.querySelectorAll('[data-operational-brief]')[0] as HTMLElement, (dialog) => {
      expect(within(dialog).getByRole('group', { name: 'Active cases' })).toHaveTextContent('Active review workload');
    });
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
    expect(container.querySelector('[data-operational-metric="cabin"] [data-operational-value]')).toHaveTextContent('21°C');
    expect(container.querySelector('[data-operational-metric="access"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="access"] [data-operational-value]')).toHaveTextContent('Unlocked');
    assertOperationalBriefDisclosure(container.querySelector('[data-operational-brief]'), 'Retained source', { contains: true });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('400 km')).toBeInTheDocument();
  });

  it('keeps genuine empty worker denominators at zero while unavailable health is missing', () => {
    const { container, rerender } = render(<MemoryRouter><BackgroundWorkersCard health={undefined} /></MemoryRouter>);
    const workerBrief = container.querySelector('[data-operational-brief]') as HTMLElement;
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(workerBrief).toHaveTextContent('No metric values are available yet.');
    assertOperationalMetricUnavailable(workerBrief, 'Worker types');
    assertOperationalMetricUnavailable(workerBrief, 'Instances');
    assertOperationalMetricUnavailable(workerBrief, 'Replicated');
    withDrawer(workerBrief, (dialog) => {
      expect(within(dialog).getByText('3 empty fields are hidden.')).toBeInTheDocument();
    });
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
    assertOperationalBriefDisclosure(container.querySelector('[data-operational-brief]'), 'Retained source', { contains: true });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('1,550')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getAllByText(/not a Tesla invoice/).length).toBeGreaterThan(0);
  });
});
