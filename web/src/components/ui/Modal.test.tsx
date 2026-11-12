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
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/react';
import { createRef, useRef, useState } from 'react';
import userEvent from '@testing-library/user-event';
import { getAppDesignAttributes } from './app-designs/designs';
import { Button } from './Button';
import { Popover } from './Popover';
import { Tooltip } from './Tooltip';
import { Drawer } from './Drawer';
import { Lightbox } from './Lightbox';

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

describe('Modal — explicit return forwarding', () => {
  it.each([false, true])('restores the invoker when a nested confirmation and parent close together (explicit=%s)', async (explicit) => {
    const user = userEvent.setup();
    function NestedConfirmation() {
      const [open, setOpen] = useState(false);
      const [confirming, setConfirming] = useState(false);
      const trigger = useRef<HTMLButtonElement>(null);
      return <>
        <h1 data-route-focus-target tabIndex={-1}>Current route</h1>
        <Button ref={trigger} onClick={() => setOpen(true)}>Open editor</Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Editor"
          getReturnFocusTarget={explicit ? () => trigger.current : undefined}>
          <Button onClick={() => setConfirming(true)}>Close dirty editor</Button>
        </Modal>
        {confirming && <Modal open onClose={() => setConfirming(false)} title="Confirmation">
          <Button onClick={() => { setOpen(false); setConfirming(false); }}>Discard draft</Button>
        </Modal>}
      </>;
    }
    render(<NestedConfirmation />);
    const trigger = screen.getByRole('button', { name: 'Open editor' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Close dirty editor' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('forwards the latest getter to the real owner, keeps the exact ref, and never leaks it to DOM', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLDivElement>();
    const first = vi.fn(() => screen.getByText('Original modal trigger'));
    const latest = vi.fn(() => screen.getByText('Latest modal trigger'));
    const content = (open: boolean, getter: typeof first) => <>
      <button>Original modal trigger</button><button>Latest modal trigger</button>
      <Modal ref={ref} open={open} onClose={vi.fn()} ariaLabel="Explicit modal" getReturnFocusTarget={getter}>
        <input autoFocus aria-label="Modal draft" />
      </Modal>
    </>;
    const view = render(content(false, first));
    await user.click(screen.getByText('Original modal trigger'));
    view.rerender(content(true, first));
    expect(screen.getByLabelText('Modal draft')).toHaveFocus();
    expect(ref.current).toBe(screen.getByRole('dialog'));
    expect(ref.current).not.toHaveAttribute('getReturnFocusTarget');
    view.rerender(content(true, latest));
    expect(screen.getByLabelText('Modal draft')).toHaveFocus();
    expect(first).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    view.rerender(content(false, latest));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Latest modal trigger')).toHaveFocus();
    expect(ref.current).toBeNull();
    view.rerender(content(true, first));
    view.rerender(content(false, first));
    expect(first).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Original modal trigger')).toHaveFocus();
  });

  it('restores an external explicit target on actual modal unmount after real autoFocus', async () => {
    const user = userEvent.setup();
    const triggerView = render(<button>Surviving modal activation</button>);
    const trigger = screen.getByText('Surviving modal activation');
    await user.click(trigger);
    const getter = vi.fn(() => trigger);
    const view = render(<Modal open onClose={vi.fn()} ariaLabel="Unmounting" getReturnFocusTarget={getter}>
      <input autoFocus aria-label="Unmount draft" />
    </Modal>);
    expect(screen.getByLabelText('Unmount draft')).toHaveFocus();
    expect(getter).not.toHaveBeenCalled();
    view.unmount();
    expect(getter).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
    triggerView.unmount();
  });
});

function getDialog(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('Modal — visibility', () => {
  it.each(['modal', 'drawer', 'lightbox'] as const)('isolates an initially open %s preview without guessing from focus', async kind => {
    const attributes = getAppDesignAttributes('editorial');
    const content = kind === 'drawer'
      ? <Drawer open onClose={() => {}} title="Initially open preview"><p>Details</p></Drawer>
      : kind === 'lightbox'
        ? <Lightbox open onClose={() => {}} images={[{ src: 'https://example.test/preview.png', alt: 'Preview image' }]} />
        : <Modal open onClose={() => {}} title="Initially open preview"><p>Details</p></Modal>;
    render(<section data-app-design-preview="" {...attributes}>{content}</section>);
    const boundary = screen.getByRole('dialog').closest('[data-app-design-portal]');
    await waitFor(() => {
      for (const [name, value] of Object.entries(attributes)) expect(boundary).toHaveAttribute(name, value);
      expect(screen.getByRole('dialog')).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial'));
    });
    expect(boundary?.parentElement).toBe(document.body);
  });

  it('only raises the overlay above notifications when requested', () => {
    const renderModal = (aboveNotifications = false) => (
      <Modal open onClose={vi.fn()} title="Review" aboveNotifications={aboveNotifications}>
        <p>Body</p>
      </Modal>
    );
    const { rerender } = render(renderModal());
    expect(getDialog().closest('.fixed.inset-0')).toHaveClass('z-overlay');
    rerender(renderModal(true));
    const overlay = getDialog().closest('.fixed.inset-0');
    expect(overlay).toHaveClass('z-[120]');
    expect(overlay).not.toHaveClass('z-overlay');
  });

  it('keeps footer actions inside the focus trap but outside the scrolling body', () => {
    const { container } = render(<Modal open title="Preview" onClose={vi.fn()} footer={<button>Install</button>}><p>Rules</p></Modal>);
    const action = screen.getByRole('button', { name: 'Install' });
    expect(container.querySelector(':not(template)')).toBeNull();
    expect(getDialog()).toHaveAttribute('data-app-part', 'dialog');
    expect(getDialog().closest('[data-app-part="overlay"]')).not.toBeNull();
    expect(screen.getByText('Preview').closest('[data-app-part="dialog-header"]')).not.toBeNull();
    expect(screen.getByText('Rules').closest('[data-app-part="dialog-body"]')).toHaveAttribute('data-modal-scroll-body');
    expect(action.closest('[data-app-part="dialog-footer"]')).toHaveAttribute('data-modal-footer');
    expect(getDialog()).toContainElement(action);
    expect(action.closest('[data-modal-scroll-body]')).toBeNull();
    expect(action.closest('[data-modal-footer]')).not.toBeNull();
    action.focus();
    fireEvent.keyDown(action, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
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
    // Only the inert, layout-free origin template remains inline.
    expect(container.querySelector(':not(template)')).toBeNull();
    // The dialog lives under <body> via createPortal.
    expect(document.body.contains(getDialog())).toBe(true);
  });

  it('keeps a different verified preview on real nested body portals, updates it live, and restores focus', async () => {
    const user = userEvent.setup();
    const outer = getAppDesignAttributes('terminal');
    const previous = Object.keys(outer).map(name => [name, document.documentElement.getAttribute(name)] as const);
    for (const [name, value] of Object.entries(outer)) document.documentElement.setAttribute(name, value);
    function Preview({ pack }: { pack: 'editorial' | 'bauhaus' }) {
      const [open, setOpen] = useState(false);
      const [menuOpen, setMenuOpen] = useState(false);
      const anchorRef = useRef<HTMLButtonElement>(null);
      return <section data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <Button onClick={() => setOpen(true)}>Open preview dialog</Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Preview dialog"
          footer={<Button variant="secondary">Keep footer</Button>}>
          <Button ref={anchorRef} onClick={() => setMenuOpen(true)}>Preview options</Button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={anchorRef}
            role="menu" ariaLabel="Preview actions">
            <Tooltip content="Preview explanation"><Button>Preview help</Button></Tooltip>
          </Popover>
        </Modal>
      </section>;
    }
    try {
      const view = render(<Preview pack="editorial" />);
      const trigger = screen.getByRole('button', { name: 'Open preview dialog' });
      await user.click(trigger);
      const dialog = screen.getByRole('dialog', { name: 'Preview dialog' });
      const boundary = dialog.closest('[data-app-design-portal]');
      expect(boundary?.parentElement).toBe(document.body);
      for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) {
        expect(boundary).toHaveAttribute(name, value);
      }
      await user.click(screen.getByRole('button', { name: 'Preview options' }));
      const menu = screen.getByRole('menu', { name: 'Preview actions' });
      const menuBoundary = menu.closest('[data-app-design-portal]');
      expect(menuBoundary?.parentElement).toBe(document.body);
      expect(menuBoundary).not.toBe(boundary);
      expect(menuBoundary).toHaveAttribute('data-app-design-pack', 'editorial');
      expect(screen.getByRole('tooltip').closest('[data-app-design-preview]')).toBe(menuBoundary);
      await waitFor(() => {
        for (const target of [dialog, menu, screen.getByRole('tooltip')]) {
          expect(target).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial'));
          expect(target).toHaveAttribute('data-app-design-owner', expect.stringContaining('controls-underline'));
          expect(target).not.toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-terminal'));
        }
      });

      view.rerender(<Preview pack="bauhaus" />);
      await waitFor(() => {
        for (const target of [boundary, menuBoundary]) {
          for (const [name, value] of Object.entries(getAppDesignAttributes('bauhaus'))) {
            expect(target).toHaveAttribute(name, value);
          }
        }
        for (const target of [dialog, menu, screen.getByRole('tooltip')]) {
          expect(target).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-bauhaus'));
          expect(target).toHaveAttribute('data-app-design-owner', expect.stringContaining('controls-segmented'));
          expect(target).not.toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-terminal'));
        }
      });
      expect(document.documentElement).toHaveAttribute('data-app-design-pack', 'terminal');
      expect(screen.getByRole('button', { name: 'Keep footer' }).closest('[data-modal-scroll-body]')).toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(trigger).toHaveFocus();
    } finally {
      for (const [name, value] of previous) {
        if (value === null) document.documentElement.removeAttribute(name);
        else document.documentElement.setAttribute(name, value);
      }
    }
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
    ['full', 'sm:max-w-modal-full'],
    ['fullscreen', 'max-w-none'],
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

  it('keeps fullscreen content in a viewport-height portal without the ordinary dialog cap', () => {
    const { container } = render(
      <Modal open onClose={vi.fn()} ariaLabel="Fullscreen widget" size="fullscreen">
        <button data-autofocus>Exit fullscreen</button>
        <div>Measured content</div>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Fullscreen widget' });
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
    expect(dialog).toHaveClass('h-dvh', 'max-h-dvh', 'max-w-none');
    expect(dialog).not.toHaveClass('sm:max-h-modal');
    expect(dialog.querySelector('[data-modal-scroll-body]')).toHaveClass('flex', 'min-h-0', 'overflow-hidden');
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toHaveFocus();
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

  it('Escape still closes after a successful form replaces its focused control', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Share">
        <button key="generate" type="button">Generate link</button>
      </Modal>,
    );
    screen.getByRole('button', { name: 'Generate link' }).focus();
    rerender(
      <Modal open onClose={onClose} title="Share">
        <button key="copy" type="button">Copy link</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('recovers the Tab trap after replacing focused content (reverse=%s)', (reverse) => {
    const { rerender } = render(
      <Modal open onClose={vi.fn()} title="Share">
        <button key="generate" type="button">Generate link</button>
      </Modal>,
    );
    screen.getByRole('button', { name: 'Generate link' }).focus();
    rerender(
      <Modal open onClose={vi.fn()} title="Share">
        <button key="copy" type="button">Copy link</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: reverse });
    expect(screen.getByRole('button', { name: reverse ? 'Copy link' : 'Close' })).toHaveFocus();
  });

  it('lost-focus Escape closes only the topmost dialog', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    render(
      <>
        <Modal open onClose={parentClose} title="Parent">Parent content</Modal>
        <Modal open onClose={childClose} title="Child">Child content</Modal>
      </>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();
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
  it('tracks the dialog ref across initially closed, open, closed and reopened states', () => {
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(<Modal ref={ref} open={false} onClose={vi.fn()} title="Lifecycle">Body</Modal>);
    expect(ref.current).toBeNull();
    rerender(<Modal ref={ref} open onClose={vi.fn()} title="Lifecycle">Body</Modal>);
    expect(ref.current).toBe(getDialog());
    rerender(<Modal ref={ref} open={false} onClose={vi.fn()} title="Lifecycle">Body</Modal>);
    expect(ref.current).toBeNull();
    rerender(<Modal ref={ref} open onClose={vi.fn()} title="Lifecycle">Body</Modal>);
    expect(ref.current).toBe(getDialog());
  });

  it('notifies callback refs when the portaled dialog mounts and unmounts', () => {
    const ref = vi.fn();
    const { unmount } = render(<Modal ref={ref} open onClose={vi.fn()} title="Callback">Body</Modal>);
    expect(ref).toHaveBeenLastCalledWith(getDialog());
    unmount();
    expect(ref).toHaveBeenLastCalledWith(null);
  });

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

describe('Modal — restrained presentation and reachability', () => {
  it('preserves a wrapping long title and its identity across translated-label rerenders', () => {
    const title = 'A very long vehicle configuration title with every important detail retained';
    const { rerender } = render(<Modal open onClose={vi.fn()} title={title}>Body</Modal>);
    const heading = screen.getByRole('heading', { name: title });
    const id = heading.id;
    expect(heading).toHaveClass('min-w-0', 'break-words');
    expect(heading).not.toHaveClass('truncate');
    expect(getDialog()).toHaveAccessibleName(title);
    rerender(<Modal open onClose={vi.fn()} title="Configuration du véhicule">Body</Modal>);
    expect(screen.getByRole('heading', { name: 'Configuration du véhicule' })).toHaveAttribute('id', id);
    expect(getDialog()).toHaveAttribute('aria-labelledby', id);
  });

  it('uses neutral theme roles and a reachable, reduced-motion-safe close control', () => {
    render(<Modal open onClose={vi.fn()} title="Presentation">Body</Modal>);
    expect(getDialog()).toHaveClass('shadow-e3', 'bg-[var(--surface-1)]', 'border-[var(--border-default)]');
    expect(getDialog()).not.toHaveClass('shadow-xl');
    const backdrop = document.querySelector('.fixed[aria-hidden="true"]');
    expect(backdrop).toHaveClass('bg-[var(--surface-overlay)]', 'forced-colors:bg-[Canvas]');
    expect(backdrop).not.toHaveClass('backdrop-blur-sm');
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveClass('h-11', 'w-11', 'focus-visible:outline-[var(--focus-ring)]', 'focus-visible:outline-offset-2', 'motion-reduce:transition-none');
    expect(close).not.toHaveClass('active:scale-95');
  });

  it.each([false, true])('contains body scroll above shell chrome with persistent footer=%s', (withFooter) => {
    render(<Modal open onClose={vi.fn()} title="Contained" footer={withFooter ? <button>Save</button> : undefined}>Body</Modal>);
    expect(getDialog()).toHaveClass('max-h-[calc(100dvh-var(--shell-chrome-bottom,0px))]', 'sm:max-h-modal');
    expect(getDialog().querySelector('[data-modal-scroll-body]')).toHaveClass('min-h-0', 'overflow-y-auto');
    if (withFooter) {
      const footer = getDialog().querySelector('[data-modal-footer]');
      expect(footer).toHaveClass('shrink-0', 'safe-bottom');
      expect(footer).toContainElement(screen.getByRole('button', { name: 'Save' }));
    }
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
