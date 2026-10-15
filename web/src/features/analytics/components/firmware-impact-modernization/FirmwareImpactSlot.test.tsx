import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FirmwareImpactSlot } from './FirmwareImpactSlot';

const current = vi.hoisted(() => ({ className: 'col-span-12', delay: 0 }));
vi.mock('@/components/layout/layout-reference', () => ({
  useCardPlacement: () => ({ className: current.className, size: 'full', span: 12, width: 1440 }),
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className, delay }: { children: ReactNode; className: string; delay: number }) => {
    current.delay = delay;
    return <div data-testid="placed-motion-slot" className={className}>{children}</div>;
  },
}));
afterEach(cleanup);

describe('firmware section placement uses the shared packed span', () => {
  it.each(['col-span-1', 'col-span-6', 'col-span-12'])('keeps %s on the actual grid child', className => {
    current.className = className;
    render(<FirmwareImpactSlot delay={0.2}><span>complete evidence</span></FirmwareImpactSlot>);
    expect(screen.getByTestId('placed-motion-slot')).toHaveClass(className, 'w-full', 'min-w-0');
    expect(screen.getByText('complete evidence')).toBeInTheDocument();
    expect(current.delay).toBe(0.2);
  });
});
