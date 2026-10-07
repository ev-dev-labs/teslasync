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
