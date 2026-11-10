import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { WidgetProps } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

interface VehiclesQuery extends DataStateSource<{ id: number }[]> {
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const mocks = vi.hoisted(() => ({
  send: vi.fn<(variables: { vehicleId: number; command: string }, options: { onSettled: () => void }) => void>(),
  vehicles: vi.fn<() => VehiclesQuery>(),
  mode: vi.fn<() => { canWrite: boolean; writeBlockReason: string | null }>(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('@/api/hooks/useVehicleCommand', () => ({ useVehicleCommand: () => ({ mutate: mocks.send }) }));
vi.mock('@/hooks/useOperationalMode', () => ({ useOperationalMode: mocks.mode }));

import CommandQuickActionsWidget from './CommandQuickActionsWidget';

const COMMAND_CASES = [
  { label: 'Unlock', command: 'unlock' },
  { label: 'Climate', command: 'climate_on' },
  { label: 'Frunk', command: 'actuate_frunk' },
  { label: 'Trunk', command: 'actuate_trunk' },
  { label: 'Flash', command: 'flash_lights' },
  { label: 'Honk', command: 'honk_horn' },
];
const DEFAULT_PROPS: WidgetProps = { vehicleId: 42, size: { cols: 3, rows: 2 } };

function vehiclesQuery(overrides: Partial<VehiclesQuery> = {}): VehiclesQuery {
  return {
    data: [{ id: 1 }],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function widget(packId: PackId, props: WidgetProps = DEFAULT_PROPS) {
  return <MemoryRouter><PackBoundary requestedPackId={packId}>
    <CommandQuickActionsWidget {...props} />
  </PackBoundary></MemoryRouter>;
}

async function expectPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-actions-appearance]')).toBeNull();
  } else {
    await waitFor(() => {
      expect(container.querySelector('[data-actions-appearance]'))
        .toHaveAttribute('data-actions-appearance', PACK_APPEARANCES[packId]);
    });
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.vehicles.mockReturnValue(vehiclesQuery());
  mocks.mode.mockReturnValue({ canWrite: true, writeBlockReason: null });
});

describe.each(PACK_IDS)('quick action preservation in %s', packId => {
  it('retains and dispatches all six actions, disabling concurrent commands until settlement', async () => {
    const { container } = render(widget(packId));
    await expectPresentation(container, packId);
    expect(screen.getByText('Quick actions')).toBeInTheDocument();
    const buttons = COMMAND_CASES.map(({ label }) => {
      expect(screen.getByText(label)).toBeInTheDocument();
      return screen.getByRole('button', { name: label });
    });
    for (const [index, { command }] of COMMAND_CASES.entries()) {
      fireEvent.click(buttons[index]);
      expect(mocks.send).toHaveBeenLastCalledWith(
        { vehicleId: 42, command },
        expect.objectContaining({ onSettled: expect.any(Function) }),
      );
      buttons.forEach(button => {
        expect(button).toBeDisabled();
        expect(button).toHaveClass('flex-col', 'gap-1');
      });
      expect(buttons[index]).toHaveAttribute('aria-busy', 'true');
      expect(buttons[index].querySelector('.animate-spin')).toBeInTheDocument();
      fireEvent.click(buttons[(index + 1) % buttons.length]);
      expect(mocks.send).toHaveBeenCalledTimes(index + 1);
      act(() => { mocks.send.mock.calls[index][1].onSettled(); });
      buttons.forEach(button => {
        expect(button).not.toBeDisabled();
        expect(button).not.toHaveAttribute('aria-busy');
      });
    }
  });

  it('preserves compact command availability without relying on visible text', async () => {
    const { container } = render(widget(packId, { vehicleId: 42, size: { cols: 1, rows: 1 } }));
    await expectPresentation(container, packId);
    COMMAND_CASES.forEach(({ label }) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    });
  });

  it('keeps the write guard and its explanation without sending a real command', async () => {
    mocks.mode.mockReturnValue({ canWrite: false, writeBlockReason: 'Read-only operating mode' });
    const { container } = render(widget(packId));
    await expectPresentation(container, packId);
    COMMAND_CASES.forEach(({ label }) => {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Read-only operating mode');
      fireEvent.click(button);
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('preserves discovery loading, empty and unknown states before resolving the first vehicle', async () => {
    const props: WidgetProps = { size: { cols: 3, rows: 2 } };
    mocks.vehicles.mockReturnValue(vehiclesQuery({ data: undefined, isLoading: true, dataUpdatedAt: 0 }));
    const view = render(widget(packId, props));
    expect(view.container.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();
    expect(screen.queryByText('No vehicle selected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();

    for (const data of [[], undefined]) {
      mocks.vehicles.mockReturnValue(vehiclesQuery({ data, dataUpdatedAt: 0 }));
      view.rerender(widget(packId, props));
      expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();
    }
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.vehicles.mockReturnValue(vehiclesQuery({ data: [{ id: 9 }, { id: 10 }] }));
    view.rerender(widget(packId, props));
    await expectPresentation(view.container, packId);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(mocks.send).toHaveBeenCalledWith(
      { vehicleId: 9, command: 'unlock' },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('does not replace a discovery error with empty content and preserves retry', () => {
    const refetch = vi.fn();
    mocks.vehicles.mockReturnValue(vehiclesQuery({
      data: undefined, isError: true, error: new Error('Discovery failed'), dataUpdatedAt: 0, refetch,
    }));
    const { container } = render(widget(packId, { size: { cols: 3, rows: 2 } }));
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByText('No vehicle selected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('keeps retained actions, degraded source trust and refresh recovery after discovery fails', async () => {
    const refetch = vi.fn();
    mocks.vehicles.mockReturnValue(vehiclesQuery({
      isError: true, isStale: true, error: new Error('Refresh failed'), refetch,
    }));
    const { container } = render(widget(packId, { size: { cols: 3, rows: 2 } }));
    await expectPresentation(container, packId);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    COMMAND_CASES.forEach(({ label }) => expect(screen.getByRole('button', { name: label })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Frunk' }));
    expect(mocks.send).toHaveBeenCalledWith(
      { vehicleId: 1, command: 'actuate_frunk' },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('keeps an explicit selection actionable while the fleet is unresolved', async () => {
    mocks.vehicles.mockReturnValue(vehiclesQuery({ data: undefined, isLoading: true, dataUpdatedAt: 0 }));
    const { container } = render(widget(packId));
    await expectPresentation(container, packId);
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
    fireEvent.click(screen.getByRole('button', { name: 'Trunk' }));
    expect(mocks.send).toHaveBeenCalledWith(
      { vehicleId: 42, command: 'actuate_trunk' },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });
});

it('preserves an in-flight command while switching through every presentation pack', async () => {
  const view = render(widget('classic'));
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  for (const packId of PACK_IDS) {
    view.rerender(widget(packId));
    await expectPresentation(view.container, packId);
    COMMAND_CASES.forEach(({ label }) => expect(screen.getByRole('button', { name: label })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Unlock' })).toHaveAttribute('aria-busy', 'true');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  }
  act(() => { mocks.send.mock.calls[0][1].onSettled(); });
  COMMAND_CASES.forEach(({ label }) => expect(screen.getByRole('button', { name: label })).toBeEnabled());
});
