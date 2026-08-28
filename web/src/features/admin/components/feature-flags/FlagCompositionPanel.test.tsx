/**
 * FlagCompositionPanel contract tests.
 *
 * Covers every branch of the single exported component:
 *   1. error         → <QueryError> banner (takes precedence over loading)
 *   2. loading+empty → <Skeleton> placeholder
 *   3. empty         → <EmptyState> with the "no flags" message
 *   4. populated     → one MetricBar per non-empty value-type bucket,
 *                      sorted by frequency, with count + percentage sublabels
 * Plus the value-kind classification (boolean/number/string/object/array/null),
 * null-safety (undefined flags / null entries), stale-while-revalidate
 * (loading with existing data still shows bars), and the list a11y semantics.
 *
 * i18next is mocked so `t(key, default, opts)` returns the interpolated
 * default string — this keeps assertions deterministic regardless of the
 * locale JSON, matching the convention in QueueStatusPanel.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        // t(key, defaultStr, opts) signature
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        // t(key, opts) signature
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { FlagCompositionPanel } from './FlagCompositionPanel';
import type { FeatureFlagEntry } from '@/types/admin-diagnostics';

function flag(key: string, value: unknown): FeatureFlagEntry {
  return { key, value } as FeatureFlagEntry;
}

function renderPanel(props: Partial<Parameters<typeof FlagCompositionPanel>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onRetry = props.onRetry ?? vi.fn();
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FlagCompositionPanel
          flags={props.flags ?? []}
          loading={props.loading ?? false}
          error={props.error ?? null}
          onRetry={onRetry}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

beforeEach(() => {
  cleanup();
});

describe('FlagCompositionPanel — states', () => {
  it('renders the error banner and wires the retry action', () => {
    const onRetry = vi.fn();
    renderPanel({ error: new Error('boom'), onRetry });

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    // The composition list must NOT render behind the error. (QueryError itself
    // renders a help-links list, so target the labelled composition list.)
    expect(
      screen.queryByRole('list', { name: 'Flag value-type composition' }),
    ).toBeNull();

    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lets the error branch win even while loading with no data', () => {
    renderPanel({ error: new Error('nope'), loading: true, flags: [] });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Skeleton placeholder must not appear when there is an error.
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders the skeleton while loading with no flags yet', () => {
    const { container } = renderPanel({ loading: true, flags: [] });

    // Skeleton(lines=5) renders five animated placeholder rows.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the empty state when there are no flags and it is not loading', () => {
    renderPanel({ flags: [], loading: false });

    const empty = screen.getByRole('status');
    expect(empty).toBeInTheDocument();
    expect(
      screen.getByText(/No flags to summarize yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('treats an undefined flags prop as empty without throwing', () => {
    renderPanel({ flags: undefined as unknown as FeatureFlagEntry[] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('FlagCompositionPanel — composition breakdown', () => {
  it('renders one labelled bar per JSON value kind', () => {
    renderPanel({
      flags: [
        flag('a', true),
        flag('b', 42),
        flag('c', 'hello'),
        flag('d', { nested: 1 }),
        flag('e', [1, 2, 3]),
        flag('f', null),
      ],
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText('Boolean')).toBeInTheDocument();
    expect(screen.getByText('Number')).toBeInTheDocument();
    expect(screen.getByText('String')).toBeInTheDocument();
    expect(screen.getByText('Object')).toBeInTheDocument();
    expect(screen.getByText('Array')).toBeInTheDocument();
    expect(screen.getByText('Null')).toBeInTheDocument();
  });

  it('buckets by frequency, sorts descending, and computes percentages', () => {
    renderPanel({
      flags: [
        flag('s1', 'x'),
        flag('s2', 'y'),
        flag('s3', 'z'),
        flag('n1', 1),
        flag('n2', 2),
        flag('b1', true),
      ],
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);

    // Sorted by count desc: String(3) → Number(2) → Boolean(1).
    expect(items[0]).toHaveTextContent('String');
    expect(items[1]).toHaveTextContent('Number');
    expect(items[2]).toHaveTextContent('Boolean');

    // Sublabel = "{count} · {pct}%" of the 6 total flags.
    expect(within(items[0]).getByText('3 · 50%')).toBeInTheDocument();
    expect(within(items[1]).getByText('2 · 33%')).toBeInTheDocument();
    expect(within(items[2]).getByText('1 · 17%')).toBeInTheDocument();
  });

  it('collapses null and undefined values into a single Null bucket', () => {
    renderPanel({
      flags: [
        flag('x', null),
        flag('y', undefined),
        // A missing entry must be tolerated by the `flag?.value` guard.
        undefined as unknown as FeatureFlagEntry,
        flag('z', 7),
      ],
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // 3 of 4 values are null-ish → Null bucket leads at 75%.
    expect(items[0]).toHaveTextContent('Null');
    expect(within(items[0]).getByText('3 · 75%')).toBeInTheDocument();
    expect(within(items[1]).getByText('1 · 25%')).toBeInTheDocument();
  });

  it('shows a single full bar when every flag is the same kind', () => {
    renderPanel({
      flags: [flag('a', 1), flag('b', 2), flag('c', 3), flag('d', 4)],
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Number');
    expect(within(items[0]).getByText('4 · 100%')).toBeInTheDocument();
  });

  it('keeps showing bars (not a skeleton) while refetching over existing data', () => {
    const { container } = renderPanel({
      loading: true,
      flags: [flag('a', true)],
    });

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('Boolean')).toBeInTheDocument();
    // Stale-while-revalidate: no skeleton because data is already present.
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('exposes the breakdown as an accessible, labelled list', () => {
    renderPanel({ flags: [flag('a', true), flag('b', 'x')] });

    const list = screen.getByRole('list', {
      name: 'Flag value-type composition',
    });
    expect(list).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});
