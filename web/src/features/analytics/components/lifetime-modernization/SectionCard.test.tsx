import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Button } from '@/components/ui';
import { SectionCard } from './SectionCard';

vi.mock('@/components/layout', async () => ({
  ...(await vi.importActual<typeof import('@/components/layout')>('@/components/layout')),
  LayoutCard: ({ title, actions, children }: { title: string; actions: ReactNode; children: ReactNode }) =>
    <section aria-label={title}>{actions}{children}</section>,
}));
vi.mock('@/components/feedback', () => ({
  Skeleton: () => <div role="status">loading source</div>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  QueryError: ({ onRetry }: { onRetry: () => void }) =>
    <div role="alert">refresh failed<Button onClick={onRetry}>Retry</Button></div>,
}));
afterEach(cleanup);

describe('lifetime persistent panel shell', () => {
  it('preserves retained specialist content with a retry beside the failure', () => {
    const retry = vi.fn();
    render(<MemoryRouter><SectionCard title="Records" icon={<span>icon</span>} state="retained"
      error={new Error('offline')} onRetry={retry} emptyMessage="No records">
      <span>original record date and measurement</span>
    </SectionCard></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Records' })).toBeInTheDocument();
    expect(screen.getByText('original record date and measurement')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it.each(['loading', 'empty', 'error'] as const)('keeps the %s shell without leaking ready data', state => {
    render(<MemoryRouter><SectionCard title="Records" icon={null} state={state}
      error={new Error('failed')} onRetry={vi.fn()} emptyMessage="No records">
      <span>ready measurement</span>
    </SectionCard></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Records' })).toBeInTheDocument();
    expect(screen.queryByText('ready measurement')).not.toBeInTheDocument();
  });
});
