import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChargeBatteryPack, ChargeMeter } from './ChargeInstruments';

describe('measured charge instruments', () => {
  it('keeps the fixed reading and target while streaming only inside the actual charge fill', () => {
    const { container } = render(<ChargeMeter value={72} label="Battery" marker={80} markerLabel="Limit 80%" active />);
    const meter = screen.getByRole('meter', { name: 'Battery' });
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '72%, Limit 80%');
    expect(screen.getByTestId('gauge-marker')).toHaveStyle({ left: '80%' });
    expect(screen.getByTestId('gauge-marker')).toHaveAttribute('title', 'Limit 80%');
    const movingLayer = container.querySelector('.widget-energy-stream');
    expect(movingLayer).toHaveClass('widget-state-motion');
    const clip = container.querySelector('clipPath rect');
    expect(clip).toHaveAttribute('width', '288');
    expect(movingLayer?.parentElement).toHaveAttribute('clip-path');
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it.each([
    { level: 100, active: true },
    { level: 0, active: true },
    { level: null, active: true },
    { level: 125, active: true },
    { level: 72, active: false },
  ])('never animates a complete, empty, unknown, out-of-scale or inactive pack: %j', props => {
    const { container } = render(<ChargeBatteryPack {...props} />);
    expect(container.querySelector('.widget-cell-stream')).toBeNull();
    expect(container.querySelector('.widget-activity-active')).toBeNull();
  });

  it('draws the partial measured cell rather than rounding up and animating empty cells', () => {
    const { container } = render(<ChargeBatteryPack level={72} active />);
    const cells = container.querySelectorAll('clipPath rect');
    expect(cells).toHaveLength(10);
    expect(Number(cells[7].getAttribute('width'))).toBeCloseTo(1.2);
    expect(cells[8]).toHaveAttribute('width', '0');
    expect(cells[9]).toHaveAttribute('width', '0');
    const motion = container.querySelector('.widget-cell-stream');
    expect(motion).toHaveClass('widget-state-motion');
    expect(motion?.parentElement).toHaveAttribute('clip-path');
  });

  it('does not advertise unknown or out-of-scale readings as a full or zero meter', () => {
    const { rerender } = render(<ChargeMeter value={null} label="Battery" marker={80} active />);
    expect(screen.queryByRole('meter')).toBeNull();
    rerender(<ChargeMeter value={125} label="Battery" marker={80} active />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByTestId('gauge-marker')).toBeNull();
    rerender(<ChargeMeter value={125} label="Battery" marker={80} preserveOutOfScaleMarker />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByTestId('gauge-marker')).toHaveStyle({ left: '80%' });
  });

  it('gives each rendered instrument unique gradient and charge-clip identifiers', () => {
    const { container } = render(<>
      <ChargeMeter value={72} label="Battery" active />
      <ChargeMeter value={64} label="Battery" active />
      <ChargeBatteryPack level={72} active />
      <ChargeBatteryPack level={64} active />
    </>);
    const ids = [...container.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
