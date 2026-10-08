import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui';
import { OperationalBrief } from './OperationalBrief';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string,
      options?: Record<string, string>,
    ) => fallback.replace('{{title}}', options?.title ?? ''),
  }),
}));

describe('OperationalBrief', () => {
  it('retains exact rich source bounds and freshness in both the summary and real drawer', () => {
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
    checkContext(summary);
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
    expect(summary).toHaveTextContent('Source bounds unknown; no interval supplied');
    expect(summary).toHaveTextContent('Observation time unknown');
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
    expect(header?.textContent).toBe('Absent context detailsUnknownNo metadata supplied.');
    expect(within(drawer).getByText('Not scored')).toBeVisible();
    expect(within(drawer).getByText('No current attention items.')).toBeVisible();
  });

  it('preserves zero-valued ReactNode metadata without truthiness filtering', () => {
    render(<OperationalBrief eyebrow="Evidence" title="Zero context"
      description="Caller supplied numeric metadata." statusLabel="Unknown"
      scope={0} freshness={0} metrics={[]} />);
    const summary = screen.getByRole('region', { name: 'Zero context' });
    expect(summary).toHaveTextContent('Unknown00');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Zero context details' });
    expect(drawer.querySelector('[data-drawer-header]')).toHaveTextContent('Unknown00');
  });

  it('preserves complete captions, rich context and long values in the summary and details', () => {
    render(<OperationalBrief compact eyebrow="Source posture" title="Source evidence"
      description="Actual source context" statusLabel="Unknown"
      metrics={[{ key: 'status', label: 'Endpoint', value: 'A complete source-provided endpoint status',
        rawValue: 'A complete source-provided endpoint status', valueState: 'value',
        detail: <><span>Complete explanatory caption</span><span>Retained source context</span></> }]} />);
    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute('data-operational-metric', 'status');
    expect(item).toHaveAttribute('data-value-state', 'value');
    expect(item.querySelector('[data-operational-value]')).toHaveTextContent('A complete source-provided endpoint status');
    expect(screen.getByText('Complete explanatory caption').parentElement).not.toHaveClass('line-clamp-2');
    expect(screen.getByText('Retained source context')).toBeVisible();
  });
  it('marks loading without inventing measurements or removing metric labels and captions', () => {
    const { container } = render(<OperationalBrief loading eyebrow="Snapshot" title="Live source"
      description="Latest source values" statusLabel="Loading"
      metrics={[{ key: 'calls', label: 'Calls', value: '—', detail: 'No measurement supplied' }]} />);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Calls')).toBeVisible();
    expect(screen.getByText('No measurement supplied')).toBeVisible();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
  });
  it('consolidates compact metrics without hiding their explanations', () => {
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
    expect(screen.getByRole('list')).toHaveClass('md:grid-cols-3', 'min-[1920px]:grid-cols-6');
    expect(screen.getByText('Total distance in your display unit.')).toBeVisible();
    expect(screen.getByText('Both drives include measured energy.')).toBeVisible();
    expect(screen.getByText('64 mi')).toHaveClass('text-emerald-700', 'dark:text-emerald-300');
    expect(screen.getByText('Driving posture')).not.toHaveClass('uppercase', 'capitalize');
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
    expect(screen.getByText('Monitor')).toBeInTheDocument();
    expect(screen.getByText('Pack score')).toBeInTheDocument();
    expect(screen.getByText('Projection changed')).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveClass('md:grid-cols-2');

    fireEvent.click(screen.getByRole('button', { name: 'Open battery workspace' }));
    expect(onOpen).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Battery posture details' });
    expect(drawer).toBeInTheDocument();
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
