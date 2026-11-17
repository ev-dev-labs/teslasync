import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Popover } from './Popover';
import { getAppDesignAttributes } from './app-designs/designs';

function HandoffHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <Button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        First
      </Button>
      <Button type="button" onClick={() => setOpen(false)}>
        Second
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        ariaLabel="First menu"
      >
        <Button type="button">Inside</Button>
      </Popover>
    </>
  );
}

describe('Popover focus restoration', () => {
  it('does not initialize owner observation for neutral opens and balances live verified transitions', async () => {
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe');
    const ownerObservations = () => observe.mock.calls.filter(([target, options]) =>
      target === document.documentElement && options?.subtree === true);
    function LivePreview({ design }: { design: 'default' | 'incomplete' | 'editorial' | 'bauhaus' }) {
      const anchorRef = useRef<HTMLButtonElement>(null);
      const attributes = design === 'editorial' || design === 'bauhaus' ? getAppDesignAttributes(design) : {};
      return <>
        <section {...attributes} data-app-design-preview={design === 'default' ? undefined : ''}>
          <Button ref={anchorRef}>Live preview anchor</Button>
        </section>
        <Popover open anchorRef={anchorRef} onClose={() => {}} ariaLabel="Live preview">
          <Button>Live portal action</Button>
        </Popover>
      </>;
    }
    const view = render(<LivePreview design="default" />);
    try {
      const popup = screen.getByRole('dialog', { name: 'Live preview' });
      expect(ownerObservations()).toHaveLength(0);
      expect(popup).not.toHaveAttribute('data-app-design-owner');
      view.rerender(<LivePreview design="incomplete" />);
      await waitFor(() => expect(popup.closest('[data-app-design-portal]')).toHaveAttribute('data-app-design-preview'));
      expect(ownerObservations()).toHaveLength(0);
      expect(popup).not.toHaveAttribute('data-app-design-owner');
      view.rerender(<LivePreview design="editorial" />);
      await waitFor(() => expect(popup).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial')));
      expect(ownerObservations()).toHaveLength(1);
      view.rerender(<LivePreview design="incomplete" />);
      await waitFor(() => expect(popup).not.toHaveAttribute('data-app-design-owner'));
      expect(document.querySelector('[data-app-design-owner]')).toBeNull();
      expect(ownerObservations()).toHaveLength(1);
      view.rerender(<LivePreview design="bauhaus" />);
      await waitFor(() => expect(popup).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-bauhaus')));
      expect(ownerObservations()).toHaveLength(2);
      view.unmount();
      expect(document.querySelector('[data-app-design-owner]')).toBeNull();
    } finally {
      view.unmount();
      observe.mockRestore();
    }
  });

  it('uses the verified anchor preview even when declared outside it and opened without focus', async () => {
    function AnchoredPreview() {
      const anchorRef = useRef<HTMLButtonElement>(null);
      return <>
        <section data-app-design-preview="" {...getAppDesignAttributes('editorial')} dir="rtl" lang="ar">
          <Button ref={anchorRef}>Preview anchor</Button>
        </section>
        <Popover open anchorRef={anchorRef} onClose={() => {}} ariaLabel="Anchored preview">
          <Button>Actual portal action</Button>
          <svg aria-hidden="true"><path data-testid="portal-vendor-descendant" d="M0 0h1" /></svg>
        </Popover>
      </>;
    }
    const view = render(<AnchoredPreview />);
    const popup = screen.getByRole('dialog', { name: 'Anchored preview' });
    const boundary = popup.closest('[data-app-design-portal]');
    expect(boundary?.parentElement).toBe(document.body);
    expect(boundary).toHaveAttribute('dir', 'rtl');
    expect(boundary).toHaveAttribute('lang', 'ar');
    expect(popup).toHaveAttribute('aria-modal', 'false');
    for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) {
      expect(boundary).toHaveAttribute(name, value);
    }
    const vendor = screen.getByTestId('portal-vendor-descendant');
    expect(vendor).not.toHaveAttribute('data-app-part');
    for (const target of [boundary, popup, vendor]) {
      expect(target).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial'));
      expect(target).toHaveAttribute('data-app-design-owner', expect.stringContaining('controls-underline'));
    }
    const inserted = document.createElement('span');
    popup.append(inserted);
    await waitFor(() => expect(inserted).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial')));
    const preview = view.container.querySelector('[data-app-design-preview]');
    expect(preview).not.toContainElement(popup);
    preview?.setAttribute('data-app-controls', 'filled');
    await waitFor(() => expect(boundary).not.toHaveAttribute('data-app-design-pack'));
    expect(boundary).toHaveAttribute('data-app-design-preview');
    await waitFor(() => {
      for (const target of [boundary, popup, vendor, inserted]) {
        expect(target).not.toHaveAttribute('data-app-design-owner');
      }
    });
    preview?.setAttribute('data-app-controls', 'underline');
    await waitFor(() => {
      expect(boundary).toHaveAttribute('data-app-design-pack', 'editorial');
      for (const target of [boundary, popup, vendor, inserted]) {
        expect(target).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial'));
      }
    });
    view.unmount();
    expect(vendor).not.toHaveAttribute('data-app-design-owner');
    expect(inserted).not.toHaveAttribute('data-app-design-owner');
  });

  it('supports menu semantics without changing the default dialog surface', () => {
    function MenuHarness() {
      const anchorRef = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <Button ref={anchorRef}>Menu trigger</Button>
          <Popover open onClose={() => {}} anchorRef={anchorRef} role="menu" ariaLabel="Actions">
            <Button>Action</Button>
          </Popover>
        </>
      );
    }
    render(<MenuHarness />);
    expect(screen.getByRole('menu', { name: 'Actions' })).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('dialog', { name: 'Actions' })).toBeNull();
  });

  it('retains the preview and inherited locale after its anchor is removed while open', async () => {
    function RemovedAnchorPreview() {
      const anchorRef = useRef<HTMLButtonElement>(null);
      const [visible, setVisible] = useState(true);
      return <>
        <section dir="rtl" lang="ar" data-testid="preview-locale">
          <section data-app-design-preview="" {...getAppDesignAttributes('editorial')}>
            {visible && <Button ref={anchorRef} onClick={() => setVisible(false)}>Remove preview anchor</Button>}
          </section>
        </section>
        <Popover open anchorRef={anchorRef} onClose={() => {}} ariaLabel="Retained preview">
          <Button>Retained portal action</Button>
        </Popover>
      </>;
    }
    render(<RemovedAnchorPreview />);
    const popup = screen.getByRole('dialog', { name: 'Retained preview' });
    const boundary = popup.closest('[data-app-design-portal]');

    fireEvent.click(screen.getByRole('button', { name: 'Remove preview anchor' }));
    expect(screen.queryByRole('button', { name: 'Remove preview anchor' })).toBeNull();
    for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) {
      expect(boundary).toHaveAttribute(name, value);
    }
    expect(boundary).toHaveAttribute('dir', 'rtl');
    expect(boundary).toHaveAttribute('lang', 'ar');

    const locale = screen.getByTestId('preview-locale');
    locale.setAttribute('dir', 'ltr');
    locale.setAttribute('lang', 'en');
    await waitFor(() => {
      expect(boundary).toHaveAttribute('dir', 'ltr');
      expect(boundary).toHaveAttribute('lang', 'en');
    });
  });

  it('does not steal focus from another control during a popover handoff', () => {
    render(<HandoffHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    screen.getByRole('button', { name: 'Inside' }).focus();
    const second = screen.getByRole('button', { name: 'Second' });
    second.focus();
    fireEvent.click(second);

    expect(second).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'First menu' })).toBeNull();
  });

  it('still restores focus to the trigger after Escape', () => {
    render(<HandoffHarness />);

    const first = screen.getByRole('button', { name: 'First' });
    fireEvent.click(first);
    screen.getByRole('button', { name: 'Inside' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(first).toHaveFocus();
  });
});
