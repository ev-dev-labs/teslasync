import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { FeatureFlagsSummary } from './FeatureFlagsSummary';
import { OrderSummary } from './OrderSummary';
import { computeOrderStats } from '../tesla-orders/teslaOrderStats';

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate: (date: string) => date }),
}));

afterEach(cleanup);

describe('independent summary sources', () => {
  it('keeps measured flag zeros while the unresolved audit counts remain unknown', () => {
    render(<FeatureFlagsSummary flags={[]} changes={undefined} flagsLoading={false} changesLoading={false} />);
    const region = screen.getByRole('region', { name: 'Feature flag summary metrics' });
    expect(within(region).getAllByText('0')).toHaveLength(3);
    expect(within(region).getAllByText('—')).toHaveLength(3);
    for (const label of ['Total flags', 'Boolean toggles', 'Structured', 'Recent changes', 'Deletes', 'Contributors']) {
      expect(within(region).getByText(label)).toBeInTheDocument();
    }
  });

  it('shows pending orders as unknown while preserving the six metric labels and known-empty results as zero', () => {
    const { rerender } = render(<OrderSummary stats={null} loading />);
    expect(screen.getByText('Total orders')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(6);
    expect(screen.queryByText('0')).toBeNull();
    rerender(<OrderSummary stats={computeOrderStats([])} loading={false} />);
    expect(screen.getAllByText('0')).toHaveLength(5);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Booked or building')).toBeInTheDocument();
    expect(screen.getByText('Awaiting handover')).toBeInTheDocument();
    expect(screen.getByText('Soonest upcoming')).toBeInTheDocument();
  });
});
