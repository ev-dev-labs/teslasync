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
      {icon && <div className="mb-4 text-gray-400">{icon}</div>}
      {title && <h3 className="mb-1 text-lg font-semibold text-gray-700 dark:text-gray-300">{title}</h3>}
      <p className="mb-4 max-w-md text-sm text-gray-500">{message}</p>
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
