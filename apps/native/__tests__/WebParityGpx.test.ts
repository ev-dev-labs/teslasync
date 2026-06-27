import {Share} from 'react-native';

import {
  buildDriveGpx,
  driveGpxFilename,
  exportDriveAsGPX,
  type GpxDrive,
  type GpxPosition,
} from '../src/web-parity/lib/gpx';

const drive: GpxDrive = {
  id: 7,
  start_date: '2026-06-26T15:30:00Z',
  distance: 12.34,
  duration_min: 25.4,
};

// First sample is valid; the other two are dropped by the truthy lat/lon filter
// (web source L19): one has a null longitude, the other a falsy 0 latitude.
const positions: GpxPosition[] = [
  {
    latitude: 37.5,
    longitude: -122.3,
    elevation: 12,
    created_at: '2026-06-26T15:31:00Z',
    speed: 20,
    battery_level: 80,
    power: 5,
  },
  {
    latitude: 37.6,
    longitude: null,
    elevation: 5,
    created_at: '2026-06-26T15:32:00Z',
  },
  {
    latitude: 0,
    longitude: -122.4,
    elevation: 0,
    created_at: '2026-06-26T15:33:00Z',
  },
];

describe('web-parity gpx serializer', () => {
  test('buildDriveGpx emits a GPX 1.1 document with drive metadata', () => {
    const gpx = buildDriveGpx(drive, positions, 'Model 3');

    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('<gpx version="1.1" creator="TeslaSync"');
    // formatDate() output is host-locale dependent, so assert only the stable
    // prefix; the numeric description and ISO time are deterministic.
    expect(gpx).toContain('<name>Model 3 - ');
    expect(gpx).toContain(
      'Distance: 12.3 km, Duration: 25 min',
    );
    expect(gpx).toContain('<time>2026-06-26T15:30:00.000Z</time>');
    expect(gpx).toContain('<name>Drive 7</name>');
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
  });

  test('buildDriveGpx renders one trkpt per valid position', () => {
    const gpx = buildDriveGpx(drive, positions, 'Model 3');

    const trkptCount = (gpx.match(/<trkpt /g) ?? []).length;
    expect(trkptCount).toBe(1);

    expect(gpx).toContain('<trkpt lat="37.5" lon="-122.3">');
    expect(gpx).toContain('<ele>12</ele>');
    expect(gpx).toContain('<time>2026-06-26T15:31:00.000Z</time>');
    expect(gpx).toContain('<speed>20</speed>');
    expect(gpx).toContain('<battery>80</battery>');
    expect(gpx).toContain('<power>5</power>');

    // Filtered-out samples must not appear.
    expect(gpx).not.toContain('lat="37.6"');
    expect(gpx).not.toContain('lat="0"');
  });

  test('buildDriveGpx applies the || 0 fallbacks for missing extensions', () => {
    const gpx = buildDriveGpx(
      drive,
      [{latitude: 1, longitude: 2, created_at: '2026-06-26T16:00:00Z'}],
      'Model Y',
    );

    expect(gpx).toContain('<ele>0</ele>');
    expect(gpx).toContain('<speed>0</speed>');
    expect(gpx).toContain('<battery>0</battery>');
    expect(gpx).toContain('<power>0</power>');
  });

  test('driveGpxFilename builds the dated download name', () => {
    expect(driveGpxFilename(drive)).toBe('teslasync-drive-7-2026-06-26.gpx');
  });
});

describe('web-parity gpx native delivery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exportDriveAsGPX shares the document through the OS share sheet', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({action: 'sharedAction'});

    const result = await exportDriveAsGPX(drive, positions, 'Model 3');

    const expectedGpx = buildDriveGpx(drive, positions, 'Model 3');
    const expectedName = driveGpxFilename(drive);

    expect(shareSpy).toHaveBeenCalledWith(
      {title: expectedName, message: expectedGpx},
      {subject: expectedName, dialogTitle: expectedName},
    );
    expect(result).toEqual({
      filename: expectedName,
      gpx: expectedGpx,
      delivered: true,
      action: 'shared',
    });
  });

  test('exportDriveAsGPX reports a dismissed share sheet', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({action: 'dismissedAction'});

    const result = await exportDriveAsGPX(drive, positions, 'Model 3');

    expect(result.delivered).toBe(false);
    expect(result.action).toBe('dismissed');
    expect(result.gpx).toContain('<trkpt lat="37.5" lon="-122.3">');
  });

  test('exportDriveAsGPX surfaces an explicit unavailable state when Share fails', async () => {
    jest
      .spyOn(Share, 'share')
      .mockRejectedValue(new Error('no share target'));

    const result = await exportDriveAsGPX(drive, positions, 'Model 3');

    expect(result.delivered).toBe(false);
    expect(result.action).toBe('unavailable');
    expect(result.unavailableReason).toBe('no share target');
    // The serialized artifact is still returned even when delivery fails.
    expect(result.filename).toBe('teslasync-drive-7-2026-06-26.gpx');
    expect(result.gpx.startsWith('<?xml')).toBe(true);
  });
});
