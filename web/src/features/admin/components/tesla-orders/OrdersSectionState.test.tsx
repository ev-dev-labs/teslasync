/**
 * OrdersSectionState — four-way per-section render gate for the Tesla Orders page.
 *
 * Every data-bound panel on the page delegates its loading / empty / error
 * affordance to this component instead of gating behind a bare `{data && …}`.
 * These tests pin the contract for each `OrderSectionStatus` branch:
 *   - the right affordance renders (Skeleton / QueryError / EmptyState),
 *   - forwarded props (skeletonHeight, error, onRetry, resourceName, emptyIcon,
 *     emptyTitle, emptyMessage, emptyAction) reach the inner component,
 *   - the error branch never goes blank — even for a nullish `error` (the
 *     regression this component exists to prevent), and
 *   - only the `ready` branch renders `children`.
 *
 * QueryError pulls in i18n (`useTranslation`) + Router (`useNavigate`) +
 * `useOnlineStatus`, so we import `@/i18n`, wrap in a MemoryRouter, and force
 * the online branch deterministically (mirrors LiveSectionState.test /
 * QueryError.test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/i18n';
import { ApiError } from '@/lib/resilience';
import { OrdersSectionState } from './OrdersSectionState';
import type { OrderSectionStatus } from './teslaOrderStats';

// Keep QueryError's network branch deterministic: always "online" so the
// nullish-error fallback lands on the "Can't reach server" copy rather than
// the offline variant.
const ONLINE_MOCK = { value: true };
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => ONLINE_MOCK.value,
}));

const READY_CHILD = <div data-testid="ready-body">orders board</div>;
const EMPTY_ICON = <span data-testid="empty-icon">📦</span>;
const EMPTY_MESSAGE = 'No active orders found on this Tesla account.';
const EMPTY_TITLE = 'No orders';

function renderState(
  status: OrderSectionStatus,
  overrides: Partial<React.ComponentProps<typeof OrdersSectionState>> = {},
) {
  const props = {
    status,
    error: null as unknown,
    onRetry: vi.fn(),
    emptyMessage: EMPTY_MESSAGE,
    emptyIcon: EMPTY_ICON,
    emptyTitle: EMPTY_TITLE,
    children: READY_CHILD as ReactNode,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <OrdersSectionState {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

beforeEach(() => {
  ONLINE_MOCK.value = true;
});

describe('OrdersSectionState', () => {
  describe('loading branch', () => {
    it('renders a pulsing skeleton at the requested height and hides children', () => {
      const { container, queryByTestId } = renderState('loading', {
        skeletonHeight: 320,
      });
      const skeleton = container.querySelector('.animate-pulse');
      expect(skeleton).not.toBeNull();
      expect((skeleton as HTMLElement).style.height).toBe('320px');
      // No affordance from other branches leaks in.
      expect(queryByTestId('ready-body')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('falls back to the default skeleton height (220) when none is supplied', () => {
      const { container } = renderState('loading');
      const skeleton = container.querySelector('.animate-pulse') as HTMLElement;
      expect(skeleton.style.height).toBe('220px');
    });
  });

  describe('error branch', () => {
    it('renders the server-error affordance and wires Retry to onRetry for a 5xx ApiError', () => {
      const onRetry = vi.fn();
      renderState('error', { error: new ApiError('boom', 500), onRetry });
      expect(screen.getByText('Server error')).toBeInTheDocument();
      const retry = screen.getByRole('button', { name: /^retry$/i });
      fireEvent.click(retry);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('forwards resourceName so a 404 reads "Orders not found" (not the generic "Resource")', () => {
      renderState('error', { error: new ApiError('gone', 404) });
      // resourceName={t('admin.teslaOrders.resource', 'Orders')} → "Orders".
      expect(screen.getByText('Orders not found')).toBeInTheDocument();
      // The generic fallback thing must NOT be used when a resourceName is given.
      expect(screen.queryByText('Resource not found')).toBeNull();
    });

    it('never goes blank when status is "error" but the error object is nullish', () => {
      const onRetry = vi.fn();
      const { container } = renderState('error', { error: null, onRetry });
      // The synthesized fallback (plain Error, no HTTP status) → network branch.
      expect(screen.getByText("Can't reach server")).toBeInTheDocument();
      // Regression guard against the blank-panel bug: QueryError returns null
      // for a falsy error, so the source must substitute a real Error.
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
    it('renders the empty affordance (icon + title + message, role=status) and hides children', () => {
      const { queryByTestId } = renderState('empty');
      expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
      expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
      expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
      // Empty state must be announced to assistive tech.
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(queryByTestId('ready-body')).toBeNull();
    });

    it('renders the optional recovery CTA and invokes its onClick when present', () => {
      const onClick = vi.fn();
      renderState('empty', {
        emptyAction: { label: 'Refresh from Tesla', onClick },
      });
      const cta = screen.getByRole('button', { name: 'Refresh from Tesla' });
      fireEvent.click(cta);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('stays an informational dead-end (no CTA button) when emptyAction is omitted', () => {
      renderState('empty');
      expect(screen.queryByRole('button')).toBeNull();
      // …but the message still shows, so the section never disappears.
      expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    });
  });

  describe('ready branch', () => {
    it('renders children and no loading/empty/error affordance', () => {
      const { container } = renderState('ready');
      expect(screen.getByTestId('ready-body')).toBeInTheDocument();
      expect(screen.getByText('orders board')).toBeInTheDocument();
      // No EmptyState (role=status), no Skeleton, no QueryError Retry.
      expect(screen.queryByRole('status')).toBeNull();
      expect(container.querySelector('.animate-pulse')).toBeNull();
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });
  });
});
