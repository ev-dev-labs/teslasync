/**
 * GasPriceControlPanel contract + hardening tests.
 *
 * The panel is the configuration face of the EIA gas-price auto-poll surface.
 * It is driven entirely by the injected `query` (a `UseQueryResult`) and owns
 * its own loading / error / content branches, plus two mutations (toggle the
 * auto-poll, change the poll interval). These tests pin every branch through
 * the component's public surface:
 *
 *   1. Structure — the panel is a heading-labelled region that always renders
 *      its title, even while loading.
 *   2. Loading — decorative skeletons render `aria-hidden`, the interactive
 *      controls are withheld, and the `&& !data` guard keeps stale content on
 *      a background refetch instead of flashing an empty skeleton.
 *   3. Error — a `QueryError` alert with a working Retry that calls refetch(),
 *      and no controls behind it.
 *   4. Running / stopped state — the switch's `aria-checked` and the textual
 *      status track `data.enabled`.
 *   5. Interactions — flipping the switch calls the toggle mutation with the
 *      negated value; changing the select calls the config mutation with the
 *      chosen interval.
 *   6. Null-safety / defaults — a missing or empty `poll_interval` falls back
 *      to weekly (`7d`), and a null-data "settled" query still renders a
 *      usable, never-blank panel.
 *   7. Accessibility — the icon-only help triggers expose per-field names.
 *
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven via `fireEvent` — matching every other component test here
 * (RateLimitStatusPanel, QueueStatusPanel, SchemaDriftPage, …).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

// i18n stub — return the fallback string (or the `defaultValue` option) so
// assertions can target the rendered English copy without loading resources.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
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
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// QueryError reaches for the browser online-state; pin it to online so the
// error branch is the network-error (`role="alert"`) path with an enabled
// Retry, rather than the offline "retry when online" disabled variant.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

// Replace the two data mutations with spies so interactions are observable
// without a QueryClient. The component imports only these two from the module.
vi.mock('@/api/hooks/useSettings', () => ({
  useToggleGasPrice: vi.fn(),
  useUpdateGasPriceConfig: vi.fn(),
}));

import {
  useToggleGasPrice,
  useUpdateGasPriceConfig,
} from '@/api/hooks/useSettings';
import { GasPriceControlPanel } from './GasPriceControlPanel';
import type { GasPriceStatus } from '@/api/types';

const mockedToggle = useToggleGasPrice as unknown as ReturnType<typeof vi.fn>;
const mockedConfig = useUpdateGasPriceConfig as unknown as ReturnType<typeof vi.fn>;

type StatusQuery = UseQueryResult<GasPriceStatus, Error>;

let toggleMutate: ReturnType<typeof vi.fn>;
let configMutate: ReturnType<typeof vi.fn>;

function makeStatus(overrides: Partial<GasPriceStatus> = {}): GasPriceStatus {
  return {
    enabled: false,
    poll_interval: '7d',
    last_poll_time: '2026-01-01T00:00:00Z',
    current_price: 3.45,
    current_price_kwh_eq: 0.12,
    ...overrides,
  };
}

function makeQuery(overrides: Partial<StatusQuery> = {}): StatusQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
    isFetching: false,
    isSuccess: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as StatusQuery;
}

function renderPanel(query: StatusQuery) {
  return render(
    <MemoryRouter>
      <GasPriceControlPanel query={query} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  toggleMutate = vi.fn();
  configMutate = vi.fn();
  mockedToggle.mockReturnValue({ mutate: toggleMutate, isPending: false });
  mockedConfig.mockReturnValue({ mutate: configMutate, isPending: false });
});

describe('GasPriceControlPanel — structure', () => {
  it('renders the Configuration title as a heading-labelled region', () => {
    renderPanel(makeQuery({ data: makeStatus() }));

    expect(
      screen.getByRole('region', { name: /configuration/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /configuration/i }),
    ).toBeInTheDocument();
  });

  it('renders the EIA data-source attribution in the content branch', () => {
    renderPanel(makeQuery({ data: makeStatus() }));

    expect(
      screen.getByText(/U\.S\. Energy Information Administration/i),
    ).toBeInTheDocument();
  });
});

describe('GasPriceControlPanel — loading', () => {
  it('renders aria-hidden skeletons and withholds the controls while first-loading', () => {
    const { container } = renderPanel(
      makeQuery({ isLoading: true, isFetching: true }),
    );

    // Two skeleton placeholders, wrapped in an aria-hidden container so
    // screen readers don't announce empty pulse boxes.
    expect(
      container.querySelector('[aria-hidden="true"] .animate-pulse'),
    ).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);

    // No interactive controls while there is no data.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    // …but the labelled region + title still render.
    expect(
      screen.getByRole('region', { name: /configuration/i }),
    ).toBeInTheDocument();
  });

  it('keeps showing controls (not a skeleton) when refetching over existing data', () => {
    const { container } = renderPanel(
      makeQuery({ isLoading: true, data: makeStatus({ enabled: true }) }),
    );

    // The `isLoading && !data` guard means non-empty data suppresses the
    // skeleton so the panel updates progressively instead of flashing empty.
    expect(
      container.querySelector('[aria-hidden="true"] .animate-pulse'),
    ).toBeNull();
    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});

describe('GasPriceControlPanel — error', () => {
  it('renders a QueryError alert with a Retry that invokes refetch()', () => {
    const refetch = vi.fn();
    renderPanel(
      makeQuery({
        isError: true,
        error: new Error('boom'),
        refetch: refetch as unknown as StatusQuery['refetch'],
      }),
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Controls must not render behind the error.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('GasPriceControlPanel — enabled/disabled state', () => {
  it('shows the Running state with a checked switch when enabled', () => {
    renderPanel(makeQuery({ data: makeStatus({ enabled: true }) }));

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Stopped')).toBeNull();
  });

  it('shows the Stopped state with an unchecked switch when disabled', () => {
    renderPanel(makeQuery({ data: makeStatus({ enabled: false }) }));

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.queryByText('Running')).toBeNull();
  });
});

describe('GasPriceControlPanel — interactions', () => {
  it('toggling on calls the toggle mutation with true when currently disabled', () => {
    renderPanel(makeQuery({ data: makeStatus({ enabled: false }) }));

    fireEvent.click(screen.getByRole('switch'));

    expect(toggleMutate).toHaveBeenCalledTimes(1);
    expect(toggleMutate).toHaveBeenCalledWith(true);
  });

  it('toggling off calls the toggle mutation with false when currently enabled', () => {
    renderPanel(makeQuery({ data: makeStatus({ enabled: true }) }));

    fireEvent.click(screen.getByRole('switch'));

    expect(toggleMutate).toHaveBeenCalledTimes(1);
    expect(toggleMutate).toHaveBeenCalledWith(false);
  });

  it('renders the four interval options and reflects the current value', () => {
    renderPanel(makeQuery({ data: makeStatus({ poll_interval: '30d' }) }));

    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('30d');

    const options = within(select).getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.textContent)).toEqual([
      'Daily',
      'Weekly',
      'Bi-weekly',
      'Monthly',
    ]);
  });

  it('changing the interval calls the config mutation with the chosen value', () => {
    renderPanel(makeQuery({ data: makeStatus({ poll_interval: '7d' }) }));

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'daily' },
    });

    expect(configMutate).toHaveBeenCalledTimes(1);
    expect(configMutate).toHaveBeenCalledWith('daily');
  });
});

describe('GasPriceControlPanel — null-safety & defaults', () => {
  it('defaults the interval to weekly (7d) when the backend value is empty', () => {
    renderPanel(makeQuery({ data: makeStatus({ poll_interval: '' }) }));

    expect(screen.getByRole('combobox')).toHaveValue('7d');
  });

  it('renders a usable, never-blank panel for a settled query with no data', () => {
    // Not loading, not error, data undefined — the content branch must still
    // render defaults rather than a blank panel.
    renderPanel(makeQuery({}));

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('7d');
    expect(
      screen.getByText(/U\.S\. Energy Information Administration/i),
    ).toBeInTheDocument();
  });
});

describe('GasPriceControlPanel — accessibility', () => {
  it('exposes per-field names on the icon-only help triggers', () => {
    renderPanel(makeQuery({ data: makeStatus() }));

    expect(
      screen.getByRole('button', { name: /help for gas-auto-poll/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /help for poll-interval/i }),
    ).toBeInTheDocument();
  });
});
