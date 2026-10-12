import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { request } from '@/api/client';
import { ApiError } from '@/lib/resilience';
import type { SecretRotationResponse, SecretRotationStatus } from '@/types/admin-operator-confidence';
import { useSecretRotationPage } from '../../hooks/useSecretRotationPage';
import { SecretRotationOperationalBrief } from './SecretRotationOperationalBrief';

vi.mock('@/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn() };
});

const mockedRequest = vi.mocked(request);
const clients: QueryClient[] = [];
const queryKey = ['admin', 'observability', 'secret-rotation'];
const fetchedAt = Date.UTC(2026, 9, 1, 12);
const provenance = 'Returned credentials and server-computed per-kind thresholds; not a selected date-range aggregate.';
const items: SecretRotationStatus[] = [
  {
    kind: 'session_jwk', target_id: 'fixture-key', last_rotated: '2026-10-01T00:00:00Z',
    age_days: 0, days_to_expiry: 0, warn_days: 30, critical_days: 60, severity: 'ok',
  },
  {
    kind: 'session_jwk', target_id: 'fixture-overdue', last_rotated: '2026-09-01T00:00:00Z',
    age_days: 30, days_to_expiry: -2, warn_days: 10, critical_days: 20, severity: 'critical',
  },
  {
    kind: 'session_jwk', age_days: Number.NaN, days_to_expiry: null,
    last_rotated: '', warn_days: 30, critical_days: 60, severity: 'unknown',
  },
];

function BriefHarness() {
  return <SecretRotationOperationalBrief controller={useSecretRotationPage()} />;
}

function renderBrief(data?: SecretRotationResponse) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  clients.push(client);
  if (data) client.setQueryData(queryKey, data, { updatedAt: fetchedAt });
  render(<MemoryRouter><QueryClientProvider client={client}>
    <BriefHarness />
  </QueryClientProvider></MemoryRouter>);
  return client;
}

function summary() {
  return screen.getByTestId('secret-rotation-summary');
}

function metricValues() {
  return [...summary().querySelectorAll('[data-operational-value]')].map(node => node.textContent);
}

