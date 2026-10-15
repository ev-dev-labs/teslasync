import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { typography } from '@/lib/tokens';
import type { ActionCenterProviderStatus } from '@/types/actionCenter';
import { ProviderStatusPanel } from './ProviderStatusPanel';

const providers: ActionCenterProviderStatus[] = [
  {
    source_feature: 'active_alerts',
    status: 'available',
    item_count: 0,
    limitations: [],
  },
  {
    source_feature: 'advanced_intelligence',
    status: 'degraded',
    item_count: 1,
    limitations: ['Retained findings; current observation time is unknown.'],
  },
  {
    source_feature: 'battery_health',
    status: 'unavailable',
    item_count: 17,
    limitations: ['History is unavailable.', 'No substitute measurement was produced.'],
  },
  { source_feature: 'charging_reliability', status: 'available', item_count: 2, limitations: [] },
  { source_feature: 'drive_efficiency', status: 'available', item_count: 3, limitations: [] },
  { source_feature: 'fleet_maintenance', status: 'available', item_count: 4, limitations: [] },
  { source_feature: 'signal_health', status: 'available', item_count: 5, limitations: [] },
  { source_feature: 'system_health', status: 'available', item_count: 6, limitations: [] },
  { source_feature: 'vehicle_readiness', status: 'available', item_count: 7, limitations: [] },
];

describe('ProviderStatusPanel presentation', () => {
  it('preserves all nine providers, status meanings, exact counts and every limitation', () => {
    render(<ProviderStatusPanel providers={providers} loading={false} />);

    const names = [
      'active alerts', 'advanced intelligence', 'battery health', 'charging reliability',
      'drive efficiency', 'fleet maintenance', 'signal health', 'system health',
      'vehicle readiness',
    ];
    const statuses = [
      'available', 'degraded', 'unavailable', 'available', 'available',
      'available', 'available', 'available', 'available',
    ];
    const counts = [
      '0 findings', '1 findings', '17 findings', '2 findings', '3 findings',
      '4 findings', '5 findings', '6 findings', '7 findings',
    ];
    const grid = screen.getByText('active alerts').parentElement?.parentElement?.parentElement;
    expect(grid).not.toBeNull();
    expect(grid?.children).toHaveLength(9);
    names.forEach((name, index) => {
      const row = screen.getByText(name).parentElement?.parentElement;
      expect(row).not.toBeNull();
      expect(grid?.children[index]).toBe(row);
      if (!row) throw new Error('Expected provider row');
      expect(within(row).getByText(statuses[index])).toBeVisible();
      expect(within(row).getByText(counts[index])).toBeVisible();
    });
    const availableStatuses = screen.getAllByText('available');
    expect(availableStatuses).toHaveLength(7);
    availableStatuses.forEach((status) => {
      expect(status).toHaveClass('text-[var(--semantic-success)]');
    });
    expect(screen.getByText('degraded')).toHaveClass('text-[var(--semantic-warning)]');
    expect(screen.getByText('unavailable')).toHaveClass('text-[var(--semantic-danger)]');
    providers.flatMap((provider) => provider.limitations).forEach((limitation) => {
      expect(screen.getByText(limitation)).toBeVisible();
    });
  });

  it('uses neutral theme roles for icon and rows and shared Typography for readable metadata', () => {
    const { container } = render(
      <ProviderStatusPanel providers={[providers[1]]} loading={false} />,
    );

    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('h-5', 'w-5', 'shrink-0', typography.color.secondary);
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
    const name = screen.getByText('advanced intelligence');
    expect(name).toHaveClass(typography.size.sm, typography.weight.medium, typography.color.primary);
    expect(name.parentElement?.parentElement).toHaveClass(
      'rounded-xl', 'border', 'border-[var(--border-subtle)]', 'bg-[var(--surface-2)]', 'p-3',
    );
    expect(screen.getByText('1 findings')).toHaveClass(...typography.role.caption.split(' '));
    expect(screen.getByText(providers[1].limitations[0])).toHaveClass(
      ...typography.role.caption.split(' '),
    );
    expect(screen.getByText('degraded')).toHaveClass('text-[var(--semantic-warning)]');
  });

  it('preserves the title and explanation with three loading placeholders and no invented finding', () => {
    const { container, rerender } = render(
      <ProviderStatusPanel providers={providers} loading />,
    );

    expect(screen.getByRole('heading', { name: 'Source coverage' })).toBeVisible();
    expect(screen.getByText(
      'Unavailable sources are shown explicitly; the inbox never invents substitute findings.',
    )).toBeVisible();
    expect(container.querySelectorAll('.bg-\\[var\\(--skeleton-bg\\)\\]')).toHaveLength(3);
    expect(screen.queryByText('active alerts')).not.toBeInTheDocument();
    expect(screen.queryByText('0 findings')).not.toBeInTheDocument();
    expect(screen.queryByText('No provider status was returned.')).not.toBeInTheDocument();

    rerender(<ProviderStatusPanel providers={providers} loading={false} />);
    expect(container.querySelectorAll('.bg-\\[var\\(--skeleton-bg\\)\\]')).toHaveLength(0);
    expect(screen.getByText('active alerts')).toBeVisible();
    expect(screen.getByText('0 findings')).toBeVisible();
  });

  it('keeps authoritative empty status distinct from measured zero and unavailable providers', () => {
    render(<ProviderStatusPanel providers={[]} loading={false} />);

    expect(screen.getByRole('heading', { name: 'Source coverage' })).toBeVisible();
    expect(screen.getByText('No provider status was returned.')).toBeVisible();
    expect(screen.queryByText('0 findings')).not.toBeInTheDocument();
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('available')).not.toBeInTheDocument();
  });

  it('retains source supplied trust limitations and counts across parent rerenders without live assurance', () => {
    const retainedProviders = [providers[1], providers[2]];
    const { rerender } = render(
      <ProviderStatusPanel providers={retainedProviders} loading={false} />,
    );
    const limitation = screen.getByText('Retained findings; current observation time is unknown.');
    expect(limitation).toBeVisible();
    expect(screen.getByText('degraded')).toBeVisible();
    expect(screen.getByText('unavailable')).toBeVisible();

    rerender(<ProviderStatusPanel providers={[...retainedProviders]} loading={false} />);

    expect(screen.getByText('Retained findings; current observation time is unknown.')).toBeVisible();
    expect(screen.getByText('History is unavailable.')).toBeVisible();
    expect(screen.getByText('No substitute measurement was produced.')).toBeVisible();
    expect(screen.getByText('1 findings')).toBeVisible();
    expect(screen.getByText('17 findings')).toBeVisible();
    expect(screen.getByText('degraded')).toBeVisible();
    expect(screen.getByText('unavailable')).toBeVisible();
    expect(screen.queryByText('available')).not.toBeInTheDocument();
    expect(screen.queryByText('0 findings')).not.toBeInTheDocument();
  });
});
