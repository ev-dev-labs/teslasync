/**
 * Phase-45 / Prompt 25 — AddWidgetButton (floating + button) tests.
 *
 * Verifies:
 *   - Hidden when the dashboard is in edit mode (the existing header
 *     `Add Widget` action covers that surface).
 *   - Visible and clickable otherwise — wired to the supplied onClick.
 *   - Exposes an accessible label so screen readers announce it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n';

import { AddWidgetButton } from '../AddWidgetButton';

describe('AddWidgetButton — Phase-45 / Prompt 25', () => {
  it('renders nothing when the dashboard is in edit mode', () => {
    const { container } = render(
      <AddWidgetButton onClick={() => {}} isEditing />,
    );
    expect(container.firstChild).toBeNull();
    cleanup();
  });

  it('renders a focusable button with an accessible label when not editing', () => {
    render(<AddWidgetButton onClick={() => {}} isEditing={false} />);
    const button = screen.getByRole('button', { name: /add widget/i });
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe('BUTTON');
    cleanup();
  });

  it('invokes onClick exactly once when clicked', () => {
    const onClick = vi.fn();
    render(<AddWidgetButton onClick={onClick} isEditing={false} />);
    const button = screen.getByRole('button', { name: /add widget/i });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('renders inside a fixed-position container so the FAB clears the StatusBar (z-[55])', () => {
    render(<AddWidgetButton onClick={() => {}} isEditing={false} />);
    const fab = screen.getByTestId('dashboard-add-widget-fab');
    // The wrapper is positioned with `fixed` + a z-index above the StatusBar.
    // Asserting on the className (rather than computed style) is sufficient
    // because Tailwind utilities are deterministic.
    expect(fab.className).toContain('fixed');
    expect(fab.className).toContain('z-[56]');
    cleanup();
  });
});
