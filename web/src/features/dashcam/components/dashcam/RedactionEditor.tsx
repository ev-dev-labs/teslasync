import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Button, GlassPanel, Select, Slider, Input } from '@/components/ui';
import type { RedactionRegion } from '../../lib/types';
import type { ClipRecord } from '../../lib/types';
import { useUpdateClip } from '../../hooks/useClipCatalog';

export interface RedactionEditorProps {
  clip: ClipRecord;
}

function nextRegionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `region_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const KIND_OPTIONS = [
  { value: 'face', label: 'Face' },
  { value: 'plate', label: 'License plate' },
  { value: 'general', label: 'General / other' },
];

/**
 * Editable, normalized (0..1) privacy-redaction rectangles. Persisted
 * locally on the clip record — this only draws an overlay over playback
 * and (via `ExportManifestPanel`) a redacted still frame; it does not
 * produce a redacted video file.
 */
export function RedactionEditor({ clip }: RedactionEditorProps) {
  const { t } = useTranslation();
  const updateClip = useUpdateClip();

  const setRegions = (regions: RedactionRegion[]) => {
    updateClip.mutate({ ...clip, redactions: regions });
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
    setRegions([...clip.redactions, region]);
  };

  const updateRegion = (id: string, patch: Partial<RedactionRegion>) => {
    setRegions(clip.redactions.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRegion = (id: string) => {
    setRegions(clip.redactions.filter((r) => r.id !== id));
  };

  return (
    <GlassPanel padding="md" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {t('dashcam.redaction.title', 'Privacy redaction masks')}
        </h3>
        <Button size="sm" variant="secondary" onClick={addRegion} icon={<Plus className="h-3.5 w-3.5" />}>
          {t('dashcam.redaction.add', 'Add region')}
        </Button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {t(
          'dashcam.redaction.description',
          'Rectangles are stored as normalized coordinates and rendered over playback. Export produces a redacted still frame or a manifest — never a modified video file.',
        )}
      </p>
      {clip.redactions.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{t('dashcam.redaction.empty', 'No redaction regions defined yet.')}</p>
      ) : (
        <ul className="space-y-4">
          {clip.redactions.map((region) => (
            <li key={region.id} className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-2">
                <Select
                  size="sm"
                  options={KIND_OPTIONS}
                  value={region.kind}
                  onChange={(e) => updateRegion(region.id, { kind: e.target.value as RedactionRegion['kind'] })}
                  className="w-40"
                />
                <Input
                  size="sm"
                  value={region.label}
                  onChange={(e) => updateRegion(region.id, { label: e.target.value })}
                  placeholder={t('dashcam.redaction.labelPlaceholder', 'Label')}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('dashcam.redaction.remove', 'Remove region')}
                  onClick={() => removeRegion(region.id)}
                  className="h-8 w-8 p-0 text-rose-300"
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
    </GlassPanel>
  );
}
