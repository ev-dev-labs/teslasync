import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '../../../i18n';

import OnboardingPage from './OnboardingPage';
import type { OnboardingStatus } from '@/api/hooks/useOnboarding';

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

let mockStatus: OnboardingStatus = status();
let mockIsLoading = false;
let mockIsFetching = false;

vi.mock('@/api/hooks/useOnboarding', () => ({
  useOnboardingStatus: () => ({
    data: mockStatus,
    isLoading: mockIsLoading,
    isFetching: mockIsFetching,
    refetch: refetchSpy,
  }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | null | undefined) => value ?? '—',
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
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <OnboardingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    refetchSpy.mockClear();
    navigateMock.mockClear();
    mockIsLoading = false;
    mockIsFetching = false;
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
});
