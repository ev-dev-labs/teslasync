import type { ReactNode } from 'react';
import { GlassPanel } from '@/components/ui';

interface StatBoxProps {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  glow?: 'cyan' | 'green' | 'purple';
}

export function StatBox({ icon, label, value, sub, glow }: StatBoxProps) {
  return (
    <GlassPanel glow={glow ?? 'none'} hover className="p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-[var(--surface-2)] p-2">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-[var(--text-muted)]">{label}</p>
          <p className="mt-0.5 text-lg font-semibold text-white">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</p>}
        </div>
      </div>
    </GlassPanel>
  );
}
