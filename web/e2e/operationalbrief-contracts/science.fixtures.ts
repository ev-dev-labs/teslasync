import type {
  ScienceElectrochem,
  ScienceNotebook,
  ScienceNotebookEntry,
  ScienceThermal,
  ScienceTires,
  ScienceWeather,
} from '../../src/api/types';

export const SCIENCE_START = '2026-08-19T16:00:00.000Z';
export const SCIENCE_END = '2026-08-26T16:00:00.000Z';
export const SCIENCE_ROUTE = `/science?vehicle_id=7&days=7&start=${SCIENCE_START}&end=${SCIENCE_END}`;

const envelope = { vehicle_id: 7, start: SCIENCE_START, end: SCIENCE_END };

export const electrochemFixture: ScienceElectrochem = {
  ...envelope,
  ocv_points: [
    { at: '2026-08-20T08:00:00.000Z', ocv_pack_v: 400, soc_pct: 60, temp_c: 20, direction: 'discharge_rest', dwell_s: 1200, energy_wh: 45000, brick_spread_mv: 8 },
    { at: '2026-08-21T08:00:00.000Z', ocv_pack_v: 401, soc_pct: 62, temp_c: 25, direction: 'charge_rest', dwell_s: 1800, energy_wh: 46500, brick_spread_mv: null },
  ],
  ocv_bins: [
    { soc_lo_pct: 60, soc_hi_pct: 70, temp_lo_c: 20, temp_hi_c: 30, n: 2, mean_ocv_v: 400.5, slope_v_per_pct: null, unknown: true },
  ],
  hysteresis: [
    { soc_lo_pct: 60, soc_hi_pct: 70, temp_lo_c: 20, temp_hi_c: 30, n_charge: 1, n_discharge: 1, delta_v: null, unknown: true },
  ],
  ir_points: [
    { at: '2026-08-20T09:00:00.000Z', ir_pack_ohm: 0.05, temp_c: 20, soc_pct: 60, delta_i_a: 20, delta_v_v: 1, dt_s: 5, context: 'drive_step' },
    { at: '2026-08-21T09:00:00.000Z', ir_pack_ohm: 0.052, temp_c: 25, soc_pct: 62, delta_i_a: 25, delta_v_v: 1.3, dt_s: 5, context: 'drive_step' },
  ],
  pulse_ir: [
    { at: '2026-08-22T09:00:00.000Z', ir_pack_ohm: 0.048, temp_c: 30, soc_pct: 65, delta_i_a: 20, delta_v_v: 0.96, dt_s: 5, context: 'charge_step' },
  ],
  arrhenius: {
    n: 12, slope: 1000, intercept: -6.4, r2: 0.9, se_slope: 100,
    ci95_low: 800, ci95_high: 1200, ci_method: 'ols_t',
    ea_j_per_mol: 8314, ea_ci95_low: 6651.2, ea_ci95_high: 9976.8,
    temp_bins: 3, temp_span_c: 10, unknown: false,
    honesty: 'Synthetic source fit: ln(IR) vs 1/T; interval is not a causal guarantee.',
  },
  aging: {
    nominal_pack_wh: 75000, nominal_pack_source: 'assumed_reference_not_vehicle_capacity',
    throughput_wh: 50000, equiv_full_cycles: 2 / 3, rest_hours: 40, high_soc_rest_hours: 5,
    proxy_slope_wh_per_day: -12, proxy_ci95_low: -20, proxy_ci95_high: -4,
    proxy_n: 6, holdout_rmse_wh: 250, unknown: false,
    honesty: 'Synthetic source exposure is descriptive, not an identified aging split.',
  },
  capacity_proxy_wh: 72000, capacity_proxy_unknown: false,
  firmware_epoch: '2026.24.3', pooled_epochs: false,
  signals_used: ['PackVoltage', 'PackCurrent'],
  missing_signals: ['cell_voltage_per_cell'],
  truncated: true,
  honesty: 'Synthetic pack-equivalent observations, not cell diagnostics or a health score.',
};

export const thermalFixture: ScienceThermal = {
  ...envelope,
  start: '2026-08-20T00:00:00.000Z',
  end: '2026-08-22T00:00:00.000Z',
  fits: [
    { start: '2026-08-20T00:00:00.000Z', end: '2026-08-20T06:00:00.000Z', kind: 'pack_cooldown', tau_s: 1800, tau_ci95_low: 1700, tau_ci95_high: 1900, t_inf_c: 15, n: 25, r2: 0.99, residual_rmse_c: 0.3, solar_unknown: true, unknown: false },
    { start: '2026-08-21T00:00:00.000Z', end: '2026-08-21T01:00:00.000Z', kind: 'cabin_cooldown', tau_s: null, tau_ci95_low: null, tau_ci95_high: null, t_inf_c: null, n: 2, r2: null, residual_rmse_c: null, solar_unknown: true, unknown: true },
  ],
  signals_used: ['ModuleTempMax'], missing_signals: ['irradiance'],
  truncated: false,
  honesty: 'Synthetic lumped-capacity fit; solar input remains unknown.',
};

export const weatherFixture: ScienceWeather = {
  ...envelope,
  start: '2026-08-20T00:00:00.000Z',
  points: Array.from({ length: 6 }, (_, index) => ({
    drive_id: 101 + index, at: `2026-08-${20 + index}T08:00:00.000Z`,
    lat: 37, lon: -122, temp_c: 15 + index, pressure_hpa: 1013,
    wind_mps: 3, precip_mm: 0, density_kg_m3: 1.225,
    residual_wh_per_m: 0.16 + index * 0.01, session_wh_per_m: 0.17 + index * 0.01,
  })),
  density_r: 0, wind_r: null, rain_n: 0, dry_n: 6, weather_unknown: false,
  signals_used: ['open_meteo_archive'], missing_signals: ['wind_variation'],
  honesty: 'Synthetic matched-drive association, never proof of causation.',
};

