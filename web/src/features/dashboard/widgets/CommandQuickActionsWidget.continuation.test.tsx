import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(variables: { vehicleId: number; command: string }, options: { onSettled: () => void }) => void>(),
  mode: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));
vi.mock('@/api/hooks/useVehicleCommand', () => ({ useVehicleCommand: () => ({ mutate: mocks.send }) }));
vi.mock('@/hooks/useOperationalMode', () => ({ useOperationalMode: mocks.mode }));

import CommandQuickActionsWidget from './CommandQuickActionsWidget';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode.mockReturnValue({ canWrite: true, writeBlockReason: null });
});

describe('quick action label and command preservation', () => {
  it('retains all eight wide commands, wraps their labels and disables every command while one is running', () => {
    render(<MemoryRouter><CommandQuickActionsWidget vehicleId={42} size={{ cols: 3, rows: 2 }} /></MemoryRouter>);
    const buttons = ['Lock', 'Unlock', 'Climate on', 'Climate off', 'Frunk', 'Horn', 'Flash', 'Trunk']
      .map(name => screen.getByRole('button', { name }));
    fireEvent.click(buttons[1]);
    expect(mocks.send).toHaveBeenCalledWith({ vehicleId: 42, command: 'unlock' }, expect.objectContaining({ onSettled: expect.any(Function) }));
    buttons.forEach(button => expect(button).toBeDisabled());
    expect(buttons[1]).toHaveAttribute('aria-busy', 'true');
    act(() => { mocks.send.mock.calls[0][1].onSettled(); });
    buttons.forEach(button => expect(button).not.toBeDisabled());
  });

  it('preserves compact command availability without relying on visible text', () => {
    render(<MemoryRouter><CommandQuickActionsWidget vehicleId={42} size={{ cols: 1, rows: 1 }} /></MemoryRouter>);
    ['Lock', 'Unlock', 'Climate on', 'Climate off'].forEach(name => expect(screen.getByRole('button', { name })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Frunk' })).not.toBeInTheDocument();
  });

  it('keeps the write guard and its explanation without sending a real command', () => {
    mocks.mode.mockReturnValue({ canWrite: false, writeBlockReason: 'Read-only operating mode' });
    render(<MemoryRouter><CommandQuickActionsWidget vehicleId={42} size={{ cols: 3, rows: 2 }} /></MemoryRouter>);
    const button = screen.getByRole('button', { name: 'Unlock' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Read-only operating mode');
    fireEvent.click(button);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
