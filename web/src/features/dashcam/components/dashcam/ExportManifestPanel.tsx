import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ImageDown } from 'lucide-react';
import { Button } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { InlineCallout } from '@/components/feedback';
import type { ClipRecord } from '../../lib/types';
import type { ReconstructionResult } from '../../lib/timelineAlignment';
import { buildIncidentManifest, downloadJson, downloadBlobAs, drawRedactedFrame } from '../../lib/redactionExport';

export interface ExportManifestPanelProps {
  clip: ClipRecord;
  reconstruction: ReconstructionResult | null;
}

/**
 * Local export: a JSON incident manifest (metadata + honesty disclaimers)
 * and an optional redacted-still PNG snapshot of the initial decoded frame.
 * Neither export is a modified video file — this feature never claims to
 * produce one.
 */
export function ExportManifestPanel({ clip, reconstruction }: ExportManifestPanelProps) {
  const { t } = useTranslation();
  const attemptRef = useRef<{ dispose: () => void } | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useLayoutEffect(() => {
    setIsPending(false);
    setExportError(null);
    return () => {
      attemptRef.current?.dispose();
      attemptRef.current = null;
    };
  }, [clip]);

  const handleManifestDownload = () => {
    setExportError(null);
    try {
      const manifest = buildIncidentManifest(clip, reconstruction);
      downloadJson(`${clip.fileName}.incident-manifest.json`, manifest);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t('dashcam.export.manifestFailed', 'The local manifest export failed.'));
    }
  };

  const handleStillExport = () => {
    if (attemptRef.current) return;
    setExportError(null);
    setIsPending(true);
    let objectUrl: string | null = null;
    let video: HTMLVideoElement | null = null;
    let disposed = false;
    let decoderReleased = false;
    const cleanupDecoder = () => {
      if (decoderReleased) return;
      decoderReleased = true;
      if (video) {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('error', onDecodeError);
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    const attempt = {
      dispose: () => {
        disposed = true;
        cleanupDecoder();
      },
    };
    const isCurrent = () => !disposed && attemptRef.current === attempt;
    const finish = () => {
      if (!isCurrent()) return;
      attempt.dispose();
      attemptRef.current = null;
      setIsPending(false);
    };
    const fail = (error: unknown) => {
      if (!isCurrent()) return;
      setExportError(error instanceof Error ? error.message : t('dashcam.export.failed', 'The local still export failed.'));
      finish();
    };
    const onDecodeError = () => {
      if (!isCurrent()) return;
      setExportError(video?.error?.message || t('dashcam.export.decodeFailed', 'This browser could not decode the clip for a still export.'));
      finish();
    };
    const onLoadedData = () => {
      if (!isCurrent() || !video) return;
      try {
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setExportError(t('dashcam.export.canvasUnavailable', 'This browser could not create a still-image canvas.'));
          finish();
          return;
        }
        drawRedactedFrame(ctx, video, width, height, clip.redactions);
        canvas.toBlob((blob) => {
          if (!isCurrent()) return;
          try {
            if (blob) downloadBlobAs(blob, `${clip.fileName}.redacted-still.png`);
            else setExportError(t('dashcam.export.imageUnavailable', 'This browser could not encode the still image.'));
          } catch (error) {
            fail(error);
          } finally {
            finish();
          }
        }, 'image/png');
      } catch (error) {
        fail(error);
      } finally {
        // Pixels are already copied; encoding may complete after this decoder is released.
        cleanupDecoder();
      }
    };
    attemptRef.current = attempt;
    try {
      objectUrl = URL.createObjectURL(clip.blob);
      video = document.createElement('video');
      video.muted = true;
      video.className = 'hidden';
      video.addEventListener('loadeddata', onLoadedData, { once: true });
      video.addEventListener('error', onDecodeError, { once: true });
      video.src = objectUrl;
      // Attached decoders are required by some browsers; never seek or play.
      document.body.appendChild(video);
    } catch (error) {
      fail(error);
    }
  };

  return (
    <LayoutCard title={t('dashcam.export.title', 'Local export')}>
      <InlineCallout variant="info">
        {t(
          'dashcam.export.disclaimer',
          'Exports are generated entirely in this browser. The still-frame export is a single redacted image, not a redacted video file.',
        )}
      </InlineCallout>
      <div className="flex flex-wrap gap-2">
        <Button wrapLabel size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={handleManifestDownload}>
          {t('dashcam.export.manifest', 'Download incident manifest (JSON)')}
        </Button>
        <Button wrapLabel size="sm" variant="secondary" disabled={isPending} aria-busy={isPending} icon={<ImageDown className="h-3.5 w-3.5" />} onClick={handleStillExport}>
          {t('dashcam.export.still', 'Export redacted still (PNG)')}
        </Button>
      </div>
      {exportError && <InlineCallout variant="danger">{exportError}</InlineCallout>}
    </LayoutCard>
  );
}