function expectMissing() {
  expect(summary().querySelectorAll('[data-operational-metric]')).toHaveLength(6);
  expect(summary().querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
  expect(summary().querySelectorAll('[data-value-state="value"]')).toHaveLength(0);
}

beforeEach(() => mockedRequest.mockReset());
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe('SecretRotationOperationalBrief trust and recovery', () => {
  it('keeps loading unknown and suppresses summary and drawer readings until the source resolves', async () => {
    mockedRequest.mockReturnValue(new Promise(() => {}));
    renderBrief();
    expect(summary()).toHaveAttribute('aria-busy', 'true');
    expectMissing();
    expect(metricValues()).toEqual([]);
    expect(summary()).toHaveTextContent('Loading source');
    expect(summary()).toHaveTextContent('Fetch time not supplied');
    expect(screen.queryByText(/tracked credentials have unknown severity/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(summary()).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(provenance)).toBeInTheDocument();
    expect(drawer.querySelectorAll('[aria-busy="true"]')).toHaveLength(6);
  });

  it('keeps all six metric identities and metadata with provenance in the canonical review drawer', async () => {
    mockedRequest.mockResolvedValue({ data: { items } });
    const client = renderBrief({ items });
    await waitFor(() => expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle'));
    expect(summary()).toHaveTextContent('Snapshot loaded');
    expect(summary()).toHaveTextContent('Rotation tracker snapshot');
    expect(summary()).toHaveTextContent('Credential observability');
    expect(summary()).toHaveTextContent('Rotation and expiry outlook');
    expect(metricValues()).toEqual(['3', '1', '0', '1', '30.00 d', '-2.00 d']);
    expect([...summary().querySelectorAll('[data-operational-metric]')]
      .map(node => node.getAttribute('data-operational-metric')))
      .toEqual(['tracked', 'healthy', 'soon', 'overdue', 'oldest', 'expiry']);
    expect(summary()).toHaveTextContent('33% of tracked');
    expect(screen.getByText('1 tracked credentials have unknown severity')).toBeInTheDocument();
    expect(screen.queryByText(provenance)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(summary()).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByText(provenance)).toHaveLength(1);
    expect(within(drawer).getByText(/Negative values mean already expired/)).toBeInTheDocument();
    expect(within(drawer).getAllByText('Session JWK · fixture-overdue')).toHaveLength(2);
  });

  it('keeps measured zero counts separate from unknown age and expiry after an empty successful response', async () => {
    mockedRequest.mockResolvedValue({ data: { items: [] } });
    renderBrief();
    await waitFor(() => expect(summary()).toHaveTextContent('Snapshot loaded'));
    expect(metricValues()).toEqual(['0', '0', '0', '0', '—', '—']);
    expect(summary().querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(summary().querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    expect(summary()).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('0 tracked credentials have unknown severity')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders one canonical fatal recovery surface without raw error echo and retries the original source', async () => {
    mockedRequest.mockRejectedValue(new Error('fixture initial query failure'));
    const client = renderBrief();
    await waitFor(() => expect(client.getQueryState(queryKey)?.status).toBe('error'));
    expectMissing();
    expect(summary()).toHaveTextContent('Source unavailable');
    const status = within(summary()).getByText('Source unavailable');
    expect(status).toHaveClass('text-[var(--semantic-warning)]');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach server");
    expect(screen.queryByText('fixture initial query failure')).not.toBeInTheDocument();
    expect(summary().closest('[data-retained]')).toHaveAttribute('data-retained', 'false');
    mockedRequest.mockResolvedValue({ data: { items: [] } });
    const calls = mockedRequest.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockedRequest.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(summary()).toHaveTextContent('Snapshot loaded'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(metricValues().slice(0, 4)).toEqual(['0', '0', '0', '0']);
  });

  it('keeps the unsupported tracker distinct from fatal recovery and never fabricates counts', async () => {
    mockedRequest.mockRejectedValue(new ApiError('fixture subsystem unavailable', 503, 'SUBSYSTEM_NOT_CONFIGURED'));
    const client = renderBrief();
    await waitFor(() => expect(client.getQueryState(queryKey)?.status).toBe('error'));
    expectMissing();
    expect(summary()).toHaveTextContent('Tracker not configured');
    expect(within(summary()).getByText('Tracker not configured')).toHaveClass('text-[var(--semantic-warning)]');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(summary()).toHaveTextContent('Fetch time not supplied');
  });

  it('retains measurements and the real fetch timestamp on refresh failure without adding raw error chrome', async () => {
    mockedRequest.mockRejectedValue(new Error('fixture refresh query failure'));
    const client = renderBrief({ items });
    await waitFor(() => expect(client.getQueryState(queryKey)?.status).toBe('error'));
    expect(metricValues()).toEqual(['3', '1', '0', '1', '30.00 d', '-2.00 d']);
    expect(summary().closest('[data-retained]')).toHaveAttribute('data-retained', 'true');
    expect(summary()).not.toHaveAttribute('aria-busy');
    expect(within(summary()).getByText('Retained source data')).toHaveClass('text-[var(--semantic-warning)]');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
    expect(summary()).toHaveTextContent(`Fetched ${new Date(fetchedAt).toLocaleString()}`);
    expect(screen.getByText('1 tracked credentials have unknown severity')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('fixture refresh query failure')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(client.getQueryData(queryKey)).toEqual({ items });
    fireEvent.click(within(summary()).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByText(provenance)).toHaveLength(1);
    expect(within(drawer).getAllByText('Retained source data')).toHaveLength(1);
    expect(within(drawer).getByText(`Fetched ${new Date(fetchedAt).toLocaleString()}`)).toBeInTheDocument();
  });

  it('keeps retained values during an active refresh without inventing a failure or a newer fetch time', async () => {
    mockedRequest.mockReturnValue(new Promise(() => {}));
    const client = renderBrief({ items });
    await act(async () => { await Promise.resolve(); });
    expect(client.getQueryState(queryKey)?.fetchStatus).toBe('fetching');
    expect(summary().closest('[data-retained]')).toHaveAttribute('data-retained', 'true');
    expect(metricValues()).toEqual(['3', '1', '0', '1', '30.00 d', '-2.00 d']);
    expect(summary()).not.toHaveAttribute('aria-busy');
    expect(summary()).toHaveTextContent('Snapshot loaded');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
    expect(summary()).toHaveTextContent(`Fetched ${new Date(fetchedAt).toLocaleString()}`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
