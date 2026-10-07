import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import type { VisitedPlaceCandidate } from '@/api/types';
import english from '@/i18n/en.json';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    })) as typeof window.matchMedia;
  }
});

const { mockRequest, toastMock } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Override the global fallback-only mock: this regression needs catalog lookup.
vi.mock('react-i18next', async () =>
  vi.importActual<typeof import('react-i18next')>('react-i18next'),
);

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockRequest };
});

vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => true }));

vi.mock('@/components/feedback/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback/Toast')>(
    '@/components/feedback/Toast',
  );
  return { ...actual, useToast: () => toastMock, useOptionalToast: () => toastMock };
});

vi.mock('@/components/maps', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    MapContainer: ({ children }: { children?: import('react').ReactNode }) =>
      React.createElement('div', { 'data-testid': 'draft-map' }, children),
    MapTileLayer: () => null,
    MapInvalidator: () => null,
    GeofenceDrawer: () => null,
  };
});

// The directory and summary have their own coverage in the retained page tests.
vi.mock('@/features/maps/components/charging-places', () => ({
  ChargingPlacesWorkspace: () => null,
}));
vi.mock('../components/operationalbrief-all/MapsOperationalBrief', () => ({
  MapsOperationalBrief: () => null,
}));

vi.mock('@/components/ai', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const { Button } = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return {
    AISuggestNewGeofences: ({
      locationId,
      onApplyDraft,
    }: {
      locationId: number;
      onApplyDraft: (draft: {
        name: string;
        latitude: number;
        longitude: number;
        radius: number;
      }) => void;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'draft-assistant', 'data-location-id': locationId },
        React.createElement(
          Button,
          {
            disabled: locationId <= 0,
            onClick: () => onApplyDraft({
              name: 'Depot draft',
              latitude: 41,
              longitude: -76,
              radius: 200,
            }),
          },
          'Apply test draft',
        ),
      ),
  };
});

import GeofencesPage from './GeofencesPage';

const EXPECTED_HINT = 'Choose a visited location to propose a zone; review the draft before saving.';
const LEGACY_HINT = 'Paste a visited-location ID from the locations page to draft a zone around it.';
const CANDIDATE: VisitedPlaceCandidate = {
  id: 42,
  name: 'Depot',
  latitude: 41,
  longitude: -76,
  visit_count: 2,
  charge_count: 0,
  first_charge_at: null,
  last_visited: '2026-09-22T12:00:00Z',
};

const clients: QueryClient[] = [];

function createCalls() {
  return mockRequest.mock.calls.filter(([path, options]) =>
    path === '/geofences' && (options as { method?: string } | undefined)?.method === 'POST',
  );
}

beforeEach(() => {
  mockRequest.mockReset();
  window.localStorage.clear();
  mockRequest.mockImplementation((path: string, options?: { method?: string }) => {
    if (path === '/geofences/visited-candidates') return Promise.resolve([CANDIDATE]);
    if (path === '/geofences' && options?.method === 'POST') {
      return Promise.resolve({ id: '99', name: 'Depot draft' });
    }
    if (path === '/geofences' || path === '/vehicles') return Promise.resolve([]);
    return Promise.resolve({});
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});

describe('GeofencesPage canonical selection copy', () => {
  it('uses canonical English for the visited-place Select and keeps drafts reviewable before saving', async () => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      resources: { en: { translation: english } },
      interpolation: { escapeValue: false },
    });

    // Parent integration must supply the new leaf, not just the JSX fallback.
    expect(i18n.exists('geofences.aiSuggest.selectHint')).toBe(true);
    expect(i18n.t('geofences.aiSuggest.selectHint')).toBe(EXPECTED_HINT);
    expect(i18n.t('geofences.aiSuggest.pickHint')).toBe(LEGACY_HINT);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    clients.push(client);
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/geofences']}>
            <GeofencesPage />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    expect(screen.getByText(EXPECTED_HINT)).toBeInTheDocument();
    expect(screen.queryByText(LEGACY_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText(/paste a visited-location ID/i)).not.toBeInTheDocument();

    const picker = screen.getByRole('combobox', {
      name: i18n.t('geofences.aiSuggest.pickLocation'),
    });
    expect(await within(picker).findByRole('option', { name: 'Depot' })).toHaveValue('42');
    expect(picker).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Apply test draft' })).toBeDisabled();

    fireEvent.change(picker, { target: { value: '42' } });
    expect(picker).toHaveValue('42');
    expect(screen.getByTestId('draft-assistant')).toHaveAttribute('data-location-id', '42');
    expect(createCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Apply test draft' }));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('geofences.createTitle') });
    expect(within(dialog).getByLabelText(i18n.t('geofences.formName'))).toHaveValue('Depot draft');
    expect(within(dialog).getByLabelText(i18n.t('geofences.latitude'))).toHaveValue(41);
    expect(within(dialog).getByLabelText(i18n.t('geofences.longitude'))).toHaveValue(-76);
    expect(within(dialog).getByLabelText(i18n.t('geofences.radiusMeters'))).toHaveValue(200);
    expect(createCalls()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common.create') }));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const options = createCalls()[0][1] as { body: string };
    expect(JSON.parse(options.body)).toMatchObject({
      name: 'Depot draft',
      latitude: 41,
      longitude: -76,
      radius: 200,
      category: 'custom',
      is_charging_location: false,
    });
  });
});
