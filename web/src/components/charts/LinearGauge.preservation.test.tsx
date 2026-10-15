import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';
import { LinearGauge } from './LinearGauge';

describe('LinearGauge reading and scale preservation', () => {
  it('prints a known reading without inventing a zero-valued meter for an invalid scale', () => {
    const { container } = render(<LinearGauge preserveReadingAndScale value={40} min={20} max={0}
      marker={30} label="Invalid prepared scale" unit="points" decimals={0} />);
    const reading = screen.getByRole('group', { name: 'Invalid prepared scale' });
    expect(screen.getByText('40', { exact: true })).toBeInTheDocument();
    expect(reading).not.toHaveAttribute('aria-valuenow');
    expect(reading).not.toHaveAttribute('aria-valuemin');
    expect(reading).not.toHaveAttribute('aria-valuemax');
    expect(screen.queryByTestId('gauge-marker')).toBeNull();
    expect(container.querySelector('[style*="background-color"]')).toBeNull();
  });

  it('preserves a fully negative interval instead of replacing its maximum with zero', () => {
    render(<LinearGauge preserveReadingAndScale value={-20} min={-50} max={-10}
      label="Negative interval" unit="points" decimals={0} />);
    const meter = screen.getByRole('meter', { name: 'Negative interval' });
    expect(meter).toHaveAttribute('aria-valuemin', '-50');
    expect(meter).toHaveAttribute('aria-valuemax', '-10');
    expect(meter).toHaveAttribute('aria-valuenow', '-20');
    expect(screen.getByText('-20', { exact: true })).toBeInTheDocument();
  });

  it('does not rewrite an out-of-range reading or publish an invalid ARIA meter', () => {
    render(<LinearGauge preserveReadingAndScale value={130} max={100}
      label="Out-of-range reading" unit="points" decimals={0} />);
    expect(screen.getByText('130', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Out-of-range reading' })).not.toHaveAttribute('aria-valuenow');
  });

  it('retains existing clamped defaults outside preservation mode', () => {
    render(<LinearGauge value={130} max={100} label="Existing gauge" unit="points" decimals={0} />);
    expect(screen.getByText('100', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Existing gauge' })).toHaveAttribute('aria-valuenow', '100');
  });

  it('does not draw a reference tick against a nonfinite caller scale', () => {
    render(<LinearGauge preserveReadingAndScale value={40} min={Number.NaN} max={100}
      marker={60} label="Unresolved scale" unit="points" decimals={0} />);
    expect(screen.getByRole('group', { name: 'Unresolved scale' })).not.toHaveAttribute('aria-valuemin');
    expect(screen.queryByTestId('gauge-marker')).toBeNull();
  });
});
