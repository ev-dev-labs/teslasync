import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SecurityEvent } from '@/api/types';
import { VehicleSecurityPanel } from './VehicleSecurityPanel';
import { normalizeDoorState, windowOpenCount } from './vehicleSecurity';

const syntheticSecurity: SecurityEvent = {
  vehicle_id: 1, ts: '2026-10-04T12:00:00Z', event_type: 'fixture',
  doors_open: null, windows_open: null, locked: null, sentry_mode: null,
  user_present: null, detail: null, source: 'synthetic-test-only',
  created_at: '2026-10-04T12:00:00Z',
  door_state: true, fd_window: '30', fp_window: '0', rd_window: true, rp_window: false,
};

describe('independent security without invented live state', () => {
  it('keeps doors/windows while lock and sentry remain unknown when live state is unavailable', () => {
    render(<VehicleSecurityPanel securityData={syntheticSecurity} state={undefined} />);
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    for (const label of ['Locked', 'Sentry', 'Doors', 'Windows']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(document.querySelector('[data-testid="vehicle-security-summary"][data-operational-brief]')).not.toBeNull();
    expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('2 open')).toBeInTheDocument();
    expect(screen.queryByText('No')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it('keeps an empty successful security response as a titled panel, not a blank', () => {
    const { container } = render(<VehicleSecurityPanel securityData={null} state={undefined} />);
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    expect(screen.getByText('No security data available')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(1);
  });

  it('retains the original raw door/window coercion rules', () => {
    expect(windowOpenCount(syntheticSecurity)).toBe(2);
    expect(windowOpenCount({ ...syntheticSecurity, fd_window: null, fp_window: 'bad', rd_window: false, rp_window: '0' })).toBe(0);
    expect(normalizeDoorState(true, 'Translated open')).toBe('Translated open');
    expect(normalizeDoorState(false, 'Translated open')).toBeNull();
    expect(normalizeDoorState('  ajar  ', 'Translated open')).toBe('ajar');
    expect(normalizeDoorState('', 'Translated open')).toBeNull();
    expect(normalizeDoorState(null, 'Translated open')).toBeNull();
  });

  it('does not invent security commands or closed/unlocked values for a successful null telemetry source', () => {
    render(<VehicleSecurityPanel securityData={null} state={undefined} />);
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No security data available');
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    for (const value of ['Closed', 'No', 'Off']) {
      expect(screen.queryByText(value)).not.toBeInTheDocument();
    }
  });

  it('distinguishes false live flags and closed telemetry from missing readings', () => {
    const { rerender } = render(<VehicleSecurityPanel securityData={{
      ...syntheticSecurity, door_state: false,
      fd_window: '0', fp_window: false, rd_window: '0', rp_window: false,
    }} state={undefined} />);
    expect(screen.getAllByText('Closed')).toHaveLength(2);
    expect(screen.getAllByText('—')).toHaveLength(2);
    rerender(<VehicleSecurityPanel securityData={{
      ...syntheticSecurity, door_state: null,
      fd_window: null, fp_window: null, rd_window: null, rp_window: null,
    }} state={undefined} />);
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });
});
