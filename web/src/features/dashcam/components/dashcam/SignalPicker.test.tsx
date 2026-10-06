import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SignalPicker } from './SignalPicker';

const { useSignals, refetch } = vi.hoisted(() => ({
  useSignals: vi.fn(),
  refetch: vi.fn(async () => {}),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({ useSignals }));

beforeEach(() => {
  refetch.mockClear();
  useSignals.mockReturnValue({
    data: ['Speed', 'Heading'], isLoading: false, isError: false, error: null, refetch,
  });
});
afterEach(cleanup);

describe('reconstruction signal catalog source independence', () => {
  it('keeps selected signal controls reachable during an initial catalog failure', () => {
    useSignals.mockReturnValue({
      data: undefined, isLoading: false, isError: true, error: new Error('catalog failed'), refetch,
    });
    const onChange = vi.fn();
    render(<MemoryRouter><SignalPicker vehicleId={1} selected={['Speed']} onChange={onChange} /></MemoryRouter>);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Speed' }));
    expect(onChange).toHaveBeenCalledWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps dynamic options and selected identifiers after a background catalog failure', async () => {
    useSignals.mockReturnValue({
      data: ['Speed', 'Heading'], isLoading: false, isError: true, error: new Error('refresh failed'), refetch,
    });
    const onChange = vi.fn();
    render(<MemoryRouter><SignalPicker vehicleId={1} selected={['Speed']} onChange={onChange} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Remove Speed' })).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Heading' }));
    expect(onChange).toHaveBeenCalledWith(['Speed', 'Heading']);
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
  });
});
