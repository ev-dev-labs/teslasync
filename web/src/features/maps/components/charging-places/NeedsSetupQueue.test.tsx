/**
 * NeedsSetupQueue — the auto-discovered "Needs Setup" queue.
 *
 * Coverage:
 *   1. Loading skeleton, no rows/count badge rendered.
 *   2. Error → QueryError with a working retry.
 *   3. Empty → the "all caught up" EmptyState message, no count badge.
 *   4. Rows: name (with "Unnamed place" fallback), category badge (with
 *      "Uncategorized" fallback for a null category), relative discovered-at
 *      timestamp, and the queue-length count badge.
 *   5. Clicking "Review" invokes `onReview` with the exact row's place object.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value }: { value: unknown }) => <span data-testid="discovered-at">{String(value)}</span>,
}));

import { NeedsSetupQueue } from './NeedsSetupQueue';
import type { Geofence } from '@/api/types';

function makePlace(overrides: Partial<Geofence> = {}): Geofence {
  return {
    id: 1,
    name: 'Provisional Place',
    polygon_wkt: 'POLYGON((0 0,0 0,0 0,0 0))',
    category: null,
    enabled: true,
    alert_on_entry: false,
    alert_on_exit: false,
    origin: 'charging_discovery',
    needs_review: true,
    is_charging_location: true,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    latitude: 40,
    longitude: -74,
    radius: 75,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
});

function renderQueue(props: Partial<Parameters<typeof NeedsSetupQueue>[0]> = {}) {
  return render(
    <MemoryRouter>
      <NeedsSetupQueue isLoading={false} onReview={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe('NeedsSetupQueue — loading/error/empty', () => {
  it('shows a loading skeleton with no rows or count badge', () => {
    const { container } = renderQueue({ isLoading: true });
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
  });

  it('surfaces a QueryError with a working retry on failure', () => {
    const onRetry = vi.fn();
    renderQueue({ isLoading: false, error: new Error('boom'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the "all caught up" empty state and no count badge when there are no rows', () => {
    renderQueue({ isLoading: false, places: [] });

    expect(
      screen.getByText('All caught up — no auto-discovered places need review.'),
    ).toBeInTheDocument();
    // The title itself always renders; only the numeric count Badge is conditional.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('does not present an unresolved source as successful completion', () => {
    const view = renderQueue();
    const unavailable = screen.getByText('The place review queue is unavailable.');
    expect(unavailable.closest('[data-app-part~="feedback"]')).toHaveAttribute('data-app-tone', 'info');
    expect(screen.queryByText('All caught up — no auto-discovered places need review.')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-app-part="card"]')).toBeNull();
  });
});

describe('NeedsSetupQueue — rows', () => {
  it.each(PACK_IDS)('%s owns the actual native queue records and retains source order and review actions', (pack) => {
    const first = makePlace({ id: 8, name: 'Full provisional charging-place address '.repeat(5) });
    const second = makePlace({ id: 2, name: 'Second observed place' });
    const review = vi.fn();
    const view = render(<MemoryRouter><div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <NeedsSetupQueue places={[first, second]} isLoading={false} error={new Error('refresh')} onReview={review} />
    </div></MemoryRouter>);
    const release = observeAppDesignScopes(view.container);
    try {
      const rows = screen.getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      const sheet = postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'));
      for (const row of rows) {
        expect(row).toHaveAttribute('data-app-part', 'card');
        expect(row).toHaveAttribute('data-surface-variant', 'standalone');
        expect(row).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
        let surfaceBound = false;
        sheet.walkRules(rule => {
          if (rule.selector.includes('[data-app-part~="card"]') && row.matches(rule.selector)) {
            rule.walkDecls('border-radius', () => { surfaceBound = true; });
          }
        });
        expect(surfaceBound).toBe(true);
        expect(row).toHaveClass('flex', 'flex-wrap', 'gap-3');
        expect(row.querySelector('[data-app-part~="metric"]')).toBeNull();
      }
      expect(rows[0]).toHaveTextContent(first.name.trim());
      expect(rows[1]).toHaveTextContent(second.name);
      fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[1]);
      expect(review).toHaveBeenCalledExactlyOnceWith(second);
      expect(screen.queryByText('All caught up — no auto-discovered places need review.')).not.toBeInTheDocument();
    } finally { release(); }
  });

  it('keeps source ordering, full names and exact review objects during a refresh failure', () => {
    const first = makePlace({ id: 42, name: 'Long provisional name '.repeat(8) });
    const second = makePlace({ id: 3, name: 'Second place' });
    const onReview = vi.fn();
    renderQueue({ places: [first, second], error: new Error('refresh'), onReview });
    const actions = screen.getAllByRole('button', { name: 'Review' });
    expect(actions).toHaveLength(2);
    expect(screen.getByText(first.name.trim())).toBeInTheDocument();
    fireEvent.click(actions[0]);
    expect(onReview).toHaveBeenCalledWith(first);
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
  });
  it('renders name, category fallback, discovered-at, and the queue count badge', () => {
    renderQueue({ places: [makePlace({ name: '', category: null })] });

    expect(screen.getByText('Unnamed place')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(screen.getByTestId('discovered-at')).toHaveTextContent('2026-01-01T00:00:00Z');
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders a localized category label when the place has one', () => {
    renderQueue({ places: [makePlace({ category: 'home' })] });
    // The i18n stub falls back to the fallback string ("home") since no
    // translation catalog is loaded in this test.
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('invokes onReview with the exact place object when "Review" is clicked', () => {
    const onReview = vi.fn();
    const place = makePlace({ id: 42, name: 'Costco Supercharger' });
    renderQueue({ places: [place], onReview });

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledWith(place);
  });

  it('renders one row + one Review button per place, and a count badge matching the row count', () => {
    renderQueue({
      places: [makePlace({ id: 1, name: 'Place A' }), makePlace({ id: 2, name: 'Place B' })],
    });

    expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(2);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
