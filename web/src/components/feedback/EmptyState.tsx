import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      {icon && <div className="mb-4 text-[var(--text-muted)]">{icon}</div>}
      {title && <h3 className="mb-1 text-lg font-semibold text-gray-700 dark:text-[var(--text-secondary)]">{title}</h3>}
      <p className="mb-4 max-w-md text-sm text-[var(--text-muted)]">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
