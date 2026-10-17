import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Text } from '@/components/ui';
import type { VehiclePlanResult } from '../lib/types';
import { VehicleReadinessPanel } from './VehicleReadinessPanel';

afterEach(() => {
  cleanup();
});

function vehicle(overrides: Partial<VehiclePlanResult> = {}): VehiclePlanResult {
  return {
    vehicleId: 'ready',
    name: 'Ready vehicle',
    priority: 'high',
    startingSocPct: 40,
    targetSocPct: 80,
    finalSocPct: 80,
    neededWh: 20_000,
    deliveredWh: 20_000,
    unmetWh: 0,
    readinessAchieved: true,
    departureSlot: 0,
    slots: [{ slotIndex: 0, powerW: 7000 }],
    ...overrides,
  };
}

function arc(name: string): SVGCircleElement {
  const element = screen.getByRole('img', { name }).querySelector<SVGCircleElement>('circle[stroke-linecap="round"]');
  if (!element) throw new Error('Projected charge ring has no progress arc');
  return element;
}

describe('VehicleReadinessPanel readiness paint', () => {
  it('uses semantic success and warning paint without changing vehicle readiness output', () => {
    render(<VehicleReadinessPanel vehicles={[
      vehicle(),
      vehicle({
        vehicleId: 'shortfall',
        name: 'Shortfall vehicle',
        finalSocPct: 59.6,
        deliveredWh: 9800,
        unmetWh: 10_200,
        readinessAchieved: false,
        departureSlot: 4,
      }),
    ]} />);

    const readyArc = arc('Ready vehicle projected state of charge');
    const shortfallArc = arc('Shortfall vehicle projected state of charge');
    expect(readyArc).toHaveAttribute('stroke', 'var(--semantic-success)');
    expect(shortfallArc).toHaveAttribute('stroke', 'var(--semantic-warning)');
    expect(Number(readyArc.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 29 * 0.2, 5);
    expect(Number(shortfallArc.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 29 * 0.404, 5);
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getAllByText('of 80%')).toHaveLength(2);
    expect(screen.getByText('Ready')).toHaveClass('text-[var(--semantic-success)]');
    expect(screen.getByText('Not ready')).toHaveClass('text-[var(--semantic-warning)]');
    expect(screen.getByText('Delivered 20.00 kWh of 20.00 kWh needed')).toBeInTheDocument();
    expect(screen.getByText('Delivered 9.80 kWh of 20.00 kWh needed')).toBeInTheDocument();
    expect(screen.getByText('Departure slot #0')).toBeInTheDocument();
    expect(screen.getByText('Departure slot #4')).toBeInTheDocument();

    const unmet = screen.getByText('Unmet: 10.20 kWh');
    expect(unmet.tagName).toBe('P');
    expect(unmet).toHaveClass('text-xs', 'text-[var(--semantic-warning)]');
    expect(unmet).not.toHaveClass('text-amber-300', 'text-[var(--text-muted)]');
  });

  it('preserves measured zero and unknown departure without inventing a shortfall or recalculating readiness', () => {
    render(<VehicleReadinessPanel vehicles={[vehicle({
      name: 'Zero-energy vehicle',
      finalSocPct: 0,
      neededWh: 0,
      deliveredWh: 0,
      unmetWh: 0,
      departureSlot: null,
      slots: [],
    })]} />);

    const zeroArc = arc('Zero-energy vehicle projected state of charge');
    expect(zeroArc).toHaveAttribute('stroke', 'var(--semantic-success)');
    expect(Number(zeroArc.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 29, 5);
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('of 80%')).toBeInTheDocument();
    expect(screen.getByText('Delivered 0.00 kWh of 0.00 kWh needed')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Opportunistic (no deadline)')).toBeInTheDocument();
    expect(screen.queryByText(/Departure slot/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Unmet:/)).not.toBeInTheDocument();
  });

  it('updates readiness paint from the supplied result while retaining the full vehicle identity and fields', () => {
    const name = 'A full family vehicle name whose retained planning identity must never be shortened';
    const retained = vehicle({
      name,
      finalSocPct: 25,
      deliveredWh: 5000,
      unmetWh: 15_000,
      readinessAchieved: false,
      departureSlot: null,
    });
    const { rerender } = render(<VehicleReadinessPanel vehicles={[retained]} />);
    expect(arc(`${name} projected state of charge`)).toHaveAttribute('stroke', 'var(--semantic-warning)');
    expect(screen.getByText(name)).toHaveClass('break-words');
    expect(screen.getByText('Unmet: 15.00 kWh')).toHaveClass('text-[var(--semantic-warning)]');
    expect(screen.getByText('Delivered 5.00 kWh of 20.00 kWh needed')).toBeInTheDocument();

    rerender(<VehicleReadinessPanel vehicles={[{ ...retained }]} />);
    expect(screen.getByText('Not ready')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('Unmet: 15.00 kWh')).toBeInTheDocument();

    rerender(<VehicleReadinessPanel vehicles={[vehicle({ name })]} />);
    expect(arc(`${name} projected state of charge`)).toHaveAttribute('stroke', 'var(--semantic-success)');
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Delivered 20.00 kWh of 20.00 kWh needed')).toBeInTheDocument();
    expect(screen.getByText('Departure slot #0')).toBeInTheDocument();
    expect(screen.queryByText(/^Unmet:/)).not.toBeInTheDocument();
  });

  it('keeps the empty panel explanation and working add-vehicle navigation', () => {
    render(<MemoryRouter>
      <Routes>
        <Route path="/" element={<VehicleReadinessPanel vehicles={[]} />} />
        <Route path="/vehicles" element={<Text as="h2">Vehicle destination</Text>} />
      </Routes>
    </MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Per-vehicle readiness' })).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText('No vehicles are part of this plan.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const action = screen.getByRole('link', { name: 'Add a vehicle' });
    expect(action).toHaveAttribute('href', '/vehicles');
    fireEvent.click(action);
    expect(screen.getByRole('heading', { name: 'Vehicle destination' })).toBeInTheDocument();
  });
});
