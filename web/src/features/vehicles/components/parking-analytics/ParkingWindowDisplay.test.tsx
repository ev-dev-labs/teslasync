import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ParkingCoverageMethodology } from './ParkingCoverageMethodology';
import { summarizeParking } from '../../lib/parkingDwell';

const preferences = vi.hoisted(() => ({ zone: 'America/Los_Angeles' }));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | number | Date, options?: { tz?: string }) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: options?.tz ?? preferences.zone, dateStyle: 'short', timeStyle: 'short',
      }).format(value instanceof Date ? value : new Date(value)),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)),
      (typeof fallback === 'string' ? fallback : fallback?.defaultValue) ?? key),
    i18n: { language: 'en' },
  }),
}));

describe('Parking requested-window display', () => {
  it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
    'formats requested window bounds in %s without changing their instants',
    (zone) => {
      preferences.zone = zone;
      const start = '2026-01-01T00:30:00Z';
      const end = '2026-01-02T00:30:00Z';
      const summary = summarizeParking([], {
        nowMs: Date.parse(end), startInstant: start, endInstantExclusive: end,
        timeZone: zone, rowLimit: 1000,
      });
      const original = structuredClone(summary);
      render(<MemoryRouter><ParkingCoverageMethodology summary={summary}
        state={{ isLoading: false, error: null, onRetry: vi.fn() }}
        rangeStart={start} rangeEnd={end} sourceStatus="ok" hasSource /></MemoryRouter>);
      const note = screen.getByText(/The server filters drive starts from/);
      fireEvent.click(within(screen.getByTestId('parking-coverage-summary'))
        .getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      for (const instant of [start, end]) {
        const label = new Intl.DateTimeFormat('en-US', {
          timeZone: zone, dateStyle: 'short', timeStyle: 'short',
        }).format(new Date(instant));
        expect(note).toHaveTextContent(label);
        expect(drawer).toHaveTextContent(label);
        expect(note).not.toHaveTextContent(instant);
        expect(drawer).not.toHaveTextContent(instant);
      }
      expect(note).toHaveTextContent('(inclusive)');
      expect(note).toHaveTextContent('(exclusive)');
      expect(drawer).toHaveTextContent('(exclusive)');
      expect(summary).toEqual(original);
    },
  );
});
