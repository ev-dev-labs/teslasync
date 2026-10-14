/**
 * RoutineWizard — place picker gates install; install posts template + place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { request } from '@/api/client';
import type { ReactNode } from 'react';

import type { RoutineTemplate } from '@/api/types';

vi.mock('@/api/client', () => ({ request: vi.fn() }));

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') return interpolate(second, third as Record<string, unknown> | undefined);
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/api/hooks/useAutomations', () => ({
  useRoutineTemplates: vi.fn(),
  useInstallRoutine: vi.fn(),
}));
vi.mock('@/api/hooks/useLocations', () => ({ useGeofencesFull: vi.fn() }));

import { useRoutineTemplates, useInstallRoutine } from '@/api/hooks/useAutomations';
import { useGeofencesFull } from '@/api/hooks/useLocations';
import { RoutineWizard } from './RoutineWizard';

const mockTemplates = useRoutineTemplates as unknown as ReturnType<typeof vi.fn>;
const mockInstall = useInstallRoutine as unknown as ReturnType<typeof vi.fn>;
const mockGeofences = useGeofencesFull as unknown as ReturnType<typeof vi.fn>;

const routines: RoutineTemplate[] = [
  { id: 'arrive_home', name: 'Arrive Home', description: 'Sentry off + lock.', event: 'enter', actions: [{ command: 'sentry_off' }, { command: 'lock' }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockTemplates.mockReturnValue({ data: routines, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  mockGeofences.mockReturnValue({
    data: [{ id: 7, name: 'Home', enabled: true, archived_at: null }],
  });
  mockInstall.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('RoutineWizard', () => {
  it('shows active loading instead of an empty catalogue', () => {
    mockTemplates.mockReturnValue({ data: undefined, isLoading: true, isPending: true, fetchStatus: 'fetching' });
    const { container } = render(<RoutineWizard />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install Arrive Home' })).not.toBeInTheDocument();
  });

  it('retains validated templates after a malformed refresh and recovers to empty', async () => {
    const actual = await vi.importActual<typeof import('@/api/hooks/useAutomations')>('@/api/hooks/useAutomations');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(request).mockResolvedValueOnce(routines).mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    const { result, unmount } = renderHook(() => actual.useRoutineTemplates(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.data).toEqual(routines));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toEqual(routines);
    await act(async () => { await result.current.refetch(); });
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);
    unmount();
    client.clear();
  });

  it('keeps a paused catalogue unknown without claiming successful empty data', () => {
    mockTemplates.mockReturnValue({ data: undefined, isLoading: false, isPending: true, fetchStatus: 'paused' });
    render(<RoutineWizard />);
    expect(screen.getByText('Geofence routines')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('—');
    expect(screen.queryByRole('button', { name: 'Install Arrive Home' })).not.toBeInTheDocument();
  });

  it('retains templates on refresh failure and removes the warning on recovery', () => {
    mockTemplates.mockReturnValue({
      data: routines, isLoading: false, isError: true,
      error: new Error('Invalid automation routine templates response'), refetch: vi.fn(),
    });
    const { rerender } = render(<RoutineWizard />);
    expect(screen.getByText('Arrive Home')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    mockTemplates.mockReturnValue({ data: routines, isLoading: false, isError: false, error: null });
    rerender(<RoutineWizard />);
    expect(screen.getByText('Arrive Home')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('validates supported template rows and rejects invalid envelopes and actions', async () => {
    const { assertRoutineTemplates } = await vi.importActual<typeof import('@/api/hooks/useAutomations')>('@/api/hooks/useAutomations');
    expect(assertRoutineTemplates(routines)).toEqual(routines);
    expect(assertRoutineTemplates([])).toEqual([]);
    for (const payload of [null, {}, { items: routines }, [null],
      [{ ...routines[0], event: 'dwell' }], [{ ...routines[0], actions: null }],
      [{ ...routines[0], actions: [{ command: 'lock', params: [] }] }]]) {
      expect(() => assertRoutineTemplates(payload)).toThrow('Invalid automation routine templates response');
    }
  });

  it('keeps the routine band visible when its catalogue is empty', () => {
    mockTemplates.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    render(<RoutineWizard />);
    expect(screen.getByText('Geofence routines')).toBeInTheDocument();
  });
  it('disables install until a place is chosen, then posts template + place', () => {
    const mutate = vi.fn();
    mockInstall.mockReturnValue({ mutate, isPending: false });
    render(<RoutineWizard />);
    expect(screen.getByText('Arrive Home')).toBeTruthy();
    const installBtn = screen.getByRole('button', { name: 'Install Arrive Home' });
    expect(installBtn).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Place'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install Arrive Home' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ id: 'arrive_home', place_id: 7 });
  });

  it('prompts to create a place when none exist', () => {
    mockGeofences.mockReturnValue({ data: [] });
    render(<RoutineWizard />);
    expect(screen.getByText('Create a geofence place first to install routines.')).toBeTruthy();
    expect(screen.getByText('Arrive Home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install Arrive Home' })).toBeDisabled();
  });

  it('preserves templates while places load without claiming there are no places', () => {
    mockGeofences.mockReturnValue({ isLoading: true });
    render(<RoutineWizard />);
    expect(screen.getByText('Arrive Home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install Arrive Home' })).toBeDisabled();
    expect(screen.queryByText('Create a geofence place first to install routines.')).not.toBeInTheDocument();
  });

  it('surfaces place failures with an independent retry and keeps templates visible', () => {
    const refetch = vi.fn();
    mockGeofences.mockReturnValue({ isError: true, error: new Error('Places unavailable'), refetch });
    render(<RoutineWizard />);
    expect(screen.getByText('Arrive Home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install Arrive Home' })).toBeDisabled();
    expect(screen.queryByText('Create a geofence place first to install routines.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
