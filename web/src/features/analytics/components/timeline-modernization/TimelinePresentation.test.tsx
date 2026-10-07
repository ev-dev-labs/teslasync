// AUTHOREDNOTRUN: parent owns React/Vitest validation after source quiescence.
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StatStripProps } from '@/components/data-display/stat-reference';
import { TimelineSource, type TimelineSourceFacts } from './TimelineSource';
import { TimelineSummary } from './TimelineSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => values?.[key] ?? ''),
  }),
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
  ErrorDisplay: ({ message }: { message: string }) => <p role="alert">{message}</p>,
  AlertBanner: ({ children }: { children: ReactNode }) => <div role="status">{children}</div>,
  Skeleton: () => <div data-testid="loading-placeholder" />,
}));
const stripSpy = vi.fn();
vi.mock('@/components/data-display/stat-reference', () => ({
  StatStrip: (props: StatStripProps) => {
    stripSpy(props);
    return <section>
      <p>{props.period.label}</p>
      {props.metrics.map(metric => <p key={metric.occurrenceId} data-testid={metric.occurrenceId}>
        {metric.rawValue == null ? '—' : String(metric.rawValue)}
      </p>)}
      {props.footer}
    </section>;
  },
}));

const ready: TimelineSourceFacts = {
  enabled: true, available: true, loading: false, paused: false, error: null,
};
const period = {
  kind: 'analysis', label: 'Requested window', start: '2026-01-01T00:00:00Z',
  endExclusive: '2026-01-08T00:00:00Z', timezone: 'America/Los_Angeles',
  completeness: 'unknown', provenance: 'Vehicle FSM summary',
} as const;

describe('independent Timeline source trust', () => {
  it('retains usable records when the refresh fails', () => {
    render(<TimelineSource source={{ ...ready, error: new Error('refresh') }} label="Records">
      <p>Recorded transition</p>
    </TimelineSource>);
    expect(screen.getByText('Recorded transition')).toBeInTheDocument();
    expect(screen.getByText(/Showing retained Records/)).toBeInTheDocument();
  });

  it('does not confuse paused initial loading with an empty successful result', () => {
    render(<TimelineSource source={{ ...ready, available: false, paused: true }} label="Records">
      <p>Empty result</p>
    </TimelineSource>);
    expect(screen.getByText('Records is paused while the connection is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Empty result')).not.toBeInTheDocument();
  });

  it('keeps retained records reachable when paused', () => {
    render(<TimelineSource source={{ ...ready, paused: true }} label="Records"><p>Retained row</p></TimelineSource>);
    expect(screen.getByText('Retained row')).toBeInTheDocument();
    expect(screen.getByText(/Refresh is paused/)).toBeInTheDocument();
  });

  it('keeps the fatal reason visible when a failed source is also paused', () => {
    render(<TimelineSource source={{ ...ready, available: false, paused: true, error: new Error('fatal') }} label="Records">{null}</TimelineSource>);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load Records');
    expect(screen.getByText('Records is paused while the connection is unavailable')).toBeInTheDocument();
  });

  it('only replaces the failing source and leaves independent neighbors usable', () => {
    render(<>
      <TimelineSource source={{ ...ready, available: false, error: new Error('fatal') }} label="Summary"><p>Unavailable summary</p></TimelineSource>
      <TimelineSource source={ready} label="Records"><p>Usable records</p></TimelineSource>
    </>);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load Summary');
    expect(screen.getByText('Usable records')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable summary')).not.toBeInTheDocument();
  });

  it('distinguishes unknown response shape from known empty content', () => {
    const { rerender } = render(<TimelineSource source={{ ...ready, available: false }} label="Records"><p>No transitions</p></TimelineSource>);
    expect(screen.getByText(/expected records/)).toBeInTheDocument();
    rerender(<TimelineSource source={ready} label="Records"><p>No transitions</p></TimelineSource>);
    expect(screen.getByText('No transitions')).toBeInTheDocument();
    expect(screen.queryByText(/expected records/)).not.toBeInTheDocument();
  });

  it('offers vehicle selection guidance rather than claiming an empty history', () => {
    render(<TimelineSource source={{ ...ready, available: false, enabled: false }} label="Records">{null}</TimelineSource>);
    expect(screen.getByText('Select a vehicle to view its state history')).toBeInTheDocument();
  });

  it('marks initial source loading without hiding another panel', () => {
    render(<>
      <TimelineSource source={{ ...ready, available: false, loading: true }} label="Summary">{null}</TimelineSource>
      <TimelineSource source={ready} label="Records"><p>Usable records</p></TimelineSource>
    </>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading Summary');
    expect(screen.getByText('Usable records')).toBeInTheDocument();
  });
});

describe('summary source coverage and specialist formatting', () => {
  it('passes missing values, not invented zero measurements, without a summary', () => {
    render(<TimelineSummary source={{ ...ready, available: false }} period={period}
      totalTransitions={0} drivingTime="0m" chargingTime="0m" idleSleepTime="0m" />);
    expect(screen.getByTestId('timeline-total-transitions')).toHaveTextContent('—');
    expect(screen.getByTestId('timeline-driving-time')).toHaveTextContent('—');
    const props = stripSpy.mock.lastCall?.[0] as StatStripProps;
    expect(props.metrics.every(metric => metric.rawValue === null)).toBe(true);
    expect(props.period).toBe(period);
  });

  it('preserves genuine zero and original specialist rollover strings', () => {
    render(<TimelineSummary source={ready} period={period}
      totalTransitions={0} drivingTime="1h" chargingTime="2h" idleSleepTime="0m" />);
    expect(screen.getByTestId('timeline-total-transitions')).toHaveTextContent('0');
    expect(screen.getByTestId('timeline-driving-time')).toHaveTextContent('1h');
    expect(screen.getByTestId('timeline-charging-time')).toHaveTextContent('2h');
    expect(screen.getByTestId('timeline-idle-sleep-time')).toHaveTextContent('0m');
  });

  it('keeps all four measurements under a retained refresh error', () => {
    render(<TimelineSummary source={{ ...ready, error: new Error('refresh') }} period={period}
      totalTransitions={12} drivingTime="1h" chargingTime="2h" idleSleepTime="3h" />);
    const props = stripSpy.mock.lastCall?.[0] as StatStripProps;
    expect(props.retained).toBe(true);
    expect(props.metrics.map(metric => metric.rawValue)).toEqual([12, '1h', '2h', '3h']);
    expect(props.error).toContain('refresh');
  });
});
