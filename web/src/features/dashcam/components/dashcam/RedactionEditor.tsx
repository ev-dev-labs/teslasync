import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Select, Slider, Input, Caption } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type { RedactionRegion } from '../../lib/types';
import type { ClipRecord } from '../../lib/types';
import { useUpdateClip } from '../../hooks/useClipCatalog';
import { useDashcamDb } from '../../hooks/useDashcamDb';
import { QueryError } from '@/components/feedback';

export interface RedactionEditorProps {
  clip: ClipRecord;
}

function nextRegionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `region_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Editable, normalized (0..1) privacy-redaction rectangles. Persisted
 * locally on the clip record — this only draws an overlay over playback
 * and (via `ExportManifestPanel`) a redacted still frame; it does not
 * produce a redacted video file. Saves are serialized against stored metadata;
 * newer edits remain in the draft, and failed drafts stay available for retry.
 */
export function RedactionEditor({ clip }: RedactionEditorProps) {
  const { db } = useDashcamDb();
  const [owner, setOwner] = useState({ db, generation: 0 });
  if (owner.db !== db) setOwner({ db, generation: owner.generation + 1 });
  return <ScopedRedactionEditor key={`${clip.id}:${owner.generation}`} clip={clip} />;
}

function ScopedRedactionEditor({ clip }: RedactionEditorProps) {
  const { t } = useTranslation();
  const updateClip = useUpdateClip();
  const { db } = useDashcamDb();
  const [draft, setDraft] = useState<{ regions: RedactionRegion[]; revision: number; error: Error | null } | null>(null);
  const [saved, setSaved] = useState<ClipRecord | null>(null);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const scope = useRef<object | null>(null);
  const mutateAsync = useRef(updateClip.mutateAsync);
  mutateAsync.current = updateClip.mutateAsync;
  const regions = draft?.regions ?? (saved && saved.updatedAt >= clip.updatedAt ? saved.redactions : clip.redactions);

  useEffect(() => {
    const token = {};
    scope.current = token;
    return () => { scope.current = null; };
  }, [db]);

  useEffect(() => {
    if (!draft || draft.error || pending) return;
    const token = scope.current;
    const submitted = draft;
    setPending(true);
    void (async () => {
      try {
        const current = await db.getClip(clip.id);
        if (scope.current !== token) return;
        if (!current) throw new Error(t('dashcam.update.error', 'Failed to save clip changes'));
        const result = await mutateAsync.current({ ...current, redactions: submitted.regions });
        if (scope.current !== token) return;
        setSaved(result);
        setDraft((latest) => latest?.revision === submitted.revision ? null : latest);
      } catch (error) {
        if (scope.current !== token) return;
        setDraft((latest) => latest?.revision === submitted.revision
          ? { ...latest, error: error instanceof Error ? error : new Error(String(error)) }
          : latest);
      } finally {
        if (scope.current === token) setPending(false);
      }
    })();
  }, [clip.id, db, draft, pending, t]);

  const setRegions = (regions: RedactionRegion[]) => {
    setDraft({ regions, revision: ++revision.current, error: null });
  };

  const addRegion = () => {
    const region: RedactionRegion = {
      id: nextRegionId(),
      kind: 'face',
      label: t('dashcam.redaction.defaultLabel', 'Unlabeled region'),
      x: 0.35,
      y: 0.35,
      width: 0.3,
      height: 0.3,
      createdAt: new Date().toISOString(),
    };
    setRegions([...regions, region]);
  };

  const updateRegion = (id: string, patch: Partial<RedactionRegion>) => {
    setRegions(regions.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRegion = (id: string) => {
    setRegions(regions.filter((r) => r.id !== id));
  };

  return (
    <LayoutCard
      title={t('dashcam.redaction.title', 'Privacy redaction masks')}
      description={t('dashcam.redaction.description', 'Rectangles are stored as normalized coordinates and rendered over playback. Export produces a redacted still frame or a manifest — never a modified video file.')}
      actions={
        <Button wrapLabel size="sm" variant="secondary" className="min-h-11 min-w-11 md:min-h-9 md:min-w-0" onClick={addRegion} icon={<Plus className="h-3.5 w-3.5" />}>
          {t('dashcam.redaction.add', 'Add region')}
        </Button>
      }
    >
      {draft?.error && (
        <QueryError
          error={draft.error}
          resourceName={t('dashcam.redaction.title', 'Privacy redaction masks')}
          onRetry={() => setDraft({ ...draft, error: null })}
        />
      )}
      {regions.length === 0 ? (
        <Caption>{t('dashcam.redaction.empty', 'No redaction regions defined yet.')}</Caption>
      ) : (
        <ul className="space-y-4">
          {regions.map((region) => (
            <li key={region.id} className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Select
                  size="sm"
                  label={t('dashcam.redaction.kindLabel', 'Region kind')}
                  options={[
                    { value: 'face', label: t('dashcam.redaction.kind.face', 'Face') },
                    { value: 'plate', label: t('dashcam.redaction.kind.plate', 'License plate') },
                    { value: 'general', label: t('dashcam.redaction.kind.general', 'General / other') },
                  ]}
                  value={region.kind}
                  onChange={(e) => updateRegion(region.id, { kind: e.target.value as RedactionRegion['kind'] })}
                  className="w-40"
                />
                <div className="min-w-0 flex-1 basis-40 md:basis-0">
                  <Input
                    size="sm"
                    label={t('dashcam.redaction.labelPlaceholder', 'Label')}
                    value={region.label}
                    onChange={(e) => updateRegion(region.id, { label: e.target.value })}
                    placeholder={t('dashcam.redaction.labelPlaceholder', 'Label')}
                    className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('dashcam.redaction.remove', 'Remove region')}
                  onClick={() => removeRegion(region.id)}
                  className="h-11 min-h-11 w-11 min-w-11 shrink-0 p-0 text-[var(--semantic-danger)] md:h-8 md:min-h-8 md:w-8 md:min-w-8"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Slider label="X" min={0} max={1} step={0.01} value={region.x} onChange={(v) => updateRegion(region.id, { x: v })} formatValue={(n) => `${Math.round(n * 100)}%`} />
                <Slider label="Y" min={0} max={1} step={0.01} value={region.y} onChange={(v) => updateRegion(region.id, { y: v })} formatValue={(n) => `${Math.round(n * 100)}%`} />
                <Slider label={t('dashcam.redaction.width', 'Width')} min={0.02} max={1} step={0.01} value={region.width} onChange={(v) => updateRegion(region.id, { width: v })} formatValue={(n) => `${Math.round(n * 100)}%`} />
                <Slider label={t('dashcam.redaction.height', 'Height')} min={0.02} max={1} step={0.01} value={region.height} onChange={(v) => updateRegion(region.id, { height: v })} formatValue={(n) => `${Math.round(n * 100)}%`} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </LayoutCard>
  );
}
