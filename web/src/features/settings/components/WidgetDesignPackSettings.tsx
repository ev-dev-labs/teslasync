import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertBanner, SectionErrorBoundary, Skeleton, useToast } from '@/components/feedback';
import { Badge, Button, GlassPanel, Modal, PanelTitle, Subhead, Text } from '@/components/ui';
import { useWidgetDesignPack } from '@/hooks/useWidgetDesignPack';
import { PACK_MANIFEST } from '@/features/dashboard/widgets/designPacks/manifest';
import { PackBoundary } from '@/features/dashboard/widgets/designPacks/PackBoundary';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import type { WidgetDesignPackPreviewProps } from './WidgetDesignPackPreview';
import WidgetDesignPackThumbnail from './WidgetDesignPackThumbnail';

export default function WidgetDesignPackSettings() {
  const { t } = useTranslation(['settings', 'dashboard']);
  const toast = useToast();
  const preference = useWidgetDesignPack();
  const [previewId, setPreviewId] = useState<PackId | null>(null);
  const [Preview, setPreview] = useState<ComponentType<WidgetDesignPackPreviewProps> | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const generation = useRef(0);
  const headingId = 'settings-widget-design-packs';
  const previewEntry = PACK_MANIFEST.find(entry => entry.id === previewId);
  const packName = (key: string) => t(key, { ns: 'dashboard' });

  useEffect(() => () => { ++generation.current; }, []);

  function openPreview(id: PackId) {
    const request = ++generation.current;
    setPreviewId(id);
    setPreviewError(false);
    if (Preview) return;
    void import('./WidgetDesignPackPreview').then(module => {
      if (request === generation.current) setPreview(() => module.default);
    }).catch(() => {
      if (request === generation.current) setPreviewError(true);
    });
  }

  function closePreview() {
    ++generation.current;
    setPreviewId(null);
    setPreviewError(false);
  }

  function selectPack(id: PackId, name: string) {
    if (!preference.isReady || preference.isSaving || preference.packId === id) return;
    if (preference.setPackId(id)) {
      toast.success(t('theme.widgetDesignPacks.saved', '{{name}} saved for this browser profile.', { name }));
    }
  }

  return <GlassPanel aria-labelledby={headingId} className="@container space-y-4 p-6">
    <PanelTitle id={headingId}>{t('theme.widgetDesignPacks.title', 'Widget design packs')}</PanelTitle>
    <Text variant="bodySm">{t('theme.widgetDesignPacks.scope', 'Applies to dashboards in this browser profile on this server. Signed-in accounts have separate selections. Other appearance settings and saved layouts stay unchanged.')}</Text>
    {!preference.isReady && !preference.error && <Text role="status">{t('theme.widgetDesignPacks.verifying', 'Verifying your browser preference...')}</Text>}
    {preference.error && <AlertBanner variant="warning" role="alert">
      {t('theme.widgetDesignPacks.saveError', 'Your previous selection is unchanged. Check your server connection and browser storage, then retry.')}
      <Button size="sm" className="min-h-11" variant="secondary" onClick={preference.retry}>
        {t('theme.widgetDesignPacks.retryPreference', 'Retry preference')}
      </Button>
    </AlertBanner>}
    <div className="grid auto-rows-fr min-w-0 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4" aria-busy={preference.isSaving}>
      {PACK_MANIFEST.map(entry => {
        const name = packName(entry.nameKey);
        const active = preference.isReady && preference.packId === entry.id;
        return <section key={entry.id} aria-labelledby={`${headingId}-${entry.id}`}
          className="flex h-full min-w-0 flex-col gap-3 rounded-shape-lg border border-[var(--border-default)] p-3">
          <WidgetDesignPackThumbnail packId={entry.id} />
          <div className="flex min-h-6 min-w-0 items-center justify-between gap-2">
            <Subhead id={`${headingId}-${entry.id}`}>{name}</Subhead>
            {active && <Badge variant="neutral">{t('theme.widgetDesignPacks.active', 'Active')}</Badge>}
          </div>
          <Text variant="bodySm" className="grow">{packName(entry.descriptionKey)}</Text>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11" variant="secondary" onClick={() => openPreview(entry.id)}
              aria-label={t('theme.widgetDesignPacks.previewNamed', 'Preview {{name}}', { name })}>
              {t('theme.widgetDesignPacks.preview', 'Preview')}
            </Button>
            <Button size="sm" className="min-h-11" disabled={!preference.isReady || preference.isSaving || active || !entry.available}
              onClick={() => selectPack(entry.id, name)}
              aria-label={active ? t('theme.widgetDesignPacks.activeNamed', '{{name}} active', { name })
                : t('theme.widgetDesignPacks.useNamed', 'Use {{name}} pack', { name })}>
              {active ? t('theme.widgetDesignPacks.active', 'Active')
                : preference.isSaving ? t('theme.widgetDesignPacks.saving', 'Saving...')
                  : t('theme.widgetDesignPacks.use', 'Use pack')}
            </Button>
          </div>
        </section>;
      })}
    </div>
    <Modal open={previewId != null} onClose={closePreview} size="full"
      title={t('theme.widgetDesignPacks.previewNamed', 'Preview {{name}}', {
        name: previewEntry ? packName(previewEntry.nameKey) : '',
      })}
      footer={<Button variant="secondary" onClick={closePreview}>{t('theme.widgetDesignPacks.close', 'Close preview')}</Button>}>
      <Text className="mb-4">{t('theme.widgetDesignPacks.synthetic', 'Synthetic examples only. Preview does not connect to a vehicle, change preferences or send commands.')}</Text>
      {previewId != null && (previewError ? <AlertBanner variant="warning" role="alert">
        {t('theme.widgetDesignPacks.previewError', 'The preview could not load. Retry, or close the preview without changing your selection.')}
        <Button size="sm" variant="secondary" onClick={() => openPreview(previewId)}>
          {t('theme.widgetDesignPacks.retry', 'Retry preview')}
        </Button>
      </AlertBanner> : Preview ? (
        <SectionErrorBoundary key={previewId} name="WidgetDesignPackPreview">
          <PackBoundary requestedPackId={previewId}><Preview packId={previewId} /></PackBoundary>
        </SectionErrorBoundary>
      ) : <Skeleton className="h-72 w-full" />)}
    </Modal>
  </GlassPanel>;
}
