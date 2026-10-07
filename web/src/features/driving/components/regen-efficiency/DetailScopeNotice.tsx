import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

interface DetailScopeNoticeProps {
  capReached: boolean;
  historyLimit: number;
  className?: string;
}

export function DetailScopeNotice({
  capReached,
  historyLimit,
  className,
}: DetailScopeNoticeProps) {
  const { t } = useTranslation();
  if (!capReached) return null;

  return (
    <AlertBanner
      className={className}
      variant="warning"
      icon={<Database className="h-4 w-4" aria-hidden="true" />}
      title={t('regen.scope.cappedTitle', 'Detailed history cap reached')}
    >
      <Text as="p" variant="caption">
        {t(
          'regen.scope.capped',
          'The detailed request returned {{limit}} rows. Additional drives in this selected window may be absent.',
          { limit: fmtInt(historyLimit) },
        )}
      </Text>
    </AlertBanner>
  );
}
