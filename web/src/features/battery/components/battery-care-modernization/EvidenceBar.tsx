import { MetricBar } from '@/components/data-display';
import { Text } from '@/components/ui';

interface EvidenceBarProps {
  label: string;
  value: number | null;
  max: number;
  color: string;
  sublabel: string;
}

/** Unknown deductions/shares are not rendered as a healthy zero-length bar. */
export function EvidenceBar({ label, value, max, color, sublabel }: EvidenceBarProps) {
  return value == null ? (
    <div
      data-app-part="card metric"
      data-app-metric="tile"
      data-app-state="missing"
      data-surface-variant="standalone"
      className="min-w-0 space-y-1 rounded-lg border border-[var(--border-subtle)] p-3"
    >
      <Text as="p" variant="bodySm" data-app-part="metric-label">{label}</Text>
      <Text as="p" variant="caption" data-app-part="metric-context">{sublabel}</Text>
      <Text as="p" variant="metricValue" data-app-part="metric-reading metric-value">—</Text>
    </div>
  ) : (
    <MetricBar label={label} value={value} max={max} color={color} fill="solid" sublabel={sublabel} />
  );
}
