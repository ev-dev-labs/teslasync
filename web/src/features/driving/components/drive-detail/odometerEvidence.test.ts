import { describe, expect, it } from 'vitest';
import { driveOdometerEvidence } from './odometerEvidence';
import { driveFixture, pointFixture, statsFixture } from './detailTestFixtures';

describe('Drive endpoint odometer evidence', () => {
  it('prefers persisted SI endpoints over incomplete samples and converts exactly once', () => {
    const drive = driveFixture({ start_odometer_m: 120000000, end_odometer_m: 120040000 });
    const result = driveOdometerEvidence(drive, statsFixture(), 'km', [pointFixture({ odometer: 99 })]);
    expect(result).toEqual({ start: 120000, end: 120040, source: 'aggregate' });
    expect(driveOdometerEvidence(drive, statsFixture(), 'mi').start).toBeCloseTo(74564.543, 3);
    expect(drive.start_odometer_m).toBe(120000000);
  });

  it('keeps actual zero readings and missing endpoints distinct', () => {
    expect(driveOdometerEvidence(driveFixture({ start_odometer_m: 0 }), statsFixture(), 'km', []))
      .toEqual({ start: 0, end: null, source: 'mixed' });
    expect(driveOdometerEvidence(driveFixture(), statsFixture({ odometerStart: 0, odometerEnd: 0 }), 'km'))
      .toEqual({ start: null, end: null, source: 'sampled' });
  });

  it('uses valid display-unit samples when the persisted endpoint is unavailable, without double conversion', () => {
    const result = driveOdometerEvidence(driveFixture({ end_odometer_m: 40000 }), statsFixture(), 'mi',
      [pointFixture({ odometer: null }), pointFixture({ odometer: 0 }), pointFixture({ odometer: NaN })]);
    expect(result.start).toBe(0);
    expect(result.end).toBeCloseTo(24.8548, 4);
    expect(result.source).toBe('mixed');
  });

  it('does not call a single observation both endpoints of a completed drive', () => {
    expect(driveOdometerEvidence(driveFixture(), statsFixture(), 'km', [pointFixture({ odometer: 0 })]))
      .toEqual({ start: 0, end: null, source: 'sampled' });
  });

  it('keeps the latest observed reading available while a drive is ongoing', () => {
    expect(driveOdometerEvidence(driveFixture({ endTs: null }), statsFixture(), 'km', [pointFixture({ odometer: 10000 })]))
      .toEqual({ start: 10000, end: 10000, source: 'sampled' });
  });
});
