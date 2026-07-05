/**
 * AddressInput — behaviour + hardening tests.
 *
 * AddressInput wraps the shared WAI-ARIA {@link Combobox} primitive to give the
 * trip planner a geocoded address autocomplete. The parent owns the raw text
 * (`value` / `onChange`); picking a suggestion additionally fires `onSelect`
 * with the resolved coordinates.
 *
 * Strategy:
 *   - Only the data boundary (`useGeocodeSearch`) is mocked; the REAL Combobox
 *     renders so the tests exercise the genuine input/listbox/keyboard wiring
 *     rather than a stubbed child. No network is touched and no QueryClient /
 *     Router provider is needed because the single hook is mocked outright.
 *   - `react-i18next` is stubbed to echo fallback strings (and interpolate
 *     `{{tokens}}`) so assertions target the rendered English exactly as
 *     production resolves it.
 *   - A small controlled harness mirrors real usage (parent holds `value`) for
 *     the interaction tests.
 *
 * The loading test pins the hardening fix: during the 400ms debounce window the
 * dropdown must show a loading affordance, NOT a premature "No results" flash.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  within,
  cleanup,
} from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import type { GeocodeResult, TripLocation } from '@/types/driving';

// i18n stub: return the fallback string and interpolate {{tokens}} so the
// Combobox's `t('combobox.noResults', 'No results')` etc. render as English.
vi.mock('react-i18next', () => {
  const translate = (key: string, fallback?: unknown, opts?: unknown): string => {
    let out = key;
    let options: Record<string, unknown> | undefined;
    if (typeof fallback === 'string') {
      out = fallback;
      options = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : undefined;
    } else if (fallback && typeof fallback === 'object') {
      options = fallback as Record<string, unknown>;
      if (typeof options.defaultValue === 'string') out = options.defaultValue;
    }
    if (options) {
      out = out.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
        options && options[k] != null ? String(options[k]) : `{{${k}}}`,
      );
    }
    return out;
  };
  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// Mock the data boundary. `...actual` keeps the module's other exports intact
// for any transitive importer; only the geocode hook is replaced.
vi.mock('@/api/hooks/useDriving', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useDriving')>();
  return { ...actual, useGeocodeSearch: vi.fn() };
});

import { useGeocodeSearch } from '@/api/hooks/useDriving';
import { AddressInput } from './AddressInput';

const mockGeocode = vi.mocked(useGeocodeSearch);

/** Build a minimal UseQueryResult-shaped return that AddressInput consumes. */
function geocodeState(
  data: GeocodeResult[] | undefined,
  isLoading = false,
): ReturnType<typeof useGeocodeSearch> {
  return { data, isLoading } as unknown as ReturnType<typeof useGeocodeSearch>;
}

/** Controlled wrapper mirroring the trip-planner parent (owns `value`). */
function ControlledAddressInput(props: {
  onChangeSpy?: (v: string) => void;
  onSelect: (loc: TripLocation) => void;
  label?: string;
  placeholder?: string;
  initial?: string;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <AddressInput
      value={value}
      onChange={(v) => {
        props.onChangeSpy?.(v);
        setValue(v);
      }}
      onSelect={props.onSelect}
      label={props.label}
      placeholder={props.placeholder}
    />
  );
}

beforeEach(() => {
  mockGeocode.mockReset();
  mockGeocode.mockReturnValue(geocodeState([]));
});

afterEach(() => {
  cleanup();
});

