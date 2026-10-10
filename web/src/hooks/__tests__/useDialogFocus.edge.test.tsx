/**
 * Extra `useDialogFocus` cases that need their own harness (A11Y-04).
 *
 * Kept separate from `useDialogFocus.test.tsx` so the main file stays a
 * straight read of the happy path.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import type { UseDialogFocusOptions } from '@/hooks/useDialogFocus';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';

/** Dialog opened programmatically — nothing was focused beforehand. */
function ProgrammaticHarness() {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus({ open, containerRef: ref, onClose: () => setOpen(false) });
  return (
    <div>
      <main id="main-content" tabIndex={-1} data-testid="main" />
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
          <button type="button">only</button>
        </div>
      )}
    </div>
  );
}

/** Closing this dialog immediately focuses something else. */
function ClaimingHarness() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus({
    open,
    containerRef: ref,
    onClose: () => {
      setOpen(false);
      // Model a "confirm → detail" flow, where closing one surface hands
      // focus straight to another.
      document.getElementById('next-surface')?.focus();
    },
  });
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button" id="next-surface" data-testid="next">
        next
      </button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
          <button type="button">inside</button>
        </div>
      )}
    </div>
  );
}

  function ExplicitEdgeDialog({
    open,
    getReturnFocusTarget,
    fallbackRef,
    name = 'Outgoing',
    field = true,
    children,
  }: Pick<UseDialogFocusOptions, 'open' | 'getReturnFocusTarget' | 'fallbackRef'> & {
    name?: string;
    field?: boolean;
    children?: React.ReactNode;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    useDialogFocus({ open, containerRef: ref, getReturnFocusTarget, fallbackRef });
    return open ? <div ref={ref} role="dialog" aria-label={name} tabIndex={-1}>
      {field && <input aria-label={`${name} draft`} autoFocus />}
      {children}
    </div> : null;
  }

  describe('useDialogFocus — explicit return safety', () => {
    it.each(['null', 'stale', 'disposed', 'throw', 'disabled', 'disconnected', 'body', 'container', 'descendant'] as const)(
      'uses safe fallback rather than a captured field or replacement for %s',
      (kind) => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const detached = document.createElement('button');
        let stale = false;
        let disposed = false;
        const getter = vi.fn(() => {
          if (kind === 'throw') throw new Error('private target detail');
          if (kind === 'body') return document.body;
          if (kind === 'disconnected') return detached;
          if (kind === 'disabled') return screen.getByText('Disabled return');
          if (kind === 'container') return screen.queryByRole('dialog', { name: 'Outgoing' });
          if (kind === 'descendant') return screen.queryByLabelText('Outgoing draft');
          if (kind === 'null' || stale || disposed) return null;
          return screen.getByText('Replacement must not win');
        });
        const content = (open: boolean) => <>
          <main id="main-content" tabIndex={-1}>Main fallback</main>
          <button disabled>Disabled return</button><button>Replacement must not win</button>
          <ExplicitEdgeDialog open={open} getReturnFocusTarget={getter} />
        </>;
        const view = render(content(true));
        expect(screen.getByLabelText('Outgoing draft')).toHaveFocus();
        expect(getter).not.toHaveBeenCalled();
        stale = kind === 'stale';
        disposed = kind === 'disposed';
        view.rerender(content(false));
        expect(getter).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Main fallback')).toHaveFocus();
        if (kind === 'throw') expect(log).toHaveBeenCalledExactlyOnceWith('Dialog return-focus target getter failed');
        else expect(log).not.toHaveBeenCalled();
        log.mockRestore();
      },
    );

    it.each(['container', 'descendant'] as const)('rejects a still-connected outgoing %s during owner unmount', (kind) => {
      const host = document.createElement('div');
      host.setAttribute('role', 'dialog');
      host.tabIndex = -1;
      const field = document.createElement('input');
      host.append(field);
      document.body.append(host);
      const main = document.createElement('main');
      main.id = 'main-content';
      main.tabIndex = -1;
      document.body.append(main);
      const getter = vi.fn(() => kind === 'container' ? host : field);
      const view = renderHook(() => useDialogFocus({ open: true, containerRef: { current: host }, getReturnFocusTarget: getter }));
      expect(field).toHaveFocus();
      const focus = vi.spyOn(kind === 'container' ? host : field, 'focus');
      view.unmount();
      expect(host.isConnected).toBe(true);
      expect(getter).toHaveBeenCalledTimes(1);
      expect(focus).not.toHaveBeenCalled();
      expect(main).toHaveFocus();
      host.remove();
      main.remove();
    });

    it.each(['explicit', 'route', 'main'] as const)('retains the safe fallback precedence at %s', (selected) => {
      const fallback = document.createElement('button');
      fallback.textContent = 'Explicit fallback';
      document.body.append(fallback);
      const getter = vi.fn(() => null);
      const content = (open: boolean) => <>
        <h1 data-route-focus-target tabIndex={-1}>Route fallback</h1>
        <main id="main-content" tabIndex={-1}>Main fallback</main>
        <ExplicitEdgeDialog open={open} getReturnFocusTarget={getter} fallbackRef={{ current: fallback }} />
      </>;
      const view = render(content(true));
      if (selected !== 'explicit') fallback.disabled = true;
      if (selected === 'main') screen.getByText('Route fallback').setAttribute('aria-hidden', 'true');
      view.rerender(content(false));
      expect(getter).toHaveBeenCalledTimes(1);
      expect(selected === 'explicit' ? fallback : screen.getByText(selected === 'route' ? 'Route fallback' : 'Main fallback')).toHaveFocus();
      fallback.remove();
    });

    it('skips an outgoing fallbackRef to the valid route target without restoring captured autoFocus', () => {
      const host = document.createElement('div');
      host.tabIndex = -1;
      const input = document.createElement('input');
      host.append(input);
      document.body.append(host);
      const route = document.createElement('h1');
      route.setAttribute('data-route-focus-target', '');
      route.tabIndex = -1;
      document.body.append(route);
      const getter = vi.fn(() => null);
      const view = renderHook(() => useDialogFocus({
        open: true, containerRef: { current: host }, fallbackRef: { current: input }, getReturnFocusTarget: getter,
      }));
      expect(input).toHaveFocus();
      view.unmount();
      expect(getter).toHaveBeenCalledTimes(1);
      expect(route).toHaveFocus();
      host.remove();
      route.remove();
    });

    it('respects external intent before invoking either getter or fallback', async () => {
      const user = userEvent.setup();
      const getter = vi.fn(() => screen.getByText('Return trigger'));
      const content = (open: boolean) => <>
        <main id="main-content" tabIndex={-1}>Fallback</main>
        <button>Return trigger</button><button>External intent</button>
        <ExplicitEdgeDialog open={open} getReturnFocusTarget={getter} />
      </>;
      const view = render(content(true));
      await user.click(screen.getByText('External intent'));
      view.rerender(content(false));
      expect(getter).not.toHaveBeenCalled();
      expect(screen.getByText('External intent')).toHaveFocus();
    });

    it.each([false, true])('does not steal another live topmost owner from body (nested=%s)', (nested) => {
      const getter = vi.fn(() => screen.getByText('Outside return'));
      const content = (outgoing: boolean, field: boolean) => <>
        <main id="main-content" tabIndex={-1}>Outside fallback</main><button>Outside return</button>
        {nested ? <ExplicitEdgeDialog open name="Parent" field={false}>
          <ExplicitEdgeDialog open={outgoing} getReturnFocusTarget={getter} />
          <ExplicitEdgeDialog open name="Topmost" field={field} />
        </ExplicitEdgeDialog> : <>
          <ExplicitEdgeDialog open={outgoing} getReturnFocusTarget={getter} />
          <ExplicitEdgeDialog open name="Topmost" field={field} />
        </>}
      </>;
      const view = render(content(true, false));
      view.rerender(content(true, true));
      expect(screen.getByLabelText('Topmost draft')).toHaveFocus();
      view.rerender(content(true, false));
      expect(document.body).toHaveFocus();
      view.rerender(content(false, false));
      expect(getter).toHaveBeenCalledTimes(1);
      expect(document.body).toHaveFocus();
      expect(screen.getByRole('dialog', { name: 'Topmost' })).toBeInTheDocument();
    });

    it('preserves focus already claimed by another actual dialog owner', () => {
      const getter = vi.fn(() => screen.getByText('Return'));
      const content = (open: boolean) => <>
        <button>Return</button>
        <ExplicitEdgeDialog open={open} getReturnFocusTarget={getter} />
        <ExplicitEdgeDialog open name="Other" />
      </>;
      const view = render(content(true));
      expect(screen.getByLabelText('Other draft')).toHaveFocus();
      view.rerender(content(false));
      expect(getter).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Other draft')).toHaveFocus();
    });

    it('allows body recovery only into the live topmost dialog', () => {
      const getter = vi.fn(() => screen.getByRole('dialog', { name: 'Other' }));
      const content = (open: boolean, field: boolean) => <>
        <ExplicitEdgeDialog open={open} getReturnFocusTarget={getter} />
        <ExplicitEdgeDialog open name="Other" field={field} />
      </>;
      const view = render(content(true, true));
      view.rerender(content(true, false));
      expect(document.body).toHaveFocus();
      view.rerender(content(false, false));
      expect(getter).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('dialog', { name: 'Other' })).toHaveFocus();
    });
  });

describe('useDialogFocus — edge cases', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sends focus to the main landmark when there was no trigger', () => {
    render(<ProgrammaticHarness />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    // Leaving focus on <body> would restart the next Tab at the top of
    // the document — the exact failure the trap exists to prevent.
    expect(document.activeElement).toBe(screen.getByTestId('main'));
  });

  it('does not override a deliberate focus claim made while closing', () => {
    render(<ClaimingHarness />);
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(document.activeElement).toBe(screen.getByTestId('next'));
  });
});
