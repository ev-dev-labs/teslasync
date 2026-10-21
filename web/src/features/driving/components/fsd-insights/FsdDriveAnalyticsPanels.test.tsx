import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contributingDriveExportRows, FsdDriveAnalyticsPanels } from './FsdDriveAnalyticsPanels';
import { fsdInsights as buildFsdInsights } from './__tests__/fixtures';
import type { UnitPref } from '@/lib/unitConversion';
import { neonColorMap, typography } from '@/lib/tokens';
import { setGlobalLocale } from '@/lib/numberFormat';

vi.unmock('@/lib/timezone');

function fsdInsights() {
  return structuredClone(buildFsdInsights());
}

const { downloadJSON, downloadRowsAsCSV, display } = vi.hoisted(() => ({
  downloadJSON: vi.fn(),
  downloadRowsAsCSV: vi.fn(),
  display: {
    unitPrefs: { distance: 'km', precision: 2, locale: 'en-US' } as UnitPref,
    locale: 'en-US',
    settings: { tz_display_default: 'user', timezone_user: 'UTC' },
    translations: {} as Record<string, string>,
  },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: display.settings, locale: display.locale }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { timezone: 'America/Los_Angeles' } }),
}));

vi.mock('@/lib/csvExport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport');
  return {
    ...actual,
    downloadJSON,
    downloadRowsAsCSV,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        display.translations[key] ?? fallback,
      ),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: display.unitPrefs,
    formatDistance: (meters: number | null, options?: { precision?: number }) =>
      meters == null ? '-' : `${(meters / 1000).toFixed(options?.precision ?? 1)} km`,
  }),
}));

const readyState = {
  isLoading: false,
  error: null,
  onRetry: vi.fn(),
  noVehicle: false,
};

beforeEach(() => {
  downloadJSON.mockReset();
  downloadRowsAsCSV.mockReset();
  display.unitPrefs = { distance: 'km', precision: 2, locale: 'en-US' };
  display.locale = 'en-US';
  display.settings = { tz_display_default: 'user', timezone_user: 'UTC' };
  display.translations = {};
  setGlobalLocale('en-US');
});

