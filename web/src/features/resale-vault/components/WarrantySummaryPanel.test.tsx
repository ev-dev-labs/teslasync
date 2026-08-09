import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WarrantySummaryPanel } from './WarrantySummaryPanel';
import type { WarrantyEvidence } from '../lib/types';

describe('WarrantySummaryPanel', () => {
  it('renders an empty state when warranty is null', () => {
    render(<WarrantySummaryPanel warranty={null} />);
    expect(screen.getByText(/No warranty evidence/i)).toBeInTheDocument();
  });

  it('renders an empty state when warranty.data is null', () => {
    render(<WarrantySummaryPanel warranty={{ fetched_at: '2024-01-01', data: null }} />);
    expect(screen.getByText(/No warranty evidence/i)).toBeInTheDocument();
  });

  it('renders the vehicle scope note and scrubbed data as key/value rows', () => {
    const warranty: WarrantyEvidence = {
      fetched_at: '2024-01-01',
      data: { plan_name: 'New Vehicle Limited Warranty', expires_at: '2028-01-01' },
    };
    render(<WarrantySummaryPanel warranty={warranty} />);
    expect(screen.getByText(/vehicle selected for this report/i)).toBeInTheDocument();
    expect(screen.getByText('plan_name')).toBeInTheDocument();
    expect(screen.getByText('New Vehicle Limited Warranty')).toBeInTheDocument();
  });
});
