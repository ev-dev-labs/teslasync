import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GridMetricIndicator } from './GridMetricIndicator';

describe('GridMetricIndicator', () => {
  it.each([[0.7, 15.4], [-1, 0], [2, 22]])('clamps the explicit battery fraction %s', (fraction, width) => {
    const { container } = render(
      <GridMetricIndicator kind="battery" band="good" title="70% of battery" fraction={fraction}>70%</GridMetricIndicator>,
    );
    expect(Number(container.querySelector('[data-fill]')?.getAttribute('width'))).toBeCloseTo(width);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-range]')).toHaveAttribute('title', '70% of battery');
    expect(container.querySelector('span')).toHaveTextContent('70%');
  });

  it('uses caller-owned grade segments independently of fraction', () => {
    const { container } = render(
      <GridMetricIndicator kind="efficiency" band="info" title="Grade B" fraction={0.99} segments={3}>170</GridMetricIndicator>,
    );
    expect(container.querySelectorAll('[data-fill]')).toHaveLength(3);
  });
});
