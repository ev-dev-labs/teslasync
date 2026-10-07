import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import { AdminSourceContent } from './AdminSourceContent';

describe('AdminSourceContent', () => {
  it('keeps retained-empty content and a working source retry', () => {
    const retry = vi.fn();
    const source = deriveDataState({ data: [], error: new Error('refresh failed'), refetch: retry });
    render(<MemoryRouter><AdminSourceContent source={source} label="Inventory" emptyMessage="No rows"><div>No inventory members</div></AdminSourceContent></MemoryRouter>);
    expect(screen.getByText('No inventory members')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('uses specialist initial geometry without rendering fake measurements', () => {
    const source = deriveDataState<number[]>({ isLoading: true });
    render(<MemoryRouter><AdminSourceContent source={source} label="Inventory" emptyMessage="No rows" loadingContent={<div>Loading geometry</div>}><div>Invented count</div></AdminSourceContent></MemoryRouter>);
    expect(screen.getByText('Loading geometry')).toBeInTheDocument();
    expect(screen.queryByText('Invented count')).not.toBeInTheDocument();
  });

  it('does not add a second retained recovery action when the card already owns Refresh', () => {
    const source = deriveDataState({ data: [17], error: new Error('refresh failed'), refetch: vi.fn() });
    render(<MemoryRouter><AdminSourceContent source={source} retryOnRetained={false} label="Inventory" emptyMessage="No rows"><div>Member 17</div></AdminSourceContent></MemoryRouter>);
    expect(screen.getByText('Member 17')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
