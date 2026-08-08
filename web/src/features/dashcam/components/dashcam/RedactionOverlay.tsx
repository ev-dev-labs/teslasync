import { useTranslation } from 'react-i18next';
import type { RedactionRegion } from '../../lib/types';

export interface RedactionOverlayProps {
  regions: RedactionRegion[];
}

const KIND_COLOR: Record<RedactionRegion['kind'], string> = {
  face: 'border-cyan-400/80 bg-cyan-400/20',
  plate: 'border-amber-400/80 bg-amber-400/20',
  general: 'border-rose-400/80 bg-rose-400/20',
};

/**
 * Read-only privacy-redaction overlay drawn atop clip playback. Rectangles
 * are stored normalized (0..1) so they scale with the video element
 * regardless of its rendered size — the percentage positioning below is a
 * dynamic, data-driven computation (not a static design token), which is
 * the documented exception to the "no inline style" rule.
 */
export function RedactionOverlay({ regions }: RedactionOverlayProps) {
  const { t } = useTranslation();
  if (regions.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-label={t('dashcam.redaction.overlayAria', 'Privacy redaction masks')}>
      {regions.map((region) => (
        <div
          key={region.id}
          className={`absolute rounded-sm border-2 ${KIND_COLOR[region.kind]}`}
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.width * 100}%`,
            height: `${region.height * 100}%`,
          }}
          title={region.label}
        />
      ))}
    </div>
  );
}
