/**
 * RuntimePanel — the Powershare "Live Session" side panel.
 *
 * The component resolves four mutually-exclusive states in a fixed priority
 * order — loading > error > empty > data — then, in the data state, paints a
 * status pill, an optional destination row, and up to two peak-scaled
 * MetricBars (output power + hours remaining). These tests assert every facet
 * the component actually renders in jsdom:
 *   - the state machine and its priority ordering (loading wins even when an
 *     error is also present, because the parent fans five independent queries
 *     in and one can still be in-flight while another has already failed; a
 *     settled error then shows QueryError; an all-null/NaN read degrades to an
 *     EmptyState, never a broken panel),
 *   - the populated view: humanized status, the "Unknown" fallback, the
 *     destination row (shown only when a type is present), and each bar's
 *     formatted sublabel at the correct precision (2dp kW / 1dp h),
 *   - the non-finite hardening (the reason this file exists): a NaN/±Infinity
 *     numeric prop must be treated as "no reading" so the bar is omitted rather
 *     than painted with `width: NaN%`, and a non-finite peak must not poison the
 *     bar's scale,
 *   - error wiring: QueryError's Retry invokes the onRetry callback, and
 *   - a11y: decorative icons are aria-hidden, the empty state is role=status,
 *     the network error is role=alert, and the status dot is color-coded while
 *     still pairing with a text label.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` returns the English default
 * for exact-copy assertions. `useOnlineStatus` is pinned online so QueryError
 * renders its network `role="alert"` branch with an enabled Retry (rather than
 * the offline "retry when online" variant). `useSettings` is provided globally
 * by the test setup, so the real `fmtNumber` produces deterministic en-US
 * strings without a QueryClientProvider. Renders are wrapped in MemoryRouter
 * because QueryError calls `useNavigate()` unconditionally.
 */
import { type ComponentProps, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const tMock = (key: string, opts?: unknown): string => {
  if (typeof opts === 'string') return opts;
  if (opts && typeof opts === 'object') {
    const o = opts as Record<string, unknown>;
    let s = typeof o.defaultValue === 'string' ? o.defaultValue : key;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'defaultValue') continue;
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  }
  return key;
};

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: tMock,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

import { RuntimePanel } from './RuntimePanel';

type Props = ComponentProps<typeof RuntimePanel>;

function renderPanel(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    status: null,
    shareType: null,
    powerKw: null,
    hoursLeft: null,
    powerPeak: 0,
    hoursPeak: 0,
    isLoading: false,
    error: null,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <RuntimePanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

describe('RuntimePanel — state priority', () => {
  it('always renders the panel title and shows the skeleton (no content) while loading', () => {
    const { container } = renderPanel({ isLoading: true, status: 'PowershareStatusActive' });

    // Title chrome is always present regardless of state.
    expect(screen.getByText('Live Session')).toBeInTheDocument();
    // Loading paints the skeleton and suppresses the data rows.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lets loading win over a coexisting error (a sibling query can still be in-flight)', () => {
    const { container } = renderPanel({ isLoading: true, error: new Error('boom') });

    // Skeleton beats the error panel: no alert leaks through while loading.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/can't reach server/i)).toBeNull();
  });

  it('renders an EmptyState (never a blank/data panel) when every signal is null', () => {
    const { container } = renderPanel();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/no live powershare session/i)).toBeInTheDocument();
    // No metric bars, no skeleton.
    expect(screen.queryByText('Output Power')).toBeNull();
    expect(screen.queryByText('Hours Remaining')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('RuntimePanel — error branch', () => {
  it('renders the network alert and wires QueryError Retry to onRetry', () => {
    const { onRetry } = renderPanel({ error: new Error('down') });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/can't reach server/i)).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('RuntimePanel — populated view', () => {
  it('renders the humanized status, destination row, and both formatted bars', () => {
    renderPanel({
      status: 'PowershareStatusActive',
      shareType: 'PowershareTypeHome',
      powerKw: 7.5,
      hoursLeft: 4.2,
      powerPeak: 10,
      hoursPeak: 6,
    });

    // Status row — prefix-stripped + humanized.
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    // Destination row.
    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();

    // Output power bar — 2dp kW sublabel.
    expect(screen.getByText('Output Power')).toBeInTheDocument();
    expect(screen.getByText('7.50 kW')).toBeInTheDocument();

    // Hours remaining bar — 1dp h sublabel.
    expect(screen.getByText('Hours Remaining')).toBeInTheDocument();
    expect(screen.getByText('4.2 h')).toBeInTheDocument();
  });

  it('falls back to "Unknown" status when only numeric data is present', () => {
    renderPanel({ status: null, shareType: null, powerKw: 5 });

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('5.00 kW')).toBeInTheDocument();
    // A null shareType hides the destination row entirely.
    expect(screen.queryByText('Destination')).toBeNull();
  });

  it('shows only the bars that have a reading (hours present, power absent)', () => {
    renderPanel({ hoursLeft: 2.5, powerKw: null, shareType: null });

    expect(screen.getByText('Hours Remaining')).toBeInTheDocument();
    expect(screen.getByText('2.5 h')).toBeInTheDocument();
    // No power reading → no output-power bar.
    expect(screen.queryByText('Output Power')).toBeNull();
    expect(screen.queryByText('Destination')).toBeNull();
  });
});

describe('RuntimePanel — non-finite hardening', () => {
  it('treats a NaN power reading as absent (bar omitted, no NaN width) while keeping hours', () => {
    const { container } = renderPanel({ powerKw: NaN, hoursLeft: 3 });

    // The broken bar must not render at all.
    expect(screen.queryByText('Output Power')).toBeNull();
    expect(screen.queryByText(/kW/)).toBeNull();
    // Hours still renders normally.
    expect(screen.getByText('Hours Remaining')).toBeInTheDocument();
    expect(screen.getByText('3.0 h')).toBeInTheDocument();
    // No NaN leaks into the DOM (e.g. as `width: NaN%`).
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('treats an Infinity hours reading as absent while keeping power', () => {
    const { container } = renderPanel({ hoursLeft: Infinity, powerKw: 6 });

    expect(screen.queryByText('Hours Remaining')).toBeNull();
    expect(screen.getByText('Output Power')).toBeInTheDocument();
    expect(screen.getByText('6.00 kW')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('Infinity');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('does not let a non-finite peak poison the bar scale', () => {
    const { container } = renderPanel({ powerKw: 5, powerPeak: NaN });

    // Bar renders with its readout; the scale falls back to a finite ceiling.
    expect(screen.getByText('5.00 kW')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('degrades to the EmptyState when the only readings are non-finite', () => {
    renderPanel({ powerKw: NaN, hoursLeft: NaN, status: null, shareType: null });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/no live powershare session/i)).toBeInTheDocument();
    expect(screen.queryByText('Output Power')).toBeNull();
  });
});

describe('RuntimePanel — a11y', () => {
  it('marks every icon decorative and color-codes the status dot alongside its label', () => {
    const { container } = renderPanel({
      status: 'PowershareStatusActive',
      shareType: 'PowershareTypeHome',
      powerKw: 7.5,
    });

    const icons = container.querySelectorAll('svg');
    const hidden = container.querySelectorAll('svg[aria-hidden="true"]');
    // Zap (title) + Home (destination) — both hidden from assistive tech.
    expect(icons.length).toBeGreaterThan(0);
    expect(hidden.length).toBe(icons.length);

    // The "success" status maps to an emerald dot, but the text label ("Active")
    // means color is never the sole indicator.
    expect(container.querySelector('.bg-emerald-400')).not.toBeNull();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
