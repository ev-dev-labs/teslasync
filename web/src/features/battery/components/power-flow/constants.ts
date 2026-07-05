/**
 * Power Flow Dashboard — shared constants.
 *
 * The colour palette encodes each energy source with a real-world mnemonic
 * (solar→amber, battery→emerald, grid→purple, home→blue) so the stacked
 * area chart, flow arrows, and SOC line all stay visually consistent. These
 * hexes feed recharts `stroke`/`fill` and dynamic gauge colours — they are
 * chart-layer values, never inline text styles. Frozen so the shared palette
 * cannot be mutated in place by a sub-component that reads from it.
 */
export const FLOW_COLORS = Object.freeze({
  solar: '#f59e0b',
  battery: '#22c55e',
  grid: '#a855f7',
  home: '#3b82f6',
  soc: '#22c55e',
} as const);

/**
 * RangePicker presets exposed on the history toolbar. Every id MUST resolve to
 * a known preset in `@/lib/datePresets` (RangePicker looks each one up); frozen
 * so the shared toolbar list stays a single immutable source.
 */
export const PRESET_IDS = Object.freeze(['today', 'yesterday', '7d', '30d', '90d', 'mtd', 'ytd'] as const);

/**
 * Fixed Tesla Energy site id. A future picker can select from multiple sites;
 * kept as a constant so every sub-component reads the same source.
 */
export const DEFAULT_SITE_ID = 1;
