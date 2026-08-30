/**
 * `<Drawer>` — slide-in side panel primitive.
 *
 * The Drawer is a hand-rolled dialog (portal + framer-motion + a bespoke
 * focus trap) used by the feature drawers (FlagEditDrawer, QueueJobDrawer,
 * EntryDrawer, WidgetPicker). These tests pin the contract those callers
 * depend on and lock in the accessibility / focus-management hardening:
 *
 *   1. Open/closed rendering + portal to <body>.
 *   2. Dialog labelling: `aria-labelledby` → heading when a title is shown,
 *      a translated `aria-label` fallback (or caller `ariaLabel`) otherwise.
 *   3. Children + the optional footer region.
 *   4. The icon-only Close control: accessible name, `type="button"`, onClose.
 *   5. Backdrop-click and Escape both close; Escape does NOT leak past the
 *      dialog (stopPropagation).
 *   6. Focus management: initial focus moves in; Tab / Shift+Tab wrap; a
 *      panel with no focusable child parks focus on the dialog container;
 *      focus is restored to the opener on close.
 *   7. Regression: a changing `onClose` identity while open must NOT steal
 *      focus back to the first control (the effect keys off `open` only).
 *   8. `side` and `className` pass-through.
 *
 * react-i18next is stubbed to echo the English fallback so assertions read
 * against stable copy without a provider. framer-motion reaches for
 * `window.matchMedia` (reduced-motion) which jsdom lacks — a canonical stub
 * removes that ambiguity. No network is touched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Drawer } from './Drawer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => cleanup());

/** Query the scrim (the aria-hidden backdrop element) inside the dialog. */
function getBackdrop(): HTMLElement {
  const dialog = screen.getByRole('dialog');
  const backdrop = dialog.querySelector('[aria-hidden="true"]');
  if (!backdrop) throw new Error('backdrop not found');
  return backdrop as HTMLElement;
}

/** Query the sliding panel through its stable slot marker. */
function getPanel(): HTMLElement {
  const dialog = screen.getByRole('dialog');
  const panel = dialog.querySelector('[data-drawer-panel]');
  if (!panel) throw new Error('panel not found');
  return panel as HTMLElement;
}

