import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaintenanceSummaryPanel } from './MaintenanceSummaryPanel';
import type { MaintenanceEvidence } from '../lib/types';

const SAMPLE: MaintenanceEvidence = {
  scheduled_item_count: 3,
  service_record_count: 2,
  service_records: [
    { item_id: 'svc_1', date: '2024-03-01', odometer_m: 15000000, notes: 'Tire rotation' },
    { item_id: 'svc_2', date: '2024-06-15', odometer_m: null, notes: '' },
  ],
  categories: ['tires', 'brakes'],
};

describe('MaintenanceSummaryPanel', () => {
  it('renders an empty state when maintenance evidence is null', () => {
    render(<MaintenanceSummaryPanel maintenance={null} />);
    expect(screen.getByText(/No maintenance or service evidence/i)).toBeInTheDocument();
  });

  it('renders the fleet-wide scope limitation callout', () => {
    render(<MaintenanceSummaryPanel maintenance={SAMPLE} />);
    expect(screen.getByText(/not filtered per vehicle/i)).toBeInTheDocument();
  });

  it('renders scheduled/record counts and categories', () => {
    render(<MaintenanceSummaryPanel maintenance={SAMPLE} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('tires, brakes')).toBeInTheDocument();
  });

  it('renders each service record with date and notes', () => {
    render(<MaintenanceSummaryPanel maintenance={SAMPLE} />);
    expect(screen.getByText('2024-03-01')).toBeInTheDocument();
    expect(screen.getByText('Tire rotation')).toBeInTheDocument();
  });

  it('handles a record with a null odometer gracefully', () => {
    render(<MaintenanceSummaryPanel maintenance={SAMPLE} />);
    expect(screen.getByText('2024-06-15')).toBeInTheDocument();
  });
});