describe('FsdDriveAnalyticsPanels', () => {
  // Metric context moved off the brief face into the evidence drawer group.
  function expectComparisonGroupContext(groupName: string, text: string) {
    const brief = within(screen.getByTestId('fsd-period-comparison'))
      .getByRole('region', { name: 'Current and previous period quantities' });
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: groupName })).toHaveTextContent(text);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
  it.each([null, undefined, NaN, Infinity, -Infinity, '', '0'])(
    'preserves populations when shares are unavailable (%s) without fabricating zero',
    (value) => {
      const insights = efficiencyInsights();
      Object.assign(insights.drive_analytics.firmware_spotlight.routes[0], {
        before_fsd_share_pct: value,
        after_fsd_share_pct: 0,
        before_drive_count: 1234,
        after_drive_count: 0,
        share_change_pct_points: value,
      });
      Object.assign(insights.drive_analytics.repeated_routes[0], { drive_count: value, fsd_share_pct: value });
      Object.assign(insights.drive_analytics.commute_identities[0].this_month, { unknown_days: value, fsd_share_pct: value });
      Object.assign(insights.drive_analytics.route_efficiency[0], {
        fsd_heavy_drive_count: value,
        fsd_heavy_efficiency_wh_per_km: 0,
      });
      render(<MemoryRouter><FsdDriveAnalyticsPanels insights={insights} state={readyState} /></MemoryRouter>);

      const spotlight = screen.getByTestId('fsd-firmware-spotlight');
      expect(within(spotlight).getByText('Not measured · 1,234')).toBeInTheDocument();
      expect(within(spotlight).getByText('0.00% · 0')).toBeInTheDocument();
      expect(within(spotlight).getByText('-')).toBeInTheDocument();
      expect(within(screen.getByTestId('fsd-comparison-groups')).getByText('Not measured')).toBeInTheDocument();
      expect(within(screen.getByTestId('fsd-commute-identity')).getAllByText('Unknown')).toHaveLength(2);
      expect(within(screen.getByTestId('fsd-route-efficiency')).getByText('Not measured / 0.00 Wh/km')).toBeInTheDocument();
    },
  );

  it('formats integer populations with locale grouping while preserving fractional signed measurements', () => {
    setGlobalLocale('de-DE');
    display.unitPrefs = { distance: 'km', precision: 2, locale: 'de-DE' };
    const insights = efficiencyInsights();
    Object.assign(insights.drive_analytics.repeated_routes[0], { drive_count: 1234.6 });
    Object.assign(insights.drive_analytics.firmware_spotlight.routes[0], {
      before_drive_count: 1234.6,
      after_drive_count: 0,
      before_fsd_share_pct: 0,
      after_fsd_share_pct: 12.345,
      share_change_pct_points: -12.345,
    });
    Object.assign(insights.drive_analytics.commute_identities[0].this_month, { unknown_days: 1234.6 });
    insights.drive_analytics.commute_identities[0].share_change_pct_points = 12.345;
    Object.assign(insights.drive_analytics.route_efficiency[0], {
      fsd_heavy_drive_count: 1234.6,
      low_fsd_drive_count: 0,
      fsd_heavy_efficiency_wh_per_km: -12.345,
      low_fsd_efficiency_wh_per_km: 0,
      difference_pct: -12.345,
    });
    render(<MemoryRouter><FsdDriveAnalyticsPanels insights={insights} state={readyState} /></MemoryRouter>);

    expect(within(screen.getByTestId('fsd-comparison-groups')).getByText('1.235')).toBeInTheDocument();
    const spotlight = screen.getByTestId('fsd-firmware-spotlight');
    expect(within(spotlight).getByText('0,00% · 1.235')).toBeInTheDocument();
    expect(within(spotlight).getByText('12,35% · 0')).toBeInTheDocument();
    expect(within(spotlight).getByText('-12,35 pts')).toBeInTheDocument();
    const commute = screen.getByTestId('fsd-commute-identity');
    expect(within(commute).getByText('1.235')).toBeInTheDocument();
    expect(within(commute).getByText('+12,35 pt')).toBeInTheDocument();
    const efficiency = screen.getByTestId('fsd-route-efficiency');
    expect(within(efficiency).getByText('1.235 / -12,35 Wh/km')).toBeInTheDocument();
    expect(within(efficiency).getByText('0 / 0,00 Wh/km')).toBeInTheDocument();
    expect(within(efficiency).getByText('-12,35%')).toBeInTheDocument();
  });

  it('lets whole localized phrases reorder routes, populations, units, and signed changes', () => {
    display.translations = {
      'fsd.analytics.routePlaces': '{{end}} from {{start}}',
      'fsd.analytics.share': 'percent {{value}}{{approximate}}',
      'fsd.analytics.sharePopulation': '{{drives}} drives: {{share}}',
      'fsd.analytics.shareChangePoints': 'points {{delta}}',
      'fsd.analytics.shareChangePoint': 'point {{delta}}',
      'fsd.analytics.efficiencyValue': '{{unit}}: {{value}}',
      'fsd.analytics.efficiencyPopulation': '{{efficiency}} across {{drives}} drives',
    };
    const insights = efficiencyInsights();
    render(<MemoryRouter><FsdDriveAnalyticsPanels insights={insights} state={readyState} /></MemoryRouter>);
    expect(within(screen.getByTestId('fsd-contributing-drives')).getByText('Office from Home')).toBeInTheDocument();
    expect(within(screen.getByTestId('fsd-firmware-spotlight')).getByText('points +40.00')).toBeInTheDocument();
    expect(within(screen.getByTestId('fsd-firmware-spotlight')).getAllByText(/drives: percent/)).toHaveLength(2);
    expect(within(screen.getByTestId('fsd-commute-identity')).getByText(/point [+-]/)).toBeInTheDocument();
    expect(within(screen.getByTestId('fsd-route-efficiency')).getByText('Wh/km: 1,234.57 across 3 drives')).toBeInTheDocument();
    expect(within(screen.getByTestId('fsd-route-efficiency')).getByText('percent -1.23')).toBeInTheDocument();
  });

  it('keeps known zero populations and shares distinct from unknown values', () => {
    const insights = efficiencyInsights();
    Object.assign(insights.drive_analytics.repeated_routes[0], { drive_count: 0, fsd_share_pct: 0 });
    Object.assign(insights.drive_analytics.firmware_spotlight.routes[0], {
      before_drive_count: 0, after_drive_count: 0,
      before_fsd_share_pct: 0, after_fsd_share_pct: 0, share_change_pct_points: 0,
    });
    Object.assign(insights.drive_analytics.commute_identities[0].this_month, { unknown_days: 0, fsd_share_pct: 0 });
    insights.drive_analytics.commute_identities[0].share_change_pct_points = 0;
    render(<MemoryRouter><FsdDriveAnalyticsPanels insights={insights} state={readyState} /></MemoryRouter>);
    const groups = screen.getByTestId('fsd-comparison-groups');
    expect(within(groups).getByText('0')).toBeInTheDocument();
    expect(within(groups).getByText('0.00%')).toBeInTheDocument();
    const spotlight = screen.getByTestId('fsd-firmware-spotlight');
    expect(within(spotlight).getAllByText('0.00% · 0')).toHaveLength(2);
    expect(within(spotlight).getByText('+0.00 pts')).toBeInTheDocument();
    const commute = screen.getByTestId('fsd-commute-identity');
    expect(within(commute).getByText('0')).toBeInTheDocument();
    expect(within(commute).getByText('0.00%')).toBeInTheDocument();
    expect(within(commute).getByText('+0.00 pt')).toBeInTheDocument();
  });

  it('keeps extracted attribution buckets distinct for measured zero and unavailable distance', () => {
    const insights = structuredClone(fsdInsights());
    insights.drive_analytics.attribution = {
      attributed_distance_m: 0,
      estimated_distance_m: null,
      ambiguous_distance_m: 1_000,
      unattributed_distance_m: 2_000,
      unknown_drive_distance_m: null,
    };
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    const panel = screen.getByTestId('fsd-attribution');
    for (const [label, value] of [
      ['High-confidence attributed', '0.0 km'],
      ['Estimated', 'Not measured'],
      ['Ambiguous between drives', '1.0 km'],
      ['Outside a known drive', '2.0 km'],
      ['Drive distance unknown', 'Not measured'],
    ]) {
      const bucket = within(panel).getByText(label).parentElement;
      expect(bucket).not.toBeNull();
      expect(within(bucket!).getByText(value)).toBeInTheDocument();
    }
  });

  it('keeps all three GroupTable datasets and their pagination independent after extraction', () => {
    const insights = structuredClone(fsdInsights());
    const seed = insights.drive_analytics.repeated_routes[0];
    insights.drive_analytics.repeated_routes = Array.from({ length: 26 }, (_, index) => ({
      ...seed,
      key: `route-${index}`,
      label: `Repeated route ${index + 1}`,
    }));
    insights.drive_analytics.time_of_day = [{ ...seed, key: 'time', label: 'Distinct time window' }];
    insights.drive_analytics.firmware = [{ ...seed, key: 'firmware', label: 'Distinct firmware' }];
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    const panel = screen.getByTestId('fsd-comparison-groups');
    expect(within(panel).getAllByRole('table')).toHaveLength(3);
    expect(within(panel).getByText('Repeated route 1')).toBeInTheDocument();
    expect(within(panel).queryByText('Repeated route 26')).not.toBeInTheDocument();
    const next = within(panel).getAllByRole('button', { name: 'Next page' })
      .find((button) => !button.hasAttribute('disabled'));
    expect(next).toBeDefined();
    fireEvent.click(next!);
    expect(within(panel).getByText('Repeated route 26')).toBeInTheDocument();
    expect(within(panel).queryByText('Repeated route 1')).not.toBeInTheDocument();
    expect(within(panel).getByText('Distinct time window')).toBeInTheDocument();
    expect(within(panel).getByText('Distinct firmware')).toBeInTheDocument();
    expect(within(panel).getByText('Showing 26–26 of 26')).toBeInTheDocument();
  });

  it('retains dataset-specific accessible alternatives when extracted tables become empty', () => {
    const insights = structuredClone(fsdInsights());
    const { rerender } = render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );
    insights.drive_analytics.contributing_drives = [];
    insights.drive_analytics.repeated_routes = [];
    insights.drive_analytics.time_of_day = [];
    insights.drive_analytics.firmware = [];
    insights.drive_analytics.firmware_spotlight.routes = [];
    insights.drive_analytics.commute_identities = [];
    insights.drive_analytics.route_efficiency = [];
    rerender(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={{ ...insights }} state={readyState} />
      </MemoryRouter>,
    );

    const groups = screen.getByTestId('fsd-comparison-groups');
    for (const title of ['Repeated routes', 'Time of day', 'Firmware version']) {
      expect(within(groups).getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(within(groups).getAllByText('Not enough high-confidence drives for this comparison.')).toHaveLength(3);
    for (const [id, message] of [
      ['fsd-contributing-drives', 'No drive has positive attributable FSD distance in this period.'],
      ['fsd-firmware-spotlight', 'Firmware moved from 2026.8.1 to 2026.20.3, but no repeated high-confidence route was observed on both versions.'],
      ['fsd-commute-identity', 'No repeated commute window has enough high-confidence drives this month.'],
      ['fsd-route-efficiency', 'No repeated route has at least two FSD-heavy and two low-FSD high-confidence drives.'],
    ]) {
      const panel = screen.getByTestId(id);
      expect(within(panel).queryByRole('table')).not.toBeInTheDocument();
      expect(within(panel).getByText(message)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeDisabled();
  });

  it('allocates mobile touch targets and explicitly restores compact desktop controls', () => {
    const insights = fsdInsights();
    insights.drive_analytics.reset_events = [{
      field: 'SelfDrivingMilesSinceReset',
      at: '2026-03-02T17:00:00Z',
      previous_value_m: 9_000,
      current_value_m: 20,
      affected_drive_ids: [295],
      firmware_version: null,
    }];
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    for (const name of ['CSV', 'JSON']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0', 'whitespace-normal');
      expect(button.parentElement).toHaveClass('flex-wrap');
    }
    const drives = screen.getByTestId('fsd-contributing-drives');
    for (const id of [
      'fsd-period-comparison', 'fsd-attribution', 'fsd-contributing-drives',
      'fsd-comparison-groups', 'fsd-firmware-spotlight', 'fsd-route-efficiency',
      'fsd-commute-identity',
    ]) {
      const icon = screen.getByTestId(id).querySelector('h3 svg');
      expect(icon).toHaveClass(typography.color.muted);
    }
    const reset = within(screen.getByTestId('fsd-attribution')).getByText('SelfDrivingMilesSinceReset').closest('li');
    expect(reset).toHaveClass(neonColorMap.amber.border, neonColorMap.amber.bg);
    expect(reset?.querySelector('p, span')).not.toHaveClass(neonColorMap.amber.text);
    const links = [
      ...within(drives).getAllByRole('link'),
      within(screen.getByTestId('fsd-attribution')).getByRole('link', { name: '#295' }),
    ];
    for (const link of links) {
      expect(link).toHaveClass('inline-flex', 'min-h-11', 'min-w-11', 'md:min-h-0', 'md:min-w-0');
      expect(link).toHaveClass('focus-visible:outline-2', 'whitespace-normal', 'break-words');
      expect(link).toHaveClass('text-[var(--text-primary)]', 'hover:bg-[var(--control-bg-hover)]');
    }
    expect(within(drives).getByRole('link', { name: /2026/ }))
      .toHaveClass('justify-start', 'text-start');
  });

  it('keeps every analytics table field accessible below md in its scrollable viewport', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={efficiencyInsights()} state={readyState} />
      </MemoryRouter>,
    );

    for (const id of [
      'fsd-contributing-drives', 'fsd-comparison-groups', 'fsd-firmware-spotlight',
      'fsd-commute-identity', 'fsd-route-efficiency',
    ]) {
      const panel = screen.getByTestId(id);
      for (const table of within(panel).getAllByRole('table')) {
        for (const cell of within(table).getAllByRole('columnheader')) {
          expect(cell).not.toHaveClass('hidden');
        }
        for (const cell of within(table).getAllByRole('cell')) {
          expect(cell).not.toHaveClass('hidden');
        }
        expect(table.closest('[data-grid-viewport]')?.className)
          .toMatch(/\boverflow-(?:x-)?auto\b/);
      }
    }
    expect(within(screen.getByTestId('fsd-contributing-drives')).getByRole('columnheader', { name: 'Firmware' }))
      .toBeInTheDocument();
    expect(within(screen.getByTestId('fsd-commute-identity')).getByRole('columnheader', { name: 'Unknown days' }))
      .toBeInTheDocument();
    expect(within(screen.getByTestId('fsd-route-efficiency')).getByRole('columnheader', { name: 'Low-FSD' }))
      .toBeInTheDocument();
  });

  it('supports keyboard export and retains focusable native drive navigation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={fsdInsights()} state={readyState} />
      </MemoryRouter>,
    );
    const csv = screen.getByRole('button', { name: 'CSV' });
    csv.focus();
    await user.keyboard('{Enter}');
    expect(downloadRowsAsCSV).toHaveBeenCalledOnce();
    await user.tab();
    expect(screen.getByRole('button', { name: 'JSON' })).toHaveFocus();
    await user.keyboard(' ');
    expect(downloadJSON).toHaveBeenCalledOnce();
    const link = screen.getByRole('link', { name: 'Open drive 295' });
    link.focus();
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute('href', '/drives/295');
  });

  it('uses saved date preferences across day boundaries without changing calendar buckets or exports', () => {
    display.locale = 'de-DE';
    display.settings = { tz_display_default: 'user', timezone_user: 'Asia/Tokyo' };
    const insights = fsdInsights();
    const instant = '2026-03-02T23:30:00Z';
    insights.drive_analytics.contributing_drives[0].started_at = instant;
    insights.drive_analytics.reset_events = [{
      field: 'SelfDrivingMilesSinceReset',
      at: instant,
      previous_value_m: 9_000,
      current_value_m: 20,
      affected_drive_ids: [295],
      firmware_version: null,
    }];
    const { rerender } = render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    const drives = screen.getByTestId('fsd-contributing-drives');
    const resets = screen.getByTestId('fsd-attribution');
    expect(within(drives).getByRole('link', { name: '3. März 2026, 08:30' })).toBeInTheDocument();
    expect(within(resets).getByText('3. März 2026, 08:30')).toBeInTheDocument();
    expectComparisonGroupContext('Previous FSD distance', '3. Jan. – 1. Feb. 2026');
    expect(insights.period.timezone).toBe('America/Los_Angeles');
    fireEvent.click(within(drives).getByRole('button', { name: 'JSON' }));
    expect(downloadJSON.mock.calls[0][1].drives[0].started_at).toBe(instant);

    display.locale = 'en-US';
    display.settings = { tz_display_default: 'vehicle', timezone_user: 'Asia/Tokyo' };
    rerender(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );
    expect(within(drives).getByRole('link', { name: 'Mar 2, 2026, 03:30 PM' })).toBeInTheDocument();
    expect(within(resets).getByText('Mar 2, 2026, 03:30 PM')).toBeInTheDocument();
    expect(within(drives).queryByRole('link', { name: '3. März 2026, 08:30' })).not.toBeInTheDocument();
    expectComparisonGroupContext('Previous FSD distance', 'Jan 3 – Feb 1, 2026');
  });

  it.each(['not-a-date', '', null, undefined])('shows unavailable timestamps (%s) without hiding drives or resets', (value) => {
    const insights = fsdInsights();
    Object.assign(insights.drive_analytics.contributing_drives[0], { started_at: value });
    insights.drive_analytics.reset_events = [{
      field: 'SelfDrivingMilesSinceReset',
      at: '',
      previous_value_m: 9_000,
      current_value_m: 20,
      affected_drive_ids: [295],
      firmware_version: null,
    }];
    Object.assign(insights.drive_analytics.reset_events[0], { at: value });
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );
    expect(within(screen.getByTestId('fsd-contributing-drives')).getByRole('link', { name: '—' }))
      .toHaveAttribute('href', '/drives/295');
    expect(within(screen.getByTestId('fsd-attribution')).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  });

  function efficiencyInsights() {
    const insights = fsdInsights();
    insights.drive_analytics.route_efficiency = [{
      route_key: 'home-office',
      route_label: 'Home to Office',
      fsd_heavy_drive_count: 3,
      low_fsd_drive_count: 5,
      fsd_heavy_efficiency_wh_per_km: 1234.567,
      low_fsd_efficiency_wh_per_km: -12.345,
      difference_pct: -1.234,
    }];
    return insights;
  }

  it('formats SI efficiency with current distance, precision, and locale preferences', () => {
    const insights = efficiencyInsights();
    const { rerender } = render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId('fsd-route-efficiency');
    expect(within(panel).getByText('3 / 1,234.57 Wh/km')).toBeInTheDocument();
    expect(within(panel).getByText('5 / -12.35 Wh/km')).toBeInTheDocument();
    expect(within(panel).getByText('-1.23%')).toBeInTheDocument();

    display.unitPrefs = { distance: 'mi', precision: 3, locale: 'de-DE' };
    insights.drive_analytics.route_efficiency[0].difference_pct = 1.234;
    rerender(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );
    expect(within(panel).getByText('3 / 1.986,843 Wh/mi')).toBeInTheDocument();
    expect(within(panel).getByText('5 / -19,867 Wh/mi')).toBeInTheDocument();
    expect(within(panel).getByText('+1,234%')).toBeInTheDocument();
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'keeps unavailable efficiency and difference (%s) distinct from measured zero',
    (value) => {
      const insights = efficiencyInsights();
      Object.assign(insights.drive_analytics.route_efficiency[0], {
        fsd_heavy_efficiency_wh_per_km: value,
        low_fsd_efficiency_wh_per_km: value,
        difference_pct: value,
      });
      render(
        <MemoryRouter>
          <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
        </MemoryRouter>,
      );
      const panel = screen.getByTestId('fsd-route-efficiency');
      expect(within(panel).getByText('3 / Not measured')).toBeInTheDocument();
      expect(within(panel).getByText('5 / Not measured')).toBeInTheDocument();
      expect(within(panel).getByText('Not measured')).toBeInTheDocument();
      expect(within(panel).queryByText(/Wh\/|[+-]0.*%/)).not.toBeInTheDocument();
    },
  );

  it('retains measured zero efficiency and a signed zero difference', () => {
    const insights = efficiencyInsights();
    Object.assign(insights.drive_analytics.route_efficiency[0], {
      fsd_heavy_efficiency_wh_per_km: 0,
      low_fsd_efficiency_wh_per_km: 0,
      difference_pct: 0,
    });
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId('fsd-route-efficiency');
    expect(within(panel).getByText('3 / 0.00 Wh/km')).toBeInTheDocument();
    expect(within(panel).getByText('5 / 0.00 Wh/km')).toBeInTheDocument();
    expect(within(panel).getByText('+0.00%')).toBeInTheDocument();
  });

  it('renders period comparison, attribution, drives, groups, and correlation caveat', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={fsdInsights()} state={readyState} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Change from the previous period')).toBeInTheDocument();
    expect(screen.getByText('Attribution and counter resets')).toBeInTheDocument();
    expect(screen.getByText('Contributing drives')).toBeInTheDocument();
    expect(screen.getByText('Route, time, and firmware comparisons')).toBeInTheDocument();
    expect(screen.getByText('Same-route experiment')).toBeInTheDocument();
    expect(screen.getByText('Firmware spotlight')).toBeInTheDocument();
    expect(screen.getByTestId('fsd-firmware-spotlight')).toHaveAttribute('id', 'fsd-firmware-spotlight');
    expect(screen.getByText('Commute supervised identity')).toBeInTheDocument();
    expect(screen.getByTestId('fsd-commute-identity')).toBeInTheDocument();
    expect(screen.getByText('Same-route efficiency comparison')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /2026/ })).toHaveAttribute('href', '/drives/295');
    expect(screen.getAllByText('Home to Office').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026.20.3').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/correlation, not proof/i).length).toBeGreaterThan(0);
  });

  it('keeps every panel shell visible while loading', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels
          insights={undefined}
          state={{ ...readyState, isLoading: true }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Change from the previous period')).toBeInTheDocument();
    expect(screen.getByText('Attribution and counter resets')).toBeInTheDocument();
    expect(screen.getByText('Contributing drives')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(8);
  });

  it('explains when period deltas lack comparable trusted coverage', () => {
    const insights = fsdInsights();
    insights.drive_analytics.comparison.fsd_distance_change_m = null;
    insights.drive_analytics.comparison.fsd_share_change_pct_points = null;

    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    expectComparisonGroupContext('Reported FSD distance', 'Periods lack comparable trusted coverage');
    expectComparisonGroupContext('Share of observed driving', 'Share periods lack comparable trusted coverage');
  });

  it('keeps missing legacy attribution unavailable instead of showing zero', () => {
    const legacy = fsdInsights() as unknown as ReturnType<typeof fsdInsights> & {
      drive_analytics?: undefined;
    };
    delete legacy.drive_analytics;

    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={legacy} state={readyState} />
      </MemoryRouter>,
    );

    const attribution = screen.getByTestId('fsd-attribution');
    const unknown = within(attribution).getByText('Drive distance unknown').parentElement;
    expect(unknown).not.toBeNull();
    expect(within(unknown as HTMLElement).getByText('Not measured')).toBeInTheDocument();
  });

  it('exports contributing drives as SI CSV and JSON', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={fsdInsights()} state={readyState} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

    expect(downloadRowsAsCSV).toHaveBeenCalledOnce();
    const csvRows = downloadRowsAsCSV.mock.calls[0][1] as Array<{ fsd_distance_m: number }>;
    expect(csvRows[0]?.fsd_distance_m).toBe(8_000);
    expect(downloadJSON).toHaveBeenCalledOnce();
    const payload = downloadJSON.mock.calls[0][1] as { unit: string; drives: Array<{ distance_m: number }> };
    expect(payload.unit).toBe('meter');
    expect(payload.drives[0]?.distance_m).toBe(10_000);
  });

  it('pages contributing drives with the shared DataTable pagination', () => {
    const insights = structuredClone(fsdInsights());
    const seed = insights.drive_analytics.contributing_drives[0];
    insights.drive_analytics.contributing_drives = Array.from({ length: 26 }, (_, index) => ({
      ...seed,
      drive_id: 2000 + index,
      started_at: `2026-03-01T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00Z`,
    }));

    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    const panel = screen.getByTestId('fsd-contributing-drives');
    expect(within(panel).getAllByRole('link', { name: /Open drive/ })).toHaveLength(25);
    expect(within(panel).getByText('Showing 1–25 of 26')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Next page' }));
    expect(within(panel).getAllByRole('link', { name: /Open drive/ })).toHaveLength(1);
    expect(within(panel).getByText('Showing 26–26 of 26')).toBeInTheDocument();
  });

  it('pages attribution reset events with the shared pagination control', () => {
    const insights = structuredClone(fsdInsights());
    insights.drive_analytics.reset_events = Array.from({ length: 26 }, (_, index) => ({
      field: 'SelfDrivingMilesSinceReset',
      at: `2026-03-01T10:${String(index).padStart(2, '0')}:00Z`,
      previous_value_m: 9_000,
      current_value_m: 20,
      affected_drive_ids: [index + 1],
      firmware_version: null,
    }));

    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    const panel = screen.getByTestId('fsd-attribution');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(25);
    expect(within(panel).getByText('Showing 1–25 of 26')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Next page' }));
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1);
    expect(within(panel).getByText('Showing 26–26 of 26')).toBeInTheDocument();
  });

  it('disables contributing-drive export when nothing is measured', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={undefined} state={readyState} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(downloadRowsAsCSV).not.toHaveBeenCalled();
    expect(downloadJSON).not.toHaveBeenCalled();
  });

  it('shows same-route FSD share before and after the latest firmware pair', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={fsdInsights()} state={readyState} />
      </MemoryRouter>,
    );

    const spotlight = screen.getByTestId('fsd-firmware-spotlight');
    expect(within(spotlight).getByText(/2026.8.1 vs 2026.20.3/)).toBeInTheDocument();
    expect(within(spotlight).getByText('+40.00 pts')).toBeInTheDocument();
  });
});

describe('contributingDriveExportRows', () => {
  it('keeps SI meters and drops unknown FSD distance', () => {
    const rows = contributingDriveExportRows([
      {
        drive_id: 1,
        started_at: '2026-03-02T17:00:00Z',
        ended_at: '2026-03-02T17:30:00Z',
        start_place: 'Home',
        end_place: 'Office',
        distance_m: 10_000,
        energy_used_wh: 1_800,
        fsd_distance_m: 8_000,
        fsd_share_pct: 80,
        confidence: 'high',
        reset_affected: false,
        firmware_version: '2026.20.3',
        evidence: [],
        evidence_truncated: false,
      },
      {
        drive_id: 2,
        started_at: '2026-03-02T18:00:00Z',
        ended_at: null,
        start_place: null,
        end_place: null,
        distance_m: 5_000,
        energy_used_wh: null,
        fsd_distance_m: null,
        fsd_share_pct: null,
        confidence: 'unknown',
        reset_affected: false,
        firmware_version: null,
        evidence: [],
        evidence_truncated: false,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      drive_id: 1,
      distance_m: 10_000,
      fsd_distance_m: 8_000,
      firmware_version: '2026.20.3',
    });
  });
});
