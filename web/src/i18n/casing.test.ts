import { describe, expect, it } from 'vitest';
import catalog from './en.json';

describe('English presentation casing', () => {
  it('provides driving evidence and vehicle health labels without overstating telemetry', () => {
    expect(catalog.widget).toMatchObject({
      speedHeatmap: { sampleScope: 'Recorded drive averages by start time · up to 200 drives' },
      drivingDynamics: {
        partialPeaks: 'Partial peak readings',
        unknown: 'Unknown dynamics',
        distributionError: 'Acceleration distribution unavailable',
        distributionLoading: 'Loading acceleration distribution',
        distributionEmpty: 'No acceleration samples yet',
      },
      speedProfile: {
        sampleScope: 'Observed speed samples · average power is not energy efficiency',
        averagePower: 'Average power',
        lowestPowerRange: 'Lowest power range',
        chartAria: 'Speed frequency and average power by speed range',
      },
      driveTelemetry: {
        sampleScope: 'Latest drive · recorded samples may contain gaps',
        powerLabel: 'Power',
        telemetryLoading: 'Loading drive telemetry',
        telemetryError: 'Drive telemetry unavailable',
      },
      reported: 'Reported',
      digitalTwinWindows: 'Windows',
      unknownVehicle: 'Unknown vehicle',
      drivetrainHealth: {
        statusGood: 'Healthy',
        statusWarning: 'Warning',
        statusCritical: 'Critical',
        statusUnknown: 'Unknown',
        assessment: 'Assessment',
        rearMotorTemp: 'Rear motor temp',
        assessmentCaveat: 'Assessment from available telemetry; not a mechanical inspection.',
      },
      watchState: { online: 'Online', asleep: 'Asleep', offline: 'Offline' },
      maintenance: {
        configuredInterval: 'Configured interval',
        intervalCaveat: 'Intervals are recommendations, not time remaining.',
        shortestInterval: 'Shortest configured interval',
        forecastStatus: 'Maintenance forecast status',
        dailyDistance: 'Daily distance',
        dayUnit: 'day',
        forecastCaveat: 'Forecast depends on recorded service history and mileage.',
        forecastVehicle: 'Forecast vehicle',
        estimated: 'Estimated',
      },
      warranty: {
        coverageCaveat: 'Cached warranty information; coverage ends at the first time or mileage limit. Confirm terms with Tesla.',
      },
    });
  });

  it('provides energy widget chart descriptions and explicit loaded-record scope', () => {
    expect(catalog.widget.energyStats.co2Estimate).toBe('CO₂ savings are estimated.');
    expect(catalog.widget.energyStats.chartAria).toBe('Daily driving energy usage');
    expect(catalog.widget.powerFlowHistory.avgNetGrid).toBe('Avg net grid');
    expect(catalog.widget.powerFlowHistory.chartAria).toBe(
      'Solar, battery, grid, and home power over the last 24 hours',
    );
    expect(catalog.widget.solarProduction.total30dSentence).toBe('30-day total');
    expect(catalog.widget.solarProduction.chartLabel).toBe('Daily solar production over the last 30 days');
    expect(catalog.widget.wallConnector).toMatchObject({
      monthLoaded: 'This month (loaded)',
      loadedWindow: 'Totals cover loaded records from the last 14 days.',
      title: 'Wall connector',
      noData: 'No wall connector data',
      chartLabel: 'Daily wall connector charging energy over the last 14 days',
    });
    const siteLabels = Object.values(catalog.widget)
      .flatMap(value => typeof value === 'object' && 'noSite' in value ? [value.noSite] : []);
    expect(siteLabels).toHaveLength(6);
    expect(siteLabels.every(label => label === 'No Tesla energy site linked')).toBe(true);
  });

  it('provides notebook matrix labels while preserving named Tesla modes', () => {
    expect(catalog.science.notebook.parameters).toBe('Parameters');
    expect(catalog.science.notebook.ci).toBe('Confidence intervals');
    expect(catalog.commands.climate.dogMode).toBe('Dog Mode');
    expect(catalog.commands.climate.campMode).toBe('Camp Mode');
  });

  it('provides driving and charging chart descriptions and context-aware labels', () => {
    expect(catalog.widget.monthlyMileage.chartAria).toBe('Distance driven by month');
    expect(catalog.widget.driveEfficiencyChart.chartAria).toBe('Daily and seven-day rolling drive efficiency');
    expect(catalog.widget.chargingSessionDetail.chartAria).toBe(
      'Charging power and battery state of charge over the latest session',
    );
    expect(catalog.widget.chargingSessionDetail.noTelemetry).toBe(
      'No charging telemetry is available for this session',
    );
    expect(catalog.widget.chargeHistory.chartLabel).toBe(
      'Energy added per recent charge session, in kilowatt-hours',
    );
    expect(catalog.widget.chargingSessionDetail.soc).toBe('SOC %');
    expect(catalog.widget.chargingTelemetry.charger).toBe('charger');
  });

  it('provides dashboard leaf labels with their authored fallbacks and interpolation', () => {
    expect(catalog.widget.forecast).toMatchObject({
      accelerated: 'Accelerated',
      healthy: 'Healthy',
      horizon: '1 / 3 / 5-year outlook',
      normal: 'Normal',
      years: '{{n}} yr',
    });
    expect(catalog.widget.projectedRange.rangeComparison).toBe('Projected range vs EPA rated');
    expect(catalog.widget.loadError).toBe('Failed to load vehicle');
  });

  it('provides schema column labels and authored event acronyms', () => {
    expect(catalog.common.name).toBe('Name');
    expect(catalog.common.type).toBe('Type');
    expect(catalog.common.description).toBe('Description');
    expect(catalog.notifications.report.values['system.mqtt.outage']).toBe('System MQTT outage');
    expect(catalog.notifications.report.values['system.tesla_api.recovery']).toBe('System Tesla API recovery');
  });

  it('provides authored widget status labels for non-color status indicators', () => {
    expect(catalog.widget.statusGrid.noData).toBe('No status data available');
    expect(catalog.widget.status).toEqual({
      ok: 'Healthy',
      warning: 'Warning',
      error: 'Error',
      inactive: 'Inactive',
      unknown: 'Unknown',
    });
  });

  it('uses sentence case for navigation, table headings, and drive details', () => {
    expect(catalog.nav.items.battery).toBe('Battery health');
    expect(catalog.charging.detail.energyAdded).toBe('Energy added');
    expect(catalog.drives.title).toBe('Drive history');
    expect(catalog.driveDetail.title).toBe('Drive details');
    expect(catalog.driveDetail.costSavings).toBe('Cost & savings');
  });

  it('preserves brands, official products, acronyms, and canonical display units', () => {
    expect(catalog.statusBar.help.about).toBe('About TeslaSync');
    expect(catalog.commands.climate.dogMode).toBe('Dog Mode');
    expect(catalog.digitalTwin.sentryMode).toBe('Sentry Mode');
    expect(catalog.charging.sessions.exportJson).toBe('JSON');
    expect(catalog.analytics.charging.avgPowerkW).toBe('Avg power (kW)');
    expect(catalog.dataRepair.field.energyWh).toBe('Energy added (Wh)');
    expect(catalog.paint.pearlWhite).toBe('Pearl White Multi-Coat');
  });

  it('does not alter interpolation or technical names in sentence bodies', () => {
    expect(catalog.table.filter.column).toBe('Filter {{column}}');
    expect(catalog.common.emptyResultsForTitle).toBe('No {{title}} found.');
    expect(catalog.help.fields.channels.hmacSecret).toContain('X-TeslaSync-Signature');
    expect(catalog.ai.settings.provider.azureProtocolHint).toContain('Chat Completions');
  });

  it('uses generic rows while keeping invalid and stale saved filter messages explicit', () => {
    expect(catalog.table.filter.unavailableValues).toBe(
      'Some saved selections are not present in the loaded rows. Clear the filter to reset them.',
    );
    expect(catalog.table.filter.invalidValues).toBe(
      'This saved value filter is invalid. Clear it to reset.',
    );
  });

  it('stores sentence-position severity labels without runtime lowercasing', () => {
    expect(catalog.notifications.bellPopover.sentenceCritical).toBe('critical');
    expect(catalog.notifications.bellPopover.sentenceWarning).toBe('warning');
    expect(catalog.notifications.bellPopover.sentenceInfo).toBe('info');
    expect(catalog.notifications.bellPopover.filterWarning).toBe('Warning');
  });
});
