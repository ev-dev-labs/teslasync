import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Button, Caption } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { useImportClips } from '../../hooks/useClipCatalog';
import { useDashcamSettings } from '../../hooks/useDashcamSettings';
import { defaultDashcamSettings } from '../../lib/types';

export interface ImportPanelProps {
  vehicleId: number | null;
}

/**
 * Local-only clip import: the user picks video files (and, optionally, a
 * matching Tesla `event.json` sidecar) straight from disk. Nothing is
 * uploaded — files are read directly in the browser and written to the
 * local IndexedDB-backed catalog.
 */
export function ImportPanel({ vehicleId }: ImportPanelProps) {
  const { t } = useTranslation();
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [sidecarFile, setSidecarFile] = useState<File | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const sidecarInputRef = useRef<HTMLInputElement>(null);

  const settingsQuery = useDashcamSettings();
  const importClips = useImportClips();

  const handleImport = async () => {
    if (videoFiles.length === 0) return;
    await importClips.mutateAsync({
      files: videoFiles,
      sidecarFile,
      vehicleId,
      settings: settingsQuery.data ?? defaultDashcamSettings(),
    });
    setVideoFiles([]);
    setSidecarFile(null);
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (sidecarInputRef.current) sidecarInputRef.current.value = '';
  };

  return (
    <LayoutCard
      title={t('dashcam.import.title', 'Import clips from disk')}
      description={t('dashcam.import.description', 'Clips never leave this browser tab. Files are parsed and stored locally in IndexedDB, along with any redaction masks and notes you add.')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          multiple
          label={t('dashcam.import.videoLabel', 'Video file(s)')}
          onChange={(e) => setVideoFiles(Array.from(e.target.files ?? []))}
        />
        <Input
          ref={sidecarInputRef}
          type="file"
          accept="application/json,.json"
          label={t('dashcam.import.sidecarLabel', 'event.json (optional)')}
          onChange={(e) => setSidecarFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          wrapLabel
          onClick={handleImport}
          disabled={videoFiles.length === 0}
          loading={importClips.isPending}
        >
          {t('dashcam.import.cta', 'Import {{count}} clip(s)', { count: videoFiles.length })}
        </Button>
        {videoFiles.length > 0 && (
          <Caption>
            {t('dashcam.import.selected', '{{count}} file(s) selected', { count: videoFiles.length })}
          </Caption>
        )}
      </div>
    </LayoutCard>
  );
}
