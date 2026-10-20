/**
 * WarrantyPanel — coverage countdown rows + assumption disclosure.
 * Pure presentational: outlook passed as props.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const preferences = vi.hoisted(() => ({
  locale: 'en-US', tz: 'UTC', distance: 'km', precision: 1,
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => preferences.tz,
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: preferences.locale,
    settings: {
      locale: preferences.locale,
      tz_display_default: 'user',
      unit_of_length: preferences.distance,
      decimal_precision: preferences.precision,
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: unknown,
      variables?: Record<string, string | number>,
    ) => {
      if (typeof fallback !== 'string') return key;
      return Object.entries(variables ?? {}).reduce(
        (value, [name, replacement]) =>
          value.replace(`{{${name}}}`, String(replacement)),
        fallback,
      );
    },
  }),
}));

import type { WarrantyOutlook } from '@/api/hooks/useServiceIntelligence';
import { WarrantyPanel } from './WarrantyPanel';

const outlook: WarrantyOutlook = {
  vehicle_id: 9,
  model: 'Model Y',
  model_year: 2024,
  assumption: 'Counted from January 1 of the model year.',
  coverages: [
    { name: 'Basic Limited', expires_at: '2028-01-01', days_remaining: 400, km_limit: 80467, km_remaining: 50000, status: 'active', basis: 'time' },
    { name: 'Battery & Drive Unit', expires_at: '2032-01-01', days_remaining: 1800, km_limit: 192000, km_remaining: 160000, status: 'active', basis: 'time' },
  ],
};

describe('WarrantyPanel', () => {
  beforeEach(() => {
    preferences.locale = 'en-US';
    preferences.tz = 'UTC';
    preferences.distance = 'km';
    preferences.precision = 1;
  });

  it('formats source kilometers using saved units, locale and precision without mutating the outlook', () => {
    const source = JSON.stringify(outlook);
    const view = render(
      <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/ends Jan 1, 2028/)).toHaveTextContent('50,000.0 km remaining');
    expect(screen.getByText(/ends Jan 1, 2032/)).toHaveTextContent('160,000.0 km remaining');

    preferences.distance = 'mi';
    preferences.precision = 2;
    view.rerender(
      <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/ends Jan 1, 2028/)).toHaveTextContent('31,068.56 mi remaining');
    expect(screen.getByText(/ends Jan 1, 2032/)).toHaveTextContent('99,419.39 mi remaining');

    preferences.locale = 'de-DE';
    preferences.precision = 0;
    view.rerender(
      <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/ends 1\. Jan\. 2028/)).toHaveTextContent('31.069 mi remaining');
    expect(JSON.stringify(outlook)).toBe(source);
  });

  it.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
    'localizes calendar expiration dates without shifting their day in %s',
    (tz) => {
      preferences.locale = 'de-DE';
      preferences.tz = tz;
      render(
        <WarrantyPanel selected loading={false} error={null}
          outlook={{
            ...outlook,
            coverages: [
              { ...outlook.coverages[0], expires_at: '2028-01-01', days_remaining: 400 },
              { ...outlook.coverages[1], expires_at: '2028-02-29', days_remaining: -3, km_remaining: -10 },
            ],
          }}
          onRetry={vi.fn()} />,
      );
      expect(screen.getByText(/ends 1\. Jan\. 2028/)).toHaveTextContent('400 days left');
      expect(screen.getByText(/ends 29\. Feb\. 2028/)).toHaveTextContent('0 days left');
      expect(screen.getByText(/ends 29\. Feb\. 2028/)).toHaveTextContent(/0(?:[,.]0+)? km remaining/);
      expect(screen.getByText(outlook.assumption)).toBeInTheDocument();
      expect(screen.queryByText(/31\. Dez\. 2027|2\. Jan\. 2028|1\. März 2028/)).not.toBeInTheDocument();
    },
  );

  it('updates expiration labels when saved locale and timezone change', () => {
    const view = render(
      <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/ends Jan 1, 2028/)).toBeInTheDocument();
    preferences.locale = 'de-DE';
    preferences.tz = 'America/Los_Angeles';
    view.rerender(
      <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/ends 1\. Jan\. 2028/)).toBeInTheDocument();
    expect(screen.queryByText(/ends Jan 1, 2028/)).not.toBeInTheDocument();
  });

  it.each(['not-a-date', '2028-01', ''])(
    'shows the shared missing-date placeholder for %j without losing the countdown',
    (expires_at) => {
      render(
        <WarrantyPanel selected loading={false} error={null}
          outlook={{ ...outlook, coverages: [{ ...outlook.coverages[0], expires_at }] }}
          onRetry={vi.fn()} />,
      );
      expect(screen.getByText(/ends —/)).toHaveTextContent('400 days left');
      expect(screen.getByText('Basic Limited')).toBeInTheDocument();
      expect(screen.getByText(outlook.assumption)).toBeInTheDocument();
    },
  );

  it.each([null, undefined])('handles a missing expiration date (%s) in the runtime payload', (expires_at) => {
    const payload: WarrantyOutlook = JSON.parse(JSON.stringify({
      ...outlook,
      coverages: [{ ...outlook.coverages[0], expires_at }],
    }));
    render(
      <WarrantyPanel selected loading={false} error={null} outlook={payload} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/ends —/)).toHaveTextContent('400 days left');
    expect(screen.getByText(outlook.assumption)).toBeInTheDocument();
  });

  it.each(['km', 'mi'])('preserves null versus real zero distance allowance, supplied coverage ordering and countdown clamping in %s', (distance) => {
    preferences.distance = distance;
    render(
      <WarrantyPanel selected loading={false} error={null}
        outlook={{
          ...outlook,
          coverages: [
            { ...outlook.coverages[0], name: 'Time-only coverage', km_limit: null, km_remaining: null, days_remaining: 0, status: 'expiring_soon' },
            { ...outlook.coverages[1], name: 'Exhausted distance allowance', km_remaining: 0, days_remaining: -3, status: 'expired' },
          ],
        }}
        onRetry={vi.fn()} />,
    );
    const timeOnly = screen.getByText('Time-only coverage').parentElement;
    const exhausted = screen.getByText('Exhausted distance allowance').parentElement;
    expect(timeOnly).toHaveTextContent('0 days left');
    expect(timeOnly).not.toHaveTextContent(`${distance} remaining`);
    expect(exhausted).toHaveTextContent('0 days left');
    expect(exhausted).toHaveTextContent(`0 ${distance} remaining`);
    expect(screen.getByText('Expiring soon')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(timeOnly?.parentElement?.nextElementSibling).toBe(exhausted?.parentElement);
    expect(screen.getByText(outlook.assumption)).toBeInTheDocument();
  });

  it('keeps initial warranty failure distinct from an empty outlook and recovers only its source', () => {
    const onRetry = vi.fn();
    const view = render(
      <MemoryRouter>
        <WarrantyPanel selected loading={false} error={new Error('warranty unavailable')} outlook={null} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Warranty countdown' })).toBeInTheDocument();
    expect(screen.getByText('This source could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No warranty outlook')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(
      <MemoryRouter>
        <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByText(outlook.assumption)).toBeInTheDocument();
    expect(screen.getByText('Basic Limited')).toBeInTheDocument();
    expect(screen.getByText('Battery & Drive Unit')).toBeInTheDocument();
    expect(screen.queryByText('This source could not be loaded.')).not.toBeInTheDocument();
  });

  it('renders coverage rows with countdowns and the assumption', () => {
    render(
      <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={() => {}} />,
    );
    expect(screen.getByText('Basic Limited')).toBeTruthy();
    expect(screen.getByText('Battery & Drive Unit')).toBeTruthy();
    expect(screen.getByText('Counted from January 1 of the model year.')).toBeTruthy();
  });

  it('marks expired coverage', () => {
    render(
      <WarrantyPanel
        selected
        loading={false}
        error={null}
        outlook={{
          ...outlook,
          coverages: [
            { name: 'Basic Limited', expires_at: '2023-01-01', days_remaining: -100, km_limit: null, km_remaining: null, status: 'expired', basis: 'time' },
          ],
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('prompts to select a vehicle when none is chosen', () => {
    render(
      <WarrantyPanel selected={false} loading={false} error={null} outlook={null} onRetry={() => {}} />,
    );
    expect(screen.getByText('Select a vehicle')).toBeTruthy();
  });
});
