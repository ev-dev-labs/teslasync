import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TripReplayReadout } from './TripReplayReadout';

describe('TripReplayReadout', () => {
  it('keeps long prepared labels, values, units and decorative icons in an unframed readout', () => {
    const label = 'A long localized remaining-range label';
    const { container } = render(
      <TripReplayReadout
        label={label}
        value="123.45"
        unit="km"
        icon={<svg data-testid="readout-icon" />}
      />,
    );
    expect(screen.getByText(label)).toHaveClass('break-words');
    expect(screen.getByText('123.45')).toHaveTextContent('123.45km');
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.getByTestId('readout-icon').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('[data-print-card]')).toBeNull();
  });
});