describe('AddressInput', () => {
  it('renders a combobox with the default hidden "Address" label and the given placeholder', () => {
    render(
      <AddressInput
        value=""
        onChange={vi.fn()}
        onSelect={vi.fn()}
        placeholder="Search here"
      />,
    );

    // No `label` prop → the Combobox label is visually hidden but still the
    // accessible name (default resolved via t('addressInput.label', 'Address')).
    const input = screen.getByRole('combobox', { name: 'Address' });
    expect(input).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search here')).toBe(input);
    // Nothing is loading and no query is typed → no spinner.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders a visible label when the `label` prop is supplied', () => {
    render(
      <AddressInput value="" onChange={vi.fn()} onSelect={vi.fn()} label="Destination" />,
    );

    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Destination' }),
    ).toBeInTheDocument();
  });

  it('forwards typed text to the parent via onChange (Combobox onInputChange wiring)', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledAddressInput onChangeSpy={onChangeSpy} onSelect={vi.fn()} />);

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Main' } });

    expect(onChangeSpy).toHaveBeenLastCalledWith('Main');
    expect(input).toHaveValue('Main');
  });

  it('fires onChange + onSelect with resolved coordinates when a suggestion is picked', () => {
    const onSelect = vi.fn();
    const onChangeSpy = vi.fn();
    const suggestion: GeocodeResult = {
      display_name: '123 Main Street, Springfield',
      lat: 40.1,
      lng: -74.2,
    };
    mockGeocode.mockReturnValue(geocodeState([suggestion]));

    render(<ControlledAddressInput onChangeSpy={onChangeSpy} onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    // Typed text is a substring of the suggestion so it survives the Combobox's
    // local filter and appears as a selectable option.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Main' } });

    const option = screen.getByText('123 Main Street, Springfield');
    fireEvent.click(option);

    expect(onSelect).toHaveBeenCalledWith({
      lat: 40.1,
      lng: -74.2,
      name: '123 Main Street, Springfield',
    });
    expect(onChangeSpy).toHaveBeenCalledWith('123 Main Street, Springfield');
  });

  it('does NOT call onSelect on a free-text commit (null guard in handleSelect)', () => {
    const onSelect = vi.fn();
    const onChangeSpy = vi.fn();
    mockGeocode.mockReturnValue(geocodeState([]));

    render(<ControlledAddressInput onChangeSpy={onChangeSpy} onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    // allowFreeText is on but no onFreeTextCommit is wired, so Enter with no
    // active option commits free text → Combobox fires onChange(null).
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nowhere' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChangeSpy).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('tolerates an undefined results payload and shows an empty "No results" listbox', () => {
    mockGeocode.mockReturnValue(geocodeState(undefined, false));

    render(<AddressInput value="" onChange={vi.fn()} onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    // `results ?? []` guards the .slice/.map inside the Combobox — no crash.
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('No results')).toBeInTheDocument();
    expect(input).toBeInTheDocument();
  });

  it('shows a loading affordance during the debounce window, then settles to "No results"', () => {
    vi.useFakeTimers();
    try {
      // Query not yet fired for the pending text → no data, not fetching.
      mockGeocode.mockReturnValue(geocodeState(undefined, false));
      render(<AddressInput value="abc" onChange={() => {}} onSelect={vi.fn()} />);

      const input = screen.getByRole('combobox');
      // Debounce is pending (value "abc" ≠ debounced "") and length ≥ 3 →
      // spinner is visible even before the dropdown is opened.
      expect(screen.getByRole('status')).toBeInTheDocument();

      fireEvent.focus(input);
      let listbox = screen.getByRole('listbox');
      // The dropdown must show "Loading" — NOT a premature/misleading "No results".
      expect(within(listbox).getByText('Loading')).toBeInTheDocument();
      expect(within(listbox).queryByText('No results')).toBeNull();

      // Debounce settles → the (still empty) request has "fired" → No results.
      act(() => {
        vi.advanceTimersByTime(400);
      });
      listbox = screen.getByRole('listbox');
      expect(within(listbox).getByText('No results')).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the query to useGeocodeSearch only after the 400ms debounce settles', () => {
    vi.useFakeTimers();
    try {
      mockGeocode.mockReturnValue(geocodeState([]));
      render(<AddressInput value="caf" onChange={() => {}} onSelect={vi.fn()} />);

      // First render seeds the hook with the empty debounced value, never "caf".
      expect(mockGeocode).toHaveBeenCalledWith('');
      expect(mockGeocode).not.toHaveBeenCalledWith('caf');

      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(mockGeocode).toHaveBeenLastCalledWith('caf');
    } finally {
      vi.useRealTimers();
    }
  });
});
