/**
 * Phase-46 / Prompt 39 — `<Lightbox>` contract tests.
 *
 * Verifies the headline behaviours called out in the prompt:
 *   - Open at index 2, ← navigates to index 1.
 *   - Esc closes; focus returns to the trigger element.
 *   - Tab key cycles only inside the modal (focus trap).
 *
 * Plus extras for the rest of the public contract (counter render,
 * caption render, zoom +/- + reset, image click does NOT close,
 * backdrop click DOES close, prev/next disabled at boundaries).
 *
 * `@testing-library/user-event` is not installed in this repo, so we
 * drive interactions via `fireEvent` from `@testing-library/react`.
 * Matches every other component test here (EditableText, TagInput,
 * ContextMenu, focusTrap, etc).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useState } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      let template: string;
      let interpolations: Record<string, unknown> | undefined;
      if (typeof defaultOrOpts === 'string') {
        template = defaultOrOpts || key;
        interpolations = opts;
      } else {
        template = key;
        interpolations = defaultOrOpts;
      }
      if (!interpolations) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(interpolations?.[name] ?? `{{${name}}}`),
      );
    },
  }),
}));

import { Lightbox, LIGHTBOX_MAX_ZOOM, type LightboxImage } from './Lightbox';

afterEach(() => {
  cleanup();
});

const FIXTURE_IMAGES: LightboxImage[] = [
  { src: 'https://example.test/img-0.jpg', alt: 'Image zero', caption: 'Caption zero' },
  { src: 'https://example.test/img-1.jpg', alt: 'Image one', caption: 'Caption one' },
  { src: 'https://example.test/img-2.jpg', alt: 'Image two' },
  { src: 'https://example.test/img-3.jpg', alt: 'Image three', caption: 'Caption three' },
];

interface HarnessProps {
  initialOpen?: boolean;
  initialIndex?: number;
  images?: LightboxImage[];
}

/**
 * Test harness wrapping a trigger button + the Lightbox in a single
 * controlled component. Lets each test exercise the open → interact →
 * close → focus-restore round trip without bespoke setup.
 */
function Harness({
  initialOpen = false,
  initialIndex = 0,
  images = FIXTURE_IMAGES,
}: HarnessProps) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open gallery
      </button>
      <Lightbox
        open={open}
        onClose={() => setOpen(false)}
        images={images}
        initialIndex={initialIndex}
      />
    </>
  );
}

function getDialog(): HTMLElement {
  return screen.getByTestId('lightbox-dialog');
}

