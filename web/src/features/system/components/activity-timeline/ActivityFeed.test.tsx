import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ActivityFeed } from './ActivityFeed';
import type { ActivityItem } from '@/types/activity';

// The real i18n instance is initialized asynchronously in the app shell
// (`loadEnglishResources()`), which this isolated component test never
// triggers, so `t()` would return the raw fallback string without
// interpolating `{{table}}`/`{{id}}`. Mock a minimal t() that performs the
// same mustache-style substitution react-i18next does at runtime.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      const values = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m: string, name: string) =>
        values[name] != null ? String(values[name]) : '',
      );
    },
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDuration: (value: number) => `${(value / 3600).toFixed(1)} h`,
    formatEnergy: (value: number) => `${(value / 1000).toFixed(1)} kWh`,
  }),
}));

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'drives:1',
    kind: 'drive',
    occurred_at: '2026-01-15T12:00:00Z',
    vehicle_id: 7,
    title: 'Drive',
    summary: '12 min',
    status: 'completed',
    source_table: 'drives',
    source_id: 1,
    path: '/drives/1',
    ...overrides,
  };
}

function renderFeed(props: Partial<React.ComponentProps<typeof ActivityFeed>> = {}) {
  return render(
    <MemoryRouter>
      <ActivityFeed
        items={[]}
        isLoading={false}
        isError={false}
        error={null}
        onRetry={vi.fn()}
        timezone="UTC"
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('ActivityFeed', () => {
  it('renders a skeleton while loading, not the empty/error states', () => {
    renderFeed({ isLoading: true });
    expect(screen.queryByText(/no activity in this window/i)).not.toBeInTheDocument();
  });

  it('renders the error state and wires the retry callback', () => {
    const onRetry = vi.fn();
    renderFeed({ isError: true, error: new Error('boom'), onRetry });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when there are no items', () => {
    renderFeed({ items: [] });
    expect(screen.getByText(/no activity in this window/i)).toBeInTheDocument();
  });

  it('groups items by day, showing a day header per calendar day', () => {
    renderFeed({
      items: [
        item({ id: 'a', occurred_at: '2026-01-15T12:00:00Z' }),
        item({ id: 'b', occurred_at: '2026-01-14T12:00:00Z' }),
      ],
    });
    expect(screen.getByText('Jan 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('Jan 14, 2026')).toBeInTheDocument();
  });

  it('localizes a typed SI drive summary and semantic provenance', () => {
    renderFeed({
      items: [
        item({
          title: '',
          summary: '',
          status: 'completed',
          duration_s: 720,
          start_soc_pct: 80,
          end_soc_pct: 76,
        }),
      ],
    });
    expect(screen.getByText('Drive')).toBeInTheDocument();
    expect(screen.getByText('0.2 h · 80% → 76%')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Source: Driving history')).toBeInTheDocument();
    expect(screen.queryByText(/drives · id/i)).not.toBeInTheDocument();
  });

  it('formats charging energy from canonical watt-hours at the render boundary', () => {
    renderFeed({
      items: [
        item({
          kind: 'charging',
          title: '',
          summary: '',
          energy_added_wh: 12_500,
        }),
      ],
    });
    expect(screen.getByText('12.5 kWh')).toBeInTheDocument();
  });

  it('renders a severity badge only for items that carry one (alerts)', () => {
    const { rerender } = renderFeed({
      items: [item({ kind: 'alert', severity: 'critical', status: 'sent' })],
    });
    expect(screen.getByText('Critical')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ActivityFeed
          items={[item({ kind: 'drive', severity: undefined })]}
          isLoading={false}
          isError={false}
          error={null}
          onRetry={vi.fn()}
          timezone="UTC"
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('critical')).not.toBeInTheDocument();
  });

  it('makes the row a navigable link when the item carries a safe path', () => {
    renderFeed({ items: [item({ path: '/drives/1' })] });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/drives/1');
  });

  it('renders a plain (non-link) row when the item has no path', () => {
    renderFeed({ items: [item({ path: undefined })] });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Drive')).toBeInTheDocument();
  });
});
