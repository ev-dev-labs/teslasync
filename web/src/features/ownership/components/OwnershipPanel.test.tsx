import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import { Button } from '@/components/ui';
import { OwnershipPanel } from './OwnershipPanel';

function panel(source: DataStateSource<unknown>, extra: { empty?: boolean; editing?: boolean; sourceEnabled?: boolean; children?: ReactNode } = {}) {
  return (
    <MemoryRouter>
      <OwnershipPanel title="Statement evidence" source={source} emptyMessage="Select a statement." {...extra}>
        {extra.children ?? <p>Retained statement lines</p>}
      </OwnershipPanel>
    </MemoryRouter>
  );
}

describe('OwnershipPanel source preservation', () => {
  it('keeps the canonical named card while a source initially loads', () => {
    render(panel({ isLoading: true }));
    expect(screen.getByRole('heading', { name: 'Statement evidence' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading Statement evidence' })).toBeInTheDocument();
    expect(screen.queryByText('Retained statement lines')).not.toBeInTheDocument();
  });

  it('isolates fatal recovery to the failed source and retries that source', () => {
    const refetch = vi.fn();
    render(panel({ error: new Error('source failed'), isError: true, refetch }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Statement evidence' })).toBeInTheDocument();
    expect(screen.queryByText('Retained statement lines')).not.toBeInTheDocument();
  });

  it('retains source content and exposes recovery after a background error', () => {
    const refetch = vi.fn();
    render(panel({ data: { statement: 7 }, error: new Error('refresh failed'), refetch }));
    expect(screen.getByText('Retained statement lines')).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps retained content during refresh rather than using the initial skeleton', () => {
    render(panel({ data: { statement: 7 }, isLoading: true, isFetching: true }));
    expect(screen.getByText('Retained statement lines')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading Statement evidence' })).not.toBeInTheDocument();
  });

  it('preserves a retained authoritative empty explanation as well as its refresh warning', () => {
    render(panel({ data: [], error: new Error('refresh failed') }, { empty: true }));
    expect(screen.getByText('Select a statement.')).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    expect(screen.queryByText('Retained statement lines')).not.toBeInTheDocument();
  });

  it('keeps an open editor reachable even when its register has never loaded', () => {
    const save = vi.fn();
    render(panel({ error: new Error('register failed') }, {
      editing: true,
      empty: true,
      children: <Button onClick={save}>Save entered statement</Button>,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save entered statement' }));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('preserves the prerequisite message for a disabled query', () => {
    render(panel({ isLoading: true }, { sourceEnabled: false, empty: true }));
    expect(screen.getByText('Select a statement.')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading Statement evidence' })).not.toBeInTheDocument();
  });

  it('does not let a failed neighbor replace an independently successful register', () => {
    render(
      <MemoryRouter>
        <OwnershipPanel title="Report" source={{ error: new Error('report failed') }}>Report rows</OwnershipPanel>
        <OwnershipPanel title="Register" source={{ data: [7] }}>Invoice seven</OwnershipPanel>
      </MemoryRouter>,
    );
    expect(screen.getByText('Invoice seven')).toBeInTheDocument();
    expect(screen.queryByText('Report rows')).not.toBeInTheDocument();
  });
});
