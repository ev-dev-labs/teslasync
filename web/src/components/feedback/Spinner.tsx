import { cn } from '@/lib/cn';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2', className)} role="status" aria-label={label ?? 'Loading'}>
      <div className={cn('animate-spin rounded-full border-4 border-blue-600 border-t-transparent', sizeMap[size])} />
      {label && <span className="text-sm text-gray-500">{label}</span>}
    </div>
  );
}