describe('Lightbox — visibility', () => {
  it('renders nothing when open=false', () => {
    render(<Harness initialOpen={false} />);
    expect(screen.queryByTestId('lightbox-dialog')).toBeNull();
  });

  it('renders nothing when images is empty', () => {
    render(<Harness initialOpen images={[]} />);
    expect(screen.queryByTestId('lightbox-dialog')).toBeNull();
  });

  it('renders the dialog with role=dialog + aria-modal=true when open', () => {
    render(<Harness initialOpen />);
    const dialog = getDialog();
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});

describe('Lightbox — counter + caption', () => {
  it('shows "n / total" counter starting at initialIndex+1', () => {
    render(<Harness initialOpen initialIndex={2} />);
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 4');
  });

  it('renders caption when present, omits caption node when absent', () => {
    render(<Harness initialOpen initialIndex={0} />);
    expect(screen.getByTestId('lightbox-caption')).toHaveTextContent('Caption zero');

    cleanup();
    render(<Harness initialOpen initialIndex={2} />);
    expect(screen.queryByTestId('lightbox-caption')).toBeNull();
  });
});

describe('Lightbox — keyboard navigation', () => {
  it('opens at index 2 then ArrowLeft navigates to index 1', () => {
    render(<Harness initialOpen initialIndex={2} />);
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 4');

    fireEvent.keyDown(getDialog(), { key: 'ArrowLeft' });
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 4');
    expect(screen.getByTestId('lightbox-image')).toHaveAttribute('alt', 'Image one');
  });

  it('ArrowRight navigates forward and stops at the last image', () => {
    render(<Harness initialOpen initialIndex={0} />);
    fireEvent.keyDown(getDialog(), { key: 'ArrowRight' });
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 4');
    fireEvent.keyDown(getDialog(), { key: 'ArrowRight' });
    fireEvent.keyDown(getDialog(), { key: 'ArrowRight' });
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('4 / 4');
    // Cap at the last image — no wraparound.
    fireEvent.keyDown(getDialog(), { key: 'ArrowRight' });
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('4 / 4');
  });

  it('Home / End jump to first / last image', () => {
    render(<Harness initialOpen initialIndex={1} />);
    fireEvent.keyDown(getDialog(), { key: 'End' });
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('4 / 4');
    fireEvent.keyDown(getDialog(), { key: 'Home' });
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 4');
  });

  it('Esc closes the dialog and returns focus to the trigger', () => {
    render(<Harness initialOpen={false} />);
    const trigger = screen.getByTestId('trigger');
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByTestId('lightbox-dialog')).toBeInTheDocument();
    // Focus moved into the dialog (first focusable button).
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(getDialog(), { key: 'Escape' });
    expect(screen.queryByTestId('lightbox-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('clicking the close button fires onClose', () => {
    render(<Harness initialOpen />);
    fireEvent.click(screen.getByTestId('lightbox-close'));
    expect(screen.queryByTestId('lightbox-dialog')).toBeNull();
  });
});

describe('Lightbox — prev / next buttons', () => {
  it('prev disabled at index 0; next disabled at last index', () => {
    render(<Harness initialOpen initialIndex={0} />);
    expect(screen.getByTestId('lightbox-prev')).toBeDisabled();
    expect(screen.getByTestId('lightbox-next')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('lightbox-next'));
    fireEvent.click(screen.getByTestId('lightbox-next'));
    fireEvent.click(screen.getByTestId('lightbox-next'));
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('4 / 4');
    expect(screen.getByTestId('lightbox-next')).toBeDisabled();
    expect(screen.getByTestId('lightbox-prev')).not.toBeDisabled();
  });

  it('hides prev/next entirely for a single-image lightbox', () => {
    render(<Harness initialOpen images={[FIXTURE_IMAGES[0]]} />);
    expect(screen.queryByTestId('lightbox-prev')).toBeNull();
    expect(screen.queryByTestId('lightbox-next')).toBeNull();
  });
});

describe('Lightbox — focus trap', () => {
  it('Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last', () => {
    render(<Harness initialOpen />);
    const dialog = getDialog();
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Pressing Tab on the LAST focusable should wrap focus to the first.
    act(() => last.focus());
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    // Pressing Shift+Tab on the FIRST focusable should wrap to the last.
    act(() => first.focus());
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('opens with focus moved into the dialog', () => {
    render(<Harness initialOpen={false} />);
    const trigger = screen.getByTestId('trigger');
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const dialog = getDialog();
    // Active element should now be inside the dialog (first focusable).
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
  });
});

describe('Lightbox — backdrop click', () => {
  it('clicking the backdrop layer closes the lightbox', () => {
    render(<Harness initialOpen />);
    fireEvent.click(screen.getByTestId('lightbox-backdrop'));
    expect(screen.queryByTestId('lightbox-dialog')).toBeNull();
  });

  it('clicking the image does NOT close the lightbox', () => {
    render(<Harness initialOpen />);
    const img = screen.getByTestId('lightbox-image');
    fireEvent.click(img);
    expect(screen.getByTestId('lightbox-dialog')).toBeInTheDocument();
  });

  it('clicking a control button does NOT close the lightbox', () => {
    render(<Harness initialOpen />);
    fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
    expect(screen.getByTestId('lightbox-dialog')).toBeInTheDocument();
  });
});

describe('Lightbox — zoom controls', () => {
  it('zoom-in increases zoom in 50% steps; zoom-out decreases; zoom-reset returns to 100%', () => {
    render(<Harness initialOpen />);
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('100%');
    expect(screen.getByTestId('lightbox-zoom-out')).toBeDisabled();

    fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('150%');
    expect(screen.getByTestId('lightbox-zoom-out')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('200%');

    fireEvent.click(screen.getByTestId('lightbox-zoom-reset'));
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('100%');
    expect(screen.getByTestId('lightbox-zoom-out')).toBeDisabled();
  });

  it('+ key zooms in; - key zooms out; 0 key resets', () => {
    render(<Harness initialOpen />);
    fireEvent.keyDown(getDialog(), { key: '+' });
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('150%');
    fireEvent.keyDown(getDialog(), { key: '+' });
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('200%');
    fireEvent.keyDown(getDialog(), { key: '-' });
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('150%');
    fireEvent.keyDown(getDialog(), { key: '0' });
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('100%');
  });

  it('zoom-in disables when reaching the max zoom cap', () => {
    render(<Harness initialOpen />);
    // Walk up to the cap (100% → 500% in 50% steps = 8 clicks).
    const stepsToMax = Math.ceil((LIGHTBOX_MAX_ZOOM - 1) / 0.5);
    for (let i = 0; i < stepsToMax; i++) {
      fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
    }
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('500%');
    expect(screen.getByTestId('lightbox-zoom-in')).toBeDisabled();
  });

  it('navigating to a different image resets zoom to 100%', () => {
    render(<Harness initialOpen initialIndex={0} />);
    fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
    fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('200%');

    fireEvent.click(screen.getByTestId('lightbox-next'));
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 4');
    expect(screen.getByTestId('lightbox-zoom-level')).toHaveTextContent('100%');
  });
});

describe('Lightbox — initialIndex behaviour', () => {
  it('clamps out-of-range initialIndex to a valid value', () => {
    render(<Harness initialOpen initialIndex={99} />);
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('4 / 4');
  });

  it('does NOT snap the user back to initialIndex while already open', () => {
    function ChangingHarness() {
      const [open, setOpen] = useState(true);
      const [seed, setSeed] = useState(0);
      return (
        <>
          <button data-testid="re-seed" onClick={() => setSeed((s) => s + 1)}>seed</button>
          <button data-testid="close" onClick={() => setOpen(false)}>close</button>
          <Lightbox open={open} onClose={() => setOpen(false)} images={FIXTURE_IMAGES} initialIndex={seed} />
        </>
      );
    }
    render(<ChangingHarness />);
    // Navigate to image 3 of 4.
    fireEvent.click(screen.getByTestId('lightbox-next'));
    fireEvent.click(screen.getByTestId('lightbox-next'));
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 4');

    // Parent re-renders with a different initialIndex while open — this
    // must NOT teleport the user back.
    fireEvent.click(screen.getByTestId('re-seed'));
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 4');
  });
});
