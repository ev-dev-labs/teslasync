import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { OperationalBrief } from '@/components/data-display';
import { CoverageOperationalBrief } from './CoverageOperationalBrief';
import { sourceFreshness, sourceStatus } from './sourceMetadata';

const saved = vi.hoisted(() => ({
  locale: 'de-DE', timezone_user: 'America/Los_Angeles', tz_display_default: 'user',
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: saved, locale: saved.locale }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
}));
vi.mock('react-i18next', async () => {
  const { createInstance: create } = await import('i18next');
  const instance = create();
  await instance.init({ lng: 'en', fallbackLng: 'en', resources: {} });
  return { useTranslation: () => ({ t: instance.t }) };
});
vi.mock('@/hooks/useOperationalMetrics', () => ({
  useOperationalMetrics: () => [],
}));
vi.mock('@/components/data-display', () => ({
  OperationalBrief: ({ freshness, statusLabel, scope, provenance }: ComponentProps<typeof OperationalBrief>) =>
    <section data-testid="coverage-summary">{freshness}{statusLabel}{scope}{provenance}</section>,
}));

const translation = createInstance();
void translation.init({ lng: 'en', fallbackLng: 'en', resources: {}, initAsync: false });
const snapshot = { categories: [], destination_totals: {}, orphan_fields: [] };
afterEach(cleanup);

describe('coverage last-success source metadata', () => {
  it.each([
    ['de-DE', 'America/Los_Angeles', '2026-10-02T00:30:00Z', '1. Okt. 2026, 17:30'],
    ['ja-JP', 'Asia/Tokyo', '2026-10-01T23:30:00Z', '2026年10月2日 08:30'],
  ])('renders saved %s / %s across the UTC day boundary', (locale, timezone, instant, expected) => {
    saved.locale = locale;
    saved.timezone_user = timezone;
    const updatedAt = Date.parse(instant);
    const { rerender } = render(<CoverageOperationalBrief query={{ data: snapshot, dataUpdatedAt: updatedAt }} />);
    expect(screen.getByText(`Fetched ${expected}`)).toBeInTheDocument();
    expect(screen.getByTestId('coverage-summary')).toHaveTextContent('Snapshot loaded');
    expect(screen.getByTestId('coverage-summary')).toHaveTextContent('Package configuration snapshot');
    expect(screen.getByTestId('coverage-summary')).toHaveTextContent('routing.yaml and teslaconfig.Builder');

    rerender(<CoverageOperationalBrief query={{
      data: snapshot, dataUpdatedAt: updatedAt, error: new Error('refresh failed'),
      errorUpdatedAt: updatedAt + 3600000,
    }} />);
    expect(screen.getByText(`Fetched ${expected}`)).toBeInTheDocument();
    expect(screen.getByTestId('coverage-summary')).toHaveTextContent('Retained source data');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
  });

  it.each([undefined, 0, Number.NaN, Infinity, -Infinity, 8640000000000001])(
    'keeps missing or invalid query timestamps unknown (%s)', dataUpdatedAt => {
      render(<CoverageOperationalBrief query={{ data: snapshot, dataUpdatedAt }} />);
      expect(screen.getByText('Fetch time not supplied')).toBeInTheDocument();
      expect(screen.queryByText(/Fetched /)).not.toBeInTheDocument();
      expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    },
  );

  it('preserves the two-argument metadata contract and never formats invalid dates', () => {
    const updatedAt = Date.parse('2026-10-01T12:00:00Z');
    expect(sourceFreshness(updatedAt, translation.t)).toBe(`Fetched ${new Date(updatedAt).toLocaleString()}`);
    const formatter = vi.fn(() => 'formatted date');
    for (const value of [null, Number.NaN, Infinity, 8640000000000001]) {
      expect(sourceFreshness(value, translation.t, formatter)).toBe('Fetch time not supplied');
    }
    expect(formatter).not.toHaveBeenCalled();
    expect(sourceFreshness(0, translation.t, formatter)).toBe('Fetched formatted date');
    expect(formatter).toHaveBeenCalledWith(new Date(0));
    expect(sourceStatus('stale', translation.t)).toBe('Retained source data');
  });
});
