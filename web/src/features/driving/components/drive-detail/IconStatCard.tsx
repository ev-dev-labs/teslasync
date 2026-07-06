import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { GlassPanel, Text } from '@/components/ui';

interface IconStatCardProps {
  icon: LucideIcon;
  color: string;
  value: ReactNode;
  label: string;
}

export function IconStatCard({ icon: Icon, color, value, label }: IconStatCardProps) {
  // Callers derive `value` from optional telemetry (e.g. an <AnimatedNumber> or a
  // formatted string that can be absent). Fall back to an em-dash so the figure
  // is never a blank gap; the nullish check preserves a legitimate 0/false node.
  const displayValue = value ?? '—';
  return (
    <GlassPanel className="p-4 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1" style={{ color }} aria-hidden="true" />
      <Text as="p" size="lg" weight="bold" color="primary">
        {displayValue}
      </Text>
      <Text as="p" size="2xs" color="muted">
        {label}
      </Text>
    </GlassPanel>
  );
}
