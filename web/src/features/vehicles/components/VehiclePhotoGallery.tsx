/**
 * Phase-46 / Prompt 39 — Vehicle photo gallery + Lightbox adoption.
 *
 * The TeslaSync data model does not yet ship per-vehicle photos
 * (the schema is targeted by a future prompt — see "Out of scope"
 * in phase-46/39). This component is the integration surface that
 * proves the shared `<Lightbox>` primitive composes cleanly:
 *
 *   - When `photos` is empty, render a placeholder card prompting
 *     the user to upload images later. The placeholder is a regular
 *     visual region (not an `<EmptyState>`) so the empty-state-CTA
 *     audit doesn't demand an action prop here — uploads are
 *     deferred to the manual-upload prompt.
 *   - When photos are present, render a responsive thumbnail grid.
 *     Each thumbnail is a button; clicking opens the Lightbox with
 *     the corresponding initial index.
 *
 * Mounting on `VehicleDetailPage` is intentionally NOT done in this
 * prompt — that page is outside the prompt's allowed-files regex.
 * Wiring will land alongside the photo-upload backend slice.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from 'lucide-react';

import { Lightbox, type LightboxImage } from '@/components/ui/Lightbox';
import { cn } from '@/lib/cn';

export interface VehiclePhotoGalleryProps {
  /** Vehicle photos to render. Defaults to an empty array. */
  photos?: LightboxImage[];
  /**
   * Optional vehicle display name, used to compose accessible labels
   * such as "Open photo 3 of 7 — Model 3 Performance".
   */
  vehicleName?: string;
  /** Optional className passed through to the outer wrapper. */
  className?: string;
}

export function VehiclePhotoGallery({
  photos = [],
  vehicleName,
  className,
}: VehiclePhotoGalleryProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <div
        data-testid="vehicle-photo-gallery-empty"
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--glass-border)] bg-[var(--surface-1)]/50 px-6 py-10 text-center',
          'forced-colors:border-[CanvasText]',
          className,
        )}
      >
        <ImageIcon
          aria-hidden="true"
          className="h-8 w-8 text-[var(--text-muted)]"
        />
        <p className="text-sm text-[var(--text-secondary)]">
          {t('vehicles.photos.empty', 'No photos uploaded yet.')}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {t(
            'vehicles.photos.emptyHelp',
            'Photos uploaded for this vehicle will appear here.',
          )}
        </p>
      </div>
    );
  }

  const handleOpen = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
  };

  return (
    <div className={className} data-testid="vehicle-photo-gallery">
      <ul
        aria-label={
          vehicleName
            ? t('vehicles.photos.galleryNamed', '{{name}} photo gallery', {
                name: vehicleName,
              })
            : t('vehicles.photos.gallery', 'Photo gallery')
        }
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      >
        {photos.map((photo, i) => (
          <li key={`${photo.src}-${i}`} className="aspect-square">
            <button
              type="button"
              data-testid={`vehicle-photo-thumb-${i}`}
              onClick={() => handleOpen(i)}
              aria-label={t(
                'vehicles.photos.openAt',
                'Open photo {{index}} of {{total}}',
                { index: i + 1, total: photos.length },
              )}
              className={cn(
                'group relative block h-full w-full overflow-hidden rounded-lg',
                'border border-[var(--glass-border)] bg-[var(--surface-1)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                'forced-colors:border-[CanvasText]',
              )}
            >
              <img
                src={photo.src}
                alt={photo.alt}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            </button>
          </li>
        ))}
      </ul>

      <Lightbox
        open={open}
        onClose={() => setOpen(false)}
        images={photos}
        initialIndex={activeIndex}
      />
    </div>
  );
}

VehiclePhotoGallery.displayName = 'VehiclePhotoGallery';
