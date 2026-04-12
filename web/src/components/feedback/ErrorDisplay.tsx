import { cn } from '@/lib/cn';

interface ErrorDisplayProps {
  error: Error | null;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

export function ErrorDisplay({ error, onRetry, compact, className }: ErrorDisplayProps) {
  if (!error) return null;

  return (
    <div className={cn(
      'rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20',
      compact ? 'p-3' : 'p-6',
      className,
    )}>
      <p className={cn('text-red-700 dark:text-red-300', compact ? 'text-xs' : 'text-sm')}>
        {error.message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-sm font-medium text-red-700 underline hover:text-red-800 dark:text-red-300"
        >
          Try again
        </button>
      )}
    </div>
  );
}
