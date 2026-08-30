import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '../../../i18n';
import type { Alert } from '@/api/types';
import type { FreshnessQuery } from '@/components/data-display';
import { AlertOperationalBrief } from './AlertOperationalBrief';

const NOW = new Date('2026-05-02T12:00:00Z').getTime();

const ALERTS: Alert[] = [
  {
    id: 1,
    vehicle_id: 7,
    type: 'battery_low',
    severity: 'critical',
    title: 'Battery critically low',
    message: 'Pack at 5%',
    is_read: false,
    created_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
    rule_signal: 'BatteryLevel',
  },
  {
    id: 2,
    vehicle_id: 7,
    type: 'tire_pressure_low',
    severity: 'warning',
    title: 'Pressure warning',
    message: 'Front-left tire',
    is_read: true,
    created_at: new Date(NOW - 30 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    vehicle_id: 7,
    type: 'software_update',
    severity: 'info',
    title: 'Update ready',
    message: 'Install while parked',
    is_read: true,
    created_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
    acknowledged_at: new Date(NOW - 30 * 60 * 1000).toISOString(),
    acknowledged_by: 'operator@example.com',
  },
];

function query(): FreshnessQuery {
  return {
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW - 1000,
    refetch: vi.fn().mockResolvedValue(undefined),
  } as FreshnessQuery;
}

describe('AlertOperationalBrief', () => {
  it('summarizes open lifecycle, critical triage, ownership, scope, and evidence gaps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onViewCritical = vi.fn();
    const onManageRules = vi.fn();

    render(
      <AlertOperationalBrief
        alerts={ALERTS}
        periodLabel="Apr 26 – May 2"
        vehicleLabel="Model Y"
        query={query()}
        onViewCritical={onViewCritical}
        onManageRules={onManageRules}
      />,
    );

    expect(screen.getByText('Immediate triage')).toBeInTheDocument();
    expect(screen.getByText('Model Y')).toBeInTheDocument();
    expect(screen.getByText('Apr 26 – May 2')).toBeInTheDocument();

    const metricFor = (label: string) =>
      screen.getByText(label).closest('[role="listitem"]') as HTMLElement;
    expect(within(metricFor('Open')).getByText('2')).toBeInTheDocument();
    expect(within(metricFor('Open critical')).getByText('1')).toBeInTheDocument();
    expect(within(metricFor('Acknowledged')).getByText('1')).toBeInTheDocument();
    expect(within(metricFor('Responders')).getByText('1')).toBeInTheDocument();

    expect(screen.getByText('1 critical alert requires response')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Triage critical' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage rules' }));
    expect(onViewCritical).toHaveBeenCalledTimes(1);
    expect(onManageRules).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(
      within(drawer).getByText('2 alerts remain open, including 1 critical.'),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('High')).toBeInTheDocument();
    expect(
      within(drawer).getAllByText('Alert event feed', { exact: false }),
    ).not.toHaveLength(0);

    vi.useRealTimers();
  });
});
