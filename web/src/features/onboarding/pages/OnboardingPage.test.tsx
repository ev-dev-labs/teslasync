import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '../../../i18n';

import OnboardingPage from './OnboardingPage';
import type { OnboardingStatus } from '@/api/hooks/useOnboarding';
import { __resetAnnouncerForTests } from '@/hooks/useAnnouncer';
import { __resetStatusAnnouncerForTests } from '@/hooks/useStatusAnnouncer';
import { __resetAnnouncePolicyForTests } from '@/lib/announcePolicy';

// Mock framer-motion so FadeIn renders children eagerly without
// IntersectionObserver awareness.
vi.mock('framer-motion', () => {
  const tagCache = new Map<
    PropertyKey,
    (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode
  >();

  return {
    motion: new Proxy(
      {},
      {
        get: (_target, key) => {
          let Component = tagCache.get(key);
          if (!Component) {
            Component = ({ children, ...props }) => {
              const safe = filterMotionProps(props);
              return <div {...safe}>{children}</div>;
            };
            tagCache.set(key, Component);
          }
          return Component;
        },
      },
    ),
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useInView: () => true,
    useReducedMotion: () => false,
  };
});

function filterMotionProps(props: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      key === 'initial' || key === 'animate' || key === 'exit' || key === 'transition' ||
      key === 'whileHover' || key === 'whileTap' || key === 'whileInView' ||
      key === 'viewport' || key === 'variants' || key === 'layout' || key === 'layoutId'
    ) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

const refetchSpy = vi.fn(() => Promise.resolve({} as unknown));

function status(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    tesla_connected: false,
    vehicle_count: 0,
    data_flowing: false,
    last_telemetry_at: null,
    telemetry_health: 'unknown',
    setup_required: true,
    setup_complete: false,
    is_complete: false,
    ...overrides,
  };
}

let mockStatus: OnboardingStatus | undefined = status();
let mockIsLoading = false;
let mockIsFetching = false;
let mockError: Error | null = null;
let mockFetchStatus: 'idle' | 'fetching' | 'paused' = 'idle';
let mockReduce = false;

