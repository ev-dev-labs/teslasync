import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import VampireDrainPage from '../../pages/VampireDrainPage';
import { request } from '@/api/client';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

// Keep the production frame/exports/table owner; reuse the repository tooltip/legend doubles.
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: PropsWithChildren) => <div>{children}</div> };
});
vi.mock('@/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn() };
});
const scope = vi.hoisted(() => ({ vehicleId: 7 as number | null }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: scope.vehicleId }),
}));
// Narrator integration is covered by the existing byte-preserved dedicated tests.
vi.mock('@/components/ai/AIVampireDrainExplanation', () => ({
  AIVampireDrainExplanation: () => null,
}));

const stats = {
  vehicle_id: 7, event_count: 1, total_observed_hours: 6,
  avg_drain_pct_per_day: 2.34, median_drain_pct_per_day: 1.81,
  p95_drain_pct_per_day: 4.56, sample_window_days: 30,
};
const event = {
  started_at: '2025-06-03T20:00:00Z', ended_at: '2025-06-04T02:00:00Z',
  duration_hours: 6, start_battery_pct: 90, end_battery_pct: 84,
  drain_pct: 6, drain_pct_per_day: 8, ambient_temp_c_avg: 25,
};
const split = {
  vehicle_id: 7, complete_plugged: [], unplugged: [{
    kind: 'unplugged', started_at: event.started_at, ended_at: event.ended_at,
    duration_s: 21600, start_soc_pct: 90, end_soc_pct: 84,
    drain_pct: 6, park_confirmed: true,
  }],
  complete_plugged_drain_pct: null, unplugged_drain_pct: 6,
  honesty: 'Observed unplugged windows only.',
};
const park = {
  confirmed_park: true, park_confirmed_at: null, neutral_rolling: false,
  sentry_reported: false, sentry_counted: false,
  cabin_overheat_reported: false, cabin_overheat_counted: false,
  preconditioning_reported: false, preconditioning_counted: false,
  rejected: [], honesty: 'Confirmed Park.',
};
const mockedRequest = vi.mocked(request);
let statsFail = false;
let eventsFail = false;
let parkFail = false;
let splitFail = false;

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  // The same actual Router persists through rerender; never rerender an unwrapped page.
  function Wrapper({ children }: PropsWithChildren) {
    return <MemoryRouter initialEntries={['/vampire-drain']}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>;
  }
  return { client, ...render(<VampireDrainPage />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  mockedRequest.mockReset();
  scope.vehicleId = 7;
  statsFail = false;
  eventsFail = false;
  parkFail = false;
  splitFail = false;
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mockedRequest.mockImplementation(async path => {
    if (path.startsWith('/vampire-drain/stats')) {
      if (statsFail) throw new Error('private server stack: stats');
      return stats as never;
    }
    if (path.startsWith('/vampire-drain?')) {
      if (eventsFail) throw new Error('private server stack: events');
      return { vehicle_id: 7, events: [event] } as never;
    }
    if (path.startsWith('/physics/park-truth')) {
      if (parkFail) throw new Error('private server stack: park');
      return park as never;
    }
    if (path.startsWith('/physics/vampire')) {
      if (splitFail) throw new Error('private server stack: split');
      return split as never;
    }
    return {} as never;
  });
});

