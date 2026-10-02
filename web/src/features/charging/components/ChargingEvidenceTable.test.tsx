import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataTable } from '@/components/ui';
import type { ChargingSession } from '@/api/types';
import { ChargingEvidenceTable } from './ChargingEvidenceTable';
import { CHARGING_VALUE_COLUMNS, chargingColumnValue, parseChargingValueSelections } from './chargingGridValues';

type TableProps = Parameters<typeof DataTable<ChargingSession>>[0];
const capture = vi.hoisted(() => ({ props: null as TableProps | null }));

vi.mock('@/components/ui', async (importActual) => {
  const actual = await importActual<typeof import('@/components/ui')>();
  return {
    ...actual,
    DataTable: (props: TableProps) => {
      capture.props = props;
      return <div>{props.data.map((row) => (
        <div key={row.id} data-testid={`session-${row.id}`}>
          {props.columns.map((column) => <div key={column.key} data-testid={`${row.id}-${column.key}`}>{column.render(row)}</div>)}
        </div>
      ))}</div>;
    },
  };
});

const session = (overrides: Partial<ChargingSession> = {}): ChargingSession => ({
  id: 41, vehicle_id: 7, started_at: '2026-10-01T08:00:00Z',
  startedAt: '2026-10-01T08:00:00Z', ended_at: '2026-10-01T09:00:00Z',
  duration_min: 60, start_soc_pct: 0, end_soc_pct: 80, delta_soc_pct: 80,
  start_odometer_m: null, end_odometer_m: null,
  start_lat: null, start_lng: null, start_place: 'Home',
  total_energy_added_wh: 18000, peak_power_w: 22000, avg_power_w: 18000,
  cost_decimal: 0, cost_currency: 'USD', charger_type: 'AC', cable_type: null,
  ...overrides,
});

function mount(rows: ChargingSession[], selectedIds = new Set<number>(), availableSessions = rows) {
  const onSelectionChange = vi.fn();
  const onPreview = vi.fn();
  const onSort = vi.fn();
  const onValueSelectionChange = vi.fn();
  const onValueFilterClear = vi.fn();
  render(
    <MemoryRouter>
      <ChargingEvidenceTable
        sessions={rows}
        availableSessions={availableSessions}
        valueSelections={{}}
        invalidValueSelection={false}
        onValueSelectionChange={onValueSelectionChange}
        onValueFilterClear={onValueFilterClear}
        timezone="UTC"
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        onPreview={onPreview}
        anomalies={new Map()}
        sortBy="date"
        sortDir="desc"
        onSort={onSort}
        density="compact"
        toolbarHeading="History"
        toolbarActions={null}
      />
    </MemoryRouter>,
  );
  return { onSelectionChange, onPreview, onSort, onValueSelectionChange, onValueFilterClear };
}

describe('ChargingEvidenceTable', () => {
  beforeEach(() => { capture.props = null; });

  it('uses controlled header filters over the loaded window before page-owned pagination', () => {
    mount([session()]);
    expect(capture.props).toMatchObject({
      tableId: 'charging:evidence', density: 'compact',
      resizable: true, columnReorder: true, stickyHeader: true, selectable: 'multi',
      maxHeight: 560,
    });
    expect(capture.props?.enableValueFilters).not.toBe(true);
    expect(capture.props?.pagination).toBeUndefined();
    expect(capture.props?.columns.filter((column) => column.filter).map((column) => column.key)).toEqual(CHARGING_VALUE_COLUMNS);
  });

  it('keeps known zero distinct from unknown cost, battery, and power', () => {
    mount([
      session(),
      session({ id: 42, end_soc_pct: null, cost_decimal: null, peak_power_w: null, avg_power_w: null, ended_at: null }),
    ]);
    expect(screen.getByTestId('41-batteryStart')).toHaveTextContent('0%');
    expect(screen.getByTestId('41-cost')).toHaveTextContent(/free/i);
    expect(screen.getByTestId('42-batteryEnd')).toHaveTextContent('—');
    expect(screen.getByTestId('42-cost')).toHaveTextContent('—');
    expect(screen.getByTestId('42-power')).toHaveTextContent('—');
    expect(screen.getByTestId('42-peakPower')).toHaveTextContent('—');
    expect(screen.getByTestId('42-duration')).toHaveTextContent('—');
  });

  it('retains session navigation and preview inspection', () => {
    const row = session();
    const { onPreview } = mount([row]);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/charging/41');
    fireEvent.click(screen.getByRole('button', { name: /quick view charging session/i }));
    expect(onPreview).toHaveBeenCalledWith(row);
    expect(capture.props?.columns.map((column) => column.key)).toEqual([
      'date', 'location', 'charger', 'duration', 'energy', 'power', 'peakPower',
      'batteryStart', 'batteryEnd', 'range', 'cost', 'rate', 'score', 'actions',
    ]);
  });

  it('preserves off-page selections when visible-page selection changes', () => {
    const { onSelectionChange } = mount([session()], new Set([41, 90]));
    capture.props?.onSelectionChange?.([41]);
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([41, 90]));
    capture.props?.onSelectionChange?.([]);
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([90]));
  });

  it('forwards only existing charging sort fields', () => {
    const { onSort } = mount([session()]);
    capture.props?.onSort?.('energy');
    capture.props?.onSort?.('power');
    capture.props?.onSort?.('batteryEnd');
    expect(onSort.mock.calls).toEqual([['energy'], ['power']]);
  });

  it('offers values from off-page rows and preserves the header clear action', () => {
    const { onValueFilterClear } = mount([session()], new Set(), [
      session(), session({ id: 42, start_place: 'Remote charger' }),
    ]);
    const column = capture.props?.columns.find((candidate) => candidate.key === 'location');
    render(<>{column?.filter}</>);
    expect(screen.getByRole('checkbox', { name: 'Remote charger' })).toBeInTheDocument();
    column?.onFilterClear?.();
    expect(onValueFilterClear).toHaveBeenCalledWith('location');
  });

  it('keeps canonical SI filter values and unknowns independent of formatted cell labels', () => {
    expect(chargingColumnValue(session(), 'energy')).toBe(18000);
    expect(chargingColumnValue(session(), 'duration')).toBe(3600);
    expect(chargingColumnValue(session(), 'power')).toBe(18000);
    expect(chargingColumnValue(session(), 'batteryStart')).toBe(0);
    expect(chargingColumnValue(session(), 'cost')).toBe(0);
    const unknown = session({ ended_at: null, avg_power_w: null, cost_decimal: null, end_soc_pct: null });
    expect(chargingColumnValue(unknown, 'power')).toBeNull();
    expect(chargingColumnValue(unknown, 'duration')).toBeNull();
    expect(chargingColumnValue(unknown, 'cost')).toBeNull();
    expect(chargingColumnValue(unknown, 'batteryEnd')).toBeNull();
  });

  it('validates saved filter shape without confusing no selection with all values', () => {
    expect(parseChargingValueSelections('{"cost":["null","0"]}')).toEqual({
      selections: { cost: ['null', '0'] }, invalid: false,
    });
    expect(parseChargingValueSelections('{"cost":[]}')).toEqual({ selections: { cost: [] }, invalid: false });
    expect(parseChargingValueSelections('{"cost":{"excluded":["null"]}}')).toEqual({
      selections: { cost: { excluded: ['null'] } }, invalid: false,
    });
    expect(parseChargingValueSelections('{"actions":["0"]}').invalid).toBe(true);
    expect(parseChargingValueSelections('{"cost":["NaN"]}').invalid).toBe(true);
    expect(parseChargingValueSelections('{broken').invalid).toBe(true);
  });
});
