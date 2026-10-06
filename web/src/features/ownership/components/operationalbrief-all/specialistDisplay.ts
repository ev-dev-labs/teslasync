import type { MetricDisplayOptions } from '@/lib/metric-reference';

export function specialistDisplay(
  formatter: (raw: number) => string,
): MetricDisplayOptions {
  return {
    formatter: (raw) => ({ value: formatter(raw), unit: '' }),
  };
}
