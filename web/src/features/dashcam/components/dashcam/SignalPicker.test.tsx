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
  it('allows the eighth signal in selection order but prevents a ninth by mouse and keyboard', async () => {
    const signals = Array.from({ length: 9 }, (_, i) => `Signal${i + 1}`);
    useSignals.mockReturnValue({
      data: signals, isLoading: false, isError: false, error: null, refetch,
    });
    const onChange = vi.fn();
    const { rerender } = render(
      <MemoryRouter><SignalPicker vehicleId={1} selected={signals.slice(0, 7)} onChange={onChange} /></MemoryRouter>,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Signal8' }));
    expect(onChange).toHaveBeenCalledWith(signals.slice(0, 8));

    onChange.mockClear();
    rerender(
      <MemoryRouter><SignalPicker vehicleId={1} selected={signals.slice(0, 8)} onChange={onChange} /></MemoryRouter>,
    );
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(/first 8 unique, non-empty signal names in selection order/);
    fireEvent.click(await screen.findByRole('option', { name: 'Signal9' }));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Signal3' }));
    expect(onChange).toHaveBeenCalledWith(signals.slice(0, 8).filter((signal) => signal !== 'Signal3'));

    const remaining = signals.slice(0, 8).filter((signal) => signal !== 'Signal3');
    rerender(
      <MemoryRouter><SignalPicker vehicleId={1} selected={remaining} onChange={onChange} /></MemoryRouter>,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Signal9' }));
    expect(onChange).toHaveBeenLastCalledWith([...remaining, 'Signal9']);
  });

  it('preserves over-limit requested identities, including names absent from the catalog', () => {
    const selected = ['Speed', 'Heading', 'Unknown1', 'Unknown2', 'Unknown3', 'Unknown4', 'Unknown5', 'Unknown6', 'Unknown7'];
    const onChange = vi.fn();
    render(<MemoryRouter><SignalPicker vehicleId={1} selected={selected} onChange={onChange} /></MemoryRouter>);
    for (const signal of selected) {
      expect(screen.getByRole('button', { name: `Remove ${signal}` })).toBeInTheDocument();
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(/existing selections are kept/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Speed' }));
    expect(onChange).toHaveBeenCalledWith(selected.slice(1));
  });

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
