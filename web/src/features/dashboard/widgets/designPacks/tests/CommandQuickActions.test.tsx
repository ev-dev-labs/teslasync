import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PACK_APPEARANCES, type PackId } from '../types';

const mocks = vi.hoisted(() => ({
  pack: vi.fn<() => PackId>(() => 'classic'),
  mode: vi.fn(),
  send: vi.fn<(variables: { vehicleId: number; command: string }, options: { onSettled: () => void }) => void>(),
}));
vi.mock('../PackBoundary', async importOriginal => ({
  ...await importOriginal<typeof import('../PackBoundary')>(), usePackPresentation: mocks.pack,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 42 }] }) }));
vi.mock('@/api/hooks/useVehicleCommand', () => ({ useVehicleCommand: () => ({ mutate: mocks.send }) }));
vi.mock('@/hooks/useOperationalMode', () => ({ useOperationalMode: mocks.mode }));
import CommandQuickActionsWidget from '../../CommandQuickActionsWidget';

const labels = ['Unlock', 'Climate', 'Frunk', 'Trunk', 'Flash', 'Honk'];
const widget = <MemoryRouter><CommandQuickActionsWidget vehicleId={42} size={{ cols: 3, rows: 2 }} /></MemoryRouter>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode.mockReturnValue({ canWrite: true, writeBlockReason: null });
});

describe.each(Object.entries(PACK_APPEARANCES))('quick actions %s', (id, appearance) => {
  it('keeps all six commands, pending state, feedback and settle recovery', async () => {
    mocks.pack.mockReturnValue(id as PackId);
    const { container } = render(widget);
    await waitFor(() => expect(container.querySelector(`[data-actions-appearance="${appearance}"]`)).not.toBeNull());
    const buttons = labels.map(name => screen.getByRole('button', { name }));
    fireEvent.click(buttons[0]);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith({ vehicleId: 42, command: 'unlock' }, expect.objectContaining({ onSettled: expect.any(Function) }));
    buttons.forEach(button => expect(button).toBeDisabled());
    expect(buttons[0]).toHaveAttribute('aria-busy', 'true');
    expect(buttons[0].querySelector('.animate-spin')).not.toBeNull();
    act(() => { mocks.send.mock.calls[0][1].onSettled(); });
    buttons.forEach(button => expect(button).not.toBeDisabled());
  });

  it('preserves the write guard and its explanation without dispatching', async () => {
    mocks.pack.mockReturnValue(id as PackId);
    mocks.mode.mockReturnValue({ canWrite: false, writeBlockReason: 'Read-only operating mode' });
    render(widget);
    const button = await screen.findByRole('button', { name: 'Unlock' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Read-only operating mode');
    fireEvent.click(button);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

it('does not reset or duplicate a pending command when the presentation changes', async () => {
  mocks.pack.mockReturnValue('v1');
  const view = render(widget);
  await waitFor(() => expect(view.container.querySelector('[data-actions-appearance="studio"]')).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Frunk' }));
  mocks.pack.mockReturnValue('v7');
  view.rerender(<MemoryRouter><CommandQuickActionsWidget vehicleId={42} size={{ cols: 3, rows: 2 }} /></MemoryRouter>);
  await waitFor(() => expect(view.container.querySelector('[data-actions-appearance="pixel"]')).not.toBeNull());
  const running = screen.getByRole('button', { name: 'Frunk' });
  expect(running).toBeDisabled();
  expect(running).toHaveAttribute('aria-busy', 'true');
  expect(running.querySelector('.animate-spin')).not.toBeNull();
  expect(mocks.send).toHaveBeenCalledOnce();
});
