import { typography } from '@/lib/tokens';

/** Dashboard content is hosted by the canvas panel; these tokens add no card chrome. */
export const dashboardTokens = {
  shell: 'relative flex h-full min-w-0 flex-col',
  header: 'flex w-full shrink-0 flex-col pl-4 pr-4 pb-2 pt-3',
  title: `${typography.size.sm} ${typography.weight.semibold} ${typography.color.primary} leading-snug`,
  description: `${typography.role.bodySm} mt-1 break-words leading-snug`,
  // One horizontal inset token (p-4) shared with header/footer; the body owns
  // the widget scroll boundary (vertical only, inside the padding) and wraps
  // descendant text at spaces via the inherited break-words.
  body: '@container min-w-0 flex-1 min-h-0 overflow-x-clip overflow-y-auto break-words [&>*]:min-w-0',
  footer: 'shrink-0 border-t border-[var(--border-subtle)] px-4 py-2',
  metric: `${typography.size['2xl']} ${typography.weight.semibold} ${typography.color.primary} tabular-nums leading-tight`,
  secondaryMetric: `${typography.size.lg} ${typography.weight.semibold} ${typography.color.primary} tabular-nums leading-tight`,
  metricLabel: `${typography.role.bodySm} break-words leading-snug`,
  unit: `${typography.role.caption} shrink-0`,
  stat: '!min-h-0 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none [&_.text-2xl]:text-xl [&_.text-2xl]:font-semibold',
  columns: {
    1: 'grid-cols-1',
    2: 'grid-cols-1 @xs:grid-cols-2',
    3: 'grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3',
    4: 'grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-4',
  },
  /**
   * Compact density tier for the redesign (design contract MDC-014 compact:
   * 32px row, 8px gap, 13px text). Values mirror the After cards in
   * `docs/widget-redesign/widgets-compare.html`: 13px base text, 8px row
   * rhythm, 10px row gaps, 8px grid gaps, 12px section rhythm, 14/12px stat
   * grid gaps. All utilities already exist in the repo.
   */
  density: {
    /** Compact widget body text (After base 13px). */
    text: 'text-[13px]',
    /** 32px minimum row height (After `.row`, `.check`). */
    row: 'min-h-8',
    /** 10px gap between a row's dot/icon, body and trailing value. */
    rowGap: 'gap-2.5',
    /** 8px vertical rhythm inside rows (`padding: 8px 0`). */
    rowPadding: 'py-2',
    /** 10/8px padding for status cells, tips and link tiles. */
    itemPadding: 'px-2.5 py-2',
    /** 8px default grid gap (status grid, buttons, links, chips wrap). */
    gridGap: 'gap-2',
    /** 12px rhythm between sections (After `.mt`). */
    sectionGap: 'gap-3',
    /** 14px column / 12px row stat grid gaps (After `.stats`). */
    statGap: 'gap-x-3.5 gap-y-3',
  },
  /**
   * Named shape-scale mapping for widget bodies (Tailwind `rounded-shape-*`
   * backed by `--radius-*` in `index.css`, i.e. contract MDC-015:
   * xs 4 / sm 6 / md 8 / lg 10 / xl 14, pill 9999px). Card chrome stays owned
   * by `WidgetShell`; `card` is exposed so inner surfaces can align to it.
   */
  radius: {
    /** 14px panel corners (After `.w`; shell-owned chrome). */
    card: 'rounded-shape-xl',
    /** 10px inner surfaces: status cells, tips, buttons, link tiles. */
    inner: 'rounded-shape-lg',
    /** 6px small controls: meter track/fill, limit marker. */
    control: 'rounded-shape-sm',
    /** Pills, chips and status dots. */
    pill: 'rounded-pill',
  },
  /** Shared calm categorical chart palette, kept separate from UI accents. */
  chart: {
    series: [
      'light-dark(#398ad6, #67aaed)',
      'light-dark(#18a7a1, #52bfb9)',
      'light-dark(#4fa866, #73bb83)',
      'light-dark(#b8790e, #e7b369)',
      'light-dark(#e57255, #ee8f63)',
      'light-dark(#cd6199, #e98092)',
      'light-dark(#876cca, #a48fe1)',
      'light-dark(#748192, #8c9aab)',
    ],
    seriesLight: ['#398ad6', '#18a7a1', '#4fa866', '#b8790e', '#e57255', '#cd6199', '#876cca', '#748192'],
    seriesDark: ['#67aaed', '#52bfb9', '#73bb83', '#e7b369', '#ee8f63', '#e98092', '#a48fe1', '#8c9aab'],
    /** Series index by hue name, so widgets pick color by meaning not slot. */
    seriesByName: {
      blue: 0,
      teal: 1,
      violet: 2,
      amber: 3,
      pink: 4,
    },
    /** Status foreground + soft-surface pairs (After `--ok/warn/bad/acc`). */
    status: {
      ok: {
        foreground: 'light-dark(#16a34a, #22c55e)',
        soft: 'light-dark(#dcfce7, #123220)',
      },
      warn: {
        foreground: 'light-dark(#d97706, #f59e0b)',
        soft: 'light-dark(#fef3c7, #3a2a0b)',
      },
      bad: {
        foreground: 'light-dark(#dc2626, #f87171)',
        soft: 'light-dark(#fee2e2, #3b1717)',
      },
      info: {
        foreground: 'light-dark(#2563eb, #60a5fa)',
        soft: 'light-dark(#dbeafe, #172a46)',
      },
    },
    /** Meter/bar track (After `--track`). */
    track: 'light-dark(#eceef1, #252a32)',
    /** Chart gridlines (After `--line2`). */
    grid: 'light-dark(#eef0f3, #20242c)',
    /** Tertiary annotation text (After `--faint`). */
    faint: 'light-dark(#9ca3af, #6b7280)',
    /** Bar corner radius in px (After bars `rx`). */
    barRadius: 3,
    /** Heat-map cell corner radius in px. */
    cellRadius: 2,
    /** Stacked-strip segment corner radius in px. */
    stripRadius: 5,
    /** Meter track height in px (After `.meter`). */
    meterHeight: 8,
    /** Emphasised meter track height in px (After `.meter.thick`). */
    meterHeightThick: 12,
  },
  /**
   * Motion budget (contract MDC-016/MDC-042): feedback only, never ambient
   * loops. No animate tokens are provided on purpose — decorative loops such
   * as flow dashes must be wrapped in `motion-safe:` by the consumer and fall
   * back to a static value under `useMotionPreference()` / reduced motion.
   */
  motion: {
    transition: 'transition-colors duration-fast motion-reduce:transition-none',
  },
} as const;

/** Theme mode accepted by {@link resolveDashboardSeriesColor}. */
export type DashboardChartMode = 'light' | 'dark';

/**
 * Resolve one categorical series color to its per-mode hex, cycling through
 * the five After hues. Pure helper for JS-computed paints that cannot consume
 * the `light-dark()` strings in {@link dashboardTokens.chart.series}.
 */
export function resolveDashboardSeriesColor(index: number, mode: DashboardChartMode): string {
  const palette =
    mode === 'dark' ? dashboardTokens.chart.seriesDark : dashboardTokens.chart.seriesLight;
  const slot = ((index % palette.length) + palette.length) % palette.length;
  return palette[slot];
}
