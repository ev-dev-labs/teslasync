/**
 * Display-only vehicle photo grid backed by the shared {@link Lightbox}.
 *
 * Renders a responsive grid of focusable thumbnails; activating one opens the
 * lightbox at that image's index. Callers pass already-normalized
 * `LightboxImage` records (`src` + `alt`) — upload and normalization concerns
 * stay out of this component.
 *
 * Contract:
 *   - No photos → an accessible placeholder card, never a blank box.
 *   - Photos present → a labelled grid of thumbnails that open the lightbox at
 *     the clicked index.
 *   - `vehicleName`, when provided, is woven into the grid label and every
 *     per-thumbnail label (e.g. "Open photo 3 of 7 — Model 3 Performance") so
 *     screen-reader users can tell one vehicle's gallery from another.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from 'lucide-react';

import { Button, Lightbox, type LightboxImage } from '@/components/ui';
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={`vehicle-photo-thumb-${i}`}
              onClick={() => handleOpen(i)}
              aria-label={
                vehicleName
                  ? t(
                      'vehicles.photos.openAtNamed',
                      'Open photo {{index}} of {{total}} — {{name}}',
                      { index: i + 1, total: photos.length, name: vehicleName },
                    )
                  : t(
                      'vehicles.photos.openAt',
                      'Open photo {{index}} of {{total}}',
                      { index: i + 1, total: photos.length },
                    )
              }
              className={cn(
                'group relative h-full w-full overflow-hidden rounded-lg p-0',
                'border border-[var(--glass-border)] bg-[var(--surface-1)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                'forced-colors:border-[CanvasText]',
              )}
            >
              <img
                src={photo.src}
                alt={photo.alt}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-normal group-hover:scale-[1.03]"
              />
            </Button>
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
