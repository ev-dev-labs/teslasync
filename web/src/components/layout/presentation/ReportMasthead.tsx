import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';

export function ReportMasthead() {
  const { t, i18n } = useTranslation();
  const generatedAt = useMemo(() => new Date(), []);
  const scope = useMemo(() => {
    if (typeof window === 'undefined') return '/';
    const url = new URL(window.location.href);
    url.searchParams.delete('presentation');
    url.searchParams.delete('kiosk');
    return `${url.pathname}${url.search}${url.hash}`;
  }, []);

  return (
    <header
      data-role="report-masthead"
      className="mb-6 flex flex-col gap-4 border-b border-[var(--border-default)] pb-5 sm:flex-row sm:items-end sm:justify-between"
    >
      <div>
        <Logo size={30} showWordmark />
        <Text as="p" size="sm" color="secondary" className="mt-3">
          {t(
            'presentation.report.description',
            'Operational report generated from the active TeslaSync view.',
          )}
        </Text>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="font-medium text-[var(--text-muted)]">
          {t('presentation.report.generated', 'Generated')}
        </dt>
        <dd className="text-right text-[var(--text-secondary)]">
          {formatDateTime(generatedAt, { locale: i18n.language })}
        </dd>
        <dt className="font-medium text-[var(--text-muted)]">
          {t('presentation.report.scope', 'Scope')}
        </dt>
        <dd className="max-w-80 truncate text-right text-[var(--text-secondary)]">
          {scope}
        </dd>
      </dl>
    </header>
  );
}
