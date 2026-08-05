import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { CancelReservationDialog } from './CancelReservationDialog';

const reset = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, value),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useFleetOps', () => ({
  useUpdateFleetReservation: () => ({
    mutate: vi.fn(),
    reset,
    isPending: false,
    isError: true,
    error: {
      name: 'ApiError',
      status: 409,
      message: 'record changed since it was loaded',
    },
  }),
}));

it('offers refresh when cancellation loses an optimistic version race', () => {
  const onClose = vi.fn();
  const onRefresh = vi.fn();
  render(
    <CancelReservationDialog
      item={{
        id: 3,
        vehicle_id: 7,
        vehicle_display_name: 'Pool Y',
        driver_id: null,
        driver_display_name: null,
        cost_center_id: null,
        cost_center_name: null,
        title: 'Airport run',
        purpose: null,
        starts_at: '2026-08-06T10:00:00Z',
        ends_at: '2026-08-06T11:00:00Z',
        status: 'confirmed',
        version: 4,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      }}
      onClose={onClose}
      onCancelled={vi.fn()}
      onRefresh={onRefresh}
    />,
  );
  expect(screen.getByRole('dialog', { name: 'Record changed' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  expect(reset).toHaveBeenCalledOnce();
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});
