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
    <div className="min-w-0 space-y-1 rounded-lg border border-[var(--border-subtle)] p-3">
      <Text as="p" variant="bodySm">{label}</Text>
      <Text as="p" variant="caption">{sublabel}</Text>
      <Text as="p" variant="metricValue">—</Text>
    </div>
  ) : (
    <MetricBar label={label} value={value} max={max} color={color} sublabel={sublabel} />
  );
}
