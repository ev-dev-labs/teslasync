/**
 * Timeline — behaviour, branch, null-safety and a11y coverage.
 *
 * Timeline is the shared presentational primitive used by the activity feeds,
 * drive/charging/alert audit views and dashboard widgets. It renders a vertical
 * list of `{ icon?, title, subtitle?, time, color? }` entries, drawing a
 * connector line between adjacent rows and a coloured dot (or the caller's icon)
 * per row. These tests pin every rendering branch other suites rely on
 * (ordered list rows, the `.font-medium` title span, the `<p>` subtitle) plus the
 * hardening added during elevation: nullish-`items` safety, the empty-state
 * placeholder, and the aria-hidden treatment of the decorative dot/connector.
 *
 * react-i18next is mocked so the default empty message resolves to its English
 * fallback deterministically, independent of the translation catalogue.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { Timeline, type TimelineItemData } from './Timeline';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (token, key: string) =>
        values?.[key] == null ? token : String(values[key]),
      ),
  }),
}));

const item = (overrides: Partial<TimelineItemData> = {}): TimelineItemData => ({
  title: 'Drive started',
  time: '12:00',
  ...overrides,
});

// The connector line is the only element carrying `w-px`;
// the default dot carries `h-2`; the outer dot carries `border-2`.
const rows = (c: HTMLElement) => c.querySelectorAll('ol > li');
const connectors = (c: HTMLElement) => c.querySelectorAll('.w-px');
const outerDots = (c: HTMLElement) => c.querySelectorAll('.border-2');
const defaultDots = (c: HTMLElement) => c.querySelectorAll('.h-2');

describe('Timeline — populated rendering', () => {
  it('renders a row with its title, time and subtitle text', () => {
    render(
      <Timeline
        items={[item({ title: 'Charge complete', subtitle: 'Added 42 kWh', time: '08:15' })]}
      />,
    );
    expect(screen.getByText('Charge complete')).toBeInTheDocument();
    expect(screen.getByText('Added 42 kWh')).toBeInTheDocument();
    expect(screen.getByText('08:15')).toBeInTheDocument();
  });

  it('draws one row per item and preserves their order', () => {
    const { container } = render(
      <Timeline
        items={[
          item({ title: 'First' }),
          item({ title: 'Second' }),
          item({ title: 'Third' }),
        ]}
      />,
    );
    expect(rows(container)).toHaveLength(3);
    const titles = Array.from(container.querySelectorAll('.font-medium')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['First', 'Second', 'Third']);
  });

  it('renders the title inside the .font-medium span that consumers assert on', () => {
    const { container } = render(<Timeline items={[item({ title: 'Locked' })]} />);
    const titleSpan = container.querySelector('.font-medium');
    expect(titleSpan).not.toBeNull();
    expect(titleSpan?.textContent).toBe('Locked');
  });

  it('omits the subtitle paragraph when no subtitle is supplied', () => {
    const { container } = render(<Timeline items={[item()]} />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders a ReactNode title (e.g. a drill-through link)', () => {
    render(
      <Timeline
        items={[item({ title: <a href="/drives/7">Trip #7</a> })]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Trip #7' })).toHaveAttribute('href', '/drives/7');
  });

  it('forwards className onto the list root', () => {
    const { container } = render(<Timeline items={[item()]} className="mt-8 custom-tl" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('custom-tl');
    expect(root).toHaveClass('relative');
    expect(root).toHaveClass('space-y-4');
  });
});

describe('Timeline — connector line', () => {
  it('draws n-1 connectors so the last row has none', () => {
    const { container } = render(
      <Timeline items={[item(), item(), item()]} />,
    );
    // 3 rows → 2 connectors bridging rows 1→2 and 2→3.
    expect(connectors(container)).toHaveLength(2);
  });

  it('draws no connector for a single row', () => {
    const { container } = render(<Timeline items={[item()]} />);
    expect(connectors(container)).toHaveLength(0);
  });

  it('marks every connector aria-hidden (decorative)', () => {
    const { container } = render(<Timeline items={[item(), item()]} />);
    const line = connectors(container)[0];
    expect(line).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Timeline — dot / icon rendering', () => {
  it('renders the default coloured dot and hides it from the a11y tree when no icon is given', () => {
    const { container } = render(<Timeline items={[item()]} />);
    // The default inner dot is present…
    expect(defaultDots(container)).toHaveLength(1);
    // …and its container is aria-hidden because it conveys no information.
    expect(outerDots(container)[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies the neutral border/text classes when no color is provided', () => {
    const { container } = render(<Timeline items={[item()]} />);
    const dot = outerDots(container)[0];
    expect(dot.className).toContain('border-[var(--control-border)]');
    expect(dot.className).toContain('text-[var(--text-muted)]');
  });

  it('applies the caller color to the dot border and to the inner dot fill', () => {
    const { container } = render(<Timeline items={[item({ color: '#10b981' })]} />);
    const dot = outerDots(container)[0] as HTMLElement;
    expect(dot).toHaveStyle({ borderColor: '#10b981', color: '#10b981' });
    // With an explicit color the neutral fallback class must NOT be applied.
    expect(dot.className).not.toContain('border-[var(--control-border)]');
    const inner = defaultDots(container)[0] as HTMLElement;
    expect(inner).toHaveStyle({ backgroundColor: '#10b981' });
  });

  it('renders the caller icon instead of the default dot and keeps its container visible', () => {
    const { container } = render(
      <Timeline
        items={[item({ icon: <svg data-testid="bolt" aria-hidden="true" /> })]}
      />,
    );
    expect(screen.getByTestId('bolt')).toBeInTheDocument();
    // No default dot when an icon is supplied.
    expect(defaultDots(container)).toHaveLength(0);
    // The icon container is not force-hidden — the icon governs its own a11y.
    expect(outerDots(container)[0]).not.toHaveAttribute('aria-hidden');
  });
});

describe('Timeline — empty + null safety', () => {
  it('renders a labelled status placeholder for an empty items array', () => {
    const { container } = render(<Timeline items={[]} />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('No timeline entries yet.');
    // No rows are drawn in the empty branch.
    expect(rows(container)).toHaveLength(0);
  });

  it('does not crash and shows the placeholder when items is nullish', () => {
    const { container } = render(
      <Timeline items={undefined as unknown as TimelineItemData[]} />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(rows(container)).toHaveLength(0);
  });

  it('renders a caller-supplied emptyMessage in preference to the default', () => {
    render(<Timeline items={[]} emptyMessage="No FSM transitions in this window" />);
    expect(screen.getByText('No FSM transitions in this window')).toBeInTheDocument();
    expect(screen.queryByText('No timeline entries yet.')).toBeNull();
  });

  it('forwards className onto the empty placeholder', () => {
    render(<Timeline items={[]} className="empty-cls" />);
    expect(screen.getByRole('status')).toHaveClass('empty-cls');
  });

  it('does not expose a status role once real items are present', () => {
    render(<Timeline items={[item()]} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Timeline — accessibility of content', () => {
  it('keeps the title, subtitle and time out of any aria-hidden subtree', () => {
    const { container } = render(
      <Timeline
        items={[item({ title: 'Parked', subtitle: 'at Home', time: '21:30' })]}
      />,
    );
    const row = rows(container)[0] as HTMLElement;
    // The informative content lives in the non-decorative content column.
    const content = within(row).getByText('Parked');
    expect(content.closest('[aria-hidden="true"]')).toBeNull();
    expect(within(row).getByText('at Home').closest('[aria-hidden="true"]')).toBeNull();
    expect(within(row).getByText('21:30').closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('Timeline — accessible summary bounds', () => {
  it.each([undefined, 'newest-first'] as const)(
    'keeps newest-first summary semantics with chronology %s',
    (chronology) => {
      render(
        <Timeline
          label="Incident updates"
          chronology={chronology}
          items={[
            item({ title: 'Resolved', time: 'Later' }),
            item({ title: 'Opened', time: 'Earlier' }),
          ]}
        />,
      );
      expect(screen.getByText('Incident updates: 2 entries. From Earlier to Later'))
        .toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Incident updates' })).toBeInTheDocument();
      expect(screen.getAllByRole('listitem').map((row) => row.textContent))
        .toEqual(['ResolvedLater', 'OpenedEarlier']);
    },
  );

  it('uses oldest-first endpoint labels verbatim without parsing localized timestamps', () => {
    const items = [
      item({ title: 'Session started', time: 'hier, après le déjeuner' }),
      item({ title: 'No in-session evidence', time: '—' }),
      item({ title: 'Contradiction', time: 'aujourd’hui, avant le dîner' }),
    ];
    render(<Timeline label="Evidence" chronology="oldest-first" items={items} />);
    expect(screen.getByText(
      'Evidence: 3 entries. From hier, après le déjeuner to aujourd’hui, avant le dîner',
    )).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((row) => row.textContent))
      .toEqual(items.map((entry) => `${entry.title}${entry.time}`));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it.each(['oldest-first', 'newest-first'] as const)(
    'gives explicit bounds precedence over %s without sorting causal entries or losing actions',
    (chronology) => {
      const onInspect = vi.fn();
      const items = [
        item({ title: <a href="/session/7">Session started</a>, time: '09:00' }),
        item({ title: 'Evidence missing', time: '—' }),
        item({ title: 'Contradiction', time: '11:00' }),
        item({
          title: 'Proposed end',
          time: '10:30',
          subtitle: <Button onClick={onInspect}>Inspect evidence</Button>,
          icon: <svg data-testid="evidence-icon" aria-hidden="true" />,
        }),
      ];
      render(
        <Timeline
          label="Repair evidence"
          chronology={chronology}
          summaryBounds={{ start: 'début de la session', end: 'dernière preuve' }}
          items={items}
        />,
      );
      expect(screen.getByText(
        'Repair evidence: 4 entries. From début de la session to dernière preuve',
      )).toBeInTheDocument();
      expect(screen.getAllByRole('listitem').map((row) =>
        row.querySelector('.font-medium')?.textContent,
      )).toEqual(['Session started', 'Evidence missing', 'Contradiction', 'Proposed end']);
      expect(screen.getByRole('link', { name: 'Session started' }))
        .toHaveAttribute('href', '/session/7');
      expect(screen.getByTestId('evidence-icon')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Inspect evidence' }));
      expect(onInspect).toHaveBeenCalledOnce();
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(items.map((entry) => entry.time)).toEqual(['09:00', '—', '11:00', '10:30']);
    },
  );

  it.each([
    {},
    { start: 'Earlier' },
    { end: 'Later' },
    { start: null, end: 'Later' },
    { start: 'Earlier', end: null },
    { start: '', end: 'Later' },
    { start: 'Earlier', end: '' },
  ])('does not infer or fabricate a range for incomplete explicit bounds %j', (summaryBounds) => {
    render(
      <Timeline
        summaryBounds={summaryBounds}
        items={[item({ time: '12:00' }), item({ time: '09:00' })]}
      />,
    );
    expect(screen.getByText('Timeline: 2 entries')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/From /)).not.toBeInTheDocument();
  });

  it.each(['oldest-first', 'newest-first'] as const)(
    'omits the range when a %s endpoint has no time without skipping that row',
    (chronology) => {
      render(
        <Timeline
          chronology={chronology}
          items={[
            item({ title: 'Missing timestamp', time: '' }),
            item({ title: 'Known middle', time: '10:00' }),
            item({ title: 'Known endpoint', time: '11:00' }),
          ]}
        />,
      );
      expect(screen.getByText('Timeline: 3 entries')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
      expect(screen.getByText('Missing timestamp')).toBeInTheDocument();
      expect(screen.queryByText(/From /)).not.toBeInTheDocument();
    },
  );

  it.each(['oldest-first', 'newest-first'] as const)(
    'preserves the single-entry range with %s',
    (chronology) => {
      render(<Timeline chronology={chronology} items={[item({ time: 'just now' })]} />);
      expect(screen.getByText('Timeline: 1 entries. From just now to just now'))
        .toBeInTheDocument();
    },
  );

  it.each([[], undefined, null])(
    'preserves empty semantics for %j even with explicit bounds and chronology',
    (items) => {
      render(
        <Timeline
          items={items as unknown as TimelineItemData[]}
          chronology="oldest-first"
          summaryBounds={{ start: 'Earlier', end: 'Later' }}
          label="Evidence"
          emptyMessage="No evidence recorded"
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('No evidence recorded');
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(screen.queryByText(/From /)).not.toBeInTheDocument();
    },
  );
});
