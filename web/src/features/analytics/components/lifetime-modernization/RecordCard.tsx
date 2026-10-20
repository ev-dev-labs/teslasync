import type { ReactNode } from 'react';
import { Text, Caption, HelperText } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';

export function RecordCard({ title, value, date, icon }: {
  title: string; value: string; date: string | null | undefined; icon: ReactNode;
}) {
  const { formatDate: fmtDate } = useDateFormat();
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-4">
      {icon}
      <div className="min-w-0">
        <Caption>{title}</Caption>
        <Text as="p" size="lg" weight="bold" color="primary" className="break-words">{value}</Text>
        {date && <HelperText>{fmtDate(date)}</HelperText>}
      </div>
    </div>
  );
}
