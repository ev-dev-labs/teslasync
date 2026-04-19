import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/feedback/Skeleton';
import { cn } from '@/lib/cn';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: React.ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; value: string; positive?: boolean };
  sublabel?: string;
  loading?: boolean;
  className?: string;
}

export function StatCard({ label, value, unit, icon, trend, sublabel, loading, className }: StatCardProps) {
  if (loading) {
    return (
      <Card className={className}>
        <Skeleton width="60%" height={16} />
        <Skeleton width="40%" height={32} className="mt-2" />
      </Card>
    );
  }

  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold">{value}</span>
        {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </div>
      {trend && (
        <div className={cn('flex items-center gap-1 text-xs',
          trend.positive ? 'text-green-600' : trend.direction === 'flat' ? 'text-gray-500' : 'text-red-600',
        )}>
          <span>{trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '—'}</span>
          <span>{trend.value}</span>
        </div>
      )}
      {sublabel && (
        <span className="text-xs text-gray-500 dark:text-gray-400">{sublabel}</span>
      )}
    </Card>
  );
}
