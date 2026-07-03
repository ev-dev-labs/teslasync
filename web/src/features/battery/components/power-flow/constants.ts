/**
 * Power Flow Dashboard — shared constants.
 *
 * The colour palette encodes each energy source with a real-world mnemonic
 * (solar→amber, battery→emerald, grid→purple, home→blue) so the stacked
 * area chart, flow arrows, and SOC line all stay visually consistent. These
 * hexes feed recharts `stroke`/`fill` and dynamic gauge colours — they are
 * chart-layer values, never inline text styles.
 */
export const FLOW_COLORS = {
  solar: '#f59e0b',
  battery: '#22c55e',
  grid: '#a855f7',
  home: '#3b82f6',
  soc: '#22c55e',
} as const;

/** RangePicker presets exposed on the history toolbar. */
export const PRESET_IDS = ['today', 'yesterday', '7d', '30d', '90d', 'mtd', 'ytd'] as const;

/**
 * Fixed Tesla Energy site id. A future picker can select from multiple sites;
 * kept as a constant so every sub-component reads the same source.
 */
export const DEFAULT_SITE_ID = 1;
