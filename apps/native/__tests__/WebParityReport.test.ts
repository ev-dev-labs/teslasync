import {Share} from 'react-native';

import {
  buildDriveReportHtml,
  buildMonthlyReportHtml,
  generateDriveReport,
  generateMonthlyReport,
  type ReportDrive,
  type ReportStats,
  type ReportVehicle,
} from '../src/web-parity/lib/report';

const drive: ReportDrive = {
  start_date: '2026-06-26T15:30:00Z',
  end_date: '2026-06-26T16:00:00Z',
  distance: 42.5,
  duration_min: 30,
  speed_max: 120,
  start_battery_level: 90,
  end_battery_level: 70,
  start_range_km: 400,
  end_range_km: 330,
};

const vehicle: ReportVehicle = {display_name: 'Model 3'};

const stats: ReportStats = {
  total_distance_km: 1234,
  total_drives: 42,
  total_energy_kwh: 256,
  total_cost: 78.5,
  avg_efficiency_wh_km: 165,
};

const vehicles: ReportVehicle[] = [
  {display_name: 'Model 3'},
  {display_name: 'Model Y'},
];

describe('web-parity report drive serializer', () => {
  test('buildDriveReportHtml emits a full HTML document with the print stylesheet', () => {
    const html = buildDriveReportHtml(drive, vehicle);

    expect(html).toContain('<!DOCTYPE html>');
    // formatDate() output is host-locale dependent, so assert only the stable
    // title prefix.
    expect(html).toContain('<title>Drive Report - ');
    expect(html).toContain('<h1>TeslaSync — Drive Report</h1>');
    expect(html).toContain('@media print { body { padding: 20px; } }');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  test('buildDriveReportHtml renders the four-tile stat strip', () => {
    const html = buildDriveReportHtml(drive, vehicle);

    // distance fmtNumber(42.5, 1), rounded duration, max speed, battery delta.
    expect(html).toContain(
      '<div class="stat-value">42.5</div><div class="stat-label">km Distance</div>',
    );
    expect(html).toContain(
      '<div class="stat-value">30</div><div class="stat-label">min Duration</div>',
    );
    expect(html).toContain(
      '<div class="stat-value">120</div><div class="stat-label">km/h Max Speed</div>',
    );
    expect(html).toContain(
      '<div class="stat-value">90→70</div><div class="stat-label">% Battery</div>',
    );
  });

  test('buildDriveReportHtml renders the details table with computed values', () => {
    const html = buildDriveReportHtml(drive, vehicle);

    // Duration h/m: floor(30/60)=0h, round(30%60)=30m.
    expect(html).toContain('<td>Duration</td><td>0h 30m</td>');
    // Average speed: fmtNumber(42.5 / (30/60), 0) = fmtNumber(85, 0).
    expect(html).toContain('<td>Average Speed</td><td>85 km/h</td>');
    expect(html).toContain('<td>Max Speed</td><td>120 km/h</td>');
    // Battery used: 90 - 70.
    expect(html).toContain('<td>Battery Used</td><td>20%</td>');
    expect(html).toContain('<td>Start Range</td><td>400 km</td>');
    expect(html).toContain('<td>End Range</td><td>330 km</td>');
  });

  test('buildDriveReportHtml applies the null fallbacks for missing fields', () => {
    const html = buildDriveReportHtml(
      {start_date: '2026-06-26T15:30:00Z'},
      null,
    );

    // vehicle?.display_name || 'N/A'.
    expect(html).toContain('<strong>Vehicle:</strong> N/A |');
    // distance / speed_max != null ? ... : '—'.
    expect(html).toContain(
      '<div class="stat-value">—</div><div class="stat-label">km Distance</div>',
    );
    expect(html).toContain(
      '<div class="stat-value">—</div><div class="stat-label">km/h Max Speed</div>',
    );
    // start/end battery ?? '?'.
    expect(html).toContain(
      '<div class="stat-value">?→?</div><div class="stat-label">% Battery</div>',
    );
    // end_date ? ... : 'In progress'.
    expect(html).toContain('<td>End Time</td><td>In progress</td>');
    // start/end range != null ? ... : '—'.
    expect(html).toContain('<td>Start Range</td><td>— km</td>');
    expect(html).toContain('<td>End Range</td><td>— km</td>');
  });
});

describe('web-parity report monthly serializer', () => {
  test('buildMonthlyReportHtml emits the summary table', () => {
    const html = buildMonthlyReportHtml(stats, vehicles);

    expect(html).toContain('<title>TeslaSync Monthly Report</title>');
    expect(html).toContain('<h1>TeslaSync — Monthly Summary</h1>');
    expect(html).toContain('<td>Total Vehicles</td><td>2</td>');
    expect(html).toContain('<td>Total Distance</td><td>1,234 km</td>');
    expect(html).toContain('<td>Total Drives</td><td>42</td>');
    expect(html).toContain('<td>Total Energy</td><td>256 kWh</td>');
    expect(html).toContain('<td>Total Cost</td><td>$78.50</td>');
    expect(html).toContain('<td>Avg Efficiency</td><td>165 Wh/km</td>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  test('buildMonthlyReportHtml applies the null fallbacks', () => {
    const html = buildMonthlyReportHtml(null, null);

    // vehicles?.length || 0 and stats?.* fallbacks.
    expect(html).toContain('<td>Total Vehicles</td><td>0</td>');
    expect(html).toContain('<td>Total Distance</td><td>0 km</td>');
    expect(html).toContain('<td>Total Drives</td><td>0</td>');
    expect(html).toContain('<td>Total Cost</td><td>$0.00</td>');
  });
});

describe('web-parity report native delivery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('generateDriveReport shares the document through the OS share sheet', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({action: 'sharedAction'});

    const result = await generateDriveReport(drive, vehicle);

    const expectedHtml = buildDriveReportHtml(drive, vehicle);

    expect(shareSpy).toHaveBeenCalledWith(
      {title: result.title, message: expectedHtml},
      {
        subject: result.title,
        dialogTitle: result.title,
      },
    );
    expect(result.title.startsWith('Drive Report - ')).toBe(true);
    expect(result.html).toBe(expectedHtml);
    expect(result.delivered).toBe(true);
    expect(result.action).toBe('shared');
  });

  test('generateMonthlyReport reports a dismissed share sheet', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({action: 'dismissedAction'});

    const result = await generateMonthlyReport(stats, vehicles);

    expect(result.title).toBe('TeslaSync Monthly Report');
    expect(result.delivered).toBe(false);
    expect(result.action).toBe('dismissed');
    expect(result.html).toContain('<h1>TeslaSync — Monthly Summary</h1>');
  });

  test('generateDriveReport surfaces an explicit unavailable state when Share fails', async () => {
    jest
      .spyOn(Share, 'share')
      .mockRejectedValue(new Error('no share target'));

    const result = await generateDriveReport(drive, vehicle);

    expect(result.delivered).toBe(false);
    expect(result.action).toBe('unavailable');
    expect(result.unavailableReason).toBe('no share target');
    // The serialized document is still returned even when delivery fails.
    expect(result.html).toContain('<!DOCTYPE html>');
  });
});
