import { useTranslation } from 'react-i18next';
import { FileJson } from 'lucide-react';
import { CodeBlock, GlassPanel, PanelTitle } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { toPrettyJson, type ServiceEvidencePackDocument } from '../lib/serviceEvidencePack';

export interface ServiceEvidencePackPreviewProps {
  pack: ServiceEvidencePackDocument | null;
  className?: string;
}

/**
 * Read-only preview of the exact JSON document the export button downloads
 * — the single canonical `ServiceEvidencePackDocument`, never wrapped in an
 * array, pretty-printed the same way `toPrettyJson` renders it to the file.
 */
export function ServiceEvidencePackPreview({ pack, className }: ServiceEvidencePackPreviewProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className={className ?? 'p-4 sm:p-5'}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <FileJson className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceEvidencePack.preview.title', 'Pack preview')}
      </PanelTitle>
      {pack == null ? (
        <EmptyState /* no-action: the preview mirrors whatever the Integrity & Export panel above has generated. */
          icon={<FileJson className="h-8 w-8" />}
          message={t('serviceEvidencePack.preview.empty', 'Generate a pack above to preview the exact JSON document that will be downloaded.')}
        />
      ) : (
        <CodeBlock
          text={toPrettyJson(pack)}
          language="json"
          wrap
          ariaLabel={t('serviceEvidencePack.preview.title', 'Pack preview')}
          className="[&_pre]:max-h-96"
        />
      )}
    </GlassPanel>
  );
}
