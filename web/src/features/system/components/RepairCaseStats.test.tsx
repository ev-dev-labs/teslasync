import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  assertOperationalBriefDisclosure,
  assertOperationalMetricUnavailable,
} from '@/test/operationalBriefAssertions';
import { RepairCaseStats } from './RepairCaseStats';
import type { RepairCaseStats as Statistics } from '@/api/hooks/useRepairCaseStats';
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' }, settingsUnavailable: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) =>
      (fallback ?? key).replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match),
  }),
}));

describe('RepairCaseStats readings', () => {
  it('keeps all four metric roles unknown when no statistics have loaded', () => {
    const { container } = render(<RepairCaseStats />);
    const region = within(screen.getByRole('region', { name: 'Repair case metrics' }));
    // Unknown readings are omitted from the face — never em-dash placeholders,
    // never invented zeros.
    expect(region.queryByText('—')).toBeNull();
    expect(region.queryByText('0')).toBeNull();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(region.getByText('No metric values are available yet.')).toBeInTheDocument();
    // All four labels survive as chips so the operator knows what is missing...
    for (const label of ['Open cases', 'In review', 'Quarantined', 'Active cases']) {
      expect(region.getByText(label)).toBeInTheDocument();
    }
    // ...and the drawer carries the counted explanation plus the source status.
    const brief = container.querySelector('[data-operational-brief]') as HTMLElement;
    assertOperationalMetricUnavailable(brief, 'Open cases');
    assertOperationalMetricUnavailable(brief, 'In review');
    assertOperationalMetricUnavailable(brief, 'Quarantined');
    assertOperationalMetricUnavailable(brief, 'Active cases');
    assertOperationalBriefDisclosure(container, 'Source unavailable');
  });

  it('keeps an authoritative zero distinct from an absent reading', () => {
    const { container } = render(<RepairCaseStats statistics={{
      total: 0, open: 0, in_review: 0, quarantined: 0, applied: 0,
      dismissed: 0, restored: 0, resolved: 0, drive: 0, charging: 0,
    } as Statistics} />);
    expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getAllByText('0')).toHaveLength(4);
    expect(screen.queryByText('—')).toBeNull();
    // The workload hint moved off the face into the drawer's per-metric group.
    const brief = container.querySelector('[data-operational-brief]') as HTMLElement;
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('group', { name: 'Active cases' })).toHaveTextContent('Active review workload');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
