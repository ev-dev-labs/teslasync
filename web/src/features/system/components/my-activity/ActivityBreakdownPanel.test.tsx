// Behavioural contract for ActivityBreakdownPanel — the reusable ranked
// MetricBar list used by the "Top actions" / "By category" breakdowns on the
// My Activity page. Exercises every branch of its loading / error / empty /
// list state machine, label resolution (i18n-key vs verbatim vs em-dash
// fallback), count·percent sublabel formatting, null-safety, precedence
// ordering, and the blank-panel guard.
//
// react-i18next's useTranslation returns the second argument (English
// fallback) when no provider is mounted, so t('key', 'Default') resolves to
// 'Default' without any i18n setup. QueryError uses useNavigate, so renders
// are wrapped in a MemoryRouter. Interactions use fireEvent (the repo does not
// depend on @testing-library/user-event).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ActivityBreakdownPanel, type ActivityBreakdownPanelProps } from './ActivityBreakdownPanel';
import type { BreakdownSlice } from './myActivityAnalytics';
import { ApiError } from '@/api/client';

const MIDDOT = '\u00B7'; // ` · ` separator used between count and percent
const EM_DASH = '\u2014'; // `—` shown when a slice has no resolvable label

function slice(overrides: Partial<BreakdownSlice> = {}): BreakdownSlice {
  return {
    key: 'drive_start',
    label: 'Drive start',
    count: 10,
    percent: 50,
    color: '#3366ff',
    ...overrides,
  };
}

function makeProps(overrides: Partial<ActivityBreakdownPanelProps> = {}): ActivityBreakdownPanelProps {
  return {
    title: 'Top actions',
    slices: [],
    isLoading: false,
    isError: false,
    isEmpty: false,
    error: null,
    onRetry: vi.fn(),
    emptyMessage: 'No actions in this window.',
    emptyIcon: <svg data-testid="empty-icon" />,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<ActivityBreakdownPanelProps> = {}) {
  const props = makeProps(overrides);
  const utils = render(
    <MemoryRouter>
      <ActivityBreakdownPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

describe('ActivityBreakdownPanel', () => {
  it('renders the title as a heading and forwards the icon and className', () => {
    const { container } = renderPanel({
      title: 'By category',
      icon: <svg data-testid="title-icon" />,
      className: 'custom-panel-class',
      slices: [slice()],
    });

    expect(screen.getByRole('heading', { name: /by category/i })).toBeInTheDocument();
    expect(screen.getByTestId('title-icon')).toBeInTheDocument();
    expect(container.querySelector('.custom-panel-class')).not.toBeNull();
  });

  it('shows an accessible loading state with five skeletons while loading', () => {
    const { container } = renderPanel({ isLoading: true });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/loading/i);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
    // Loading must win over the list / empty branches.
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('prioritises the loading state over the error and empty flags', () => {
    renderPanel({
      isLoading: true,
      isError: true,
      error: new ApiError('boom', 500),
      isEmpty: true,
    });

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(screen.queryByText(/server error/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the error state and calls onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    renderPanel({ isError: true, error: new ApiError('server exploded', 500), onRetry });

    expect(screen.getByText(/server error/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Error UI replaces the list, not augments it.
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('never renders a blank body when isError is set without an error object', () => {
    // <QueryError> early-returns null on a falsy error; the panel must fall
    // through to the empty state rather than leaving the body blank.
    renderPanel({ isError: true, error: null, slices: [], emptyMessage: 'No data yet' });

    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the empty state (message + icon) when isEmpty even if slices exist', () => {
    renderPanel({ isEmpty: true, emptyMessage: 'Nothing here', slices: [slice()] });

    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    // isEmpty takes precedence over the (non-empty) slice list.
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('falls back to the empty state when there are no slices even if isEmpty is false', () => {
    renderPanel({ isEmpty: false, slices: [], emptyMessage: 'No data yet' });

    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders a ranked list with resolved labels and count · percent sublabels', () => {
    renderPanel({
      slices: [
        slice({ key: 'a', label: 'Charging session', i18nKey: undefined, count: 8, percent: 40 }),
        slice({
          key: 'b',
          label: '',
          i18nKey: 'activity.myActivity.action.driveStart',
          fallback: 'Drive start',
          count: 12,
          percent: 60,
        }),
      ],
    });

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    // Verbatim-label branch.
    expect(screen.getByText('Charging session')).toBeInTheDocument();
    // i18n-key branch resolves to the fallback when no provider is mounted.
    expect(screen.getByText('Drive start')).toBeInTheDocument();
    // Sublabels: fmtInt(count) + ' · ' + fmtPercent(percent, 0).
    expect(screen.getByText(`8 ${MIDDOT} 40%`)).toBeInTheDocument();
    expect(screen.getByText(`12 ${MIDDOT} 60%`)).toBeInTheDocument();
  });

  it('prefers the i18n fallback chain: fallback → label → key', () => {
    renderPanel({
      slices: [
        // fallback present → wins over label and key.
        slice({ key: 'k1', label: 'lbl-one', i18nKey: 'activity.a', fallback: 'Fallback wins' }),
        // No fallback, empty label → falls through to the raw key (the `||`
        // chain must skip the empty-string label, not render it blank).
        slice({ key: 'raw_key_only', label: '', i18nKey: 'activity.b', fallback: undefined }),
      ],
    });

    expect(screen.getByText('Fallback wins')).toBeInTheDocument();
    expect(screen.queryByText('lbl-one')).toBeNull();
    expect(screen.getByText('raw_key_only')).toBeInTheDocument();
  });

  it('is null-safe: renders — for a missing label and 0 · 0% for null count/percent', () => {
    // Deliberately malformed slice (contract says these are numbers) to prove
    // the runtime `?? 0` / `|| —` guards hold.
    const malformed = {
      key: 'z',
      label: '',
      count: null,
      percent: null,
      color: '#000000',
    } as unknown as BreakdownSlice;

    renderPanel({ slices: [malformed] });

    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
    expect(screen.getByText(`0 ${MIDDOT} 0%`)).toBeInTheDocument();
  });

  it('tolerates a nullish slices prop without throwing', () => {
    const nullSlices = null as unknown as BreakdownSlice[];
    expect(() =>
      renderPanel({ slices: nullSlices, emptyMessage: 'No data yet' }),
    ).not.toThrow();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
});
