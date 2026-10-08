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
      className="mb-6 flex min-w-0 flex-col gap-4 border-b border-[var(--border-default)] pb-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between"
    >
      <div className="min-w-0 flex-1 basis-full sm:basis-64">
        <Logo size={30} showWordmark />
        <Text as="p" variant="bodySm" className="mt-3 break-words">
          {t(
            'presentation.report.description',
            'Operational report generated from the active TeslaSync view.',
          )}
        </Text>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-1 sm:max-w-80 sm:grid-cols-2">
        <Text as="dt" variant="label" className="break-words">
          {t('presentation.report.generated', 'Generated')}
        </Text>
        <Text as="dd" size="xs" color="secondary" className="min-w-0 break-words text-start sm:text-end">
          {formatDateTime(generatedAt, { locale: i18n.language })}
        </Text>
        <Text as="dt" variant="label" className="break-words">
          {t('presentation.report.scope', 'Scope')}
        </Text>
        <Text as="dd" size="xs" color="secondary" className="min-w-0 break-all text-start sm:text-end">
          {scope}
        </Text>
      </dl>
    </header>
  );
}