describe('Vampire drain modernization — authored runtime preservation', () => {
  it('retries only the failed event source from the sessions empty state', async () => {
    eventsFail = true;
    mount();
    const heading = screen.getByRole('heading', { name: 'Drain sessions', exact: true });
    const sessions = heading.closest('[data-card]') as HTMLElement;
    const retry = await within(sessions).findByRole('button', { name: 'Retry Parked-drain events' });
    await within(screen.getByRole('region', { name: 'Drain summary' })).findByText('2.34');
    const statsCalls = mockedRequest.mock.calls.filter(([path]) => path.startsWith('/vampire-drain/stats')).length;
    eventsFail = false;
    fireEvent.click(retry);
    await within(sessions).findByRole('table', { name: 'Drain sessions' });
    expect(mockedRequest.mock.calls.filter(([path]) => path.startsWith('/vampire-drain/stats'))).toHaveLength(statsCalls);
    expect(screen.queryByText(/private server stack/)).not.toBeInTheDocument();
  });

  it('retains the cache operands, cancellation, both named figures and all seven desktop columns', async () => {
    const { client } = mount();
    const table = await screen.findByRole('table', { name: 'Drain sessions' });
    for (const name of ['Started', 'Duration', 'Start %', 'End %', 'Loss %', 'Rate %/day', 'Ambient']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(name.replace('%', '%')) })).toBeInTheDocument();
    }
    expect(client.getQueryData(['vampire-drain-stats', '7'])).toEqual(stats);
    expect(client.getQueryData(['vampire-drain-events', '7'])).toEqual({ vehicle_id: 7, events: [event] });
    const call = mockedRequest.mock.calls.find(([path]) => path === '/vampire-drain?vehicle_id=7&limit=200');
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    const trend = screen.getByRole('figure', { name: 'Drain rate trend' });
    const daily = screen.getByRole('figure', { name: 'Daily drain while parked' });
    expect(within(trend).getByRole('button', { name: 'Export chart' })).toBeInTheDocument();
    expect(within(daily).getByRole('button', { name: 'Export chart' })).toBeInTheDocument();
    expect(within(trend).getByRole('heading', { name: 'Drain rate trend' })).toBeInTheDocument();
    expect(within(daily).getByRole('heading', { name: 'Daily drain while parked' })).toBeInTheDocument();
  });

  it('keeps cached stats, charts and table visible after a failed refresh with source-specific recovery', async () => {
    mount();
    await screen.findByRole('table', { name: 'Drain sessions' });
    statsFail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh vampire drain' }));
    await screen.findByRole('button', { name: 'Retry Vampire-drain statistics' });
    expect(screen.getByRole('table', { name: 'Drain sessions' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Drain rate trend' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Drain summary' });
    expect(within(summary).getByText('2.34')).toBeInTheDocument();
    expect(screen.queryByText(/private server stack/)).not.toBeInTheDocument();
    statsFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry Vampire-drain statistics' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry Vampire-drain statistics' })).not.toBeInTheDocument());
  });

  it('shows a friendly fatal alert without blanking independent successful events', async () => {
    statsFail = true;
    mount();
    await screen.findByRole('button', { name: 'Retry Vampire-drain statistics' });
    const summary = screen.getByRole('region', { name: 'Drain summary' });
    expect(within(summary).getByRole('alert')).toHaveTextContent('Vampire-drain statistics could not be loaded.');
    expect(screen.getByRole('table', { name: 'Drain sessions' })).toBeInTheDocument();
    expect(screen.queryByText(/private server stack/)).not.toBeInTheDocument();
  });

  it('preserves split evidence when Park fails; missing Park does not render a false Off', async () => {
    parkFail = true;
    mount();
    await screen.findByRole('button', { name: 'Retry Confirmed Park evidence' });
    const culprits = screen.getByTestId('vampire-culprits');
    await waitFor(() => expect(within(culprits).getByText('6.00')).toBeInTheDocument());
    expect(within(culprits).queryByText('Off')).not.toBeInTheDocument();
    expect(within(culprits).getAllByText('No confirmed measurement supplied by this source.').length).toBeGreaterThan(0);
  });

  it('preserves Park evidence when split fails and retries only the named split source', async () => {
    splitFail = true;
    mount();
    const culprits = screen.getByTestId('vampire-culprits');
    await within(culprits).findByRole('button', { name: 'Retry Plugged and unplugged drain' });
    expect(within(culprits).getAllByText('Off')).toHaveLength(3);
    expect(within(culprits).getByText('Confirmed Park. Sentry, cabin overheat, and preconditioning only count after confirmed Park. Drain percentages are parked windows, not invented watt-hours.')).toBeInTheDocument();
    const parkCalls = mockedRequest.mock.calls.filter(([path]) => path.startsWith('/physics/park-truth')).length;
    splitFail = false;
    fireEvent.click(within(culprits).getByRole('button', { name: 'Retry Plugged and unplugged drain' }));
    await within(culprits).findByText('6.00');
    expect(mockedRequest.mock.calls.filter(([path]) => path.startsWith('/physics/park-truth'))).toHaveLength(parkCalls);
  });

  it('retains every section and issues no scoped requests when the vehicle is cleared on the same Router', async () => {
    const mounted = mount();
    await screen.findByRole('table', { name: 'Drain sessions' });
    const before = mockedRequest.mock.calls.length;
    scope.vehicleId = null;
    mounted.rerender(<VampireDrainPage />);
    expect(screen.getByRole('region', { name: 'Drain summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Daily drain and reduction tips' })).toBeInTheDocument();
    expect(screen.getByText('Disable Sentry Mode when parked at home to save 1–2 % per day.')).toBeInTheDocument();
    expect(screen.getByTestId('vampire-split')).toBeInTheDocument();
    expect(screen.getByTestId('vampire-culprits')).toBeInTheDocument();
    for (const panel of ['vampire-split', 'vampire-culprits']) {
      expect(within(screen.getByTestId(panel)).getByRole('link', { name: 'Set up TeslaSync' }))
        .toHaveAttribute('href', '/onboarding');
    }
    expect(mockedRequest.mock.calls.length).toBe(before);
  });

  it('keeps observed-hours session context separate from the explanatory stat tooltip', async () => {
    mount();
    await screen.findByRole('table', { name: 'Drain sessions' });
    const summary = screen.getByRole('region', { name: 'Drain summary' });
    const observed = within(summary).getByText('Observed hours');
    const tile = observed.closest('[data-stat]');
    expect(tile?.querySelector('[data-stat-context]')).toHaveTextContent('1 sessions');
    fireEvent.focus(observed);
    const tooltip = within(observed.parentElement as HTMLElement).getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Total parked, non-charging hours sampled for the drain statistics.');
    expect(tooltip).not.toHaveTextContent('1 sessions');
    fireEvent.blur(observed);
  });
});
