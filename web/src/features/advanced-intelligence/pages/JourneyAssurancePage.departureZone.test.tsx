import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import type { AppSettings } from '@/api/types';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import type { JourneyAssuranceRequest } from '@/types/advancedIntelligence';
import JourneyAssurancePage from './JourneyAssurancePage';
import { journey } from './advancedIntelligenceClosure.fixtures';

// Exercise real selection, settings, timezone, formatting, mutation, request and
// retained-publication hooks. Only fetch is replaced: no real HTTP can escape.
vi.unmock('@/hooks/useSettings');
vi.unmock('@/lib/timezone');

const scenarioPath = '/api/v1/advanced-intelligence/journey-assurance/scenarios';
const draft = '2026-01-15T12:00';
// The runner sets TZ before forking. Literal expected instants prove the
// browser-local parser rather than deriving expectations with the same parser.
const submittedInstant = '2026-01-15T20:00:00.000Z';
const browserZone = 'America/Los_Angeles';
const entryDescription = `Enter departure in your browser time zone (${browserZone}). Display time zone preferences do not change this entry.`;

let client: QueryClient;
let settings: Partial<AppSettings>;
let requests: { path: string; method: string; body: string | null }[];
let unexpectedRequests: string[];
let rejectScenario: boolean;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function departureInput(): HTMLInputElement {
  return screen.getByLabelText(/Departure/) as HTMLInputElement;
}

function runButton() {
  return screen.getByRole('button', { name: 'Run confirmed readiness assessment' });
}

function scenarioForm(): HTMLFormElement {
  const form = runButton().closest('form');
  if (!form) throw new Error('Journey scenario form is not mounted');
  return form;
}

function scenarioRequests() {
  return requests.filter(request => request.path === scenarioPath && request.method === 'POST');
}

function payload(index = 0): JourneyAssuranceRequest {
  const body = scenarioRequests()[index]?.body;
  if (!body) throw new Error('No captured synthetic scenario payload');
  return JSON.parse(body) as JourneyAssuranceRequest;
}

async function renderPage(mode: 'vehicle' | 'user' | 'utc' = 'utc') {
  settings = { ...settings, tz_display_default: mode };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/intelligence/journey-assurance?vehicle_id=7']}>
      <SelectedVehicleProvider><ToastProvider><JourneyAssurancePage /></ToastProvider></SelectedVehicleProvider>
    </MemoryRouter>
  </QueryClientProvider>);
  await waitFor(() => {
    expect(client.getQueryData(['settings'])).toMatchObject({ tz_display_default: mode });
    expect(runButton()).toBeEnabled();
  });
}

async function publishDraft() {
  fireEvent.change(departureInput(), { target: { value: draft } });
  fireEvent.click(runButton());
  await waitFor(() => expect(screen.getByRole('region', { name: 'Journey readiness assessment' })).toBeVisible());
}

async function changePreference(mode: 'vehicle' | 'user' | 'utc') {
  settings = { ...settings, tz_display_default: mode };
  await act(async () => { client.setQueryData(['settings'], settings); });
}

beforeEach(() => {
  // These assertions fail discovery/execution if the requested divergent host
  // zone was not actually applied; Intl-only spoofing would not prove Date parsing.
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(browserZone);
  expect(new Date(draft).getTimezoneOffset()).toBe(480);
  window.localStorage.clear();
  onlineManager.setOnline(true);
  requests = [];
  unexpectedRequests = [];
  rejectScenario = false;
  settings = {
    unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
    preferred_range: 'rated', language: 'en', base_cost_per_kwh: 0.12,
    api_suspended: false, theme: 'neon-cyan', mode: 'dark',
    custom_primary: '#00b4d8', custom_accent: '#e63946', gas_price_per_unit: 0,
    gas_unit: 'gallon', gas_efficiency_mpg: 25, decimal_precision: 2,
    quiet_hours_enabled: false, quiet_hours_start: '22:00', quiet_hours_end: '07:00',
    alert_digest_mode: 'instant', currency_symbol: '$', locale: 'en-US',
    tz_display_default: 'utc', timezone_user: 'Asia/Tokyo',
    tab_badge_enabled: true, critical_flash_enabled: false, ui_density: 'comfortable',
    time_format_default: 'relative', chart_palette: 'cb_safe',
    ai_mode: 'off', ai_features: {}, ai_provider_config: {}, ai_cost_cap_cents: 0,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.origin).pathname;
    const method = init?.method ?? 'GET';
    requests.push({ path, method, body: typeof init?.body === 'string' ? init.body : null });
    if (path === '/api/v1/settings' && method === 'GET') return jsonResponse(settings);
    if (path === '/api/v1/vehicles' && method === 'GET') return jsonResponse([{
      id: 7, vehicle_id: 7, vin: 'SYNTHETIC', display_name: 'Synthetic vehicle',
      model: 'Synthetic', trim_badging: '', exterior_color: '', wheel_type: '',
      state: 'online', healthy: true, timezone: 'Europe/Berlin',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    }]);
    if (path === scenarioPath && method === 'POST') {
      if (rejectScenario) return new Response(JSON.stringify({ error: 'Synthetic scenario rejected' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
      return jsonResponse(journey);
    }
    unexpectedRequests.push(`${method} ${path}`);
    throw new Error(`Unexpected HTTP boundary: ${method} ${path}`);
  }));
});

afterEach(() => {
  cleanup();
  client?.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
});

