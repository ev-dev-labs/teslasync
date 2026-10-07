import { useTranslation } from 'react-i18next';
import { Fingerprint, Download } from 'lucide-react';
import { GlassPanel, PanelTitle, Text, Caption, Button, CopyButton } from '@/components/ui';
import { EmptyState, AlertBanner } from '@/components/feedback';
import type { ServiceEvidencePackDocument } from '../lib/serviceEvidencePack';

export interface ServiceEvidenceIntegrityPanelProps {
  /** Mirrors `isAnalysisDefensible(analysis)` plus a chosen focal signal. */
  canGenerate: boolean;
  generating: boolean;
  pack: ServiceEvidencePackDocument | null;
  /** Pre-localized error message, or `null` when there is none to show. */
  generationError: string | null;
  onGenerate: () => void;
  onDismissError: () => void;
  onExport: () => void;
  className?: string;
}

/**
 * Generate → verify digest → export panel. Generation is a deliberate,
 * user-initiated action (not a background query) because it performs a
 * real cryptographic digest over the current analysis — so this panel
 * uses `<Button loading>` for its in-flight state (matching the existing
 * Hash Calculator devtool pattern) rather than a generic query Skeleton.
 *
 * Export stays disabled until a pack has actually been generated, and
 * generation itself stays disabled until the underlying analysis clears
 * `isAnalysisDefensible` — an indefensible analysis should never be
 * exportable, defensible or not.
 */
export function ServiceEvidenceIntegrityPanel({
  canGenerate,
  generating,
  pack,
  generationError,
  onGenerate,
  onDismissError,
  onExport,
  className,
}: ServiceEvidenceIntegrityPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className={className ?? 'p-4 sm:p-5'}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Fingerprint className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceEvidencePack.integrity.title', 'Integrity & Export')}
      </PanelTitle>
      <div className="space-y-3">
        <Text variant="bodySm" as="p">
          {t(
            'serviceEvidencePack.integrity.explain',
            'Generate the pack to compute a SHA-256 integrity digest over its canonical JSON. The digest lets anyone verify offline that the exported file has not been altered since it was generated — it is not a digital signature.',
          )}
        </Text>
        {generationError && (
          <AlertBanner variant="danger" onClose={onDismissError}>
            {generationError}
          </AlertBanner>
        )}
        <Button
          type="button"
          variant="primary"
          size="sm"
          icon={<Fingerprint className="h-4 w-4" />}
          loading={generating}
          disabled={!canGenerate || generating}
          onClick={onGenerate}
        >
          {t('serviceEvidencePack.integrity.generate', 'Generate pack')}
        </Button>
        {!canGenerate && !pack && (
          <EmptyState /* no-action: this unlocks automatically once the chosen signal clears the minimum evidence bar above. */
            icon={<Fingerprint className="h-8 w-8" />}
            message={t(
              'serviceEvidencePack.integrity.needsEvidence',
              'Choose a signal whose analysis clears the minimum evidence bar before generating a pack.',
            )}
          />
        )}
        {pack && (
          <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Text as="code" variant="code" className="break-all">
                {pack.integrity.digestHex}
              </Text>
              <CopyButton
                text={pack.integrity.digestHex}
                withToast
                label={t('serviceEvidencePack.integrity.copyDigest', 'Copy digest')}
                className="shrink-0"
              />
            </div>
            <Caption>
              {t('serviceEvidencePack.integrity.meta', 'Schema {{version}} · generated {{when}}', {
                version: pack.schemaVersion,
                when: new Date(pack.generatedAt).toLocaleString(),
              })}
            </Caption>
            <Button type="button" variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={onExport}>
              {t('serviceEvidencePack.integrity.export', 'Download JSON')}
            </Button>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
