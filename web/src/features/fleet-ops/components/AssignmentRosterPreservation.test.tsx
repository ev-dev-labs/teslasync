import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetAssignment } from '@/api/hooks/useFleetOps';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import { AssignmentRoster } from './AssignmentRoster';

vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}));

const callbacks = {
  onRetry: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(),
};
const items: FleetAssignment[] = Array.from({ length: 27 }, (_, index) => ({
  id: index + 1,
  vehicle_id: index + 100,
  vehicle_display_name: `Pool vehicle ${index + 1}`,
  driver_id: index + 200,
  driver_display_name: `Roster driver ${index + 1}`,
  starts_at: '2026-10-01T12:00:00Z',
  ends_at: null,
  notes: null,
  version: 3,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}));

function roster(data: FleetAssignment[]) {
  return <AssignmentRoster items={data} enableValueFilters loading={false} error={null} {...callbacks} />;
}

async function exportRows(format: 'CSV' | 'JSON') {
  fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
  fireEvent.click(screen.getByRole('menuitem', { name: `Download as ${format}` }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled());
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('actual assignment roster member filters and complete exports', () => {
  it('exports every matching loaded record, not just the 25-row rendered page, through both existing formats', async () => {
    const original = JSON.stringify(items);
    render(roster(items));
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.queryByRole('button', { name: 'Edit assignment for Roster driver 27' })).not.toBeInTheDocument();
    await exportRows('JSON');
    const json = vi.mocked(downloadJSON).mock.calls[0]?.[1];
    expect(json).toEqual(items.map(item => ({
      driver: item.driver_display_name,
      vehicle: item.vehicle_display_name,
      starts_at: item.starts_at,
      ends_at: null,
      actions: null,
    })));
    await exportRows('CSV');
    const csv = vi.mocked(downloadCSV).mock.calls[0]?.[1] ?? '';
    expect(csv.split(/\r?\n/).filter(Boolean)).toHaveLength(28);
    expect(csv).toContain('Driver,Vehicle,Starts,Ends,Actions');
    for (const item of items) {
      expect(csv).toContain(item.driver_display_name);
      expect(csv).toContain(item.vehicle_display_name);
    }
    expect(JSON.stringify(items)).toBe(original);
  });

  it('keeps selected driver identities when names and row order change, including the last loaded member', async () => {
    const { rerender } = render(roster(items));
    fireEvent.click(screen.getByRole('button', { name: 'Driver filter' }));
    const filter = screen.getByRole('dialog', { name: 'Driver filter' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }));
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Roster driver 2' }));
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Roster driver 27' }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Edit assignment for Roster driver 27' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit assignment for Roster driver 1' })).not.toBeInTheDocument();

    const renamed = [...items].reverse().map(item => ({
      ...item,
      driver_display_name: item.driver_id === items[1]!.driver_id
        ? 'Renamed selected driver' : item.driver_display_name,
    }));
    rerender(roster(renamed));
    expect(screen.getByRole('button', { name: 'Edit assignment for Renamed selected driver' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Driver filter' }));
    const changedFilter = screen.getByRole('dialog', { name: 'Driver filter' });
    expect(within(changedFilter).getByRole('checkbox', { name: 'Renamed selected driver' })).toBeChecked();
    expect(within(changedFilter).getByRole('checkbox', { name: 'Roster driver 27' })).toBeChecked();
    expect(within(changedFilter).getByRole('checkbox', { name: 'Roster driver 1' })).not.toBeChecked();
    fireEvent.click(within(changedFilter).getByRole('button', { name: 'Done' }));
    await exportRows('JSON');
    const exported = vi.mocked(downloadJSON).mock.calls[0]?.[1];
    expect(exported).toEqual([
      expect.objectContaining({ driver: 'Roster driver 27', vehicle: 'Pool vehicle 27' }),
      expect.objectContaining({ driver: 'Renamed selected driver', vehicle: 'Pool vehicle 2' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment for Renamed selected driver' }));
    expect(callbacks.onEdit).toHaveBeenCalledWith(renamed.find(item => item.id === 2));
  });
});
