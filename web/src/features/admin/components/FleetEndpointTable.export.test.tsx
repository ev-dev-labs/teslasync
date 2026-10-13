import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetEndpoint } from '@/api/hooks/useSettings';
import { FleetEndpointTable } from './FleetEndpointTable';

const endpoint: FleetEndpoint = {
  key: 'vehicle.data.fetch_snapshot',
  method: 'GET',
  path: '/api/1/vehicles/{vehicle_id}/data',
  category: 'Vehicle data',
  pollable: true,
};

interface ConfigurationCase {
  name: string;
  access: boolean | null | undefined;
  auto: boolean | null | undefined;
  pollable: boolean;
  expectedAccess: boolean | null;
  expectedAuto: boolean | null;
}

const cases: ConfigurationCase[] = [
  { name: 'enabled selection', access: true, auto: true, pollable: true, expectedAccess: true, expectedAuto: true },
  { name: 'disabled access', access: false, auto: true, pollable: true, expectedAccess: false, expectedAuto: false },
  { name: 'disabled selection', access: true, auto: false, pollable: true, expectedAccess: true, expectedAuto: false },
  { name: 'both disabled', access: false, auto: false, pollable: true, expectedAccess: false, expectedAuto: false },
  { name: 'unknown access', access: undefined, auto: true, pollable: true, expectedAccess: null, expectedAuto: null },
  { name: 'unknown selection', access: true, auto: undefined, pollable: true, expectedAccess: true, expectedAuto: null },
  { name: 'null access', access: null, auto: true, pollable: true, expectedAccess: null, expectedAuto: null },
  { name: 'null selection', access: true, auto: null, pollable: true, expectedAccess: true, expectedAuto: null },
  { name: 'nonpollable operation', access: true, auto: true, pollable: false, expectedAccess: true, expectedAuto: null },
];

function configuration(value: boolean | null | undefined): Record<string, boolean> {
  const values: Record<string, boolean> = {};
  // Simulate nullable wire entries without changing the production boolean-map API.
  if (value !== undefined) Object.defineProperty(values, endpoint.key, { value, enumerable: true });
  return values;
}

const blobs: Blob[] = [];
const filenames: string[] = [];
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  localStorage.clear();
  blobs.length = 0;
  filenames.length = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return `blob:fleet-fixture/${blobs.length}`;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    filenames.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

async function exportText(format: 'CSV' | 'JSON'): Promise<string> {
  const count = blobs.length;
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
  fireEvent.click(screen.getByRole('menuitem', { name: `Download as ${format}` }));
  await waitFor(() => expect(blobs).toHaveLength(count + 1));
  expect(filenames[count]).toMatch(format === 'JSON' ? /\.json$/ : /\.csv$/);
  return blobs[count].text();
}

function mountTable(access: Record<string, boolean>, auto: Record<string, boolean>, pollable = true) {
  return render(<FleetEndpointTable
    endpoints={[{ ...endpoint, pollable }]}
    candidates={[{ ...endpoint, pollable }]}
    access={access}
    auto={auto}
    pollingEnabled
    pending={false}
    tableId="fleet:export-fixture"
    onEnable={vi.fn()}
    onAuto={vi.fn()}
  />);
}

