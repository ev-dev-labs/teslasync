import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { VehiclePaintPicker } from '../VehiclePaintPicker';
import { PAINT_PALETTE_LIST } from '@/lib/vehicleColors';

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

  it('keeps one tab stop and selects and focuses with arrows, Home and End', () => {
    render(<VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    radios[0].focus();
    for (const [key, expectedIndex] of [
      ['ArrowLeft', 4], ['ArrowRight', 0], ['ArrowDown', 1],
      ['ArrowUp', 0], ['End', 4], ['Home', 0],
    ] as const) {
      fireEvent.keyDown(document.activeElement ?? radios[0], { key });
      expect(radios[expectedIndex]).toHaveFocus();
      expect(radios[expectedIndex]).toHaveAttribute('aria-checked', 'true');
      expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual([radios[expectedIndex]]);
    }
    expect(localStorage.getItem('teslasync:vehicle:1:paint')).toBeNull();
  });

  it('uses visual horizontal navigation in RTL without reversing vertical navigation', () => {
    render(<div dir="rtl"><VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" /></div>);
    const radios = screen.getAllByRole('radio');
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(radios[4]).toHaveFocus();
    fireEvent.keyDown(radios[4], { key: 'ArrowDown' });
    expect(radios[0]).toHaveFocus();
  });

  it('retains physical swatches, contrasting checks and restrained 44px controls', () => {
    render(<VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" />);
    const radios = screen.getAllByRole('radio');
    radios.forEach((radio, index) => {
      expect(radio).toHaveClass('h-11', 'w-11');
      expect(radio.querySelector('span[aria-hidden="true"]')).toHaveStyle({
        background: PAINT_PALETTE_LIST[index].swatch,
      });
      expect(radio.className).not.toMatch(/shadow(?!-none(?:\s|$))|scale-|cyan-/);
    });
    expect(radios[0].querySelector('path')).toHaveAttribute('stroke', '#000000');
    fireEvent.click(radios[3]);
    expect(radios[3].querySelector('path')).toHaveAttribute('stroke', '#ffffff');
  });

  it('keeps vehicle preferences isolated and follows updated inference after clearing', () => {
    const { rerender } = render(
      <VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" className="picker-owner" />,
    );
    expect(screen.getByRole('radiogroup')).toHaveClass('picker-owner');
    fireEvent.click(screen.getByRole('radio', { name: /deep blue/i }));
    rerender(<VehiclePaintPicker vehicleId={2} exteriorColor="SolidBlack" />);
    expect(screen.getByRole('radio', { checked: true })).toHaveAccessibleName('Solid Black');
    expect(localStorage.getItem('teslasync:vehicle:1:paint')).toBe('deep-blue');
    rerender(<VehiclePaintPicker vehicleId={1} exteriorColor="PearlWhite" />);
    expect(screen.getByRole('radio', { checked: true })).toHaveAccessibleName('Deep Blue Metallic');
    fireEvent.click(screen.getByRole('radio', { name: /pearl white/i }));
    expect(localStorage.getItem('teslasync:vehicle:1:paint')).toBeNull();
    rerender(<VehiclePaintPicker vehicleId={1} exteriorColor="SolidBlack" />);
    expect(screen.getByRole('radio', { checked: true })).toHaveAccessibleName('Solid Black');
    expect(screen.getByText(/solid black · auto-detected/i)).toHaveAttribute('aria-live', 'polite');
  });
});
