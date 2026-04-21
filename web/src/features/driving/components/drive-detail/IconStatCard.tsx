import { GlassPanel } from '@/components/ui';
import type { LucideIcon } from 'lucide-react';

interface IconStatCardProps {
  icon: LucideIcon;
  color: string;
  value: React.ReactNode;
  label: string;
}

export function IconStatCard({ icon: Icon, color, value, label }: IconStatCardProps) {
  return (
    <GlassPanel className="p-4 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1" style={{ color }} />
      <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
    </GlassPanel>
  );
}
