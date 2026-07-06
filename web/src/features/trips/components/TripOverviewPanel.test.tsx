/**
 * `<TripOverviewPanel>` — behaviour + hardening coverage.
 *
 * The panel is a self-sufficient presentational section: it owns a single
 * GlassPanel whose title ("Overview") is ALWAYS visible, and it selects one
 * of four bodies from the `{ trip, isLoading, isError, error, onRetry }`
 * contract — a skeleton (first load), a branched `<QueryError>` (failure), an
 * `<EmptyState>` (no record), or the metadata `<KVList>` (ready). Those four
 * branches, plus the exact KVList row mapping, are what this suite pins down.
 *
 * Strategy: render against the REAL children (KVList / DateTime / QueryError /
 * EmptyState / Skeleton) so the assertions exercise the actual rendered output
 * — that is what surfaces the two hardening fixes (blank name → em-dash;
 * whitespace-only notes → row omitted). `react-i18next` is stubbed to echo the
 * English default (with `{{placeholder}}` interpolation) so copy assertions are
 * deterministic, and the tree is wrapped in a `MemoryRouter` because
 * `<QueryError>`/`<EmptyState>` reach for `useNavigate`/`<Link>`. Network is
 * never touched — the panel takes its query state purely through props.
 *
 * Covered facets:
 *   - INVARIANT: the "Overview" heading renders in every state (loading /
 *     error / empty / ready), and its accessible name excludes the decorative
 *     icon (aria-hidden).
 *   - READY (complete trip): every KVList row maps correctly, timestamps carry
 *     the canonical ISO in their `title`, and the Notes row appears.
 *   - READY (in-progress + null-safety): "In progress" for a missing end date,
 *     "—" for a zero duration, `?? 0` fallbacks for absent counts, blank name
 *     → "—" (fix), and no Notes row when notes are absent.
 *   - EDGE (blank strings): whitespace-only name renders "—" and whitespace-only
 *     notes omit the row (both fixes).
 *   - LOADING: skeleton shown only when there is no cached trip; a background
 *     refetch over an existing trip keeps the data visible (no skeleton).
 *   - ERROR: retryable 5xx renders an alert + a Retry that calls `onRetry`;
 *     a 404 forwards `resourceName`/`listHref` (Back-to-list, no Retry); and a
 *     stale trip does not suppress the error.
 *   - EMPTY: the not-found empty state renders when there is no trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ApiError } from '@/api/client';
import type { TripDetail } from '@/api/types';

// Deterministic i18n: echo the English default and interpolate {{placeholder}}.
// Mirrors the sibling TripDetailPage suite so copy is stable regardless of the
// real resource bundles.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { TripOverviewPanel } from './TripOverviewPanel';

// ── Contract mirror (the interface is not exported from the component) ───────
type PanelProps = {
  trip: TripDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
};

// ── Fixtures ─────────────────────────────────────────────────────────────────
function makeTrip(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    id: 42,
    vehicle_id: 7,
    name: 'Weekend Getaway',
    start_date: '2024-01-10T08:00:00.000Z',
    end_date: '2024-01-12T20:00:00.000Z',
    started_at: '2024-01-10T08:00:00.000Z',
    ended_at: '2024-01-12T20:00:00.000Z',
    total_distance_m: 320_000,
    total_energy_wh: 64_000,
    total_duration_s: 5_400, // 1h 30m
    total_cost: 12.5,
    drive_count: 3,
    charge_count: 1,
    created_at: '2024-01-10T07:00:00.000Z',
    energy_used_wh: 64_000,
    drives: [],
    notes: 'Scenic route',
    ...overrides,
  };
}

function renderPanel(props: Partial<PanelProps> = {}) {
  const merged: PanelProps = {
    trip: undefined,
    isLoading: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    ...props,
  };
  const utils = render(
    <MemoryRouter>
      <TripOverviewPanel {...merged} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry: merged.onRetry };
}

// The KVList renders each entry as `<div><dt>label</dt><dd>value</dd></div>`.
// These helpers resolve a row by its label and read the rendered value / the
// canonical ISO carried by a <DateTime> span's `title`.
function ddText(label: string): string {
  const row = screen.getByText(label).parentElement;
  return row?.querySelector('dd')?.textContent ?? '';
}

function ddTitle(label: string): string | null {
  const row = screen.getByText(label).parentElement;
  return row?.querySelector('span[title]')?.getAttribute('title') ?? null;
}

afterEach(() => cleanup());

describe('TripOverviewPanel — panel shell invariant', () => {
  const states: Array<{ name: string; props: Partial<PanelProps> }> = [
    { name: 'loading', props: { isLoading: true, trip: undefined } },
    { name: 'error', props: { isError: true, error: new ApiError('boom', 500) } },
    { name: 'empty', props: { trip: undefined } },
    { name: 'ready', props: { trip: makeTrip() } },
  ];

  it('always renders the "Overview" heading regardless of state', () => {
    for (const { props } of states) {
      const { unmount } = renderPanel(props);
      expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
      unmount();
    }
  });

  it('keeps the decorative icon out of the heading accessible name', () => {
    renderPanel({ trip: makeTrip() });
    const heading = screen.getByRole('heading', { name: 'Overview' });
    // The lucide <Info> icon is aria-hidden, so the title reads exactly
    // "Overview" and the svg is not exposed to assistive tech.
    expect(heading).toHaveTextContent('Overview');
    expect(heading.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TripOverviewPanel — ready state (complete trip)', () => {
  beforeEach(() => {
    renderPanel({ trip: makeTrip() });
  });

  it('maps every scalar metadata row to its rendered value', () => {
    expect(ddText('Trip ID')).toBe('42');
    expect(ddText('Name')).toBe('Weekend Getaway');
    expect(ddText('Vehicle')).toBe('#7');
    expect(ddText('Duration')).toBe('1h 30m');
    expect(ddText('Drives')).toBe('3');
    expect(ddText('Charges')).toBe('1');
  });

  it('renders timestamps with their canonical ISO title and shows the Notes row', () => {
    expect(ddTitle('Started')).toBe('2024-01-10T08:00:00.000Z');
    expect(ddTitle('Ended')).toBe('2024-01-12T20:00:00.000Z');
    expect(ddTitle('Created')).toBe('2024-01-10T07:00:00.000Z');
    expect(ddText('Notes')).toBe('Scenic route');
  });

  it('does not render loading, error, or empty affordances', () => {
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('TripOverviewPanel — ready state (in-progress + null-safety)', () => {
  it('shows "In progress", "—" for zero duration, and falls back to 0 for absent counts', () => {
    renderPanel({
      trip: makeTrip({
        name: '',
        end_date: null,
        total_duration_s: 0,
        drive_count: undefined as unknown as number,
        charge_count: undefined as unknown as number,
        notes: null,
      }),
    });

    expect(ddText('Ended')).toBe('In progress');
    expect(ddText('Duration')).toBe('—');
    expect(ddText('Drives')).toBe('0');
    expect(ddText('Charges')).toBe('0');
    // Blank name renders the em-dash placeholder (hardening fix — `?? '—'`
    // alone would have rendered an empty cell for `name: ''`).
    expect(ddText('Name')).toBe('—');
    // Notes are absent → the row is omitted entirely.
    expect(screen.queryByText('Notes')).toBeNull();
  });

  it('treats a whitespace-only name and notes as blank', () => {
    renderPanel({ trip: makeTrip({ name: '   ', notes: '   ' }) });

    expect(ddText('Name')).toBe('—');
    // Whitespace-only notes must not produce a stray, visually-empty row.
    expect(screen.queryByText('Notes')).toBeNull();
  });
});

describe('TripOverviewPanel — loading state', () => {
  it('renders a skeleton and no metadata when there is no cached trip', () => {
    renderPanel({ isLoading: true, trip: undefined });

    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Trip ID')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the cached trip visible (no skeleton) during a background refetch', () => {
    // `isLoading` is true but a trip is already present — the `isLoading &&
    // !trip` guard must fall through to the data body, not the skeleton.
    renderPanel({ isLoading: true, trip: makeTrip({ id: 99 }) });

    expect(ddText('Trip ID')).toBe('99');
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('TripOverviewPanel — error state', () => {
  it('renders a retryable server-error alert and calls onRetry on click', () => {
    const onRetry = vi.fn();
    renderPanel({ isError: true, error: new ApiError('server exploded', 500), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Server error')).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // The metadata body is not rendered while erroring.
    expect(screen.queryByText('Trip ID')).toBeNull();
  });

  it('forwards resourceName + listHref to QueryError on a 404 (Back to list, no Retry)', () => {
    renderPanel({ isError: true, error: new ApiError('missing', 404) });

    // `resourceName="Trip"` interpolates into the not-found title, and
    // `listHref="/trips"` surfaces a Back-to-list CTA. 404s have no Retry.
    expect(screen.getByText('Trip not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to list/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retry$/i })).toBeNull();
  });

  it('prioritises the error state over a stale trip object', () => {
    renderPanel({ isError: true, error: new ApiError('boom', 500), trip: makeTrip() });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Trip ID')).toBeNull();
  });
});

describe('TripOverviewPanel — empty state', () => {
  it('renders the not-found empty state when there is no trip, error, or load', () => {
    renderPanel({ trip: undefined, isLoading: false, isError: false });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Trip not found');
    // Neither the skeleton nor the metadata body is present.
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText('Trip ID')).toBeNull();
  });
});
