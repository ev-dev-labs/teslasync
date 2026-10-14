import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ActivityFeed } from './ActivityFeed';
import { formatTime, type FormatOptions } from '@/lib/dateFormat';
import { KIND_ACCENT, KIND_ICON, severityBadgeVariant, statusBadgeVariant } from './constants';
import { ACTIVITY_KINDS } from '@/types/activity';
import type { ActivityItem } from '@/types/activity';

const datePreferences = vi.hoisted(() => ({ locale: 'en-US' }));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    locale: datePreferences.locale,
    formatTime: (value: string, override?: FormatOptions) =>
      formatTime(value, { locale: datePreferences.locale, ...override }),
  }),
}));

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
  beforeEach(() => {
    datePreferences.locale = 'en-US';
  });

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

  it('wraps full source-authored titles and exposes record provenance outside the title link', () => {
    const title = 'An authentic annotation with a very long title / '.repeat(8);
    const summary = 'Source-authored detail / '.repeat(8);
    renderFeed({
      items: [item({ title, summary, source_table: 'future_source', source_id: 1_234_567_890 })],
    });
    expect(screen.getByRole('link', { name: title.trim() })).toHaveAttribute('href', '/drives/1');
    expect(screen.getByText(title.trim())).toHaveClass('whitespace-normal', 'break-words');
    expect(screen.getByText(title.trim())).not.toHaveClass('truncate');
    expect(screen.getByText(summary.trim())).toBeInTheDocument();
    const provenance = screen.getByText('future_source record 1234567890');
    expect(provenance.closest('a')).toBeNull();
    expect(provenance).not.toHaveAttribute('title');
    expect(screen.getByText('Source: Driving history')).toBeInTheDocument();
  });

  it('retains all five category icons and labels with neutral theme-owned swatches', () => {
    const sources = ['drives', 'charging_sessions', 'notification_logs', 'software_updates', 'chart_annotations'];
    const { container } = renderFeed({
      items: ACTIVITY_KINDS.map((kind, index) => item({
        id: `${kind}:${index}`, kind, title: '', summary: '', source_table: sources[index],
        status: 'future_state', path: null,
      })),
    });
    for (const title of ['Drive', 'Charging session', 'Alert', 'Software update', 'Annotation']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    for (const kind of ACTIVITY_KINDS) {
      expect(KIND_ACCENT[kind]).toBeUndefined();
      expect(KIND_ICON[kind]).toBeDefined();
    }
    const swatches = container.querySelectorAll('.bg-\\[var\\(--surface-2\\)\\].h-8');
    expect(swatches).toHaveLength(5);
    for (const swatch of swatches) {
      expect(swatch).toHaveClass('text-[var(--text-muted)]');
      expect(swatch).not.toHaveAttribute('style');
      expect(swatch).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getAllByText('future state')).toHaveLength(5);
  });

  it('uses the selected locale for both day headings and times without changing vehicle day keys', () => {
    datePreferences.locale = 'de-DE';
    const events = [item({ occurred_at: '2026-01-01T02:00:00Z' })];
    const { rerender } = renderFeed({ items: events, timezone: 'America/Los_Angeles' });
    expect(screen.getByRole('heading', { name: '31. Dez. 2025' })).toBeInTheDocument();
    expect(screen.getByText('18:00')).toBeInTheDocument();
    datePreferences.locale = 'en-US';
    rerender(
      <MemoryRouter>
        <ActivityFeed items={events} isLoading={false} isError={false} error={null}
          onRetry={vi.fn()} timezone="America/Los_Angeles" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Dec 31, 2025' })).toBeInTheDocument();
    expect(screen.getByText('06:00 PM')).toBeInTheDocument();
    expect(events[0].occurred_at).toBe('2026-01-01T02:00:00Z');
  });

  it('keeps invalid timestamps unknown and missing measurements absent rather than measured zero', () => {
    renderFeed({
      items: [item({ occurred_at: 'not-a-date', summary: '', duration_s: null,
        energy_added_wh: null, start_soc_pct: 80, end_soc_pct: null })],
    });
    expect(screen.getByRole('heading', { name: '—' })).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText(/h|kWh|%/, { selector: 'p.mt-0\\.5' })).not.toBeInTheDocument();
    expect(screen.getByText('drives record 1')).toBeInTheDocument();
  });

  it('retains source order, SI zero and negative energy signs without mutating source records', () => {
    const events = [
      item({ id: 'first', title: 'First retained event', summary: '', duration_s: 0, energy_added_wh: -1_250 }),
      item({ id: 'second', title: 'Second retained event', summary: '', energy_added_wh: 0 }),
    ];
    const before = JSON.stringify(events);
    const { container } = renderFeed({ items: events });
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'First retained event', 'Second retained event',
    ]);
    expect(screen.getByText('0.0 h · -1.3 kWh')).toBeInTheDocument();
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(JSON.stringify(events)).toBe(before);
    expect(container.querySelectorAll('.w-px.flex-1')).toHaveLength(1);
  });

  it('preserves domain status and severity mappings, keeping unknown values neutral', () => {
    for (const status of ['completed', 'installed', 'sent']) {
      expect(statusBadgeVariant(status)).toBe('success');
    }
    for (const status of ['in_progress', 'installing', 'downloading', 'pending']) {
      expect(statusBadgeVariant(status)).toBe('info');
    }
    expect(statusBadgeVariant('failed')).toBe('danger');
    expect(statusBadgeVariant('deferred_dnd')).toBe('warning');
    expect(statusBadgeVariant('available')).toBe('warning');
    expect(statusBadgeVariant('future_status')).toBe('neutral');
    expect(severityBadgeVariant('critical')).toBe('danger');
    expect(severityBadgeVariant('warn')).toBe('warning');
    expect(severityBadgeVariant('info')).toBe('info');
    expect(severityBadgeVariant('future_severity')).toBe('neutral');
    expect(severityBadgeVariant(null)).toBe('neutral');
  });
});