describe('<Drawer>', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <Drawer open={false} onClose={vi.fn()} title="Filters">
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('portals a labelled modal dialog into <body> when opened', () => {
    const { container } = render(
      <Drawer open onClose={vi.fn()} title="Filters">
        <p>Body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Portaled out of the render container onto document.body.
    expect(container).toBeEmptyDOMElement();
    expect(document.body.contains(dialog)).toBe(true);
    // Title renders as a level-3 heading wired to the dialog via labelledby.
    const heading = screen.getByRole('heading', { level: 3, name: 'Filters' });
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('falls back to a translated aria-label when no title is provided', () => {
    render(
      <Drawer open onClose={vi.fn()}>
        <p>Body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Panel' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).not.toHaveAttribute('aria-labelledby');
    // No visible heading is rendered without a title.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('prefers a caller-supplied ariaLabel over the default for untitled drawers', () => {
    render(
      <Drawer open onClose={vi.fn()} ariaLabel="Quick filters">
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Quick filters' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Panel' })).not.toBeInTheDocument();
  });

  it('renders children and standardizes custom, default, and suppressed footers', () => {
    const { rerender } = render(
      <Drawer
        open
        onClose={vi.fn()}
        title="Filters"
        footer={<div data-testid="drawer-footer">Save</div>}
      >
        <p>Drawer body content</p>
      </Drawer>,
    );
    expect(screen.getByText('Drawer body content')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-footer')).toBeInTheDocument();

    // Dropping the footer prop installs the standard read-only Close action.
    rerender(
      <Drawer open onClose={vi.fn()} title="Filters">
        <p>Drawer body content</p>
      </Drawer>,
    );
    expect(screen.getByText('Drawer body content')).toBeInTheDocument();
    expect(screen.queryByTestId('drawer-footer')).not.toBeInTheDocument();
    expect(screen.getByText('Drawer body content').closest('[data-drawer-body]')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(2);

    // Explicit null is the escape hatch for a panel that genuinely has no
    // action footer; the header Close control remains available.
    rerender(
      <Drawer open onClose={vi.fn()} title="Filters" footer={null}>
        <p>Drawer body content</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').querySelector('[data-drawer-footer]')).toBeNull();
  });

  it('exposes an accessible, non-submitting Close control that calls onClose', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Filters">
        <p>Body</p>
      </Drawer>,
    );
    const closeBtn = screen.getAllByRole('button', { name: 'Close' })[0];
    // type="button" so an enclosing <form> is never accidentally submitted.
    expect(closeBtn).toHaveAttribute('type', 'button');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop scrim is clicked', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Filters">
        <p>Body</p>
      </Drawer>,
    );
    fireEvent.click(getBackdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and stops the event from escaping the dialog', () => {
    const onClose = vi.fn();
    const documentHandler = vi.fn();
    document.addEventListener('keydown', documentHandler);
    try {
      render(
        <Drawer open onClose={onClose} title="Filters">
          <button type="button">Action</button>
        </Drawer>,
      );
      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      // stopPropagation() means the document-level listener never sees it.
      expect(documentHandler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', documentHandler);
    }
  });

  it('moves initial focus to the first focusable control on open', () => {
    render(
      <Drawer open onClose={vi.fn()} title="Filters">
        <button type="button">Alpha</button>
        <button type="button">Beta</button>
      </Drawer>,
    );
    // The header Close button is the first focusable in DOM order.
    const closeBtn = screen.getAllByRole('button', { name: 'Close' })[0];
    expect(document.activeElement).toBe(closeBtn);
  });

  it('traps Tab focus, wrapping last→first and first→last (Shift+Tab)', () => {
    render(
      <Drawer open onClose={vi.fn()} title="Filters">
        <button type="button">Alpha</button>
        <button type="button">Beta</button>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    const closeBtn = closeButtons[0];
    const footerClose = closeButtons[closeButtons.length - 1];

    // Tab off the last focusable wraps back to the first (header Close).
    act(() => footerClose.focus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab off the first focusable wraps to the footer Close.
    act(() => closeBtn.focus());
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(footerClose);
  });

  it('keeps a close control available even when the panel has no title or body controls', () => {
    render(
      <Drawer open onClose={vi.fn()}>
        <span>Read-only content</span>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    expect(closeButtons).toHaveLength(2);
    expect(document.activeElement).toBe(closeButtons[0]);
    expect(dialog).toHaveAttribute('tabindex', '-1');
  });

  it('restores focus to the opener when the drawer closes', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button" data-testid="trigger">
            Open drawer
          </button>
          <Drawer open={open} onClose={vi.fn()} title="Filters">
            <button type="button">Action</button>
          </Drawer>
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    const trigger = screen.getByTestId('trigger');
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);

    // Opening pulls focus into the dialog…
    rerender(<Harness open />);
    expect(document.activeElement).not.toBe(trigger);

    // …and closing hands it back to the trigger.
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus when onClose identity changes while open', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Drawer open onClose={first} title="Filters">
        <input data-testid="field" />
      </Drawer>,
    );
    const field = screen.getByTestId('field');
    act(() => field.focus());
    expect(document.activeElement).toBe(field);

    // A parent re-render with a brand-new inline onClose must not re-run the
    // focus effect and yank focus back to the Close button.
    rerender(
      <Drawer open onClose={second} title="Filters">
        <input data-testid="field" />
      </Drawer>,
    );
    expect(document.activeElement).toBe(field);
  });

  it('honours the side prop and merges a custom className onto the panel', () => {
    const { rerender } = render(
      <Drawer open onClose={vi.fn()} title="Filters" className="ring-2">
        <p>Body</p>
      </Drawer>,
    );
    const rightPanel = getPanel();
    expect(rightPanel.className).toContain('right-0');
    expect(rightPanel.className).not.toContain('left-0');
    expect(rightPanel.className).toContain('ring-2');

    rerender(
      <Drawer open onClose={vi.fn()} title="Filters" side="left">
        <p>Body</p>
      </Drawer>,
    );
    const leftPanel = getPanel();
    expect(leftPanel.className).toContain('left-0');
    expect(leftPanel.className).not.toContain('right-0');
  });

  it('uses named widths with a full-width mobile fallback', () => {
    const { rerender } = render(
      <Drawer open onClose={vi.fn()} title="Filters" size="sm">
        <p>Body</p>
      </Drawer>,
    );
    expect(getPanel()).toHaveAttribute('data-drawer-size', 'sm');
    expect(getPanel()).toHaveClass('w-full', 'max-w-none', 'sm:max-w-sm');

    rerender(
      <Drawer open onClose={vi.fn()} title="Filters" size="lg">
        <p>Body</p>
      </Drawer>,
    );
    expect(getPanel()).toHaveAttribute('data-drawer-size', 'lg');
    expect(getPanel()).toHaveClass('sm:max-w-2xl');
  });

  it('renders header metadata and tabs in stable slots', () => {
    render(
      <Drawer
        open
        onClose={vi.fn()}
        eyebrow="Evidence"
        title="Drive 42"
        description="Completed 10 minutes ago"
        headerMeta={<span>Complete</span>}
        tabs={<div role="tablist">Tabs</div>}
      >
        <p>Body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Drive 42' });
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(dialog.querySelector('[data-drawer-header]')).toHaveTextContent(
      'EvidenceDrive 42CompleteCompleted 10 minutes ago',
    );
    expect(dialog.querySelector('[data-drawer-tabs]')).toContainElement(
      screen.getByRole('tablist'),
    );
  });

  it('locks background scrolling while open and restores it on close', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = render(
      <Drawer open onClose={vi.fn()} title="Filters">
        <p>Body</p>
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Drawer open={false} onClose={vi.fn()} title="Filters">
        <p>Body</p>
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe('auto');
  });
});
