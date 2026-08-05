import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IncidentSummaryPanel } from './IncidentSummaryPanel';
import type { SecurityIncidentsEvidence } from '../lib/types';

const SAMPLE: SecurityIncidentsEvidence = {
  observed_event_count: 5,
  by_type: [
    { event_type: 'sentry_triggered', count: 3 },
    { event_type: 'tow_detected', count: 2 },
  ],
  acknowledged_count: 4,
  earliest_event_at: '2024-01-01',
  latest_event_at: '2024-05-01',
};

describe('IncidentSummaryPanel', () => {
  it('renders an empty state when incidents is null', () => {
    render(<IncidentSummaryPanel incidents={null} />);
    expect(screen.getByText(/No security incident evidence/i)).toBeInTheDocument();
  });

  it('renders counts and date bounds', () => {
    render(<IncidentSummaryPanel incidents={SAMPLE} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2024-01-01')).toBeInTheDocument();
    expect(screen.getByText('2024-05-01')).toBeInTheDocument();
  });

  it('renders a badge per event type with its count', () => {
    render(<IncidentSummaryPanel incidents={SAMPLE} />);
    expect(screen.getByText('sentry_triggered: 3')).toBeInTheDocument();
    expect(screen.getByText('tow_detected: 2')).toBeInTheDocument();
  });
});
