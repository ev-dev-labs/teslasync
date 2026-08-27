/**
 * Deterministic chart sampling primitives.
 *
 * Sampling is a rendering optimisation only: callers must keep using their
 * complete source rows for totals, CSV export, and accessibility summaries.
 * The returned disclosure is intentionally data, rather than UI copy, so
 * products can localize its presentation at the display boundary.
 */
export interface ChartSamplingDisclosure {
  sourceCount: number;
  renderedCount: number;
  sampled: boolean;
  strategy: 'none' | 'stride';
}

export interface DownsampledChartRows<T> {
  rows: T[];
  disclosure: ChartSamplingDisclosure;
}

/**
 * Caps a chronological series while retaining first and last observations.
 * It is deterministic and allocation-bounded; a cap below two is normalized
 * to two because a line chart needs both boundary observations to honestly
 * represent its time window.
 */
export function downsampleChartRows<T>(
  rows: readonly T[] | null | undefined,
  maxPoints: number,
): DownsampledChartRows<T> {
  const source = rows ?? [];
  const cap = Math.max(2, Math.floor(Number.isFinite(maxPoints) ? maxPoints : source.length));
  if (source.length <= cap) {
    return {
      rows: [...source],
      disclosure: {
        sourceCount: source.length,
        renderedCount: source.length,
        sampled: false,
        strategy: 'none',
      },
    };
  }

  const stride = Math.ceil((source.length - 1) / (cap - 1));
  const indexes = new Set<number>();
  for (let index = 0; index < source.length - 1; index += stride) {
    indexes.add(index);
  }
  indexes.add(source.length - 1);
  const sampled = [...indexes].sort((a, b) => a - b).map((index) => source[index]);

  return {
    rows: sampled,
    disclosure: {
      sourceCount: source.length,
      renderedCount: sampled.length,
      sampled: true,
      strategy: 'stride',
    },
  };
}
