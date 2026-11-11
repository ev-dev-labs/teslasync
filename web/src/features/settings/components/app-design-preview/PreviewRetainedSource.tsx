import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KVList } from '@/components/data-display';
import { AlertBanner, DataStateNotice } from '@/components/feedback';
import { Button } from '@/components/ui';

export default function PreviewRetainedSource() {
  const { t } = useTranslation('settings');
  const [failed, setFailed] = useState(true);
  return (
    <div data-preview-state={failed ? 'retained-error' : 'retained-recovery'} className="min-w-0 space-y-3 md:col-span-2">
      {failed ? <DataStateNotice state="stale" preserveSeverity
        title={t('theme.appDesignPreview.retainedTitle', 'Sample refresh failed')}
        message={t('theme.appDesignPreview.retainedHelp', 'The previous readings stay visible. A failed refresh does not erase measured zero or turn an unknown reading into zero.')} />
        : <AlertBanner variant="success" title={t('theme.appDesignPreview.retainedRecovered', 'Sample refresh recovered')}>
          {t('theme.appDesignPreview.retainedRecoveredHelp', 'The local refresh completed; the same retained readings remain available.')}
        </AlertBanner>}
      <KVList layout="responsive" items={[
        { id: 'zero', label: t('theme.appDesignPreview.retainedZero', 'Retained sample count'), value: 0 },
        { id: 'unknown', label: t('theme.appDesignPreview.retainedUnknown', 'Unknown sample reading'), value: '—' },
      ]} />
      <Button variant="secondary" onClick={() => setFailed(value => !value)}>
        {failed ? t('theme.appDesignPreview.retryRetained', 'Retry retained example')
          : t('theme.appDesignPreview.resetRetained', 'Show refresh failure again')}
      </Button>
    </div>
  );
}