describe('FleetEndpointTable existing export serialization', () => {
  it.each(cases)('serializes $name as explicit configuration in JSON and CSV', async (testCase) => {
    mountTable(configuration(testCase.access), configuration(testCase.auto), testCase.pollable);

    expect(JSON.parse(await exportText('JSON'))).toEqual([{
      method: 'GET',
      operation: 'vehicle.data.fetch_snapshot',
      path: '/api/1/vehicles/{vehicle_id}/data',
      access: testCase.expectedAccess,
      auto: testCase.expectedAuto,
    }]);
    expect(await exportText('CSV')).toBe(
      'HTTP method,Operation,API path,Access,Auto-poll\r\n'
      + 'GET,vehicle.data.fetch_snapshot,/api/1/vehicles/{vehicle_id}/data,'
      + `${testCase.expectedAccess ?? ''},${testCase.expectedAuto ?? ''}`,
    );
  });

  it('preserves selected configuration while master polling is paused', async () => {
    const access = configuration(true);
    const auto = configuration(true);
    render(<FleetEndpointTable endpoints={[endpoint]} candidates={[endpoint]} access={access} auto={auto}
      pollingEnabled={false} pending={false} tableId="fleet:paused-fixture" onEnable={vi.fn()} onAuto={vi.fn()} />);

    const pollSwitch = screen.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles/{vehicle_id}/data' });
    expect(pollSwitch).toHaveAttribute('aria-checked', 'true');
    expect(pollSwitch).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Enable GET /api/1/vehicles/{vehicle_id}/data' })).toBeEnabled();
    expect(JSON.parse(await exportText('JSON'))).toEqual([{
      method: 'GET', operation: 'vehicle.data.fetch_snapshot', path: '/api/1/vehicles/{vehicle_id}/data',
      access: true, auto: true,
    }]);
    expect(await exportText('CSV')).toBe(
      'HTTP method,Operation,API path,Access,Auto-poll\r\n'
      + 'GET,vehicle.data.fetch_snapshot,/api/1/vehicles/{vehicle_id}/data,true,true',
    );
    expect(access[endpoint.key]).toBe(true);
    expect(auto[endpoint.key]).toBe(true);
  });

  it('retains operation labels, row counts, callbacks and pending action guards', () => {
    const onEnable = vi.fn();
    const onAuto = vi.fn();
    const props = {
      endpoints: [endpoint], candidates: [endpoint], access: configuration(true), auto: configuration(true),
      pollingEnabled: true, pending: false, tableId: 'fleet:actions-fixture', onEnable, onAuto,
    };
    const view = render(<FleetEndpointTable {...props} />);
    expect(screen.getByText('vehicle › data › fetch snapshot')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    const accessSwitch = screen.getByRole('switch', { name: 'Enable GET /api/1/vehicles/{vehicle_id}/data' });
    const autoSwitch = screen.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles/{vehicle_id}/data' });
    expect(accessSwitch).toHaveAttribute('aria-checked', 'true');
    expect(autoSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(accessSwitch);
    fireEvent.click(autoSwitch);
    expect(onEnable).toHaveBeenCalledExactlyOnceWith(endpoint);
    expect(onAuto).toHaveBeenCalledExactlyOnceWith('vehicle.data.fetch_snapshot');

    view.rerender(<FleetEndpointTable {...props} pending />);
    expect(accessSwitch).toBeDisabled();
    expect(autoSwitch).toBeDisabled();
    fireEvent.click(accessSwitch);
    fireEvent.click(autoSwitch);
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(onAuto).toHaveBeenCalledTimes(1);
  });

  it('exports current maps for matching loaded rows without adding candidate rows', async () => {
    const candidate: FleetEndpoint = { ...endpoint, key: 'vehicle.command.wake_up', method: 'POST', path: '/api/1/vehicles/{vehicle_id}/wake_up', pollable: false };
    const props = {
      endpoints: [endpoint], candidates: [endpoint, candidate],
      access: configuration(true), auto: configuration(true),
      pollingEnabled: true, pending: false, tableId: 'fleet:matching-fixture', onEnable: vi.fn(), onAuto: vi.fn(),
    };
    const view = render(<FleetEndpointTable {...props} />);
    await exportText('JSON');
    view.rerender(<FleetEndpointTable {...props} access={configuration(false)} auto={configuration(false)} />);
    expect(JSON.parse(await exportText('JSON'))).toEqual([{
      method: 'GET', operation: 'vehicle.data.fetch_snapshot', path: '/api/1/vehicles/{vehicle_id}/data',
      access: false, auto: false,
    }]);
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('switch', { name: 'Enable GET /api/1/vehicles/{vehicle_id}/data' }))
      .toHaveAttribute('aria-checked', 'false');
  });
});
