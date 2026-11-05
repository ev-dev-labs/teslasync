import { useTranslation } from 'react-i18next';
import { Button, Text } from '@/components/ui';
import type { NotificationLog } from '@/api/types';
import { cn } from '@/lib/cn';

interface Props {
  log: NotificationLog;
  onActivate: (log: NotificationLog) => void;
}

export function NotificationInboxSummary({ log, onActivate }: Props) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-2">
      <Button type="button" variant="ghost"
        className="!h-auto !min-h-11 xl:!min-h-9 w-full !justify-start !px-0 !py-1 text-left"
        onClick={() => onActivate(log)}
        aria-label={t('notifications.inbox.row.open', 'Open notification: {{title}}', { title: log.title || '—' })}>
        <Text as="span" variant="bodySm" className={cn('line-clamp-2 break-words',
          log.read_at ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]')}>
          {log.title || '—'}
        </Text>
      </Button>
    </div>
  );
}
