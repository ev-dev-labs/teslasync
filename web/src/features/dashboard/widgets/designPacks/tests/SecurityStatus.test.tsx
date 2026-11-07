import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PACK_APPEARANCES, type PackId } from '../types';

const mocks = vi.hoisted(() => ({
  pack: vi.fn<() => PackId>(() => 'classic'), security: vi.fn(),
}));
vi.mock('../PackBoundary', async importOriginal => ({
  ...await importOriginal<typeof import('../PackBoundary')>(), usePackPresentation: mocks.pack,
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 42 }] }), useSecurityLatest: mocks.security,
}));
import SecurityStatusWidget from '../../SecurityStatusWidget';

function query<T>(data: T, error: Error | null = null) {
  return { data, error, isError: error != null, isLoading: false, isFetching: false,
    isStale: false, dataUpdatedAt: Date.now(), refetch: vi.fn() };
}
function mount() {
  return render(<MemoryRouter><SecurityStatusWidget vehicleId={42} size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
}
beforeEach(() => { vi.clearAllMocks(); });

describe.each(Object.entries(PACK_APPEARANCES))('security %s', (id, appearance) => {
  it('preserves independent lock, sentry, door and window evidence', async () => {
    mocks.pack.mockReturnValue(id as PackId);
    mocks.security.mockReturnValue(query({ locked: false, sentry_mode: true, door_state: true }));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(`[data-status-appearance="${appearance}"]`)).not.toBeNull());
    const root = container.querySelector(`[data-status-appearance="${appearance}"]`);
    expect(root).not.toBeNull();
    expect(root).toHaveTextContent('Sentry');
    expect(root).toHaveTextContent('Active');
    expect(root).toHaveTextContent('Doors');
    expect(root).toHaveTextContent('1 Open');
    expect(root).toHaveTextContent('Windows');
    expect(root).toHaveTextContent('—');
    expect(root).not.toHaveTextContent('All closed');
    expect(mocks.security).toHaveBeenCalledWith(42, 5_000);
  });

  it('does not turn a wholly unknown cached snapshot into a secured vehicle', async () => {
    mocks.pack.mockReturnValue(id as PackId);
    mocks.security.mockReturnValue(query({ locked: null, sentry_mode: null }, new Error('refresh failed')));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(`[data-status-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
    expect(screen.queryByText('Unlocked')).not.toBeInTheDocument();
    expect(screen.queryByText('All closed')).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });
});
