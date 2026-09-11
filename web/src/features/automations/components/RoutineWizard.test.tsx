/**
 * RoutineWizard — place picker gates install; install posts template + place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { RoutineTemplate } from '@/api/types';

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
  });
});
