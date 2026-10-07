// Behavioural contract for AccessOverviewPanel — the context panel beside the
// drivers table on /vehicles/:id/access. It visualises invitation-status and
// driver-role composition and owns its own loading / error / empty / content
// states. These tests exercise every branch of that state machine plus the
// null-safety guards (undefined breakdown arrays, null slice counts), the
// blank-panel guard (isError with no error object), label resolution
// (i18n-key → titleCase fallback → em-dash), the count · percent sublabel
// formatting, and the always-visible title heading.
//
// react-i18next's useTranslation returns the second argument (English
// fallback) when a key is missing, and every vehicleAccess.* key asserted
// here is absent from en.json, so t('key', 'Default') resolves to 'Default'
// with or without an i18n provider. QueryError uses useNavigate, so renders
// are wrapped in a MemoryRouter. Interactions use fireEvent (the repo does
// not depend on @testing-library/user-event).

import { type ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  AccessOverviewPanel,
  type AccessStatusSlice,
  type AccessRoleSlice,
} from './AccessOverviewPanel';
import { ApiError } from '@/api/client';

const MIDDOT = '\u00B7'; // ` · ` separator between count and percent
const EM_DASH = '\u2014'; // `—` shown when a status/role has no label

type Props = ComponentProps<typeof AccessOverviewPanel>;

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    statusBreakdown: [],
    roleBreakdown: [],
    totalInvitations: 0,
    totalDrivers: 0,
    isLoading: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Props> = {}) {
  const props = makeProps(overrides);
  const utils = render(
    <MemoryRouter>
      <AccessOverviewPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

const status = (o: Partial<AccessStatusSlice> = {}): AccessStatusSlice => ({
  status: 'pending',
  count: 3,
  color: '#f59e0b',
  ...o,
});

const role = (o: Partial<AccessRoleSlice> = {}): AccessRoleSlice => ({
  role: 'driver',
  count: 7,
  ...o,
});

describe('AccessOverviewPanel', () => {
  it('always renders the Access Overview title as a heading', () => {
    renderPanel();
    expect(
      screen.getByRole('heading', { name: /access overview/i }),
    ).toBeInTheDocument();
  });

  it('renders both section subheads and the metric rows when data is present', () => {
    renderPanel({
      statusBreakdown: [
        status({ status: 'pending', count: 3, color: '#f59e0b' }),
        status({ status: 'accepted', count: 1, color: '#10b981' }),
      ],
      roleBreakdown: [role({ role: 'driver', count: 7 })],
      totalInvitations: 4,
      totalDrivers: 7,
    });

    // Section headings.
    expect(screen.getByText('Invitation Status')).toBeInTheDocument();
    expect(screen.getByText('Driver Roles')).toBeInTheDocument();

    // titleCase-resolved bar labels.
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();

    // `${count} · ${fmtPercent(pct, 0)}` sublabels: 3/4 = 75%, 1/4 = 25%.
    expect(screen.getByText(`3 ${MIDDOT} 75%`)).toBeInTheDocument();
    expect(screen.getByText(`1 ${MIDDOT} 25%`)).toBeInTheDocument();
  });

  it('renders each driver-role as a chip with its resolved label and count', () => {
    renderPanel({
      roleBreakdown: [role({ role: 'driver', count: 7 })],
      totalDrivers: 7,
    });

    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(list).getByText('Driver')).toBeInTheDocument();
    expect(within(list).getByText('7')).toBeInTheDocument();
  });

  it('shows an accessible loading state and hides the content branches', () => {
    const { container } = renderPanel({
      isLoading: true,
      statusBreakdown: [status()],
      totalInvitations: 3,
    });

    const live = screen.getByRole('status');
    expect(live).toHaveTextContent(/loading/i);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // Loading replaces the content — the section subheads must not render.
    expect(screen.queryByText('Invitation Status')).toBeNull();
  });

  it('prioritises the loading state over the error and empty flags', () => {
    renderPanel({
      isLoading: true,
      isError: true,
      error: new ApiError('boom', 500),
      totalInvitations: 0,
      totalDrivers: 0,
    });

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(screen.queryByText(/server error/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the error state and calls onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    renderPanel({
      isError: true,
      error: new ApiError('server exploded', 500),
      onRetry,
    });

    expect(screen.getByText(/server error/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Error UI replaces the content, it does not augment it.
    expect(screen.queryByText('Invitation Status')).toBeNull();
  });

  it('never renders a blank panel when isError is set without an error object', () => {
    // <QueryError> early-returns null on a falsy error; the panel must fall
    // through to the content state rather than leaving the body blank.
    renderPanel({
      isError: true,
      error: null,
      statusBreakdown: [status({ status: 'pending', count: 2 })],
      totalInvitations: 2,
      totalDrivers: 1,
    });

    expect(screen.getByText('Invitation Status')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/server error/i)).toBeNull();
  });

  it('shows the empty state when there are no invitations and no drivers', () => {
    renderPanel({ totalInvitations: 0, totalDrivers: 0 });

    expect(
      screen.getByText('No access data to summarize yet.'),
    ).toBeInTheDocument();
    // Empty state replaces the section content.
    expect(screen.queryByText('Invitation Status')).toBeNull();
    expect(screen.queryByText('Driver Roles')).toBeNull();
  });

  it('shows the "no invitations" caption while still rendering role chips', () => {
    renderPanel({
      statusBreakdown: [],
      roleBreakdown: [role({ role: 'owner', count: 1 })],
      totalInvitations: 0,
      totalDrivers: 1, // non-zero → not globally empty
    });

    expect(screen.getByText('No invitations yet')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    // The role chip's own count still renders.
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('shows the "no drivers" caption while still rendering status bars', () => {
    renderPanel({
      statusBreakdown: [status({ status: 'expired', count: 5, color: '#64748b' })],
      roleBreakdown: [],
      totalInvitations: 5,
      totalDrivers: 0, // non-zero invitations → not globally empty
    });

    expect(screen.getByText('No drivers yet')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText(`5 ${MIDDOT} 100%`)).toBeInTheDocument();
  });

  it('is null-safe against undefined breakdown arrays', () => {
    // The prop contract types these as required arrays; a mid-flight hook
    // could still hand us undefined. `.length` / `.map` must not throw.
    expect(() =>
      renderPanel({
        statusBreakdown: undefined as unknown as AccessStatusSlice[],
        roleBreakdown: undefined as unknown as AccessRoleSlice[],
        totalInvitations: 3,
        totalDrivers: 2,
      }),
    ).not.toThrow();

    expect(screen.getByText('No invitations yet')).toBeInTheDocument();
    expect(screen.getByText('No drivers yet')).toBeInTheDocument();
  });

  it('is null-safe against a null slice count (renders 0, not "null")', () => {
    renderPanel({
      statusBreakdown: [
        { status: 'pending', count: null, color: '#f59e0b' } as unknown as AccessStatusSlice,
      ],
      totalInvitations: 5,
    });

    // `count ?? 0` → "0"; without the guard this would render "null · 0%".
    expect(screen.getByText(`0 ${MIDDOT} 0%`)).toBeInTheDocument();
    expect(screen.queryByText(`null ${MIDDOT} 0%`)).toBeNull();
  });

  it('falls back to an em-dash label for a blank status via titleCase', () => {
    renderPanel({
      statusBreakdown: [status({ status: '', count: 1, color: '#000000' })],
      totalInvitations: 1,
    });

    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
    expect(screen.getByText(`1 ${MIDDOT} 100%`)).toBeInTheDocument();
  });
});
