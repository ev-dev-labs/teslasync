/**
 * LiveSectionState — five-way per-section render gate.
 *
 * Every data-bound panel on the Live Signal Inspector delegates its
 * loading / empty / error / "no vehicle selected" affordance to this
 * component instead of gating behind a bare `{data && …}`. These tests
 * pin the contract for each `SectionStatus` branch:
 *   - the right affordance renders (Skeleton / EmptyState / QueryError),
 *   - forwarded props (height, icon, message, error, onRetry) reach the
 *     inner component,
 *   - the error branch never goes blank — even for a nullish error,
 *   - ready/retained render children; retained-empty keeps specialist empty copy.
 *
 * QueryError pulls in i18n (`useTranslation`) + Router (`useNavigate`) +
 * `useOnlineStatus`, so we import `@/i18n`, wrap in a MemoryRouter, and
 * force the online branch deterministically (mirrors QueryError.test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/i18n';
import { ApiError } from '@/lib/resilience';
import { LiveSectionState } from './LiveSectionState';
import type { SectionStatus } from './liveSignalStats';

// Keep QueryError's network branch deterministic: always "online" so we
// assert the "Can't reach server" copy rather than the offline variant.
const ONLINE_MOCK = { value: true };
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => ONLINE_MOCK.value,
}));

const READY_CHILD = <div data-testid="ready-body">snapshot table</div>;
const NO_VEHICLE_ICON = <span data-testid="no-vehicle-icon">📡</span>;
const EMPTY_ICON = <span data-testid="empty-icon">∅</span>;

function renderState(
  status: SectionStatus,
  overrides: Partial<React.ComponentProps<typeof LiveSectionState>> = {},
) {
  const props = {
    status,
    error: null as unknown,
    onRetry: vi.fn(),
    noVehicleMessage: 'Pick a vehicle to stream its cache.',
    emptyMessage: 'Redis has no live snapshot for this vehicle yet.',
    noVehicleIcon: NO_VEHICLE_ICON,
    emptyIcon: EMPTY_ICON,
    children: READY_CHILD as ReactNode,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <LiveSectionState {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

beforeEach(() => {
  ONLINE_MOCK.value = true;
});

describe('LiveSectionState', () => {
  describe('no-vehicle branch', () => {
    it('renders the no-vehicle EmptyState (icon + message, role=status) and hides children', () => {
      const { queryByTestId } = renderState('no-vehicle');
      expect(
        screen.getByText('Pick a vehicle to stream its cache.'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('no-vehicle-icon')).toBeInTheDocument();
      // Empty state must be announced to assistive tech.
      expect(screen.getByRole('status')).toBeInTheDocument();
      // The empty-branch icon must NOT leak into the no-vehicle branch.
      expect(queryByTestId('empty-icon')).toBeNull();
      expect(queryByTestId('ready-body')).toBeNull();
    });
  });

  describe('loading branch', () => {
    it('renders a pulsing skeleton at the requested height and hides children', () => {
      const { queryByTestId } = renderState('loading', {
        skeletonHeight: 320,
      });
      const loading = screen.getByRole('status', { name: 'Loading Live snapshot' });
      const skeletons = loading.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
      expect(skeletons).toHaveLength(1);
      const [skeleton] = skeletons;
      expect(skeleton).not.toBeNull();
      expect(skeleton).toHaveClass('h-4', 'w-full', 'rounded', 'bg-[var(--skeleton-bg)]');
      expect(skeleton).toHaveAttribute('aria-hidden', 'true');
      expect(skeleton.style.height).toBe('320px');
      expect(loading).toBeInTheDocument();
      expect(queryByTestId('ready-body')).toBeNull();
    });

    it('falls back to the default skeleton height (220) when none is supplied', () => {
      const { queryByTestId } = renderState('loading');
      const loading = screen.getByRole('status', { name: 'Loading Live snapshot' });
      const skeletons = loading.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
      expect(skeletons).toHaveLength(1);
      const [skeleton] = skeletons;
      expect(skeleton).toHaveClass('h-4', 'w-full', 'rounded', 'bg-[var(--skeleton-bg)]');
      expect(skeleton).toHaveAttribute('aria-hidden', 'true');
      expect(skeleton.style.height).toBe('220px');
      expect(queryByTestId('ready-body')).toBeNull();
    });
  });

  describe('error branch', () => {
    it('renders the server-error affordance and wires Retry to onRetry for a 5xx ApiError', () => {
      const onRetry = vi.fn();
      renderState('error', {
        error: new ApiError('boom', 500),
        onRetry,
      });
      expect(screen.getByText('Server error')).toBeInTheDocument();
      const retry = screen.getByRole('button', { name: /^retry$/i });
      fireEvent.click(retry);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('forwards the raw error so the status-specific branch is chosen (404 → not found)', () => {
      renderState('error', { error: new ApiError('gone', 404) });
      expect(screen.getByText('Resource not found')).toBeInTheDocument();
    });

    it('never goes blank when status is "error" but the error object is nullish', () => {
      const onRetry = vi.fn();
      const { container } = renderState('error', { error: null, onRetry });
      // The synthesized fallback has no HTTP status → network/unknown branch.
      expect(screen.getByText("Can't reach server")).toBeInTheDocument();
      // The panel must render *something* — regression guard against the
      // blank-panel bug where QueryError returns null for a falsy error.
      expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not render children while in the error branch', () => {
      const { queryByTestId } = renderState('error', {
        error: new ApiError('boom', 500),
      });
      expect(queryByTestId('ready-body')).toBeNull();
    });
  });

  describe('empty branch', () => {
    it('renders the empty EmptyState (empty icon + message) and hides children', () => {
      const { queryByTestId } = renderState('empty');
      expect(
        screen.getByText('Redis has no live snapshot for this vehicle yet.'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
      // The no-vehicle icon must NOT leak into the empty branch.
      expect(queryByTestId('no-vehicle-icon')).toBeNull();
      expect(queryByTestId('ready-body')).toBeNull();
    });
  });

  describe('ready branch', () => {
    it('renders children and no loading/empty/error affordance', () => {
      const { container } = renderState('ready');
      expect(screen.getByTestId('ready-body')).toBeInTheDocument();
      expect(screen.getByText('snapshot table')).toBeInTheDocument();
      // No EmptyState (role=status), no Skeleton, no QueryError.
      expect(screen.queryByRole('status')).toBeNull();
      expect(container.querySelectorAll('[aria-hidden="true"].h-4.w-full')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });

    describe('retained branch', () => {
      it('keeps the specialist body visible and retries without replacing it with an error', () => {
        const onRetry = vi.fn();
        renderState('retained', { error: new ApiError('refresh failed', 500), onRetry });
        expect(screen.getByTestId('ready-body')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Previously loaded data remains visible');
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('ready-body')).toBeInTheDocument();
      });

      it('keeps a retained empty snapshot distinct from a fresh empty answer or a fatal error', () => {
        const onRetry = vi.fn();
        renderState('retained-empty', { error: new ApiError('refresh failed', 500), onRetry });
        expect(screen.getByText('Redis has no live snapshot for this vehicle yet.')).toBeInTheDocument();
        expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
        expect(screen.queryByTestId('ready-body')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
      });
    });
  })
});
