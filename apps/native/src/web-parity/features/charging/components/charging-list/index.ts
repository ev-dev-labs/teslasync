// Native parity port of web/src/features/charging/components/charging-list/index.ts.
//
// The web charging-list barrel re-exports ten section components (HeroGauges,
// QuickMetrics, ChartsRow, AcDcStatsPanel, BatteryLevelChart, DetailedStatistics,
// EfficiencyPanel, ChargerSpecsPanel, OptimizerSection, SessionListSection) plus
// the pure compute/* helpers and their associated types from ./helpers.
//
// In the file-by-file web-to-native conversion only the modules already ported
// into this parity tree may be re-exported here; pointing at a not-yet-ported
// sibling would break the native typecheck. BatteryLevelChart (web L5) is the
// only charging-list sibling currently present under
// apps/native/src/web-parity/features/charging/components/charging-list, so it is
// the single live re-export, mirroring the web barrel's component surface for
// that line. Every remaining web export — the other nine section components, the
// ten ./helpers compute functions, and the seven ./helpers type aliases — is
// enumerated in `nativeChargingListBarrelCapabilities.pending` with an explicit
// unavailable reason so the gap stays discoverable and the source public API
// remains documented, matching the capability-record convention used by the
// native charts and feedback barrels.
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

export { BatteryLevelChart } from './BatteryLevelChart';

export const NATIVE_CHARGING_LIST_PENDING_REASON =
  'This web charging-list export has not yet been ported into the React Native ' +
  'parity tree. It will be re-exported from this barrel once its source module ' +
  'is converted by the file-by-file web-to-native loop; until then importing it ' +
  'from the native charging-list barrel is intentionally unavailable.';

/**
 * Explicit availability record for the native charging-list barrel.
 *
 * `available` lists the web charging-list exports already ported into this
 * parity tree (and therefore re-exported above). `pending.exports` enumerates
 * every other identifier exported by
 * web/src/features/charging/components/charging-list/index.ts — the remaining
 * section components, the ./helpers compute functions, and the ./helpers type
 * aliases — that has not yet been converted. Each is intentionally absent from
 * the live re-exports until its own source module is ported, so this record
 * documents the unavailable state instead of silently dropping the symbol.
 */
export const nativeChargingListBarrelCapabilities = {
  available: ['BatteryLevelChart'],
  pending: {
    reason: NATIVE_CHARGING_LIST_PENDING_REASON,
    exports: [
      // Section components (web L1-4, L6-10)
      'HeroGauges',
      'QuickMetrics',
      'ChartsRow',
      'AcDcStatsPanel',
      'DetailedStatistics',
      'EfficiencyPanel',
      'ChargerSpecsPanel',
      'OptimizerSection',
      'SessionListSection',
      // ./helpers compute functions (web L11-22)
      'computeStats',
      'computeChargerBreakdown',
      'computeEnergyTrend',
      'computeCostByType',
      'computeStartLevelDist',
      'computeAcDcBreakdown',
      'computeEfficiencyStats',
      'computeChargerSpecs',
      'computeEnhancedStats',
      'filterAndSortSessions',
      // ./helpers type aliases (web L23-31)
      'SortKey',
      'ChargerFilter',
      'ChargingStats',
      'AcDcBreakdown',
      'EfficiencyStats',
      'ChargerSpecsData',
      'EnhancedStats',
    ],
  },
} as const;