export const tiresFixture: ScienceTires = {
  ...envelope,
  fl_kpa: 290, fr_kpa: 292, rl_kpa: 288, rr_kpa: 291, imbalance_kpa: 4,
  recommended_kpa: 310, underinflation_frac: 0.07,
  extra_wh: 350, extra_model_low: 180, extra_model_high: 520, distance_m: 500000,
  unknown: false, signals_used: ['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr'],
  honesty: 'Synthetic TPMS as recorded; rolling energy is a labeled model, not measured loss.',
};

const notebookEntry: ScienceNotebookEntry = {
  ...envelope,
  id: 'electrochem.ocv:7:synthetic', domain: 'electrochem',
  hypothesis: 'Synthetic rest-voltage observations map SOC.',
  firmware_epoch: '2026.24.3', n: 2, method: 'rest_ocv_binned', ci_method: 'none',
  parameters: { mean_pack_voltage_v: 400.5 },
  holdout_frac: null, holdout_rmse: null, residual_mean: null, residual_rmse: null,
  signals_used: ['PackVoltage'], missing_signals: ['cell_voltage_per_cell'],
  unknown: false, honesty: 'Synthetic descriptive record; missing intervals and holdouts remain unknown.',
};

export const notebookFixture: ScienceNotebook = {
  ...envelope,
  entries: [
    notebookEntry,
    { ...notebookEntry, id: 'thermal.tau:7:synthetic', domain: 'thermal', hypothesis: 'Synthetic park cooldown.', method: 'lumped_exponential', n: 25 },
    { ...notebookEntry, id: 'weather.wind:7:synthetic', domain: 'weather', hypothesis: 'Synthetic wind fit unavailable.', method: 'pearson_r', n: 6, unknown: true },
  ],
  honesty: 'Synthetic attempted analyses, not a persisted experiment notebook.',
};

// Go nil slices serialize as null. Null nested objects additionally preserve
// the existing ScienceLabPage defensive regression, not a valid Go value struct.
type NullableLists<T> = {
  [K in keyof T]: NonNullable<T[K]> extends readonly unknown[] ? T[K] | null : T[K];
};
export type ElectrochemWire = Omit<NullableLists<ScienceElectrochem>, 'arrhenius' | 'aging'> & {
  arrhenius: ScienceElectrochem['arrhenius'] | null;
  aging: ScienceElectrochem['aging'] | null;
};
export interface ScienceResponses {
  electrochem: ElectrochemWire | null;
  thermal: NullableLists<ScienceThermal> | null;
  weather: NullableLists<ScienceWeather> | null;
  tires: NullableLists<ScienceTires> | null;
  notebook: NullableLists<ScienceNotebook> | null;
}
export type ScienceDomain = keyof ScienceResponses;
export type ScienceCase = 'populated' | 'zero' | 'nil-ledgers' | 'source-unknown';

export const SCIENCE_DOMAINS: readonly ScienceDomain[] = [
  'electrochem', 'thermal', 'weather', 'tires', 'notebook',
];

export function scienceResponses(mode: ScienceCase): ScienceResponses {
  const reports: ScienceResponses = {
    electrochem: electrochemFixture, thermal: thermalFixture,
    weather: weatherFixture, tires: tiresFixture, notebook: notebookFixture,
  };
  if (mode === 'zero') {
    reports.electrochem = {
      ...electrochemFixture, ocv_points: [], ir_points: [], pulse_ir: [], truncated: false,
      aging: { ...electrochemFixture.aging, throughput_wh: 0, rest_hours: 0, proxy_slope_wh_per_day: 0, holdout_rmse_wh: 0 },
      capacity_proxy_wh: 0,
    };
    reports.tires = {
      ...tiresFixture, fl_kpa: 0, fr_kpa: null, rl_kpa: 300, rr_kpa: null,
      imbalance_kpa: 0, underinflation_frac: 0, extra_wh: 0,
      extra_model_low: 0, extra_model_high: 0,
    };
    reports.weather = { ...weatherFixture, density_r: 0, wind_r: null };
  } else if (mode === 'nil-ledgers') {
    reports.electrochem = {
      ...electrochemFixture, ocv_points: null, ocv_bins: null, hysteresis: null,
      ir_points: null, pulse_ir: null, arrhenius: null, aging: null,
      signals_used: null, missing_signals: null, capacity_proxy_wh: null,
      capacity_proxy_unknown: true, truncated: false,
    };
    reports.thermal = { ...thermalFixture, fits: null, signals_used: null, missing_signals: null };
    reports.weather = { ...weatherFixture, points: null, density_r: null, wind_r: null, rain_n: 0, dry_n: 0, weather_unknown: true, signals_used: null, missing_signals: null };
    reports.tires = { ...tiresFixture, fl_kpa: null, fr_kpa: null, rl_kpa: null, rr_kpa: null, imbalance_kpa: null, underinflation_frac: null, extra_wh: null, extra_model_low: null, extra_model_high: null, unknown: true, signals_used: null, missing_signals: null };
    reports.notebook = { ...notebookFixture, entries: null };
  } else if (mode === 'source-unknown') {
    reports.electrochem = { ...electrochemFixture, capacity_proxy_unknown: true };
    reports.tires = { ...tiresFixture, unknown: true };
    reports.weather = { ...weatherFixture, weather_unknown: true };
  }
  return reports;
}
