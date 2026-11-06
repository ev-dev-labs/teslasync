import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArrivalReliabilityRouteTick } from './ArrivalReliabilityRouteTick';

describe('arrival route labels', () => {
  it('separates origin and destination while preserving the complete route', () => {
    const label = 'Home \u2192 Office';
    const { container } = render(
      <svg><ArrivalReliabilityRouteTick x={160} y={24} payload={{ value: label }} /></svg>,
    );
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    expect([...container.querySelectorAll('text')].map(node => node.textContent))
      .toEqual(['Home', '\u2192 Office']);
  });

  it('retains a label without a directional separator as one line', () => {
    const { container } = render(
      <svg><ArrivalReliabilityRouteTick payload={{ value: 'Unspecified route' }} /></svg>,
    );
    expect(screen.getByRole('img', { name: 'Unspecified route' })).toBeInTheDocument();
    expect(container.querySelectorAll('text')).toHaveLength(1);
    expect(container.querySelector('text')).toHaveTextContent('Unspecified route');
  });
});
