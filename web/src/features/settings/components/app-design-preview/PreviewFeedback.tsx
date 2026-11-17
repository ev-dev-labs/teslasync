import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertBanner, DataStateNotice, EmptyState, ErrorDisplay, Skeleton, Spinner } from '@/components/feedback';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import PreviewRetainedSource from './PreviewRetainedSource';

export default function PreviewFeedback() {
  const { t } = useTranslation('settings');
  const [recovered, setRecovered] = useState(false);
  return (
    <GlassPanel data-preview-section="feedback" className="min-w-0 space-y-4 p-4">
      <PanelTitle>{t('theme.appDesignPreview.feedback', 'Data states and recovery')}</PanelTitle>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <div data-preview-state="loading" className="min-w-0 space-y-3" aria-busy="true">
          <Text role="status">{t('theme.appDesignPreview.loadingState', 'Loading synthetic observations')}</Text>
          <Spinner size="sm" /><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-1/2" />
        </div>
        <div data-preview-state="empty">
          {/* This healthy synthetic example has no alert source to recover or configure. */}
          <EmptyState variant="informational" message={t('theme.appDesignPreview.emptyState', 'No sample alerts in this view.')} />
        </div>
        <div data-preview-state="stale"><DataStateNotice state="stale"
          title={t('theme.appDesignPreview.staleTitle', 'Sample cached data')}
          message={t('theme.appDesignPreview.staleState', 'Last sample observation: 12 minutes ago. Cached readings stay visible, but are not live.')} /></div>
        <div data-preview-state="partial"><DataStateNotice state="partial"
          title={t('theme.appDesignPreview.partialTitle', 'Sample partial response')}
          message={t('theme.appDesignPreview.partialState', 'Five energy readings are available; one is unknown. The total is withheld.')} /></div>
        <PreviewRetainedSource />
        <div data-preview-state={recovered ? 'recovery' : 'error'} className="md:col-span-2">
          {recovered ? <AlertBanner variant="success" title={t('theme.appDesignPreview.recovered', 'Sample source recovered')}>
            {t('theme.appDesignPreview.recoveredHelp', 'Local retry succeeded. No server request was made.')}
            <Button variant="secondary" onClick={() => setRecovered(false)}>{t('theme.appDesignPreview.resetError', 'Show error again')}</Button>
          </AlertBanner> : <ErrorDisplay error={new Error('synthetic-preview-failure')} compact
            message={t('theme.appDesignPreview.errorState', 'Synthetic source unavailable. Retry to demonstrate local recovery.')}
            onRetry={() => setRecovered(true)} />}
        </div>
      </div>
    </GlassPanel>
  );
}
