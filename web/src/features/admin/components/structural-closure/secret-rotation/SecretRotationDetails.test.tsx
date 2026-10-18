import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/api/client';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import type { SecretRotationResponse, SecretRotationStatus } from '@/types/admin-operator-confidence';
import { useSecretRotationPage } from '../../../hooks/useSecretRotationPage';
import { SecretRotationDetails } from './SecretRotationDetails';

vi.mock('@/api/client', () => ({
  request: vi.fn(),
  isApiError: () => false,
}));

const mockedRequest = vi.mocked(request);
const observers: { element: Element; callback: ResizeObserverCallback }[] = [];

function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}

function makeStatus(overrides: Partial<SecretRotationStatus> = {}): SecretRotationStatus {
  return {
    kind: 'mqtt_mtls_cert',
    target_id: 'fixture-broker-east',
    last_rotated: '2026-10-11T12:00:00Z',
    age_days: 1,
    expires_at: '2026-10-14T12:00:00Z',
    days_to_expiry: 2,
    warn_days: 60,
    critical_days: 120,
    severity: 'warn',
    ...overrides,
  };
}

function DetailsHarness() {
  return <SecretRotationDetails controller={useSecretRotationPage()} />;
}

function mount(items?: SecretRotationStatus[]) {
  if (items) mockedRequest.mockResolvedValue({ items });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DetailsHarness />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, client };
}

async function mountMobile(items: SecretRotationStatus[]) {
  const view = mount(items);
  await screen.findByText(items[0].target_id ?? 'MQTT mTLS certificate');
  resize(375);
  expect(view.container.querySelector('[data-mobile-table]')).not.toBeNull();
  expect(view.container.querySelector('table')).toBeNull();
  return view;
}

function detailValue(dialog: HTMLElement, label: string) {
  const term = within(dialog).getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  expect(value?.tagName).toBe('DD');
  return value;
}

