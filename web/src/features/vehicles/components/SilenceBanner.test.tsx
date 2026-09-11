/**
 * SilenceBanner — surfaces quiet/silent/never; hides on ok.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { VehicleSilence } from '@/api/hooks/useVehicles';

vi.mock('react-i18next', () => {
  const t = (key: string, second?: unknown): string =>
    typeof second === 'string' ? second : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicleSilence: vi.fn() }));

import { useVehicleSilence } from '@/api/hooks/useVehicles';
import { SilenceBanner } from './SilenceBanner';

const mockSilence = useVehicleSilence as unknown as ReturnType<typeof vi.fn>;

function silence(over: Partial<VehicleSilence> = {}): VehicleSilence {
  return {
    vehicle_id: 3,
    status: 'silent',
    last_seen_at: '2026-03-09T06:00:00Z',
    silent_for_s: 108000,
    checked_at: '2026-03-10T12:00:00Z',
    explanation: 'Silent for 30h.',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSilence.mockReturnValue({ data: silence() });
});

describe('SilenceBanner', () => {
  it('renders the silent banner with guidance', () => {
    render(<SilenceBanner vehicleId={3} />);
    expect(screen.getByText('Vehicle silent')).toBeTruthy();
    expect(screen.getByText('Silent for 30h.')).toBeTruthy();
  });

  it('renders nothing when telemetry is fresh', () => {
    mockSilence.mockReturnValue({ data: silence({ status: 'ok', explanation: 'fresh' }) });
    const { container } = render(<SilenceBanner vehicleId={3} />);
    expect(container.textContent).toBe('');
  });
});