vi.mock('@/api/hooks/useOnboarding', () => ({
  useOnboardingStatus: () => ({
    data: mockStatus,
    isLoading: mockIsLoading,
    isFetching: mockIsFetching,
    refetch: refetchSpy,
    isError: mockError != null,
    error: mockError,
    fetchStatus: mockFetchStatus,
  }),
}));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({
    reduce: mockReduce,
    durationMs: mockReduce ? 0 : 250,
  }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | null | undefined) => value ?? '—',
  }),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      decimal_precision: 2,
      locale: 'en-US',
      currency_symbol: '$',
    },
    settingsUnavailable: false,
    locale: 'en-US',
  }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<OnboardingPage />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/onboarding']}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    ),
  });
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetStatusAnnouncerForTests();
    __resetAnnouncerForTests();
    __resetAnnouncePolicyForTests();
    refetchSpy.mockClear();
    navigateMock.mockClear();
    mockIsLoading = false;
    mockIsFetching = false;
    mockError = null;
    mockFetchStatus = 'idle';
    mockReduce = false;
    mockStatus = status();
    try {
      window.localStorage.removeItem('teslasync:onboarding:skipped:v1');
    } catch {
      /* ignore */
    }
  });

  it('renders the welcome heading and three setup steps', () => {
    renderPage();
    expect(screen.getByText(/Welcome to TeslaSync/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect your Tesla account/i)).toBeInTheDocument();
    expect(screen.getByText(/Wait for vehicles to appear/i)).toBeInTheDocument();
    expect(screen.getByText(/Wait for telemetry data/i)).toBeInTheDocument();
  });

  it('owns a touch-friendly viewport scroller because the global body is non-scrolling', () => {
    renderPage();
    const scroller = screen.getByRole('main');
    expect(scroller).toHaveAttribute('data-testid', 'onboarding-scroll-container');
    expect(scroller).toHaveClass('h-dvh', 'overflow-y-auto', 'overscroll-y-contain');
    expect(scroller.className).toContain('[touch-action:pan-y]');
  });

  it('shows the Continue button only when onboarding is complete', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /Continue to dashboard/i })).toBeNull();
  });

  it('shows the Continue button once is_complete is true', async () => {
    mockStatus = status({
      tesla_connected: true,
      vehicle_count: 1,
      data_flowing: true,
      last_telemetry_at: '2026-01-01T00:00:00Z',
      telemetry_health: 'healthy',
      setup_required: false,
      setup_complete: true,
      is_complete: true,
    });
    renderPage();
    const cta = await screen.findByRole('button', { name: /Continue to dashboard/i });
    expect(cta).toBeInTheDocument();

    fireEvent.click(cta);
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('renders the connect Tesla CTA on the first step when no token', async () => {
    renderPage();
    // The "Connect Tesla account" CTA appears as the in-progress
    // action button below the first step description.
    const cta = await screen.findByRole('button', { name: /Connect Tesla account/i });
    fireEvent.click(cta);
    expect(navigateMock).toHaveBeenCalledWith('/tesla-account');
  });

  it('Check again button calls refetch', async () => {
    renderPage();
    const button = screen.getByRole('button', { name: /Check again/i });
    fireEvent.click(button);
    await waitFor(() => expect(refetchSpy).toHaveBeenCalled());
  });

  it('shows the Skip for now button when not complete and skips on click', async () => {
    renderPage();
    const skipBtn = await screen.findByRole('button', { name: /Skip for now/i });
    expect(skipBtn).toBeInTheDocument();

    fireEvent.click(skipBtn);
    expect(navigateMock).toHaveBeenCalledWith('/');
    // The skip flag is persisted in localStorage so the gate honours it.
    expect(window.localStorage.getItem('teslasync:onboarding:skipped:v1')).toBe('1');
  });

  it('hides the Skip for now button once onboarding is complete', () => {
    mockStatus = status({
      tesla_connected: true,
      vehicle_count: 1,
      data_flowing: true,
      last_telemetry_at: '2026-01-01T00:00:00Z',
      telemetry_health: 'healthy',
      setup_required: false,
      setup_complete: true,
      is_complete: true,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: /Skip for now/i })).toBeNull();
  });

  it('advances the in-progress indicator when the first anchor is satisfied', () => {
    mockStatus = status({
      tesla_connected: true,
      vehicle_count: 0,
      data_flowing: false,
    });
    renderPage();
    // The first step should be done (no more "Connect Tesla account" button)
    expect(screen.queryByRole('button', { name: /Connect Tesla account/i })).toBeNull();
    // The second step should now show its Refresh CTA.
    expect(screen.getByRole('button', { name: /^Refresh$/i })).toBeInTheDocument();
  });

  it('keeps configured users complete and explains a telemetry outage', () => {
    mockStatus = status({
      tesla_connected: true,
      vehicle_count: 1,
      data_flowing: false,
      last_telemetry_at: '2026-01-01T00:00:00Z',
      telemetry_health: 'stale',
      setup_required: false,
      setup_complete: true,
      is_complete: true,
    });

    renderPage();

    expect(screen.getByTestId('onboarding-runtime-health')).toBeInTheDocument();
    expect(screen.getByText(/keep using TeslaSync and viewing stored history/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue to dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Skip for now/i })).toBeNull();
  });

  it('retains setup status, current-step action and every section after a background error', () => {
    mockStatus = status({ tesla_connected: true, vehicle_count: 0 });
    mockError = new Error('Refresh unavailable');
    const { container } = renderPage();
    expect(container.querySelector('[data-layout-reference]')).not.toBeNull();
    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(screen.getByText('Vehicles synced')).toBeInTheDocument();
    expect(screen.getByText(/What you.ll unlock/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Tesla account/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Skip for now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check again/i })).toBeInTheDocument();
  });

  it('migrates only the existing setup summary while preserving profile, checklist and resource controls', () => {
    const { container } = renderPage();
    const brief = screen.getByTestId('onboarding-setup-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(screen.getByText('Tailor your workspace')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Onboarding steps' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Resources & help' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Tesla account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('renders the telemetry guide as one named native link without a nested button', () => {
    mockStatus = status({ tesla_connected: true, vehicle_count: 1 });
    renderPage();

    const steps = screen.getByRole('list', { name: 'Onboarding steps' });
    const guide = within(steps).getByRole('link', { name: 'Setup guide (opens in a new tab)' });
    expect(guide).toHaveAccessibleName('Setup guide (opens in a new tab)');
    expect(within(guide).getByText('(opens in a new tab)')).toHaveClass('sr-only');
    expect(guide.closest('li')).toHaveAttribute('id', 'onboarding-step-telemetry');
    expect(guide.closest('li')).toHaveAttribute('aria-current', 'step');
    expect(guide).toHaveAttribute('href', '/docs/fleet-telemetry-setup');
    expect(guide).toHaveAttribute('target', '_blank');
    expect(guide).toHaveAttribute('rel', 'noreferrer noopener');
    expect(guide.querySelector('button')).toBeNull();
    expect(guide).toHaveClass('min-h-11', 'md:min-h-9', 'whitespace-normal');
    expect(screen.queryByRole('button', { name: 'Setup guide' })).toBeNull();
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
  });

  it('uses neutral decorative icons and reachable mobile setup and footer actions', () => {
    renderPage();

    for (const name of ['Connect Tesla account', 'Check again', 'Skip for now']) {
      const action = screen.getByRole('button', { name });
      expect(action).toHaveClass('min-h-11');
      expect(action.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    for (const heading of ['Tailor your workspace', 'Setup checklist']) {
      const icon = screen.getByText(heading).parentElement?.parentElement?.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden');
      expect(icon?.parentElement).toHaveClass(
        'bg-[var(--surface-2)]',
        'text-[var(--text-secondary)]',
      );
    }
    expect(screen.getByRole('combobox', { name: 'Primary use' })).toHaveAttribute(
      'id',
      'onboarding-workspace-profile',
    );
  });

  it('keeps refresh controls disabled and preserves sections while reduced-motion refresh is busy', () => {
    mockStatus = status({ tesla_connected: true });
    mockIsFetching = true;
    mockFetchStatus = 'fetching';
    mockReduce = true;
    const { container } = renderPage();

    expect(container.querySelector('[data-role="page-container"]')).toHaveAttribute('aria-busy', 'true');
    for (const name of ['Checking…', 'Check again']) {
      const action = screen.getByRole('button', { name });
      expect(action).toBeDisabled();
      expect(action).toHaveClass('min-h-11');
      expect(action.querySelector('svg')).not.toHaveClass('animate-spin');
      fireEvent.click(action);
    }
    expect(refetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('navigation', { name: 'Resources & help' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: "What you'll unlock" }).children).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled();
  });

  it('explains unresolved initial setup without hiding any steps or exploration controls', () => {
    mockStatus = undefined;
    mockIsLoading = true;
    mockIsFetching = true;
    mockFetchStatus = 'fetching';
    renderPage();

    expect(within(screen.getByTestId('onboarding-status-pending')).getByText(
      'Setup status has not been received; no completed-step or vehicle count is known.',
    )).toBeInTheDocument();
    expect(screen.getByText('Setup status not yet received')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Onboarding steps' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('combobox', { name: 'Primary use' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Resources & help' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: "What you'll unlock" }).children).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Connect Tesla account' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Continue to dashboard' })).toBeNull();
  });

  it.each(['fetching', 'paused', 'failed', 'idle'] as const)(
    'keeps all completion anchors unknown before a status response (%s)',
    (state) => {
      mockStatus = undefined;
      mockIsLoading = state === 'fetching';
      mockIsFetching = state === 'fetching';
      mockFetchStatus = state === 'fetching' || state === 'paused' ? state : 'idle';
      mockError = state === 'failed' ? new Error('Setup status read unavailable') : null;
      renderPage();

      const steps = screen.getByRole('list', { name: 'Onboarding steps' });
      expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
      expect(within(steps).getAllByText('Unknown')).toHaveLength(3);
      for (const label of ['Completed', 'In progress', 'Not started']) {
        expect(within(steps).queryByText(label)).toBeNull();
      }
      for (const key of ['tesla', 'vehicle', 'telemetry']) {
        expect(steps.querySelector(`#onboarding-step-${key}`)).not.toBeNull();
      }
      expect(screen.getByRole('button', { name: 'Connect Tesla account' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Continue to dashboard' })).toBeNull();
    },
  );

  it('replaces unknown evidence with confirmed anchor states when setup status arrives', () => {
    mockStatus = undefined;
    const { rerender } = renderPage();
    mockStatus = status({ tesla_connected: true });
    rerender(<OnboardingPage />);

    const steps = screen.getByRole('list', { name: 'Onboarding steps' });
    expect(within(steps).queryByText('Unknown')).toBeNull();
    for (const label of ['Completed', 'In progress', 'Not started']) {
      expect(within(steps).getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Connect Tesla account' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(steps.querySelector('#onboarding-step-vehicle')).toHaveAttribute('aria-current', 'step');
  });

  it('retains paused setup status and current-step refresh without claiming a device outage', () => {
    mockStatus = status({ tesla_connected: true });
    mockFetchStatus = 'paused';
    renderPage();

    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(within(screen.getByTestId('stale-refresh-warning')).getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.getByText('Refresh is paused. Retained data remains available.')).toBeInTheDocument();
    expect(screen.queryByText('This page refreshes automatically every 30 seconds.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Setup status details' });
    expect(within(drawer).getByText('Retained setup status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Connect Tesla account' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled();
    expect(screen.queryByText(/device is offline/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue to dashboard' })).toBeNull();
  });

  it('explains initial paused refresh without claiming missing anchors or a device outage', () => {
    mockStatus = undefined;
    mockFetchStatus = 'paused';
    renderPage();

    const pending = screen.getByTestId('onboarding-status-pending');
    expect(pending).toHaveAttribute('data-refresh-blocked', 'true');
    expect(within(pending).getByText('Refresh paused')).toBeInTheDocument();
    expect(within(pending).getByText(
      'Setup status has not been received; no completed-step or vehicle count is known.',
    )).toBeInTheDocument();
    expect(screen.queryByText('This page refreshes automatically every 30 seconds.')).toBeNull();
    expect(screen.queryByText(/device is offline/i)).toBeNull();
    expect(screen.getByTestId('announcer-polite')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(refetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Connect Tesla account' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled();
    expect(screen.getByRole('navigation', { name: 'Resources & help' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: "What you'll unlock" }).children).toHaveLength(4);
  });

  it('announces the initial status outcome once without hiding sections or narrating polling', () => {
    mockStatus = undefined;
    mockIsLoading = true;
    mockIsFetching = true;
    mockFetchStatus = 'fetching';
    const { rerender } = renderPage();
    expect(screen.getByRole('navigation', { name: 'Resources & help' })).toBeInTheDocument();
    expect(screen.getByTestId('announcer-polite')).toBeEmptyDOMElement();

    mockIsLoading = false;
    mockIsFetching = false;
    mockFetchStatus = 'paused';
    rerender(<OnboardingPage />);
    expect(screen.getByTestId('announcer-polite')).toBeEmptyDOMElement();

    mockStatus = status({ tesla_connected: true });
    mockFetchStatus = 'idle';
    rerender(<OnboardingPage />);
    const announcement = screen.getByTestId('announcer-polite');
    expect(announcement).toHaveTextContent('Setup status loaded');
    const initialAnnouncement = announcement.textContent;

    mockIsFetching = true;
    mockFetchStatus = 'fetching';
    rerender(<OnboardingPage />);
    mockIsFetching = false;
    mockFetchStatus = 'idle';
    mockStatus = status({ tesla_connected: true, vehicle_count: 1 });
    rerender(<OnboardingPage />);
    expect(announcement.textContent).toBe(initialAnnouncement);
    expect(screen.getByTestId('announcer-assertive')).toBeEmptyDOMElement();
    expect(screen.getByRole('list', { name: 'Onboarding steps' })).toBeInTheDocument();
  });

  it('does not promise interval polling while the tab is hidden', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    renderPage();

    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByText('This page refreshes automatically every 30 seconds.')).toBeNull();
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled();
  });

  it('announces a failed initial load without announcing successful completion', () => {
    mockStatus = undefined;
    mockIsLoading = true;
    mockIsFetching = true;
    mockFetchStatus = 'fetching';
    const { rerender } = renderPage();

    mockIsLoading = false;
    mockIsFetching = false;
    mockFetchStatus = 'idle';
    mockError = new Error('Setup status read unavailable');
    rerender(<OnboardingPage />);

    expect(screen.getByTestId('announcer-assertive')).toHaveTextContent('Could not refresh Setup status');
    expect(screen.getByTestId('announcer-polite')).toBeEmptyDOMElement();
    expect(screen.getByRole('navigation', { name: 'Resources & help' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    expect(screen.getByRole('list', { name: "What you'll unlock" }).children).toHaveLength(4);
  });

  it('keeps failed initial setup explainable and recoverable without removing neighboring sections', () => {
    mockStatus = undefined;
    mockError = new Error('Setup status read unavailable');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Setup status details' });
    expect(within(drawer).getByText('Setup status unavailable')).toBeInTheDocument();
    expect(screen.getByText('Setup status not yet received')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Onboarding steps' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Resources & help' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: "What you'll unlock" }).children).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(refetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
  });
});
