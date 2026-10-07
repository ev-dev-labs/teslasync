import type { ReactNode } from 'react';
import { Card, IconBox, MetricLabel } from '@/components/ui';
import type { NeonColor } from '@/lib/tokens';

export function LogConnectionCard({ label, icon, color = 'cyan', children }: {
  label: string; icon: ReactNode; color?: NeonColor; children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <MetricLabel className="mb-1 block break-words">{label}</MetricLabel>
          <div className="mt-0.5">{children}</div>
        </div>
        <IconBox color={color} size="sm">{icon}</IconBox>
      </div>
    </Card>
  );
}
