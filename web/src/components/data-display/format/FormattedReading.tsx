import { Text } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';

export interface FormattedReadingOptions {
  /** Opt in to a standalone reading with a caller-localized label. */
  label?: string;
  className?: string;
}

export function FormattedReading({
  label,
  className,
  children,
  title,
}: FormattedReadingOptions & { children: string; title?: string }) {
  if (!label) return <span className={className} title={title}>{children}</span>;

  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-shape-sm border border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-2">
      <Text size="sm" color="secondary" className="min-w-0 [overflow-wrap:anywhere]">{label}</Text>
      <Text size="lg" weight="semibold" color="primary" title={title} className={cn('min-w-0 tabular-nums [overflow-wrap:anywhere]', className)}>
        {children}
      </Text>
    </span>
  );
}
