/**
 * RateForm — add-a-rate form for one charging place.
 *
 * The form's entire reason to exist is the ONE conversion boundary between
 * the user-facing currency/kWh entry and the canonical `rate_per_wh` sent
 * on the wire (never a *_kwh field). Coverage:
 *
 *   1. Renders all four fields (currency, rate, effective-from, effective-to)
 *      plus a pre-seeded effective-from (now) and an open-ended hint.
 *   2. Submits rate_per_wh = rate/kWh ÷ 1000 — the SI conversion boundary —
 *      and never a *_kwh key on the mutation payload.
 *   3. Blocks submit with an inline error when the rate is missing/negative.
 *   4. Blocks submit when effective_to <= effective_from.
 *   5. Resets the rate/effective-to fields after a successful save (keeps
 *      currency/effective-from so the next entry doesn't start from scratch).
 *   6. Seeds the currency default from the rate active now, if any.
 *   7. Explains that today's rate estimates eligible legacy sessions without
 *      replacing actual costs.
 *   8. Uses saved-zone independent business instants, including DST gaps,
 *      folds, skipped midnight/date, and exact half-open wire bounds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) => (name in o ? String(o[name]) : `{{${name}}}`));
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

const preferences = vi.hoisted(() => ({
  currency_symbol: '$',
  tz_display_default: 'user',
  timezone_user: 'America/Los_Angeles',
}));
const selectedVehicle = vi.hoisted(() => ({ timezone: 'Asia/Tokyo' }));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: 'en-US',
    settings: preferences,
  }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: selectedVehicle }),
}));

vi.mock('@/api/hooks/useLocations', () => ({
  useCreateGeofenceRate: vi.fn(),
}));

import { useCreateGeofenceRate } from '@/api/hooks/useLocations';
import { RateForm } from './RateForm';
import type { GeofenceRate } from '@/api/types';

const mockedCreate = useCreateGeofenceRate as unknown as ReturnType<typeof vi.fn>;
let createMutate: ReturnType<typeof vi.fn>;

function makeRate(overrides: Partial<GeofenceRate> = {}): GeofenceRate {
  return {
    id: 1,
    geofence_id: 7,
    rate_per_wh: 0.0001,
    currency: 'USD',
    effective_from: '2020-01-01T00:00:00Z',
    effective_to: null,
    created_at: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T07:00:00Z'));
  preferences.tz_display_default = 'user';
  preferences.timezone_user = 'America/Los_Angeles';
  selectedVehicle.timezone = 'Asia/Tokyo';
  createMutate = vi.fn();
  mockedCreate.mockReturnValue({ mutate: createMutate, isPending: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

function rateInput(): HTMLInputElement {
  return screen.getByLabelText('Rate per kWh') as HTMLInputElement;
}

function typeRate(value: string) {
  const input = rateInput();
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('RateForm — structure', () => {
  it('defaults the first rate to saved-zone midnight the day before the earliest charge', () => {
    render(<RateForm geofenceId={7} firstSessionAt="2026-09-01T01:30:00Z" />);
    expect(screen.getByLabelText('Effective from')).toHaveValue('2026-08-30T00:00');
  });
  it('renders the currency select, rate field, and both effective-date fields', () => {
    render(<RateForm geofenceId={7} />);

    expect(screen.getByText('Add a rate')).toBeInTheDocument();
    expect(screen.getByLabelText('Currency')).toBeInTheDocument();
    expect(rateInput()).toBeInTheDocument();
    expect(screen.getByLabelText('Effective from')).toBeInTheDocument();
    expect(screen.getByLabelText('Effective to (optional)')).toBeInTheDocument();
    expect(screen.getByText('Leave blank for an open-ended rate. · America/Los_Angeles')).toBeInTheDocument();
    expect(screen.getByLabelText('Effective from')).toHaveAccessibleDescription('America/Los_Angeles');
    expect(screen.getByLabelText('Effective to (optional)')).toHaveAccessibleDescription(
      'Leave blank for an open-ended rate. · America/Los_Angeles',
    );
    expect(
      screen.getByText(
        'Starting before the first charge makes that session eligible. Preview and apply to price past sessions; existing actual costs stay unchanged.',
      ),
    ).toBeInTheDocument();
  });

  it('pre-seeds effective-from with a non-empty local datetime value', () => {
    render(<RateForm geofenceId={7} />);
    const input = screen.getByLabelText('Effective from') as HTMLInputElement;
    expect(input.value).not.toBe('');
    // datetime-local shape: YYYY-MM-DDTHH:mm
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(input.value).toBe('2026-10-14T00:00');
  });

  it('seeds the currency default from the active rate when provided', () => {
    render(<RateForm geofenceId={7} currentRate={makeRate({ currency: 'EUR' })} />);
    const select = screen.getByLabelText('Currency') as HTMLSelectElement;
    expect(select.value).toBe('EUR');
  });

  it('updates the currency when the active rate finishes loading', () => {
    const { rerender } = render(<RateForm geofenceId={7} />);

    rerender(<RateForm geofenceId={7} currentRate={makeRate({ currency: 'CAD' })} />);

    expect((screen.getByLabelText('Currency') as HTMLSelectElement).value).toBe('CAD');
  });
});

describe('RateForm — the SI conversion boundary', () => {
  it('converts a typed currency/kWh rate to rate_per_wh (÷1000) on submit', () => {
    render(<RateForm geofenceId={7} />);

    typeRate('0.12');
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0];
    expect(payload.geofenceId).toBe(7);
    expect(payload.rate_per_wh).toBeCloseTo(0.00012, 10);
    expect(payload.currency).toBe('USD');
    // Never a *_kwh field anywhere in the wire payload.
    expect(Object.keys(payload).some((k) => /kwh/i.test(k))).toBe(false);
  });

  it('omits effective_to from the payload when left blank (open-ended rate)', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    const [payload] = createMutate.mock.calls[0];
    expect(payload).not.toHaveProperty('effective_to');
  });

  it('includes effective_to in the payload when set, after the effective-from', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-01-01T00:00' } });
    fireEvent.change(screen.getByLabelText('Effective to (optional)'), { target: { value: '2026-08-27T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    const [payload] = createMutate.mock.calls[0];
    expect(payload).toEqual({
      geofenceId: 7,
      rate_per_wh: 0.0001,
      currency: 'USD',
      effective_from: '2026-01-01T08:00:00.000Z',
      effective_to: '2026-08-27T07:00:00.000Z',
    });
  });
});

describe('RateForm — independent saved-zone business instants', () => {
  it.each([
    ['utc', 'America/Los_Angeles', 'Asia/Tokyo', '2026-01-01T00:00:00.000Z'],
    ['user', 'Asia/Kolkata', 'Asia/Tokyo', '2025-12-31T18:30:00.000Z'],
    ['vehicle', 'America/Los_Angeles', 'Asia/Tokyo', '2025-12-31T15:00:00.000Z'],
  ])('honors saved %s mode with user zone %s and vehicle zone %s', (mode, userZone, vehicleZone, expected) => {
    preferences.tz_display_default = mode;
    preferences.timezone_user = userZone;
    selectedVehicle.timezone = vehicleZone;
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate.mock.calls[0][0].effective_from).toBe(expected);
  });

  it.each([
    ['2026-03-08T00:00', '2026-03-09T00:00', '2026-03-08T08:00:00.000Z', '2026-03-09T07:00:00.000Z', 23],
    ['2026-11-01T00:00', '2026-11-02T00:00', '2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z', 25],
    ['2026-03-08T01:30', '2026-03-08T03:30', '2026-03-08T09:30:00.000Z', '2026-03-08T10:30:00.000Z', 1],
  ])('preserves the half-open DST interval %s to %s', (from, to, expectedFrom, expectedTo, hours) => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.15');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: from } });
    fireEvent.change(screen.getByLabelText('Effective to (optional)'), { target: { value: to } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate.mock.calls[0][0]).toEqual({
      geofenceId: 7,
      rate_per_wh: 0.00015,
      currency: 'USD',
      effective_from: expectedFrom,
      effective_to: expectedTo,
    });
    expect((Date.parse(expectedTo) - Date.parse(expectedFrom)) / 3_600_000).toBe(hours);
  });

  it('keeps the earlier occurrence of a repeated DST wall time', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-11-01T01:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate.mock.calls[0][0].effective_from).toBe('2026-11-01T08:30:00.000Z');
  });

  it.each(['Effective from', 'Effective to (optional)'])('rejects a nonexistent DST wall time in %s', (label) => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-03-08T01:00' } });
    fireEvent.change(screen.getByLabelText(label), { target: { value: '2026-03-08T02:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(label === 'Effective from'
      ? 'Enter a valid effective-from date/time.'
      : 'Effective-to date/time is invalid.')).toBeInTheDocument();
  });

  it('seeds the first representable prior-day boundary when the zone skips midnight', () => {
    preferences.timezone_user = 'America/Santiago';
    render(<RateForm geofenceId={7} firstSessionAt="2025-09-08T12:00:00Z" />);
    expect(screen.getByLabelText('Effective from')).toHaveValue('2025-09-07T01:00');
    typeRate('0.1');
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate.mock.calls[0][0].effective_from).toBe('2025-09-07T04:00:00.000Z');
  });

  it('rejects a skipped calendar date rather than silently moving the interval', () => {
    preferences.timezone_user = 'Pacific/Apia';
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2011-12-30T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid effective-from date/time.')).toBeInTheDocument();
  });

  it('does not guess a fallback zone for invalid saved settings', () => {
    preferences.timezone_user = 'Invalid/Zone';
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid effective-from date/time.')).toBeInTheDocument();
  });

  it('retains drafts and raw signed SI source data when the unrelated workspace URL range changes', () => {
    const currentRate = Object.freeze(makeRate({ rate_per_wh: -0.00012 }));
    const { rerender } = render(<RateForm geofenceId={7} currentRate={currentRate} />);
    typeRate('0');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2020-01-01T00:00' } });
    fireEvent.change(screen.getByLabelText('Effective to (optional)'), { target: { value: '2020-02-01T00:00' } });
    window.history.replaceState(null, '', '/geofences?from=2026-09-01&to=2026-10-01');
    rerender(<RateForm geofenceId={7} currentRate={currentRate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate.mock.calls[0][0]).toEqual({
      geofenceId: 7,
      rate_per_wh: 0,
      currency: 'USD',
      effective_from: '2020-01-01T08:00:00.000Z',
      effective_to: '2020-02-01T08:00:00.000Z',
    });
    expect(currentRate).toEqual(makeRate({ rate_per_wh: -0.00012 }));
    expect(screen.queryByRole('button', { name: /view settings|date range|vehicle/i })).not.toBeInTheDocument();
  });
});

describe('RateForm — validation', () => {
  it('blocks submit and shows an inline error when no rate has been entered', () => {
    render(<RateForm geofenceId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(createMutate).not.toHaveBeenCalled();
  });

  it('the Save button stays disabled until a rate value is entered', () => {
    render(<RateForm geofenceId={7} />);
    expect(screen.getByRole('button', { name: 'Save rate' })).toBeDisabled();
    typeRate('0.1');
    expect(screen.getByRole('button', { name: 'Save rate' })).not.toBeDisabled();
  });

  it('blocks submit and shows an error when effective_to is not after effective_from', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-08-27T00:00' } });
    fireEvent.change(screen.getByLabelText('Effective to (optional)'), { target: { value: '2026-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(screen.getByText('Effective-to must be after effective-from.')).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('rejects an equal exclusive bound rather than expanding it to end-of-day', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    for (const label of ['Effective from', 'Effective to (optional)']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '2026-01-01T00:00' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Effective-to must be after effective-from.')).toBeInTheDocument();
  });

  it('rejects a cleared required start date', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid effective-from date/time.')).toBeInTheDocument();
  });

  it('rejects a malformed calendar date instead of normalizing it', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-02-30T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid effective-from date/time.')).toBeInTheDocument();
  });
});

describe('RateForm — after a successful save', () => {
  it('resets the rate and effective-to fields but keeps currency/effective-from', () => {
    createMutate.mockImplementation((_payload, opts) => opts?.onSuccess?.());

    render(<RateForm geofenceId={7} />);
    typeRate('0.15');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-01-01T00:00' } });
    fireEvent.change(screen.getByLabelText('Effective to (optional)'), { target: { value: '2027-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));

    expect((screen.getByLabelText('Effective to (optional)') as HTMLInputElement).value).toBe('');
    // The rate field re-renders back to empty ("") once valueMicro resets to null.
    expect(rateInput().value).toBe('');
    expect(screen.getByLabelText('Currency')).toHaveValue('EUR');
    expect(screen.getByLabelText('Effective from')).toHaveValue('2026-01-01T00:00');
  });
});

describe('RateForm — loading state', () => {
  it('shows the Save button as loading while the mutation is pending', () => {
    mockedCreate.mockReturnValue({ mutate: createMutate, isPending: true });
    render(<RateForm geofenceId={7} />);

    const button = screen.getByRole('button', { name: 'Save rate' });
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
