import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { VehiclePaintPicker } from '../VehiclePaintPicker';

describe('VehiclePaintPicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders 5 swatches as a radio group', () => {
    render(<VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" />);
    const group = screen.getByRole('radiogroup', { name: /vehicle paint color/i });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(5);
  });

  it('marks the inferred paint as checked initially', () => {
    render(<VehiclePaintPicker vehicleId={1} exteriorColor="MidnightSilverMetallic" />);
    const checked = screen.getByRole('radio', { checked: true });
    expect(checked.getAttribute('aria-label')).toMatch(/midnight silver/i);
  });

  it('clicking a swatch persists override and re-checks', () => {
    render(<VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" />);

    const redSwatch = screen.getByRole('radio', { name: /red multi-coat/i });
    fireEvent.click(redSwatch);

    expect(screen.getByRole('radio', { checked: true }).getAttribute('aria-label')).toMatch(
      /red multi-coat/i,
    );
    expect(localStorage.getItem('teslasync:vehicle:1:paint')).toBe('red-multicoat');
  });

  it('shows reset button only when overridden', () => {
    render(<VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" />);

    expect(screen.queryByRole('button', { name: /reset to auto/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /deep blue/i }));
    expect(screen.getByRole('button', { name: /reset to auto/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reset to auto/i }));
    expect(screen.queryByRole('button', { name: /reset to auto/i })).not.toBeInTheDocument();
    expect(localStorage.getItem('teslasync:vehicle:1:paint')).toBeNull();
  });

  it('every swatch has an accessible label', () => {
    render(<VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" />);
    const radios = screen.getAllByRole('radio');
    for (const r of radios) {
      expect(r.getAttribute('aria-label')).toBeTruthy();
    }
  });
});

