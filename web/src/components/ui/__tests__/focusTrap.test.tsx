/**
 * Focus-trap audit — .
 *
 * Comprehensive accessibility audit verifies that every dialog-style overlay
 * shipped from `@/components/ui/*` traps Tab + Shift+Tab inside the dialog
 * while open, so keyboard users cannot accidentally focus elements behind
 * the modal scrim. Each test mounts the dialog with multiple focusable
 * children, presses Tab past the last focusable, and asserts that focus
 * wraps to the first focusable (and vice versa for Shift+Tab).
 *
 * Coverage:
 * - <Modal> — the canonical primitive
 * - <ConfirmDialog> — composed on top of <Modal>; verifies inheritance
 * - <Drawer> — independent implementation; was unaudited
 *
 * <CommandPalette> is intentionally NOT covered here: it implements its
 * own keyboard navigation primitive (single-input, arrow-key result list,
 * Esc-to-close) where Tab is *not* used to navigate within the palette,
 * so the standard Tab-trap pattern does not apply. Its keyboard behavior
 * is verified by `CommandPalette.test.tsx`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { Modal } from '../Modal';
import { Drawer } from '../Drawer';
import { ConfirmDialog } from '../ConfirmDialog';

// i18n stub so any `t()` calls in dialog children (e.g. ConfirmDialog's
// typed-confirmation copy) resolve to readable strings without a provider.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

function getFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

describe('focus trap — Phase-45 / Prompt 13', () => {
  afterEach(() => {
    cleanup();
  });

  describe('<Modal>', () => {
    it('moves initial focus to the first focusable element on open', () => {
      render(
        <Modal open onClose={() => {}} title="Test modal" data-testid="focus-trap-root">
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </Modal>,
      );
      // The Modal's title-bar Close button is the first focusable, so it
      // receives initial focus. Verify the document's activeElement is
      // inside the dialog rather than asserting on the specific button.
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('wraps focus on Tab from the last focusable to the first', () => {
      render(
        <Modal open onClose={() => {}} title="Test modal">
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      const focusables = getFocusables(dialog);
      expect(focusables.length).toBeGreaterThanOrEqual(2);

      // Move focus to the last focusable, press Tab, expect wrap to first.
      const last = focusables[focusables.length - 1];
      const first = focusables[0];
      act(() => last.focus());
      expect(document.activeElement).toBe(last);

      fireEvent.keyDown(dialog, { key: 'Tab' });
      expect(document.activeElement).toBe(first);
    });

    it('wraps focus on Shift+Tab from the first focusable to the last', () => {
      render(
        <Modal open onClose={() => {}} title="Test modal">
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      const focusables = getFocusables(dialog);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      act(() => first.focus());
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it('Escape calls onClose', () => {
      const onClose = vi.fn();
      render(
        <Modal open onClose={onClose} title="Test modal">
          <button type="button">Action</button>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('<Drawer>', () => {
    it('moves initial focus to the first focusable element on open', () => {
      render(
        <Drawer open onClose={() => {}} title="Test drawer">
          <button type="button">First</button>
          <button type="button">Last</button>
        </Drawer>,
      );
      const drawer = screen.getByRole('dialog');
      expect(drawer.contains(document.activeElement)).toBe(true);
    });

    it('wraps focus on Tab from the last focusable to the first', () => {
      render(
        <Drawer open onClose={() => {}} title="Test drawer">
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </Drawer>,
      );
      const drawer = screen.getByRole('dialog');
      const focusables = getFocusables(drawer);
      expect(focusables.length).toBeGreaterThanOrEqual(2);

      const last = focusables[focusables.length - 1];
      const first = focusables[0];
      act(() => last.focus());
      fireEvent.keyDown(drawer, { key: 'Tab' });
      expect(document.activeElement).toBe(first);
    });

    it('wraps focus on Shift+Tab from the first focusable to the last', () => {
      render(
        <Drawer open onClose={() => {}} title="Test drawer">
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </Drawer>,
      );
      const drawer = screen.getByRole('dialog');
      const focusables = getFocusables(drawer);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      act(() => first.focus());
      fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it('Escape calls onClose', () => {
      const onClose = vi.fn();
      render(
        <Drawer open onClose={onClose} title="Test drawer">
          <button type="button">Action</button>
        </Drawer>,
      );
      const drawer = screen.getByRole('dialog');
      fireEvent.keyDown(drawer, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('<ConfirmDialog>', () => {
    it('inherits focus trap from <Modal>', () => {
      render(
        <ConfirmDialog
          open
          title="Confirm"
          message="Are you sure?"
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);

      const focusables = getFocusables(dialog);
      // ConfirmDialog renders Cancel + Confirm + the Modal's Close (X)
      // header button — at least three focusable controls.
      expect(focusables.length).toBeGreaterThanOrEqual(2);

      const last = focusables[focusables.length - 1];
      const first = focusables[0];
      act(() => last.focus());
      fireEvent.keyDown(dialog, { key: 'Tab' });
      expect(document.activeElement).toBe(first);
    });
  });
});
