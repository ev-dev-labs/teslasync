import { describe, expect, it } from 'vitest';
import type { SecurityEvent } from '@/api/types';
import { securityDoorReading, securityWindowReading } from './securityReadings';

describe('source-preserving door and corner-window readings', () => {
  it('distinguishes false closed doors from null or blank unknown doors without recasing source enums', () => {
    expect(securityDoorReading(false, 'Open', 'Closed')).toBe('Closed');
    expect(securityDoorReading(true, 'Open', 'Closed')).toBe('Open');
    expect(securityDoorReading(null, 'Open', 'Closed')).toBeNull();
    expect(securityDoorReading(undefined, 'Open', 'Closed')).toBeNull();
    expect(securityDoorReading('  ', 'Open', 'Closed')).toBeNull();
    expect(securityDoorReading('  AJAR  ', 'Open', 'Closed')).toBe('AJAR');
  });

  it('requires four known closed corners, keeps definite openings, and does not treat invalid input as closed', () => {
    const closed = { fd_window: false, fp_window: '0', rd_window: false, rp_window: '0' } as SecurityEvent;
    expect(securityWindowReading(closed)).toEqual({ open: 0, complete: true });
    expect(securityWindowReading({ ...closed, fd_window: null })).toEqual({ open: 0, complete: false });
    expect(securityWindowReading({ ...closed, fd_window: '' })).toEqual({ open: 0, complete: false });
    expect(securityWindowReading({ ...closed, fd_window: 'bad' })).toEqual({ open: 0, complete: false });
    expect(securityWindowReading({ ...closed, fd_window: '-1' })).toEqual({ open: 0, complete: false });
    expect(securityWindowReading({ ...closed, fd_window: '30', rd_window: true })).toEqual({ open: 2, complete: true });
    expect(securityWindowReading(null)).toEqual({ open: 0, complete: false });
  });
});
