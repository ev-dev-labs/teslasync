import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Geofence } from '@/api/types';

vi.mock('@/api/client', () => ({ request: vi.fn() }));
vi.mock('@/api/hooks/_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { request } from '@/api/client';
import { PlaceEventAlertsPanel } from './PlaceEventAlertsPanel';

const place: Geofence = {
  id: 7,
  name: 'Home',
  polygon_wkt: '',
  enabled: true,
  alert_on_entry: false,
  alert_on_exit: true,
  origin: 'manual',
  needs_review: false,
  is_charging_location: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  latitude: 40,
  longitude: -75,
  radius: 75,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PlaceEventAlertsPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

it('updates entry alerts without overwriting exit alerts', async () => {
  vi.mocked(request).mockImplementation(async (url, options) => {
    if (url === '/geofences' && !options?.method) return [place];
    if (url === '/geofences/7' && options?.method === 'PUT') return { ...place, alert_on_entry: true };
    throw new Error(`Unexpected request: ${url}`);
  });
  renderPanel();

  fireEvent.click(await screen.findByRole('switch', { name: 'Alert on entry: Home' }));

  await waitFor(() => expect(request).toHaveBeenCalledWith('/geofences/7', expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({ alert_on_entry: true }),
  })));
  expect(screen.getByRole('switch', { name: 'Alert on exit: Home' })).toBeChecked();
});

it('does not allow alerts on places awaiting review', async () => {
  vi.mocked(request).mockResolvedValue([{ ...place, needs_review: true, enabled: false }]);
  renderPanel();

  expect(await screen.findByRole('switch', { name: 'Alert on entry: Home' })).toBeDisabled();
  expect(screen.getByRole('switch', { name: 'Alert on exit: Home' })).toBeDisabled();
  expect(screen.getByText('Review this place before enabling its notifications.')).toBeInTheDocument();
});
