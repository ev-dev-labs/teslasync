import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChargeStatusSummary } from './ChargeStatusSummary';

describe('charging status indicator', () => {
  it('keeps the same battery and bolt when freshness changes without changing the reported state', () => {
    const { container, rerender } = render(<ChargeStatusSummary charging active limit={85} />);
    const indicator = screen.getByRole('img', { name: 'Charging', exact: true });
    const bolt = indicator.querySelector('[data-charge-bolt]');
    expect(bolt).not.toBeNull();
    expect(indicator.querySelector('.widget-state-motion')).not.toBeNull();
    const appearance = indicator.className;
    rerender(<ChargeStatusSummary charging active={false} limit={85} />);
    expect(screen.getByRole('img', { name: /Charging.*Last reported/ })).toBe(indicator);
    expect(indicator.className).toBe(appearance);
    expect(indicator.querySelector('[data-charge-bolt]')).toBe(bolt);
    expect(container.querySelector('.widget-state-motion')).toBeNull();
    expect(screen.getByText('Last reported').closest('[role="tooltip"]')).not.toBeNull();
    expect(screen.getByText('Charge limit 85%')).toBeInTheDocument();
    rerender(<ChargeStatusSummary charging active limit={85} />);
    expect(screen.getByRole('img', { name: 'Charging', exact: true })).toBe(indicator);
    expect(indicator.querySelector('[data-charge-bolt]')).toBe(bolt);
  });

  it('distinguishes stopped and unknown charging without a bolt or motion', () => {
    const { container, rerender } = render(<ChargeStatusSummary charging={false} active={false} limit={85} />);
    expect(screen.getByRole('img', { name: 'Not charging' })).toBeInTheDocument();
    expect(container.querySelector('[data-charge-bolt]')).toBeNull();
    rerender(<ChargeStatusSummary charging={null} active={false} limit={null} />);
    expect(screen.getByRole('img', { name: 'Unknown' })).toBeInTheDocument();
    expect(container.querySelector('[data-charge-bolt]')).toBeNull();
    expect(container.querySelector('.widget-state-motion')).toBeNull();
    expect(screen.getByText('Charge limit —')).toBeInTheDocument();
  });
});
