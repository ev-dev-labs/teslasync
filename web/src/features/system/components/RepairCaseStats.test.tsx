import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RepairCaseStats } from './RepairCaseStats';
import type { RepairCaseStats as Statistics } from '@/api/hooks/useRepairCaseStats';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

describe('RepairCaseStats readings', () => {
  it('keeps all four metric roles unknown when no statistics have loaded', () => {
    render(<RepairCaseStats />);
    const region = within(screen.getByRole('region', { name: 'Repair case metrics' }));
    expect(region.getAllByText('—')).toHaveLength(4);
    expect(region.queryByText('0')).toBeNull();
    expect(region.getByText('Active review workload')).toBeInTheDocument();
  });

  it('keeps an authoritative zero distinct from an absent reading', () => {
    render(<RepairCaseStats statistics={{
      total: 0, open: 0, in_review: 0, quarantined: 0, applied: 0,
      dismissed: 0, restored: 0, resolved: 0, drive: 0, charging: 0,
    } as Statistics} />);
    expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getAllByText('0')).toHaveLength(4);
    expect(screen.queryByText('—')).toBeNull();
  });
});
