import { type ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  AccessOverviewPanel,
  type AccessStatusSlice,
  type AccessRoleSlice,
} from './AccessOverviewPanel';
import { ApiError } from '@/api/client';
import { deriveDataState } from '@/api/dataState';
import { typography } from '@/lib/tokens';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const MIDDOT = '\u00B7'; // ` · ` separator between count and percent
const EM_DASH = '\u2014'; // `—` shown when a status/role has no label

type Props = ComponentProps<typeof AccessOverviewPanel>;

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    statusBreakdown: [],
    roleBreakdown: [],
    totalInvitations: 0,
    totalDrivers: 0,
    driversState: deriveDataState({ data: [] }),
    invitationsState: deriveDataState({ data: [] }),
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
  color: 'var(--semantic-warning)',
  ...o,
});

const role = (o: Partial<AccessRoleSlice> = {}): AccessRoleSlice => ({
  role: 'driver',
  count: 7,
  ...o,
});

describe('AccessOverviewPanel', () => {
  it('reactively formats secondary counts without changing bar totals or ratios', () => {
    const preferences = getFormatterPreferences();
    const props = makeProps({
      statusBreakdown: [status({ count: 1234 })],
      roleBreakdown: [role({ count: 1234 })],
      totalInvitations: 2468,
      totalDrivers: 1234,
    });
    try {
      setGlobalLocale('en-US');
      setGlobalPrecision(2);
      renderPanel(props);
      const bar = screen.getByRole('progressbar', { name: 'pending' });
      expect(screen.getByText(`1,234 ${MIDDOT} 50.00%`)).toBeInTheDocument();
      expect(within(screen.getByRole('list')).getByText('1,234')).toBeInTheDocument();
      expect(bar).toHaveAttribute('aria-valuenow', '1234');
      expect(bar).toHaveAttribute('aria-valuemax', '2468');

      act(() => {
        setGlobalLocale('de-DE');
        setGlobalPrecision(3);
      });
      expect(screen.getByText(`1.234 ${MIDDOT} 50,000%`)).toBeInTheDocument();
      expect(within(screen.getByRole('list')).getByText('1.234')).toBeInTheDocument();
      expect(bar).toHaveAttribute('aria-valuenow', '1234');
      expect(bar).toHaveAttribute('aria-valuemax', '2468');
      expect(props.statusBreakdown[0].count).toBe(1234);
      expect(props.roleBreakdown[0].count).toBe(1234);
    } finally {
      act(() => {
        setGlobalLocale(preferences.locale);
        setGlobalPrecision(preferences.precision);
      });
    }
  });

  it.each([false, true])('uses neutral, decorative shared icons with populated data: %s', (populated) => {
    const { container } = renderPanel(populated ? {
      statusBreakdown: [status()],
      roleBreakdown: [role()],
      totalInvitations: 3,
      totalDrivers: 7,
    } : {});

    const heading = screen.getByRole('heading', { name: /access overview/i });
    const titleIcon = heading.querySelector('svg');
    expect(titleIcon).toHaveClass('h-4', 'w-4', 'shrink-0', typography.color.muted);
    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(populated ? 1 : 2);
    for (const icon of icons) {
      expect(icon).toHaveClass('shrink-0', typography.color.muted);
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
      expect(icon).not.toHaveAttribute('role', 'img');
    }
    if (!populated) {
      expect(icons[1]).toHaveClass('h-6', 'w-6');
      expect(screen.getByText('No access data to summarize yet.')).toBeInTheDocument();
    }
  });

  it('always renders the Access Overview title as a heading', () => {
    renderPanel();
    expect(
      screen.getByRole('heading', { name: /access overview/i }),
    ).toBeInTheDocument();
  });

  it('renders both section subheads and the metric rows when data is present', () => {
    renderPanel({
      statusBreakdown: [
        status({ status: 'pending', count: 3, color: 'var(--semantic-warning)' }),
        status({ status: 'accepted', count: 1, color: 'var(--semantic-success)' }),
      ],
      roleBreakdown: [role({ role: 'driver', count: 7 })],
      totalInvitations: 4,
      totalDrivers: 7,
    });

    // Section headings.
    expect(screen.getByText('Invitation status')).toBeInTheDocument();
    expect(screen.getByText('Driver roles')).toBeInTheDocument();

    // Catalog-resolved bar labels (vehicleAccess.status.*).
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();

    // `${count} · ${fmtPercent(pct, 0)}` sublabels: 3/4 = 75%, 1/4 = 25%.
    expect(screen.getByText(`3 ${MIDDOT} 75.00%`)).toBeInTheDocument();
    expect(screen.getByText(`1 ${MIDDOT} 25.00%`)).toBeInTheDocument();
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

  it('loads invitations without hiding available driver roles', () => {
    const { container } = renderPanel({
      invitationsState: deriveDataState({ isFetching: true }),
      roleBreakdown: [role()],
      totalDrivers: 7,
    });

    const live = screen.getByRole('status');
    expect(live).toHaveTextContent(/loading/i);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    const skeleton = container.querySelector(
      '[aria-busy="true"] [aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]',
    );
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveStyle({ height: '100px' });
    expect(skeleton).toHaveClass('w-full');
    expect(skeleton).not.toHaveClass('animate-pulse');
    expect(screen.getByText('Invitation status')).toBeInTheDocument();
    expect(screen.getByText('Driver roles')).toBeInTheDocument();
    expect(screen.getByText('Driver')).toBeInTheDocument();
    expect(screen.queryByText('pending')).toBeNull();
  });

  it('keeps invitation loading independent of a fatal driver error', () => {
    renderPanel({
      invitationsState: deriveDataState({ isFetching: true }),
      driversState: deriveDataState({ error: new ApiError('boom', 500) }),
    });

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.getByText(/server error/i)).toBeInTheDocument();
  });

  it('retries only failed invitations and keeps driver composition visible', () => {
    const onRetry = vi.fn();
    const driversRetry = vi.fn();
    renderPanel({
      invitationsState: deriveDataState({ error: new ApiError('server exploded', 500), refetch: onRetry }),
      driversState: deriveDataState({ data: [], refetch: driversRetry }),
      roleBreakdown: [role()],
      totalDrivers: 7,
    });

    expect(screen.getByText(/server error/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(driversRetry).not.toHaveBeenCalled();
    expect(screen.getByText('Driver')).toBeInTheDocument();
  });

  it('renders a fatal source error even when the query supplies no error object', () => {
    renderPanel({
      invitationsState: deriveDataState({ isError: true, refetch: vi.fn() }),
    });

    expect(screen.getByText('Invitation status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows the empty state when there are no invitations and no drivers', () => {
    renderPanel({ totalInvitations: 0, totalDrivers: 0 });

    expect(
      screen.getByText('No access data to summarize yet.'),
    ).toBeInTheDocument();
    // Empty state replaces the section content.
    expect(screen.queryByText('Invitation status')).toBeNull();
    expect(screen.queryByText('Driver roles')).toBeNull();
  });

  it('distinguishes paused initial data from successful empty data and retries the paused source', () => {
    const retry = vi.fn();
    renderPanel({
      invitationsState: deriveDataState({ fetchStatus: 'paused', refetch: retry }),
    });
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.getByText('No drivers yet')).toBeInTheDocument();
    expect(screen.queryByText('No invitations yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No access data to summarize yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('retains composition through a refresh failure and clears the warning after recovery', () => {
    const retry = vi.fn();
    const props = makeProps({
      invitationsState: deriveDataState({ data: [], error: new Error('refresh failed'), refetch: retry }),
      statusBreakdown: [status()],
      totalInvitations: 3,
    });
    const view = render(<MemoryRouter><AccessOverviewPanel {...props} /></MemoryRouter>);
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(<MemoryRouter><AccessOverviewPanel {...props} invitationsState={deriveDataState({ data: [] })} /></MemoryRouter>);
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
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
      statusBreakdown: [status({ status: 'expired', count: 5, color: 'var(--text-secondary)' })],
      roleBreakdown: [],
      totalInvitations: 5,
      totalDrivers: 0, // non-zero invitations → not globally empty
    });

    expect(screen.getByText('No drivers yet')).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
    expect(screen.getByText(`5 ${MIDDOT} 100.00%`)).toBeInTheDocument();
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
        { status: 'pending', count: null, color: 'var(--semantic-warning)' } as unknown as AccessStatusSlice,
      ],
      totalInvitations: 5,
    });

    // `count ?? 0` → "0"; without the guard this would render "null · 0%".
    expect(screen.getByText(`0 ${MIDDOT} 0.00%`)).toBeInTheDocument();
    expect(screen.queryByText(`null ${MIDDOT} 0.00%`)).toBeNull();
  });

  it('falls back to an em-dash label for a blank status via titleCase', () => {
    renderPanel({
      statusBreakdown: [status({ status: '', count: 1, color: 'var(--text-secondary)' })],
      totalInvitations: 1,
    });

    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
    expect(screen.getByText(`1 ${MIDDOT} 100.00%`)).toBeInTheDocument();
  });
});


describe('AccessOverviewPanel — palette consumer compatibility', () => {
  it('renders CSS-variable colors as solid fills with unchanged labels, counts and percentages', () => {
    const { container } = renderPanel({
      statusBreakdown: [
        status({ status: 'pending', count: 3, color: 'var(--semantic-warning)' }),
        status({ status: 'accepted', count: 1, color: 'var(--semantic-success)' }),
      ],
      roleBreakdown: [role({ role: 'owner', count: 1 })],
      totalInvitations: 4,
      totalDrivers: 1,
    });
    for (const [label, color, count] of [
      ['pending', 'var(--semantic-warning)', '3'],
      ['accepted', 'var(--semantic-success)', '1'],
    ]) {
      const bar = screen.getByRole('progressbar', { name: label });
      expect(bar).toHaveAttribute('aria-valuenow', count);
      expect(bar).toHaveAttribute('aria-valuemax', '4');
      const fill = bar.querySelector<HTMLElement>('[data-metric-fill]');
      // Exercise the real MetricBar: its gradient appends 99, invalid for var().
      expect(fill?.style.background).toBe(color);
      expect(fill).toHaveClass('forced-colors:!bg-[Highlight]', 'forced-colors:!bg-none');
    }
    expect(container.querySelectorAll('[data-metric-fill]')).toHaveLength(2);
    expect(screen.getByText(`3 ${MIDDOT} 75.00%`)).toBeInTheDocument();
    expect(screen.getByText(`1 ${MIDDOT} 25.00%`)).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('Owner')).toBeInTheDocument();
  });
});
