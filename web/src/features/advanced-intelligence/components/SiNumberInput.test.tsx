import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiNumberInput } from './SiNumberInput';

afterEach(cleanup);

const baseProps = {
  label: 'Annual distance',
  value: 15000,
  siUnit: 'm',
  displayHint: '15 km display',
  onChange: vi.fn(),
};

describe('SiNumberInput', () => {
  it('provides mobile minimums and preserves the default desktop Input sizing', () => {
    render(<SiNumberInput {...baseProps} />);
    expect(screen.getByRole('spinbutton', { name: baseProps.label })).toHaveClass(
      'min-h-11', 'min-w-11', 'md:min-h-10', 'md:min-w-0', 'w-full', 'px-3', 'py-2',
    );
  });

  it.each([
    ['sm', 'md:min-h-9', 'py-1.5'],
    ['md', 'md:min-h-10', 'py-2'],
    ['lg', 'min-h-12', 'py-2.5'],
    ['auto', 'md:min-h-d-row', 'py-d-pad-y'],
  ] as const)('forwards %s sizing without losing desktop behavior', (size, minimum, padding) => {
    render(<SiNumberInput {...baseProps} size={size} className="max-w-full" />);
    expect(screen.getByRole('spinbutton')).toHaveClass(minimum, padding, 'max-w-full');
  });

  it('forwards refs, native constraints, events and accessible descriptions', () => {
    const ref = createRef<HTMLInputElement>();
    const onBlur = vi.fn();
    render(<SiNumberInput {...baseProps} ref={ref} id="annual-distance"
      name="annual_distance_m" min={0} max={20000} step={0.5} required
      aria-describedby="external-description" onBlur={onBlur} />);
    const input = screen.getByRole('spinbutton', { name: /Annual distance/ });
    expect(ref.current).toBe(input);
    expect(input).toHaveValue(15000);
    expect(input).toHaveAttribute('id', 'annual-distance');
    expect(input).toHaveAttribute('name', 'annual_distance_m');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '20000');
    expect(input).toHaveAttribute('step', '0.5');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-describedby', 'external-description annual-distance-hint');
    expect(screen.getByText(baseProps.displayHint)).toHaveAttribute('id', 'annual-distance-hint');
    expect(screen.getByText('m')).toBeInTheDocument();
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it('retains raw SI changes, zero, and null clearing', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SiNumberInput {...baseProps} onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '1234.5' } });
    expect(onChange).toHaveBeenLastCalledWith(1234.5);
    fireEvent.change(input, { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    rerender(<SiNumberInput {...baseProps} value={null} onChange={onChange} />);
    expect(input).toHaveValue(null);
    rerender(<SiNumberInput {...baseProps} value={0} onChange={onChange} />);
    expect(input).toHaveValue(0);
  });

  it('forwards disabled and read-only states', () => {
    render(<SiNumberInput {...baseProps} disabled readOnly />);
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toHaveAttribute('readonly');
  });
});
