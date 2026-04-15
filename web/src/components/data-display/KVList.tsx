import { cn } from '@/lib/cn';

interface KVItem {
  label: string;
  value: React.ReactNode;
}

interface KVListProps {
  items: KVItem[];
  columns?: 1 | 2;
  className?: string;
}

export function KVList({ items, columns = 1, className }: KVListProps) {
  return (
    <dl className={cn(
      'divide-y divide-gray-200 dark:divide-gray-700',
      columns === 2 && 'grid grid-cols-2 gap-x-6',
      className,
    )}>
      {items.map((item) => (
        <div key={item.label} className="flex justify-between py-2">
          <dt className="text-sm text-gray-500 dark:text-gray-400">{item.label}</dt>
          <dd className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
