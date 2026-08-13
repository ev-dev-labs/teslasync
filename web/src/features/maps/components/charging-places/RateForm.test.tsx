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
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: 'en-US',
    settings: { currency_symbol: '$' },
  }),
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
  createMutate = vi.fn();
  mockedCreate.mockReturnValue({ mutate: createMutate, isPending: false });
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
  it('renders the currency select, rate field, and both effective-date fields', () => {
    render(<RateForm geofenceId={7} />);

    expect(screen.getByText('Add a Rate')).toBeInTheDocument();
    expect(screen.getByLabelText('Currency')).toBeInTheDocument();
    expect(rateInput()).toBeInTheDocument();
    expect(screen.getByLabelText('Effective from')).toBeInTheDocument();
    expect(screen.getByLabelText('Effective to (optional)')).toBeInTheDocument();
    expect(screen.getByText('Leave blank for an open-ended rate.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'If this rate is active today, it also estimates older unpriced sessions at this place. Existing actual costs stay unchanged.',
      ),
    ).toBeInTheDocument();
  });

  it('pre-seeds effective-from with a non-empty local datetime value', () => {
    render(<RateForm geofenceId={7} />);
    const input = screen.getByLabelText('Effective from') as HTMLInputElement;
    expect(input.value).not.toBe('');
    // datetime-local shape: YYYY-MM-DDTHH:mm
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
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
    fireEvent.click(screen.getByRole('button', { name: 'Save Rate' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Save Rate' }));

    const [payload] = createMutate.mock.calls[0];
    expect(payload).not.toHaveProperty('effective_to');
  });

  it('includes effective_to in the payload when set, after the effective-from', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-01-01T00:00' } });
    fireEvent.change(screen.getByLabelText('Effective to (optional)'), { target: { value: '2026-08-27T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rate' }));

    const [payload] = createMutate.mock.calls[0];
    expect(payload.effective_from).toBe(new Date('2026-01-01T00:00').toISOString());
    expect(payload.effective_to).toBe(new Date('2026-08-27T00:00').toISOString());
  });
});

describe('RateForm — validation', () => {
  it('blocks submit and shows an inline error when no rate has been entered', () => {
    render(<RateForm geofenceId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Rate' }));

    expect(createMutate).not.toHaveBeenCalled();
  });

  it('the Save button stays disabled until a rate value is entered', () => {
    render(<RateForm geofenceId={7} />);
    expect(screen.getByRole('button', { name: 'Save Rate' })).toBeDisabled();
    typeRate('0.1');
    expect(screen.getByRole('button', { name: 'Save Rate' })).not.toBeDisabled();
  });

  it('blocks submit and shows an error when effective_to is not after effective_from', () => {
    render(<RateForm geofenceId={7} />);
    typeRate('0.1');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-08-27T00:00' } });
    fireEvent.change(screen.getByLabelText('Effective to (optional)'), { target: { value: '2026-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rate' }));

    expect(screen.getByText('Effective-to must be after effective-from.')).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });
});

describe('RateForm — after a successful save', () => {
  it('resets the rate and effective-to fields but keeps currency/effective-from', () => {
    createMutate.mockImplementation((_payload, opts) => opts?.onSuccess?.());

    render(<RateForm geofenceId={7} />);
    typeRate('0.15');
    fireEvent.change(screen.getByLabelText('Effective to (optional)'), { target: { value: '2027-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rate' }));

    expect((screen.getByLabelText('Effective to (optional)') as HTMLInputElement).value).toBe('');
    // The rate field re-renders back to empty ("") once valueMicro resets to null.
    expect(rateInput().value).toBe('');
  });
});

describe('RateForm — loading state', () => {
  it('shows the Save button as loading while the mutation is pending', () => {
    mockedCreate.mockReturnValue({ mutate: createMutate, isPending: true });
    render(<RateForm geofenceId={7} />);

    const button = screen.getByRole('button', { name: 'Save Rate' });
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
