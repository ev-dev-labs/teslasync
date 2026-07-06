/**
 * `<Modal>` contract tests.
 *
 * Exercises the full public surface of the shared modal primitive:
 *   - visibility gating (`open` false → renders nothing; portals to <body>)
 *   - header / title labelling (aria-labelledby) vs `ariaLabel` fallback
 *   - size-preset class mapping (incl. the `md` default)
 *   - close affordances: Close button, backdrop click, Esc key, and that
 *     clicking dialog content does NOT close
 *   - focus management: initial focus lands inside the dialog, restores to the
 *     trigger on close, focuses the container itself when there are no
 *     focusables, and — the regression this file locks — is NOT stolen back to
 *     the first focusable when the parent re-renders with a fresh `onClose`
 *   - focus trap: Tab / Shift+Tab wrap at the boundaries; Tab with no
 *     focusables keeps focus on the dialog
 *   - forwardRef exposes the dialog node
 *   - className merge + arbitrary prop passthrough
 *   - i18n: the Close button's accessible name comes from `t()`
 *
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven via `fireEvent` from `@testing-library/react` — matching every
 * other component test here (Lightbox, EditableText, focusTrap, etc).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { createRef, useState } from 'react';

// i18n stub so the Close button's `t('modal.close', 'Close')` resolves to its
// fallback string without needing a provider. Returns the fallback (2nd arg)
// when present, otherwise the key — the same shape used across the UI tests.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { Modal } from './Modal';

afterEach(() => {
  cleanup();
});

function getDialog(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('Modal — visibility', () => {
  it('renders nothing when open is false', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('renders a role=dialog with aria-modal=true when open', () => {
    render(
      <Modal open onClose={() => {}} title="Visible">
        <p>Body</p>
      </Modal>,
    );
    const dialog = getDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('portals the dialog to document.body, not the render container', () => {
    const { container } = render(
      <Modal open onClose={() => {}} title="Portaled">
        <p>Body</p>
      </Modal>,
    );
    // Nothing renders inline where <Modal> was mounted.
    expect(container).toBeEmptyDOMElement();
    // The dialog lives under <body> via createPortal.
    expect(document.body.contains(getDialog())).toBe(true);
  });
});

describe('Modal — title + labelling', () => {
  it('renders the title in a heading wired to the dialog via aria-labelledby', () => {
    render(
      <Modal open onClose={() => {}} title="Battery Health">
        <p>Body</p>
      </Modal>,
    );
    const heading = screen.getByRole('heading', { name: 'Battery Health' });
    const dialog = getDialog();
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(heading).toHaveAttribute('id', labelledBy!);
    // With a visible title the dialog must NOT also carry an aria-label.
    expect(dialog).not.toHaveAttribute('aria-label');
  });

  it('falls back to aria-label when no title is provided', () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="Filters panel">
        <p>Body</p>
      </Modal>,
    );
    const dialog = getDialog();
    expect(dialog).toHaveAttribute('aria-label', 'Filters panel');
    expect(dialog).not.toHaveAttribute('aria-labelledby');
    // No header/heading is rendered without a title.
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders the Close button only when a title is present', () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Has header">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    rerender(
      <Modal open onClose={() => {}} ariaLabel="No header">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

describe('Modal — size presets', () => {
  const cases: Array<[NonNullable<React.ComponentProps<typeof Modal>['size']>, string]> = [
    ['sm', 'sm:max-w-sm'],
    ['md', 'sm:max-w-lg'],
    ['lg', 'sm:max-w-2xl'],
    ['full', 'sm:max-w-[min(96vw,1100px)]'],
  ];

  it.each(cases)('size="%s" applies the %s width class', (size, cls) => {
    render(
      <Modal open onClose={() => {}} title="Sized" size={size}>
        <p>Body</p>
      </Modal>,
    );
    expect(getDialog().className).toContain(cls);
  });

  it('defaults to the md preset when size is omitted', () => {
    render(
      <Modal open onClose={() => {}} title="Default size">
        <p>Body</p>
      </Modal>,
    );
    expect(getDialog().className).toContain('sm:max-w-lg');
  });
});

describe('Modal — close affordances', () => {
  it('clicking the Close button calls onClose exactly once', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Closable">
        <p>Body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop calls onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Backdrop">
        <p>Body</p>
      </Modal>,
    );
    // The backdrop is the aria-hidden scrim sibling of the dialog.
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Esc">
        <button type="button">Action</button>
      </Modal>,
    );
    fireEvent.keyDown(getDialog(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking content inside the dialog does NOT call onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Inner">
        <button type="button" data-testid="inner-action">Do thing</button>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('inner-action'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape uses the LATEST onClose after the prop changes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Modal open onClose={first} title="Latest">
        <button type="button">Action</button>
      </Modal>,
    );
    rerender(
      <Modal open onClose={second} title="Latest">
        <button type="button">Action</button>
      </Modal>,
    );
    fireEvent.keyDown(getDialog(), { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('Modal — focus management', () => {
  function OpenCloseHarness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
          Open
        </button>
        <Modal open={open} onClose={() => setOpen(false)} title="Focus round-trip">
          <button type="button" data-testid="inner">Inner</button>
        </Modal>
      </>
    );
  }

  it('moves focus into the dialog when it opens', () => {
    render(
      <Modal open onClose={() => {}} title="Autofocus">
        <button type="button">Action</button>
      </Modal>,
    );
    const dialog = getDialog();
    expect(dialog.contains(document.activeElement)).toBe(true);
    // The header Close button is the first focusable in DOM order.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('focuses the dialog container itself when there are no focusable children', () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="No focusables">
        <p>Just some text with nothing focusable.</p>
      </Modal>,
    );
    const dialog = getDialog();
    expect(document.activeElement).toBe(dialog);
  });

  it('restores focus to the trigger element when the dialog closes', () => {
    render(<OpenCloseHarness />);
    const trigger = screen.getByTestId('trigger');
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(getDialog()).toBeInTheDocument();
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(getDialog(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does NOT steal focus back to the first focusable when the parent re-renders (regression)', () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Re-render">
        <button type="button" data-testid="b1">One</button>
        <button type="button" data-testid="b2">Two</button>
      </Modal>,
    );
    const b2 = screen.getByTestId('b2');
    act(() => b2.focus());
    expect(document.activeElement).toBe(b2);

    // Simulate a parent re-render that passes a brand-new inline onClose —
    // the single most common real-world trigger for this bug. Focus must
    // stay where the user put it, not jump back to the Close button.
    rerender(
      <Modal open onClose={() => {}} title="Re-render">
        <button type="button" data-testid="b1">One</button>
        <button type="button" data-testid="b2">Two</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(b2);
  });
});

describe('Modal — focus trap', () => {
  it('Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last', () => {
    render(
      <Modal open onClose={() => {}} title="Trap">
        <button type="button">First body</button>
        <button type="button">Last body</button>
      </Modal>,
    );
    const dialog = getDialog();
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    act(() => last.focus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    act(() => first.focus());
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Tab with no focusable children keeps focus on the dialog container', () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="Empty trap">
        <p>Nothing focusable here.</p>
      </Modal>,
    );
    const dialog = getDialog();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });
});

describe('Modal — ref + prop passthrough', () => {
  it('forwards the ref to the dialog element', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Modal ref={ref} open onClose={() => {}} title="Ref">
        <p>Body</p>
      </Modal>,
    );
    expect(ref.current).toBe(getDialog());
    expect(ref.current).toHaveAttribute('role', 'dialog');
  });

  it('merges a custom className and forwards arbitrary props onto the dialog', () => {
    render(
      <Modal
        open
        onClose={() => {}}
        title="Passthrough"
        className="custom-modal-class"
        data-testid="modal-root"
        aria-describedby="desc-node"
      >
        <p>Body</p>
      </Modal>,
    );
    const dialog = getDialog();
    expect(dialog.className).toContain('custom-modal-class');
    expect(dialog).toHaveAttribute('data-testid', 'modal-root');
    expect(dialog).toHaveAttribute('aria-describedby', 'desc-node');
  });
});

describe('Modal — i18n', () => {
  it('labels the Close button via the translation helper fallback', () => {
    render(
      <Modal open onClose={() => {}} title="Localized">
        <p>Body</p>
      </Modal>,
    );
    const header = getDialog();
    // Icon-only control must expose an accessible name for screen readers.
    const closeBtn = within(header).getByRole('button', { name: 'Close' });
    expect(closeBtn).toHaveAttribute('aria-label', 'Close');
    expect(closeBtn).toHaveAttribute('type', 'button');
  });
});
