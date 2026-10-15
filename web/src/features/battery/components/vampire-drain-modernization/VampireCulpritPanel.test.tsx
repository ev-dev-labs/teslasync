import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { request } from '@/api/client';
import type { ParkTruth, VampireSplit } from '@/types/teslaPhysics';
import english from '@/i18n/en.json';
import batteryEnglish from '@/i18n/en/locale-battery.json';
import { VampireCulpritPanel } from './VampireCulpritPanel';

vi.mock('@/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn() };
});

const park: ParkTruth = {
  confirmed_park: true, park_confirmed_at: null, neutral_rolling: false,
  sentry_reported: false, sentry_counted: false,
  cabin_overheat_reported: false, cabin_overheat_counted: false,
  preconditioning_reported: false, preconditioning_counted: false,
  rejected: [], honesty: 'Current confirmed Park.',
};
const split: VampireSplit = {
  vehicle_id: 7, complete_plugged: [], unplugged: [],
  complete_plugged_drain_pct: null, unplugged_drain_pct: 6,
  honesty: 'Historical unplugged windows.',
};
const mockedRequest = vi.mocked(request);
let parkData: ParkTruth;
let splitData: VampireSplit;
let parkFail: boolean;
let splitFail: boolean;

function mount(vehicleId: string | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <VampireCulpritPanel vehicleId={vehicleId} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  parkData = { ...park };
  splitData = { ...split };
  parkFail = false;
  splitFail = false;
  mockedRequest.mockReset();
  mockedRequest.mockImplementation(async path => {
    if (path.startsWith('/physics/park-truth')) {
      if (parkFail) throw new Error('Park unavailable');
      return parkData as never;
    }
    if (path.startsWith('/physics/vampire')) {
      if (splitFail) throw new Error('Split unavailable');
      return splitData as never;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
});

describe('VampireCulpritPanel observed loss, not attributed cause', () => {
  it('ships the observed-loss limitation and labels in canonical and lazy-loaded English', () => {
    expect(english.vampireDrain.observed).toEqual({
      causeLimit: 'Cause unconfirmed. Current Park truth is independent of historical SOC-loss windows; correlation does not establish a cause or a residual after Sentry/HVAC.',
      causeUnconfirmed: 'Cause unconfirmed',
      currentParkTruth: 'Current Park truth; not historical cause attribution',
      summary: 'Independent Park and historical SOC-loss evidence',
      title: 'Observed parked SOC loss',
      unpluggedSocLoss: 'Observed unplugged SOC loss',
    });
    expect(batteryEnglish.vampireDrain.observed).toEqual(english.vampireDrain.observed);
  });

  it('labels populated unplugged loss without diagnosing a leak or residual from current Off states', async () => {
    mount('7');
    expect(await screen.findByText('6.00%')).toBeInTheDocument();
    expect(screen.getByText('Observed unplugged SOC loss')).toBeInTheDocument();
    expect(screen.getAllByText('Off')).toHaveLength(3);
    expect(screen.getByText('Cause unconfirmed')).toBeInTheDocument();
    expect(screen.getAllByText(/Current Park truth is independent of historical SOC-loss windows/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/genuine leak|12V upkeep|remains after Sentry\/HVAC|Tonight:/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Independent Park and historical SOC-loss evidence' }))
      .toHaveTextContent('Current confirmed Park. Historical unplugged windows.');
  });

  it.each(['sentry', 'cabin_overheat', 'preconditioning'] as const)(
    'preserves current %s On and both populated loss values without attributing historical loss to it',
    async mode => {
      parkData = { ...park, [`${mode}_reported`]: true, [`${mode}_counted`]: true };
      splitData = { ...split, complete_plugged_drain_pct: 2 };
      mount('7');
      expect(await screen.findByText('6.00%')).toBeInTheDocument();
      expect(screen.getByText('2.00%')).toBeInTheDocument();
      expect(screen.getByText('On')).toBeInTheDocument();
      expect(screen.getAllByText('Off')).toHaveLength(2);
      expect(screen.getByText('Cause unconfirmed')).toBeInTheDocument();
      expect(screen.queryByText(/Tonight:|Turn Sentry off|Turn it off|Leave it on|Unplug after/)).not.toBeInTheDocument();
    },
  );

  it('preserves a measured zero as zero, with cause still unconfirmed', async () => {
    splitData = { ...split, unplugged_drain_pct: 0 };
    mount('7');
    expect(await screen.findByText('0.00%')).toBeInTheDocument();
    expect(screen.getByText('Observed unplugged SOC loss')).toBeInTheDocument();
    expect(screen.getByText('Cause unconfirmed')).toBeInTheDocument();
  });

  it('keeps historical loss when current Park fails without manufacturing Off states', async () => {
    parkFail = true;
    mount('7');
    await screen.findByRole('button', { name: 'Retry Confirmed Park evidence' });
    expect(await screen.findByText('6.00%')).toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    expect(screen.getByText('Cause unconfirmed')).toBeInTheDocument();
  });

  it('keeps populated Park readings on split failure and recovers only the split source', async () => {
    splitFail = true;
    mount('7');
    const retry = await screen.findByRole('button', { name: 'Retry Plugged and unplugged drain' });
    expect(screen.getAllByText('Off')).toHaveLength(3);
    const parkCalls = mockedRequest.mock.calls.filter(([path]) => path.startsWith('/physics/park-truth')).length;
    splitFail = false;
    fireEvent.click(retry);
    expect(await screen.findByText('6.00%')).toBeInTheDocument();
    expect(mockedRequest.mock.calls.filter(([path]) => path.startsWith('/physics/park-truth'))).toHaveLength(parkCalls);
  });

  it('keeps missing loss unknown instead of displaying zero', async () => {
    splitData = { ...split, unplugged_drain_pct: null };
    mount('7');
    await waitFor(() => expect(screen.getAllByText('Off')).toHaveLength(3));
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.getAllByText('No confirmed measurement supplied by this source.').length).toBeGreaterThan(0);
  });

  it('preserves the panel and vehicle setup action without scoped requests when no vehicle is selected', () => {
    mount(undefined);
    const panel = screen.getByTestId('vampire-culprits');
    expect(within(panel).getByText('Select a vehicle to view its vampire drain.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Set up TeslaSync' })).toHaveAttribute('href', '/onboarding');
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
