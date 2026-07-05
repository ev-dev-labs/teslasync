/**
 * VehiclePhotoGallery — behaviour, branch, null-safety, a11y and interaction
 * coverage for the display-only vehicle photo grid.
 *
 * The component is a thin, presentation-only wrapper around the shared
 * {@link Lightbox}: it renders either an accessible empty-state placeholder or a
 * responsive grid of focusable thumbnails, and opens the (real) lightbox at the
 * clicked index. This suite pins:
 *
 *   - the EMPTY branch — an omitted / empty `photos` prop renders the labelled
 *     placeholder (never a blank box) with a decorative, a11y-hidden icon, and
 *     never mounts the lightbox;
 *   - the GRID branch — one focusable thumbnail per photo, each carrying the
 *     correct `src`/`alt`, wrapped in a labelled list;
 *   - the `vehicleName` CONTRACT — the display name is woven into BOTH the grid
 *     label and every per-thumbnail label ("Open photo 3 of 3 — <name>"). The
 *     per-thumbnail weaving was the documented-but-missing behaviour this file
 *     drove into the source;
 *   - the INTERACTION — clicking a thumbnail opens the lightbox at that exact
 *     index (proven via the counter + the visible image), closing removes it,
 *     and reopening a different thumbnail re-targets the index;
 *   - the `className` passthrough on both branches.
 *
 * Strategy: only `react-i18next` is mocked so `t(key, fallback, opts)` renders
 * the deterministic English fallback with `{{…}}` interpolation — this keeps the
 * assertions independent of the en.json shape (these keys are fallback-only) and
 * lets the real Lightbox's own `t()` calls (counter, close label) resolve too.
 * The real Lightbox is used deliberately: it exercises the actual open → view →
 * close round-trip and its portal-rendered dialog. `@testing-library/user-event`
 * is not installed in this repo, so interactions are driven via `fireEvent`
 * (matching Lightbox.test.tsx / VehiclePhotoUpload.test.tsx).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      // Mirror the i18next overloads: t(key, defaultStr),
      // t(key, defaultStr, opts) and t(key, opts). Interpolates {{token}}
      // placeholders so aria-label / counter strings are asserted verbatim.
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined);
        let out = fallback ?? key;
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(`{{${k}}}`, String(v));
          }
        }
        return out;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import type { LightboxImage } from '@/components/ui/Lightbox';
import { VehiclePhotoGallery } from './VehiclePhotoGallery';

afterEach(() => {
  cleanup();
});

const PHOTOS: LightboxImage[] = [
  { src: 'https://cdn.test/front.jpg', alt: 'Front three-quarter' },
  { src: 'https://cdn.test/side.jpg', alt: 'Driver side profile' },
  { src: 'https://cdn.test/rear.jpg', alt: 'Rear three-quarter', caption: 'Rear' },
];

// ── Empty branch ─────────────────────────────────────────────────────────────

describe('VehiclePhotoGallery — empty state', () => {
  it('renders the accessible placeholder (not a blank box) when photos is omitted', () => {
    render(<VehiclePhotoGallery />);

    const placeholder = screen.getByTestId('vehicle-photo-gallery-empty');
    expect(placeholder).toBeInTheDocument();
    // The grid + lightbox must NOT be mounted on the empty branch.
    expect(screen.queryByTestId('vehicle-photo-gallery')).toBeNull();
    expect(screen.queryByTestId('lightbox-dialog')).toBeNull();

    // Helpful copy, not a silent void.
    expect(screen.getByText('No photos uploaded yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Photos uploaded for this vehicle will appear here.'),
    ).toBeInTheDocument();
  });

  it('treats an explicitly empty array the same as omitted (no thumbnails)', () => {
    render(<VehiclePhotoGallery photos={[]} />);

    expect(screen.getByTestId('vehicle-photo-gallery-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-photo-thumb-0')).toBeNull();
  });

  it("hides the placeholder's decorative icon from the accessibility tree", () => {
    render(<VehiclePhotoGallery />);

    const placeholder = screen.getByTestId('vehicle-photo-gallery-empty');
    const icon = placeholder.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes className through to the empty-state wrapper', () => {
    render(<VehiclePhotoGallery className="ring-2 ring-rose-500" />);

    const placeholder = screen.getByTestId('vehicle-photo-gallery-empty');
    expect(placeholder).toHaveClass('ring-2');
    expect(placeholder).toHaveClass('ring-rose-500');
  });
});

// ── Grid branch ──────────────────────────────────────────────────────────────

describe('VehiclePhotoGallery — thumbnail grid', () => {
  it('renders one focusable thumbnail per photo with correct src + alt', () => {
    render(<VehiclePhotoGallery photos={PHOTOS} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(PHOTOS.length);

    PHOTOS.forEach((photo, i) => {
      const thumb = screen.getByTestId(`vehicle-photo-thumb-${i}`);
      const img = within(thumb).getByRole('img');
      expect(img).toHaveAttribute('src', photo.src);
      expect(img).toHaveAttribute('alt', photo.alt);
    });
  });

  it('labels the grid generically and each thumbnail with its position when unnamed', () => {
    render(<VehiclePhotoGallery photos={PHOTOS} />);

    expect(screen.getByRole('list', { name: 'Photo gallery' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open photo 1 of 3' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open photo 3 of 3' }),
    ).toBeInTheDocument();
    // The unnamed variant must NOT contain the em-dash name suffix.
    expect(
      screen.queryByRole('button', { name: /Open photo 1 of 3 —/ }),
    ).toBeNull();
  });

  it('passes className through to the grid wrapper', () => {
    render(<VehiclePhotoGallery photos={PHOTOS} className="mt-8" />);

    expect(screen.getByTestId('vehicle-photo-gallery')).toHaveClass('mt-8');
  });
});

// ── vehicleName weaving (contract / a11y regression) ─────────────────────────

describe('VehiclePhotoGallery — vehicleName weaving', () => {
  it('weaves the vehicle name into the grid label and every thumbnail label', () => {
    render(<VehiclePhotoGallery photos={PHOTOS} vehicleName="Model 3 Performance" />);

    // Grid label carries the name.
    expect(
      screen.getByRole('list', { name: 'Model 3 Performance photo gallery' }),
    ).toBeInTheDocument();

    // Every thumbnail label is disambiguated with the name — this is the
    // documented behaviour ("Open photo 3 of 7 — Model 3 Performance") that
    // the generic `openAt` label previously failed to honour.
    expect(
      screen.getByRole('button', {
        name: 'Open photo 1 of 3 — Model 3 Performance',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Open photo 3 of 3 — Model 3 Performance',
      }),
    ).toBeInTheDocument();
    // The bare (nameless) label must no longer be present when a name is given.
    expect(
      screen.queryByRole('button', { name: 'Open photo 1 of 3' }),
    ).toBeNull();
  });
});

// ── Interaction — open / target index / close ────────────────────────────────

describe('VehiclePhotoGallery — lightbox interaction', () => {
  it('opens the lightbox at the clicked index and shows that image', async () => {
    render(<VehiclePhotoGallery photos={PHOTOS} />);

    // Closed by default — the portal dialog is absent.
    expect(screen.queryByTestId('lightbox-dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('vehicle-photo-thumb-2'));

    const dialog = await screen.findByTestId('lightbox-dialog');
    expect(dialog).toBeInTheDocument();
    // Counter proves the initialIndex wiring: 3rd of 3.
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 3');
    // And the visible image is the one that was clicked.
    expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', PHOTOS[2].src);
  });

  it('closes the lightbox when the close control is activated', async () => {
    render(<VehiclePhotoGallery photos={PHOTOS} />);

    fireEvent.click(screen.getByTestId('vehicle-photo-thumb-0'));
    await screen.findByTestId('lightbox-dialog');

    fireEvent.click(screen.getByTestId('lightbox-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('lightbox-dialog')).toBeNull();
    });
  });

  it('re-targets the index when a different thumbnail is opened after closing', async () => {
    render(<VehiclePhotoGallery photos={PHOTOS} />);

    // Open the first image.
    fireEvent.click(screen.getByTestId('vehicle-photo-thumb-0'));
    await screen.findByTestId('lightbox-dialog');
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 3');

    // Close, then open a different one — the fresh index must take effect.
    fireEvent.click(screen.getByTestId('lightbox-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('lightbox-dialog')).toBeNull();
    });

    fireEvent.click(screen.getByTestId('vehicle-photo-thumb-1'));
    await screen.findByTestId('lightbox-dialog');
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 3');
    expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', PHOTOS[1].src);
  });

  it('labels a single-photo gallery as "1 of 1"', () => {
    render(<VehiclePhotoGallery photos={[PHOTOS[0]]} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Open photo 1 of 1' }),
    ).toBeInTheDocument();
  });
});
