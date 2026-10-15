import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatGrid } from './StatGrid';

describe('Ownership specialist stat presentation', () => {
  it('retains caller order, formatted currency, unknown readings, real zero, hints and rich values', () => {
    const { container } = render(
      <StatGrid columns={3} stats={[
        { key: 'money', label: 'Liability', value: '€12.37', hint: 'Entered billing period' },
        { key: 'missing', label: 'Unknown coverage', value: '—' },
        { key: 'zero', label: 'Real zero', value: 0 },
        { key: 'rich', label: 'Independent comparison', value: <span>+4% vs baseline</span>, tone: 'warning' },
      ]} />,
    );
    expect(screen.getByText('€12.37')).toBeInTheDocument();
    expect(screen.getByText('Entered billing period')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('+4% vs baseline')).toBeInTheDocument();
    expect(container.textContent?.indexOf('Liability')).toBeLessThan(container.textContent?.indexOf('Unknown coverage') ?? 0);
    expect(container.textContent?.indexOf('Unknown coverage')).toBeLessThan(container.textContent?.indexOf('Real zero') ?? 0);
    expect(container.textContent?.indexOf('Real zero')).toBeLessThan(container.textContent?.indexOf('Independent comparison') ?? 0);
  });
});
