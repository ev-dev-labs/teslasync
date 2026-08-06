import { useTranslation } from 'react-i18next';
import { Trash2, Video } from 'lucide-react';
import { Badge, Button, SelectableCard } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import type { ClipRecord } from '../../lib/types';
import { useDeleteClip } from '../../hooks/useClipCatalog';
import { CAMERA_LABELS, SOURCE_LABELS } from './constants';
import { formatCapturedAtRaw } from './helpers';

export interface ClipCatalogListProps {
  clips: ClipRecord[];
  totalCount: number;
  selectedClipId: string | null;
  onSelect: (id: string) => void;
  /** Resets the catalog's search/facet filters back to `defaultClipFilterState()`. */
  onClearFilters: () => void;
}

/** Card-list of clips matching the current search/filter state. */
export function ClipCatalogList({ clips, totalCount, selectedClipId, onSelect, onClearFilters }: ClipCatalogListProps) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const deleteClip = useDeleteClip();

  if (totalCount === 0) {
    // no-action: the trigger surface is the ImportPanel directly above this catalog on the page.
    return (
      <EmptyState
        icon={<Video className="h-8 w-8" />}
        title={t('dashcam.catalog.emptyTitle', 'No clips imported yet')}
        message={t('dashcam.catalog.emptyMessage', 'Import Sentry/Dashcam clips above to build a local, searchable catalog.')}
      />
    );
  }

  if (clips.length === 0) {
    return (
      <EmptyState
        icon={<Video className="h-8 w-8" />}
        title={t('dashcam.catalog.noMatchTitle', 'No clips match these filters')}
        message={t('dashcam.catalog.noMatchMessage', 'Try clearing the search text or resetting a filter chip.')}
        action={{ label: t('dashcam.filters.clear', 'Clear filters'), onClick: onClearFilters }}
      />
    );
  }

  return (
    <ul className="space-y-2" role="listbox" aria-label={t('dashcam.catalog.listAria', 'Imported clips')}>
      {clips.map((clip) => {
        const selected = clip.id === selectedClipId;
        return (
          <li key={clip.id} className="flex items-center gap-2">
            <SelectableCard
              role="option"
              selected={selected}
              onClick={() => onSelect(clip.id)}
              className="flex-1"
            >
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="truncate text-sm font-medium text-[var(--text-primary)]">{clip.fileName}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <Badge size="sm">{CAMERA_LABELS[clip.cameraPosition]}</Badge>
                  <Badge size="sm" variant="info">{SOURCE_LABELS[clip.source]}</Badge>
                  <span>{formatCapturedAtRaw(clip.capturedAtRaw)}</span>
                  <span>·</span>
                  <span>{formatDuration(clip.durationSeconds ?? null)}</span>
                  {clip.eventCandidates.length > 0 && (
                    <span>· {t('dashcam.catalog.eventCount', '{{count}} event candidate(s)', { count: clip.eventCandidates.length })}</span>
                  )}
                </span>
              </span>
            </SelectableCard>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('dashcam.catalog.delete', 'Delete clip')}
              onClick={() => deleteClip.mutate(clip.id)}
              className="h-8 w-8 shrink-0 p-0 text-rose-300 hover:text-rose-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