describe('Journey departure browser-local zone contract', () => {
  it.each([
    { mode: 'utc' as const, displayZone: 'UTC' },
    { mode: 'vehicle' as const, displayZone: 'Europe/Berlin' },
    { mode: 'user' as const, displayZone: 'Asia/Tokyo' },
  ])('discloses America/Los_Angeles entry independently of $mode display zone $displayZone', async ({ mode, displayZone }) => {
    await renderPage(mode);
    expect(departureInput()).toHaveAttribute('type', 'datetime-local');
    expect(departureInput()).toHaveAccessibleDescription(entryDescription);
    const hintId = departureInput().getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId ?? '')).toBeVisible();
    expect(document.getElementById(hintId ?? '')).not.toHaveTextContent(displayZone);
    expect(scenarioRequests()).toHaveLength(0);
  });

  it('submits browser-local noon as unchanged 20:00Z raw ISO with canonical SI and nullable optionals', async () => {
    await renderPage('utc');
    await publishDraft();
    expect(scenarioRequests()).toHaveLength(1);
    expect(payload()).toEqual({
      vehicle_id: 7, confirmed: true, route_distance_m: 250000,
      departure_at: submittedInstant, reserve_target_pct: 15,
      outside_temp_c: null, average_speed_mps: null, auxiliary_load_w: null,
    });
    expect(departureInput()).toHaveValue(draft);
  });

  it('renders published departure in the effective vehicle zone rather than the browser entry zone', async () => {
    await renderPage('vehicle');
    await publishDraft();
    const summary = screen.getByRole('region', { name: 'Journey readiness assessment' });
    expect(summary).toHaveTextContent('Jan 15, 2026, 09:00 PM');
    expect(summary).not.toHaveTextContent('Jan 15, 2026, 12:00 PM');
    expect(payload().departure_at).toBe(submittedInstant);
    expect(departureInput()).toHaveAccessibleDescription(entryDescription);
  });

  it('does not reinterpret a draft when display preference changes before submission', async () => {
    await renderPage('utc');
    fireEvent.change(departureInput(), { target: { value: draft } });
    await changePreference('user');
    expect(departureInput()).toHaveValue(draft);
    expect(departureInput()).toHaveAccessibleDescription(entryDescription);
    fireEvent.click(runButton());
    await waitFor(() => expect(scenarioRequests()).toHaveLength(1));
    expect(payload().departure_at).toBe(submittedInstant);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Journey readiness assessment' }))
      .toHaveTextContent('Jan 16, 2026, 05:00 AM'));
  });

  it('reformats retained published inputs after preference changes without replacing their instant or the edited draft', async () => {
    await renderPage('utc');
    await publishDraft();
    expect(screen.getByRole('region', { name: 'Journey readiness assessment' })).toHaveTextContent('Jan 15, 2026, 08:00 PM');
    fireEvent.change(departureInput(), { target: { value: '2026-02-20T08:45' } });
    await changePreference('vehicle');
    expect(departureInput()).toHaveValue('2026-02-20T08:45');
    expect(screen.getByRole('region', { name: 'Journey readiness assessment' })).toHaveTextContent('Jan 15, 2026, 09:00 PM');
    expect(scenarioRequests()).toHaveLength(1);
    expect(payload().departure_at).toBe(submittedInstant);
  });

  it.each([
    { caseName: 'blank', value: '' },
    { caseName: 'malformed', value: 'not-a-date' },
    { caseName: 'out-of-range', value: '2026-13-40T99:99' },
  ])('blocks $caseName datetime-local entry before the mocked HTTP boundary', async ({ value }) => {
    await renderPage();
    fireEvent.change(departureInput(), { target: { value } });
    expect(departureInput()).toHaveValue('');
    expect(scenarioForm().checkValidity()).toBe(false);
    fireEvent.submit(scenarioForm());
    expect(scenarioRequests()).toHaveLength(0);
  });

  it('blocks a non-finite nonempty draft even when native required validation succeeds', async () => {
    await renderPage();
    // jsdom sanitizes malformed datetime-local strings to blank. A text-type
    // DOM fault injects a nonempty invalid date to exercise the finite-Date guard.
    departureInput().type = 'text';
    fireEvent.change(departureInput(), { target: { value: 'not-a-date' } });
    expect(scenarioForm().checkValidity()).toBe(true);
    fireEvent.submit(scenarioForm());
    expect(scenarioRequests()).toHaveLength(0);
  });

  it('keeps the published scenario and modeled versus measured sections after a failed edited retry', async () => {
    await renderPage('vehicle');
    await publishDraft();
    rejectScenario = true;
    fireEvent.change(departureInput(), { target: { value: '2026-02-20T08:45' } });
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getAllByText(/Synthetic scenario rejected/).length).toBeGreaterThan(0));
    expect(screen.getByRole('region', { name: 'Journey readiness assessment' })).toHaveTextContent('Jan 15, 2026, 09:00 PM');
    expect(departureInput()).toHaveValue('2026-02-20T08:45');
    expect(payload().departure_at).toBe(submittedInstant);
    expect(payload(1).departure_at).toBe('2026-02-20T16:45:00.000Z');
    for (const title of ['Journey scenario', 'Readiness and arrival range', 'Readiness factors', 'Evidence, quality, and limitations']) {
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
    }
    expect(screen.getByText('Observed charge, not readiness proof.')).toBeVisible();
    expect(screen.getByText('Unknown weather is not zero degrees.')).toBeVisible();
    expect(screen.getAllByText('Estimated energy requirement for the submitted route, not measured journey consumption.').length).toBeGreaterThan(0);
    expect(scenarioRequests()).toHaveLength(2);
  });
});
