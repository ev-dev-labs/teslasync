import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { QueueJobsResponse } from '@/api/types';

const { mockedRequest } = vi.hoisted(() => ({
  mockedRequest: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
}));
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockedRequest };
});
import { WorkerJobsDrawer } from './WorkerJobsDrawer';

beforeEach(() => { mockedRequest.mockReset(); });

describe('WorkerJobsDrawer', () => {
  it('keeps full job evidence, duration, and source retry after a failed refresh', async () => {
    const data: QueueJobsResponse = { worker: 'notification', jobs: [{
      id: 'job-1', worker: 'notification', status: 'failed',
      title: 'Complete notification job identity without truncation',
      started_at: '2026-10-05T18:00:00Z', finished_at: '2026-10-05T18:00:02Z',
      error: 'Complete backend job error evidence',
    }] };
    mockedRequest.mockResolvedValue(data);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
    render(<QueryClientProvider client={client}><MemoryRouter>
      <WorkerJobsDrawer worker="notification" displayName="Notification worker" open onClose={() => {}} />
    </MemoryRouter></QueryClientProvider>);
    await screen.findByText(data.jobs[0]!.title);
    expect(mockedRequest).toHaveBeenCalledWith('/system/queues/notification/jobs?limit=25', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByTestId('queue-job-status-job-1')).toHaveTextContent('failed');
    expect(screen.getByTestId('queue-job-error-job-1')).toHaveTextContent(data.jobs[0]!.error ?? '');
    expect(screen.getByText(/Took/)).toHaveTextContent('2');
    mockedRequest.mockRejectedValue(new Error('refresh unavailable'));
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(client.getQueryCache().getAll().some((query) => query.state.error !== null)).toBe(true));
    expect(screen.getByText(data.jobs[0]!.title)).toBeInTheDocument();
    expect(screen.getByTestId('queue-job-error-job-1')).toBeInTheDocument();
    expect(screen.queryByTestId('queue-job-drawer-error')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
