import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ImageDown } from 'lucide-react';
import { Button, GlassPanel } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import type { ClipRecord } from '../../lib/types';
import type { ReconstructionResult } from '../../lib/timelineAlignment';
import { buildIncidentManifest, downloadJson, downloadBlobAs, drawRedactedFrame, type RedactionDrawContext } from '../../lib/redactionExport';

export interface ExportManifestPanelProps {
  clip: ClipRecord;
  reconstruction: ReconstructionResult | null;
}

/**
 * Local export: a JSON incident manifest (metadata + honesty disclaimers)
 * and an optional redacted-still PNG snapshot of the current video frame.
 * Neither export is a modified video file — this feature never claims to
 * produce one.
 */
export function ExportManifestPanel({ clip, reconstruction }: ExportManifestPanelProps) {
  const { t } = useTranslation();
  const objectUrlRef = useRef<string | null>(null);

  const handleManifestDownload = () => {
    const manifest = buildIncidentManifest(clip, reconstruction);
    downloadJson(`${clip.fileName}.incident-manifest.json`, manifest);
  };

  const handleStillExport = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const objectUrl = URL.createObjectURL(clip.blob);
    objectUrlRef.current = objectUrl;
    const video = document.createElement('video');
    video.muted = true;
    video.style.display = 'none';
    video.src = objectUrl;
    // Some browsers only reliably decode frames for elements attached to
    // the document — attach off-screen, then clean up once the frame has
    // been drawn (success or failure).
    document.body.appendChild(video);
    const cleanup = () => {
      document.body.removeChild(video);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    video.addEventListener(
      'loadeddata',
      () => {
        try {
          const width = video.videoWidth || 640;
          const height = video.videoHeight || 360;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d') as unknown as RedactionDrawContext | null;
          if (!ctx) return;
          drawRedactedFrame(ctx, video, width, height, clip.redactions);
          canvas.toBlob((blob) => {
            if (blob) downloadBlobAs(blob, `${clip.fileName}.redacted-still.png`);
          }, 'image/png');
        } finally {
          cleanup();
        }
      },
      { once: true },
    );
    video.addEventListener('error', cleanup, { once: true });
  };

  return (
    <GlassPanel padding="md" className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
        {t('dashcam.export.title', 'Local export')}
      </h3>
      <InlineCallout variant="info">
        {t(
          'dashcam.export.disclaimer',
          'Exports are generated entirely in this browser. The still-frame export is a single redacted image, not a redacted video file.',
        )}
      </InlineCallout>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={handleManifestDownload}>
          {t('dashcam.export.manifest', 'Download incident manifest (JSON)')}
        </Button>
        <Button size="sm" variant="secondary" icon={<ImageDown className="h-3.5 w-3.5" />} onClick={handleStillExport}>
          {t('dashcam.export.still', 'Export redacted still (PNG)')}
        </Button>
      </div>
    </GlassPanel>
  );
}
