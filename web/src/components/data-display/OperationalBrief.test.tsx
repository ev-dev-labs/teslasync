import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui';
import { OperationalBrief } from './OperationalBrief';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string,
      options?: Record<string, unknown>,
    ) => {
      const pluralFallback = options?.count === 1
        ? String(options.defaultValue_one ?? fallback)
        : String(options?.defaultValue_other ?? fallback)
      return Object.entries(options ?? {}).reduce(
        (value, [key, replacement]) => value.replaceAll(`{{${key}}}`, String(replacement)),
        pluralFallback,
      )
    },
  }),
}));

describe('OperationalBrief', () => {
  it('retains the source eyebrow only in the real details drawer', () => {
    render(<OperationalBrief eyebrow="Observed history window" title="Journey evidence"
      description="Returned history context" statusLabel="Returned evidence" metrics={[]} />);
    expect(screen.queryByText('Observed history window')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('Observed history window')).toBeInTheDocument();
  });

  it('does not duplicate the title as the drawer eyebrow', () => {
    render(<OperationalBrief eyebrow="Journey evidence" title="Journey evidence"
      description="Returned history context" statusLabel="Returned evidence" metrics={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).queryByText('Journey evidence')).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Journey evidence details' })).toBeInTheDocument();
  });

  it('balances metric rows so six items render as three plus three and four items never orphan one', () => {
    const metrics = Array.from({ length: 6 }, (_, index) => ({
      key: `metric-${index}`,
      label: `Metric ${index + 1}`,
      value: index + 1,
      detail: `Metric ${index + 1} source detail.`,
      valueState: 'value' as const,
    }));
    const { rerender, container } = render(<OperationalBrief eyebrow="Evidence" title="Balanced rows"
      description="Source metrics" statusLabel="Returned" metrics={metrics} />);

    expect(container.querySelector('[data-max-per-row]')).toHaveAttribute('data-max-per-row', '3');
    expect(Array.from(container.querySelectorAll('[data-operational-metric-bank]'), row => row.getAttribute('data-columns')))
      .toEqual(['3', '3']);

    rerender(<OperationalBrief eyebrow="Evidence" title="Balanced rows" description="Source metrics"
      statusLabel="Returned" maxPerRow={3} metrics={metrics.slice(0, 4)} />);
    expect(Array.from(container.querySelectorAll('[data-operational-metric-bank]'), row => row.getAttribute('data-columns')))
      .toEqual(['2', '2']);
  });

  it.each(['success', 'info', 'warning', 'danger', 'neutral'] as const)(
    'keeps %s metric tone and complete captions in the summary and drawer using semantic foregrounds',
    (tone) => {
      render(<OperationalBrief eyebrow="Evidence" title="Semantic evidence"
        description="Source-confirmed metric" statusLabel="Retained" statusTone={tone}
        metrics={[{ key: 'confirmed', label: 'Confirmed', value: 0,
          detail: 'Complete retained-source explanation', tone, valueState: 'value' }]} />);
      const expectedTone = tone === 'neutral'
        ? 'text-[var(--text-primary)]' : `text-[var(--semantic-${tone})]`;
      const summary = screen.getByRole('region', { name: 'Semantic evidence' });
      expect(within(summary).getByText('0', { exact: true })).toHaveClass(expectedTone);
      expect(within(summary).getByRole('listitem')).toHaveAttribute('data-value-state', 'value');
      expect(within(summary).queryByText('Complete retained-source explanation')).not.toBeInTheDocument();
      fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog', { name: 'Semantic evidence details' });
      expect(within(drawer).getByText('0', { exact: true })).toHaveClass(expectedTone);
      expect(within(drawer).getByText('Complete retained-source explanation')).toBeVisible();
      expect(within(drawer).getByText('Retained')).toBeVisible();
    },
  );
  it('keeps primitive scope and freshness in the drawer header, off the card face', () => {
    const scope = 'Period A: Last 30 days · Period B: Last 90 days';
    const freshness = 'Last confirmed at 2026-01-02T04:05:06Z';
    render(<OperationalBrief eyebrow="Evidence" title="Primitive context"
      description="Independent metadata fields." statusLabel="Retained"
      scope={scope} freshness={freshness} metrics={[]} />);
    const checkMetadata = (surface: HTMLElement) => {
      const scopeElement = within(surface).getByText(scope, { exact: true });
      const freshnessElement = within(surface).getByText(freshness, { exact: true });
      expect(scopeElement).not.toBe(freshnessElement);
      expect(scopeElement.tagName).toBe('SPAN');
      expect(freshnessElement.tagName).toBe('SPAN');
      expect(scopeElement.attributes).toHaveLength(0);
      expect(freshnessElement.attributes).toHaveLength(0);
      expect(scopeElement.textContent).toBe(scope);
      expect(freshnessElement.textContent).toBe(freshness);
      expect(scopeElement).toBeVisible();
      expect(freshnessElement).toBeVisible();
    };
    const summary = screen.getByRole('region', { name: 'Primitive context' });
    expect(within(summary).queryByText(scope, { exact: true })).not.toBeInTheDocument();
    expect(within(summary).queryByText(freshness, { exact: true })).not.toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Primitive context details' });
    const header = drawer.querySelector<HTMLElement>('[data-drawer-header]');
    expect(header).toBeVisible();
    if (!header) throw new Error('Drawer header missing');
    checkMetadata(header);
  });

  describe('OperationalBrief optional per-metric loading', () => {
    it.each([
      { global: true, override: undefined, pending: true },
      { global: false, override: undefined, pending: false },
      { global: true, override: false, pending: false },
      { global: false, override: true, pending: true },
      { global: true, override: true, pending: true },
    ])('matches summary and drawer for global=$global override=$override', ({ global, override, pending }) => {
      render(<OperationalBrief eyebrow="Independent sources" title="Loading compatibility"
        description="Actual source states" statusLabel="Remote pending" loading={global}
        metrics={[{ key: 'source', label: 'Source reading', value: 'retained-value',
          detail: 'Source caption remains visible', rawValue: 'retained-value', valueState: 'value', loading: override }]} />);
      const summary = screen.getByRole('region', { name: 'Loading compatibility' });
      expect(within(summary).queryByText('Source caption remains visible')).not.toBeInTheDocument();
      expect(summary.querySelector('[data-operational-metric]')).toHaveAttribute('data-value-state', 'value');
      expect(summary.querySelectorAll('[data-operational-value]')).toHaveLength(pending ? 0 : 1);
      if (pending) {
        expect(within(summary).queryByText('retained-value')).toBeNull();
        expect(summary.querySelector('[aria-busy="true"]')).not.toBeNull();
      } else {
        expect(within(summary).getByText('retained-value')).toBeVisible();
        expect(within(summary).getByText('retained-value')).not.toHaveAttribute('aria-busy');
      }
      fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog', { name: 'Loading compatibility details' });
      expect(within(drawer).getByText('Source caption remains visible')).toBeVisible();
      if (pending) {
        expect(within(drawer).queryByText('retained-value')).toBeNull();
        expect(drawer.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
      } else {
        expect(within(drawer).getByText('retained-value')).toBeVisible();
        expect(drawer.querySelector('[aria-busy="true"]')).toBeNull();
      }
    });
  });

  it('retains exact rich source bounds and freshness in the real drawer only', () => {
    render(
      <OperationalBrief
        eyebrow="Source evidence"
        title="Returned bounds"
        description="Independent source bounds."
        statusLabel="Retained"
        scope={<>
          <strong>A source bounds: 2026-01-01T01:02:03Z → 2026-01-02T04:05:06Z</strong>
          <span>B source bounds not supplied</span>
          <a href="/evidence/bounds">Inspect returned bounds</a>
        </>}
        freshness={<span>Last confirmed at <time dateTime="2026-01-02T04:05:06Z">2026-01-02T04:05:06Z</time>; refresh failed</span>}
        metrics={[{ key: 'observations', label: 'Observations', value: 0, detail: 'Confirmed empty result' }]}
      />,
    );
    const checkContext = (surface: HTMLElement) => {
      const queries = within(surface);
      expect(queries.getByText('A source bounds: 2026-01-01T01:02:03Z → 2026-01-02T04:05:06Z').tagName).toBe('STRONG');
      expect(queries.getByText('B source bounds not supplied')).toBeVisible();
      expect(queries.getByRole('link', { name: 'Inspect returned bounds' })).toHaveAttribute('href', '/evidence/bounds');
      expect(queries.getByText('2026-01-02T04:05:06Z')).toHaveAttribute('datetime', '2026-01-02T04:05:06Z');
      expect(queries.getByText(/Last confirmed at/)).toHaveTextContent('Last confirmed at 2026-01-02T04:05:06Z; refresh failed');
      expect(queries.getByText('Retained')).toBeVisible();
      expect(queries.getByText('0', { exact: true })).toBeVisible();
      expect(queries.getByText('Confirmed empty result')).toBeVisible();
    };
    const summary = screen.getByRole('region', { name: 'Returned bounds' });
    expect(within(summary).queryByText('Source bounds unknown; no interval supplied')).not.toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Returned bounds details' });
    checkContext(drawer);
    expect(within(drawer).getByText('What changed')).toBeVisible();
    expect(within(drawer).getByText('Not scored')).toBeVisible();
    expect(within(drawer).getByText('No supporting records were supplied.')).toBeVisible();
  });

  it('keeps caller-supplied unknown scope and freshness wording in the drawer', () => {
    render(<OperationalBrief eyebrow="Evidence" title="Unknown context"
      description="No observation supplied." statusLabel="Unknown"
      scope="Source bounds unknown; no interval supplied"
      freshness="Observation time unknown" metrics={[]} />);
    const summary = screen.getByRole('region', { name: 'Unknown context' });
    expect(summary).not.toHaveTextContent('Source bounds unknown; no interval supplied');
    expect(summary).not.toHaveTextContent('Observation time unknown');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Unknown context details' });
    const header = drawer.querySelector('[data-drawer-header]');
    expect(header).toBeVisible();
    expect(header).toHaveTextContent('Source bounds unknown; no interval supplied');
    expect(header).toHaveTextContent('Observation time unknown');
    expect(within(drawer).getByText('Unknown')).toBeVisible();
    expect(within(drawer).queryByText('Live', { exact: true })).not.toBeInTheDocument();
  });

  it.each([undefined, null])('does not invent absent scope or freshness (%s)', (metadata) => {
    render(<OperationalBrief eyebrow="Evidence" title="Absent context"
      description="No metadata supplied." statusLabel="Unknown"
      scope={metadata} freshness={metadata} metrics={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Absent context details' });
    const header = drawer.querySelector('[data-drawer-header]');
    expect(header).toHaveTextContent('Absent context detailsUnknownNo metadata supplied.');
    expect(header?.textContent).toBe('EvidenceAbsent context detailsUnknownNo metadata supplied.');
    expect(within(drawer).getByText('Not scored')).toBeVisible();
    expect(within(drawer).getByText('No current attention items.')).toBeVisible();
  });

  it('preserves zero-valued ReactNode metadata without truthiness filtering', () => {
    render(<OperationalBrief eyebrow="Evidence" title="Zero context"
      description="Caller supplied numeric metadata." statusLabel="Unknown"
      scope={0} freshness={0} metrics={[]} />);
    const summary = screen.getByRole('region', { name: 'Zero context' });
    expect(summary).not.toHaveTextContent('Unknown00');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Zero context details' });
    expect(drawer.querySelector('[data-drawer-header]')).toHaveTextContent('Unknown00');
  });

  it('keeps long values on the card and moves complete captions into details', () => {
    render(<OperationalBrief compact eyebrow="Source posture" title="Source evidence"
      description="Actual source context" statusLabel="Unknown"
      metrics={[{ key: 'status', label: 'Endpoint', value: 'A complete source-provided endpoint status',
        rawValue: 'A complete source-provided endpoint status', valueState: 'value',
        detail: <><span>Complete explanatory caption</span><span>Retained source context</span></> }]} />);
    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute('data-operational-metric', 'status');
    expect(item).toHaveAttribute('data-value-state', 'value');
    expect(item.querySelector('[data-operational-value]')).toHaveTextContent('A complete source-provided endpoint status');
    expect(screen.queryByText('Complete explanatory caption')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Source evidence details' });
    expect(within(drawer).getByText('Complete explanatory caption').parentElement).not.toHaveClass('line-clamp-2');
    expect(within(drawer).getByText('Retained source context')).toBeVisible();
  });
  it('marks loading without inventing measurements or removing metric labels and captions', () => {
    const { container } = render(<OperationalBrief loading eyebrow="Snapshot" title="Live source"
      description="Latest source values" statusLabel="Loading"
      metrics={[{ key: 'calls', label: 'Calls', value: '—', detail: 'No measurement supplied' }]} />);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Calls')).toBeVisible();
    expect(screen.queryByText('No measurement supplied')).not.toBeInTheDocument();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
  });
  it('renders compact metrics as flat tiles and keeps explanations in details', () => {
    render(
      <OperationalBrief
        compact
        eyebrow="Driving posture"
        title="Activity in context"
        description="Measured drive evidence."
        statusLabel="On track"
        metrics={[
          { key: 'distance', label: 'Distance', value: '64 mi', detail: 'Total distance in your display unit.', tone: 'success' },
          { key: 'efficiency', label: 'Energy intensity', value: '297 Wh/mi', detail: 'Both drives include measured energy.', tone: 'info' },
        ]}
      />,
    );
    expect(screen.getByRole('list')).toHaveClass('flex', 'flex-wrap');
    const tiles = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(tiles).toHaveLength(2);
    tiles.forEach((tile) => expect(tile).toHaveClass('flex-[1_1_200px]'));
    expect(screen.queryByText('Total distance in your display unit.')).not.toBeInTheDocument();
    expect(screen.getByText('64 mi')).toHaveClass('text-[var(--semantic-success)]');
    expect(screen.getByText('Activity in context')).not.toHaveClass('uppercase', 'capitalize');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Activity in context details' });
    expect(within(drawer).getByText('Total distance in your display unit.')).toBeVisible();
    expect(within(drawer).getByText('Both drives include measured energy.')).toBeVisible();
  });

  it('removes its raised surface and inner padding when embedded in a widget', () => {
    render(<OperationalBrief variant="embedded" compact eyebrow="Fleet" title="Embedded summary"
      description="Embedded source context." statusLabel="Available"
      metrics={[{ key: 'distance', label: 'Distance', value: '42 mi', detail: 'Measured distance.' }]} />);
    const region = screen.getByRole('region', { name: 'Embedded summary' });
    const surface = region.querySelector('[data-operational-brief-surface="embedded"]');
    expect(surface).toBeInTheDocument();
    expect(surface).not.toHaveClass('border', 'bg-[var(--surface-1)]', 'shadow-e1');
    expect(surface?.firstElementChild).not.toHaveClass('p-3', 'sm:p-4');
  });

  it('replaces a fully empty metric row with a sentence and metric chips', () => {
    render(<OperationalBrief eyebrow="Charging" title="Charging options"
      description="Current option estimates." statusLabel="No prices"
      metrics={[
        { key: 'home', label: 'Home now', value: '-', detail: 'Price unavailable', valueState: 'missing' },
        { key: 'wait', label: 'Wait window', value: '-', detail: 'Price unavailable', valueState: 'missing' },
      ]} />);
    const summary = screen.getByRole('region', { name: 'Charging options' });
    expect(within(summary).getByText('No metric values are available yet.')).toBeVisible();
    expect(within(summary).getByText('Values will appear when the source provides measurements.')).toBeVisible();
    expect(within(summary).getByText('Home now')).toBeVisible();
    expect(within(summary).getByText('Wait window')).toBeVisible();
    expect(summary.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });

  it.each([
    { sharedLoading: false, sourceLoading: true, pending: true },
    { sharedLoading: true, sourceLoading: false, pending: false },
    { sharedLoading: false, sourceLoading: undefined, pending: false },
  ])('keeps an unmeasured independent source honest for shared=$sharedLoading source=$sourceLoading', ({ sharedLoading, sourceLoading, pending }) => {
    render(<OperationalBrief eyebrow="Sources" title="Independent reading"
      description="One independently loaded source." statusLabel="Source state" loading={sharedLoading}
      metrics={[{ key: 'reading', label: 'Reading', value: '-', detail: 'Source has no measurement yet.',
        valueState: 'missing', loading: sourceLoading }]} />);
    const summary = screen.getByRole('region', { name: 'Independent reading' });
    const metric = summary.querySelector('[data-operational-metric="reading"]');
    if (pending) {
      expect(metric).toBeInTheDocument();
      expect(metric?.querySelector('[aria-busy="true"]')).toBeInTheDocument();
      expect(within(summary).queryByText('No metric values are available yet.')).not.toBeInTheDocument();
    } else {
      expect(metric).not.toBeInTheDocument();
      expect(within(summary).getByText('No metric values are available yet.')).toBeVisible();
    }
    expect(summary.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    expect(within(summary).queryByText('-', { exact: true })).not.toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Independent reading details' });
    expect(within(drawer).getByText('Reading')).toBeVisible();
    if (pending) expect(drawer.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    else expect(within(drawer).getByText('1 empty field is hidden.')).toBeVisible();
    expect(within(drawer).queryByText('-', { exact: true })).not.toBeInTheDocument();
  });

  it('explains an entirely unavailable group with mixed missing and invalid readings', () => {
    render(<OperationalBrief eyebrow="Evidence" title="Unavailable readings"
      description="Unreported and invalid source values." statusLabel="Unavailable"
      metrics={[
        { key: 'missing', label: 'Unreported count', value: '-', detail: 'Not provided', valueState: 'missing' },
        { key: 'invalid', label: 'Invalid count', value: '-', detail: 'Invalid source value', valueState: 'invalid' },
      ]} />);
    const summary = screen.getByRole('region', { name: 'Unavailable readings' });
    expect(within(summary).getByText('No metric values are available yet.')).toBeVisible();
    expect(within(summary).getByText('Unreported count')).toBeVisible();
    expect(within(summary).getByText('Invalid count')).toBeVisible();
    expect(summary.querySelector('[data-operational-metric]')).not.toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Unavailable readings details' });
    expect(within(drawer).getByText('No metric values are available yet.')).toBeVisible();
    expect(within(drawer).getByText('2 empty fields are hidden.')).toBeVisible();
    expect(within(drawer).queryByText('-', { exact: true })).not.toBeInTheDocument();
    expect(within(drawer).queryByText('0', { exact: true })).not.toBeInTheDocument();
  });

  it('hides empty metric rows in details and reports the count in a full sentence', () => {
    render(<OperationalBrief eyebrow="Evidence" title="Partial readings"
      description="Available source readings." statusLabel="Partial"
      metrics={[
        { key: 'count', label: 'Count', value: 3, detail: 'Measured count.', valueState: 'value' },
        { key: 'distance', label: 'Distance', value: '-', detail: 'Not provided', valueState: 'missing' },
      ]} />);
    const summary = screen.getByRole('region', { name: 'Partial readings' });
    expect(within(summary).getByText('Count')).toBeVisible();
    expect(within(summary).queryByText('Distance')).not.toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Partial readings details' });
    expect(within(drawer).getByText('Count')).toBeVisible();
    expect(within(drawer).queryByText('Distance')).not.toBeInTheDocument();
    expect(within(drawer).getByText('1 empty field is hidden.')).toBeVisible();
  });

  it('renders decision context, evidence, and workflow actions', () => {
    const onOpen = vi.fn();

    render(
      <OperationalBrief
        title="Battery posture"
        eyebrow="Operational brief"
        description="Review one pack signal."
        statusLabel="Monitor"
        statusTone="warning"
        scope="Fleet · All vehicles"
        freshness="2025-01-15T10:00:00Z"
        metricColumns={2}
        metrics={[
          { key: 'score', label: 'Pack score', value: '91', detail: 'Fleet average' },
          {
            key: 'cycles',
            label: 'Cycle exposure',
            value: '284 eq.',
            detail: 'Equivalent full cycles',
            tone: 'success',
          },
        ]}
        attention={[
          {
            key: 'projection',
            title: 'Projection changed',
            description: 'The long-term projection moved outside its expected band.',
            tone: 'warning',
          },
        ]}
        provenance="Battery-health snapshots and charging history"
        actions={<Button onClick={onOpen}>Open battery workspace</Button>}
      />,
    );

    expect(screen.getByRole('region', { name: 'Battery posture' })).toBeInTheDocument();
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument();
    expect(screen.getByText('Pack score')).toBeInTheDocument();
    expect(screen.getByText('Projection changed')).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveClass('flex', 'flex-wrap');

    fireEvent.click(screen.getByRole('button', { name: 'Open battery workspace' }));
    expect(onOpen).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Battery posture details' });
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByText('Monitor')).toBeVisible();
    expect(
      screen.getByText('Battery-health snapshots and charging history'),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('What changed')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();

    const closeButtons = within(drawer).getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(
      screen.queryByRole('dialog', { name: 'Battery posture details' }),
    ).not.toBeInTheDocument();
  });

  it('shows an explicit clear state in the detail drawer when there are no attention items', () => {
    render(
      <OperationalBrief
        eyebrow="Operational brief"
        title="Fleet posture"
        description="All connected vehicles are available."
        statusLabel="Nominal"
        statusTone="success"
        metrics={[
          {
            key: 'availability',
            label: 'Availability',
            value: '100%',
            detail: 'Connected fleet',
          },
        ]}
        attention={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByText('No current attention items.')).toBeInTheDocument();
  });
});
