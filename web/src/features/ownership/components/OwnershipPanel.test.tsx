import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import { Button } from '@/components/ui';
import { OwnershipPanel } from './OwnershipPanel';

function panel(source: DataStateSource<unknown>, extra: { empty?: boolean; editing?: boolean; sourceEnabled?: boolean; children?: ReactNode; preserveSummary?: boolean } = {}) {
  return (
    <MemoryRouter>
      <OwnershipPanel title="Statement evidence" source={source} emptyMessage="Select a statement." {...extra}>
        {extra.children ?? <p>Retained statement lines</p>}
      </OwnershipPanel>
    </MemoryRouter>
  );
}

describe('OwnershipPanel source preservation', () => {
  it('retains opted-in summaries during loading without changing ordinary source-body behavior', () => {
    render(panel({ isLoading: true }, { preserveSummary: true, children: <p>Unknown summary quantities</p> }));
    expect(screen.getByRole('status', { name: 'Loading Statement evidence' })).toBeInTheDocument();
    expect(screen.getByText('Unknown summary quantities')).toBeInTheDocument();
  });

  describe('OwnershipPanel unresolved and paused sources', () => {
    it('does not turn pending without a payload into an authoritative empty response', () => {
      render(panel({ isPending: true, isLoading: false, fetchStatus: 'idle' }, { empty: true }));
      expect(screen.getByRole('status', { name: 'Loading Statement evidence' })).toBeInTheDocument();
      expect(screen.queryByText('Select a statement.')).not.toBeInTheDocument();
      expect(screen.queryByText('Retained statement lines')).not.toBeInTheDocument();
    });

    it('explains an initial offline pause without claiming cached or empty data and recovers', () => {
      const refetch = vi.fn();
      const { rerender } = render(panel({ isPending: true, fetchStatus: 'paused', refetch }, { empty: true }));
      expect(screen.getByText(/initial query is paused/)).toBeInTheDocument();
      expect(screen.queryByText('Select a statement.')).not.toBeInTheDocument();
      expect(screen.queryByText('Retained statement lines')).not.toBeInTheDocument();
      expect(screen.queryByText(/Previously loaded data remains visible/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(refetch).toHaveBeenCalledOnce();
      rerender(panel({ data: { statement: 7 } }));
      expect(screen.getByText('Retained statement lines')).toBeInTheDocument();
      expect(screen.queryByText(/initial query is paused/)).not.toBeInTheDocument();
    });

    it('distinguishes a paused refresh from refresh failure while preserving cached evidence', () => {
      const refetch = vi.fn();
      const { rerender } = render(panel({ data: { statement: 7 }, fetchStatus: 'paused', refetch }));
      expect(screen.getByText('Cached evidence remains visible while its refresh is paused.')).toBeInTheDocument();
      expect(screen.getByText('Retained statement lines')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(refetch).toHaveBeenCalledOnce();
      rerender(panel({ data: { statement: 7 }, error: new Error('private upstream details'), refetch }));
      expect(screen.getByText('The latest values are temporarily unavailable. Previously loaded data remains visible.')).toBeInTheDocument();
      expect(screen.queryByText('private upstream details')).not.toBeInTheDocument();
      expect(screen.queryByText(/refresh is paused/)).not.toBeInTheDocument();
    });

    it('preserves authoritative empty evidence and summary during an offline refresh', () => {
      render(panel({ data: [], fetchStatus: 'paused' }, {
        empty: true, preserveSummary: true, children: <p>Known empty summary</p>,
      }));
      expect(screen.getByText('Select a statement.')).toBeInTheDocument();
      expect(screen.getByText('Known empty summary')).toBeInTheDocument();
      expect(screen.getByText(/refresh is paused/)).toBeInTheDocument();
    });

    it('keeps opted-in unknown summaries during an initial pause without an empty claim', () => {
      render(panel({ fetchStatus: 'paused' }, { empty: true, preserveSummary: true }));
      expect(screen.getByText('Retained statement lines')).toBeInTheDocument();
      expect(screen.getByText(/initial query is paused/)).toBeInTheDocument();
      expect(screen.queryByText('Select a statement.')).not.toBeInTheDocument();
    });

    it('keeps an independent unsaved editor mounted through pending, offline and first-read failure', () => {
      const save = vi.fn();
      const children = <Button onClick={save}>Save entered statement</Button>;
      const { rerender } = render(panel({ isPending: true }, { editing: true, empty: true, children }));
      const button = screen.getByRole('button', { name: 'Save entered statement' });
      rerender(panel({ fetchStatus: 'paused' }, { editing: true, empty: true, children }));
      expect(screen.getByRole('button', { name: 'Save entered statement' })).toBe(button);
      rerender(panel({ error: new Error('register failed') }, { editing: true, empty: true, children }));
      expect(screen.getByRole('button', { name: 'Save entered statement' })).toBe(button);
      fireEvent.click(button);
      expect(save).toHaveBeenCalledOnce();
      expect(screen.queryByText('Select a statement.')).not.toBeInTheDocument();
    });

    it('preserves descriptions, caller classes and native card actions during source loading', () => {
      const action = vi.fn();
      render(
        <OwnershipPanel title="Statement evidence" description="Statement context"
          className="space-y-3" actions={<Button type="button" onClick={action}>Add statement</Button>}
          source={{ isPending: true }}>
          <p>Unresolved rows</p>
        </OwnershipPanel>,
      );
      expect(screen.getByText('Statement context', { selector: '[data-card-desc="true"]' })).toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Loading Statement evidence' }).parentElement).toHaveClass('space-y-3');
      fireEvent.click(screen.getByRole('button', { name: 'Add statement' }));
      expect(action).toHaveBeenCalledOnce();
      expect(screen.queryByText('Unresolved rows')).not.toBeInTheDocument();
    });
  });

  it('keeps opted-in unknown summaries beside fatal recovery rather than masking the error', () => {
    const refetch = vi.fn();
    render(panel({ error: new Error('source failed'), refetch }, {
      preserveSummary: true, children: <p>Unknown summary quantities</p>,
    }));
    expect(screen.getByText('Unknown summary quantities')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('retains the empty-source explanation and an opted-in summary through a refresh failure', () => {
    render(panel({ data: [], error: new Error('refresh failed') }, {
      empty: true, preserveSummary: true, children: <p>Known empty summary</p>,
    }));
    expect(screen.getByText('Select a statement.')).toBeInTheDocument();
    expect(screen.getByText('Known empty summary')).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
  });

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
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
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