beforeEach(() => {
  mockedRequest.mockReset();
  localStorage.clear();
  observers.length = 0;
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T12:00:00Z'));
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SecretRotationDetails mobile preservation', () => {
  it('exposes every desktop field and caption in quick view without confusing same-kind targets', async () => {
    const east = makeStatus();
    const west = makeStatus({
      target_id: 'fixture-broker-west', age_days: 200, warn_days: 90, critical_days: 180,
      days_to_expiry: -2, severity: 'critical',
    });
    const items = [east, west];
    const before = structuredClone(items);
    await mountMobile(items);
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0]);
    let dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('MQTT mTLS certificate · fixture-broker-east');
    expect(detailValue(dialog, 'Kind')).toHaveTextContent('fixture-broker-east');
    expect(detailValue(dialog, 'Last rotated')).toHaveTextContent(formatDateTime(east.last_rotated));
    expect(detailValue(dialog, 'Last rotated')).toHaveTextContent(formatRelative(east.last_rotated));
    expect(detailValue(dialog, 'Age (days)')).toHaveTextContent('1.00');
    expect(detailValue(dialog, 'Expires')).toHaveTextContent(formatDateTime(east.expires_at));
    expect(detailValue(dialog, 'Expires')).toHaveTextContent('2d remaining');
    expect(detailValue(dialog, 'Warn / critical')).toHaveTextContent('60.00d / 120.00d');
    expect(detailValue(dialog, 'Severity')).toHaveTextContent('Rotate soon');
    fireEvent.click(within(dialog).getByText('Close'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[1]);
    dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('MQTT mTLS certificate · fixture-broker-west');
    expect(detailValue(dialog, 'Age (days)')).toHaveTextContent('200.00');
    expect(detailValue(dialog, 'Expires')).toHaveTextContent('-2d remaining');
    expect(detailValue(dialog, 'Warn / critical')).toHaveTextContent('90.00d / 180.00d');
    // The critical severity label is 'Critical' (shared common.critical copy).
    expect(detailValue(dialog, 'Severity')).toHaveTextContent('Critical');
    expect(items).toEqual(before);
  });

  it.each([
    // The existing renderer accepts null numeric values returned by an unknown source.
    { case: 'unknown', value: null as unknown as number, age: '—', thresholds: '— / —' },
    { case: 'zero', value: 0, age: '0.00', thresholds: '0.00d / 0.00d' },
  ])('preserves $case age, thresholds and absent timestamps rather than fabricating values', async ({ value, age, thresholds }) => {
    await mountMobile([makeStatus({
      last_rotated: '', age_days: value, warn_days: value, critical_days: value,
      expires_at: null, days_to_expiry: null, severity: 'unknown',
    })]);
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    expect(detailValue(dialog, 'Age (days)')).toHaveTextContent(age);
    expect(detailValue(dialog, 'Warn / critical')?.textContent).toBe(thresholds);
    expect(detailValue(dialog, 'Last rotated')).toHaveTextContent('—');
    expect(detailValue(dialog, 'Expires')?.textContent).toBe('—');
    expect(detailValue(dialog, 'Severity')?.textContent).toBe('—');
    expect(within(dialog).queryByText(/remaining/)).toBeNull();
  });

  it('retains loaded-row search, no-match recovery and desktop columns across the mobile boundary', async () => {
    const view = await mountMobile([
      makeStatus(), makeStatus({ target_id: 'fixture-broker-west', severity: 'critical' }),
    ]);
    const search = screen.getByRole('searchbox', { name: 'Search loaded rows' });
    fireEvent.change(search, { target: { value: 'fixture-broker-west' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(1));
    expect(screen.queryByText(/fixture-broker-east/)).toBeNull();
    fireEvent.change(search, { target: { value: 'fixture-no-match' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Quick view' })).toBeNull());
    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(2));
    resize(640);
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
    const table = screen.getByRole('table', { name: 'admin:secret-rotation' });
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Kind', 'Last rotated', 'Age (days)', 'Expires', 'Warn / critical', 'Severity',
    ]);
    expect(within(table).getByText('fixture-broker-east')).toBeInTheDocument();
    expect(within(table).getByText('fixture-broker-west')).toBeInTheDocument();
  });

  it('keeps complete mobile details reachable after a failed background refresh', async () => {
    const { client } = await mountMobile([makeStatus()]);
    mockedRequest.mockRejectedValue(new Error('fixture refresh unavailable'));
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(client.getQueryCache().getAll()[0].state.error).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    expect(detailValue(dialog, 'Warn / critical')).toHaveTextContent('60.00d / 120.00d');
    expect(detailValue(dialog, 'Expires')).toHaveTextContent('2d remaining');
    expect(detailValue(dialog, 'Kind')).toHaveTextContent('fixture-broker-east');
  });

  it('retains the section shell and source-shaped loading state before rows arrive', () => {
    mockedRequest.mockReturnValue(new Promise<SecretRotationResponse>(() => {}));
    const { container } = mount();
    expect(screen.getByRole('region', { name: 'Rotation status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rotation status' })).toBeInTheDocument();
    expect(container.querySelector('[class~="bg-[var(--skeleton-bg)]"]')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick view' })).toBeNull();
  });

  it('retains the read-only empty explanation without offering a credential mutation', async () => {
    mount([]);
    expect(await screen.findByText('No tracked secrets')).toBeInTheDocument();
    expect(screen.getByText(/The tracker captures observations on every credential rotation/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Rotation status' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /rotate|create/i })).toBeNull();
  });

  it('retains the fatal-error retry action when there is no loaded data', async () => {
    mockedRequest.mockRejectedValue(new Error('fixture unavailable'));
    mount();
    const retry = await screen.findByRole('button', { name: 'Retry', exact: true });
    expect(screen.getByRole('region', { name: 'Rotation status' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quick view' })).toBeNull();
    mockedRequest.mockResolvedValue({ items: [makeStatus()] });
    fireEvent.click(retry);
    await screen.findByText('fixture-broker-east');
    resize(375);
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(detailValue(screen.getByRole('dialog'), 'Warn / critical')).toHaveTextContent('60.00d / 120.00d');
  });
});
