import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { summarizeParking } from '../../lib/parkingDwell';
import { TopParkingLocations } from './TopParkingLocations';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDuration: (seconds: number) => `${seconds} s` }),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, variables?: Record<string, unknown>) =>
        (typeof fallback === 'string' ? fallback : key)
          .replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(variables?.[name] ?? '')),
      i18n: { language: 'en' },
    }),
  };
});

function summary(possiblyCapped = false) {
  const value = summarizeParking([], {
    nowMs: Date.parse('2026-09-01T12:00:00Z'),
    rangeStart: '2026-09-01',
    rangeEnd: '2026-09-01',
    timeZone: 'UTC',
  });
  value.coverage.possiblyCapped = possiblyCapped;
  value.locations = Array.from({ length: 30 }, (_, index) => ({
    location: `Location ${index + 1}`,
    stints: index === 29 ? 7 : 1,
    totalMs: 1_000,
    share: 1 / 30,
  }));
  return value;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe('TopParkingLocations value filters', () => {
  it('filters all loaded location groups before client pagination', () => {
    render(<TopParkingLocations summary={summary()} state={{ isLoading: false, error: null, onRetry: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter Stints' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '1' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Location 30')).toBeInTheDocument();
    expect(screen.queryByText('Location 1')).toBeNull();
  });

  it('does not offer whole-window choices when the source drive list may be capped', () => {
    render(<TopParkingLocations summary={summary(true)} state={{ isLoading: false, error: null, onRetry: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: 'Filter Stints' })).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
