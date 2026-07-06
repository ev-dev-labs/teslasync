/**
 * SoftwareUpdateStatusBreakdown — behaviour + hardening coverage.
 *
 * The component has a single named export (a presentational panel). It takes a
 * `counts` map keyed by the wire status string plus a `total` and renders one
 * <MetricBar> per KNOWN status (those in `UPDATE_STATUS_ORDER`) that has a
 * positive count, in canonical order.
 *
 * What is covered:
 *   1. ORDER    — bars render in `UPDATE_STATUS_ORDER`, not insertion order.
 *   2. FORMAT   — the count is run through `fmtInt` (locale thousands
 *                 separators) and the sublabel is coloured with the status hex.
 *   3. FILTER   — zero, negative, absent, and unknown-status keys are skipped.
 *   4. BUG-FIX  — when `total > 0` but every update carries an UNKNOWN status
 *                 (so no known bar has a positive count), the panel renders an
 *                 <EmptyState> instead of a blank <ul>. Previously this left a
 *                 blank panel (violates "never a blank panel").
 *   5. EMPTY    — an empty `counts` map also yields the <EmptyState>.
 *   6. A11Y     — the bars are exposed as a `list` named "By Status"; the
 *                 empty branch exposes `role="status"`.
 *   7. GUARD    — a `total` of 0 alongside a known positive count does not
 *                 divide by zero — the row still renders.
 *
 * i18n is stubbed so `t(key, fallback)` returns the English fallback, matching
 * the repo's component-test convention. Network is never touched — the
 * component is pure/presentational.
 */

import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { SoftwareUpdateStatusBreakdown } from './SoftwareUpdateStatusBreakdown';
import { UPDATE_STATUS } from './softwareUpdateStatus';

describe('SoftwareUpdateStatusBreakdown', () => {
  it('renders one bar per known status with a positive count, in canonical order (not insertion order)', () => {
    // Insertion order is deliberately scrambled (available → installed →
    // downloading) to prove the component re-orders by UPDATE_STATUS_ORDER
    // (installed → downloading → available) rather than echoing key order.
    render(
      <SoftwareUpdateStatusBreakdown
        counts={{ available: 5, installed: 12, downloading: 3 }}
        total={20}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);

    // Canonical order: installed, downloading, available.
    expect(within(items[0]).getByText('Installed')).toBeInTheDocument();
    expect(within(items[0]).getByText('12')).toBeInTheDocument();
    expect(within(items[1]).getByText('Downloading')).toBeInTheDocument();
    expect(within(items[1]).getByText('3')).toBeInTheDocument();
    expect(within(items[2]).getByText('Available')).toBeInTheDocument();
    expect(within(items[2]).getByText('5')).toBeInTheDocument();

    // Statuses absent from `counts` never render.
    expect(screen.queryByText('Installing')).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
  });

  it('formats the count via fmtInt (locale separators) and colours the sublabel with the status hex', () => {
    render(
      <SoftwareUpdateStatusBreakdown counts={{ installed: 1234 }} total={1234} />,
    );

    // fmtInt applies en-US grouping — a bare "1234" would prove no formatting.
    const sublabel = screen.getByText('1,234');
    expect(sublabel).toBeInTheDocument();
    expect(screen.queryByText('1234')).not.toBeInTheDocument();

    // The MetricBar sublabel carries the status meta hex as an inline colour.
    expect(sublabel).toHaveStyle({ color: UPDATE_STATUS.installed.hex });
    expect(screen.getByText('Installed')).toBeInTheDocument();
  });

  it('skips zero, negative, absent, and unknown-status counts', () => {
    render(
      <SoftwareUpdateStatusBreakdown
        counts={{
          installed: 0, // zero → excluded
          downloading: -2, // negative → excluded
          available: 5, // rendered
          scheduled: 3, // rendered
          failed: 99, // unknown status → excluded
          rebooting: 7, // unknown status → excluded
        }}
        total={8}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    // Only the two positive, known statuses render, in canonical order.
    expect(within(items[0]).getByText('Available')).toBeInTheDocument();
    expect(within(items[1]).getByText('Scheduled')).toBeInTheDocument();

    expect(screen.queryByText('Installed')).not.toBeInTheDocument();
    expect(screen.queryByText('Downloading')).not.toBeInTheDocument();
    // Unknown wire statuses have no bar and no visible label.
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });

  it('renders an EmptyState — never a blank panel — when total > 0 but every update has an unknown status', () => {
    // Regression guard: `total` counts ALL updates (including unknown-status
    // ones), so the parent does not gate this case. With no KNOWN status
    // present the ordered filter is empty; the component must surface an
    // EmptyState rather than an empty <ul>.
    render(
      <SoftwareUpdateStatusBreakdown counts={{ failed: 4, cancelled: 1 }} total={5} />,
    );

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    const empty = screen.getByRole('status');
    expect(empty).toBeInTheDocument();
    expect(
      screen.getByText('No categorized update statuses to show'),
    ).toBeInTheDocument();
  });

  it('renders an EmptyState when the counts map is empty', () => {
    render(<SoftwareUpdateStatusBreakdown counts={{}} total={0} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.getByText('No categorized update statuses to show'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('exposes the bars as a list named "By Status" (a11y)', () => {
    render(<SoftwareUpdateStatusBreakdown counts={{ installed: 2 }} total={2} />);

    const list = screen.getByRole('list', { name: 'By Status' });
    expect(list).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('does not divide by zero when total is 0 but a known status has a positive count', () => {
    // Exercises the `total > 0 ? total : value` denominator guard: a
    // malformed total of 0 must not blank the row or crash the render.
    render(<SoftwareUpdateStatusBreakdown counts={{ installed: 3 }} total={0} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('Installed')).toBeInTheDocument();
    expect(within(items[0]).getByText('3')).toBeInTheDocument();
  });
});
