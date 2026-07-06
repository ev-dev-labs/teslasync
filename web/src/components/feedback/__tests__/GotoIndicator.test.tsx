import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { GotoIndicator } from '../GotoIndicator';

/**
 * GotoIndicator contract.
 *
 * The indicator is the transient overlay shown while the keyboard-shortcut
 * state machine is in `goto` mode (after the user presses `g`). It must:
 *   - render nothing while hidden (the `visible` branch),
 *   - expose a live-region status role so screen readers announce the mode,
 *   - render the localized prompt + the two `<kbd>` key hints, and
 *   - resolve a DEDICATED i18n key — regression guard for the collision with
 *     the cheat-sheet's `shortcuts.goto` ("Go to {{label}}") which leaked the
 *     raw `{{label}}` placeholder into the user-facing prompt.
 */
describe('GotoIndicator', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<GotoIndicator visible={false} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('goto-indicator')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the overlay when visible', () => {
    render(<GotoIndicator visible={true} />);
    const indicator = screen.getByTestId('goto-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator.tagName).toBe('DIV');
  });

  it('exposes a polite live-region status role for screen-reader announcement', () => {
    render(<GotoIndicator visible={true} />);
    const status = screen.getByRole('status');
    expect(status).toBe(screen.getByTestId('goto-indicator'));
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('renders the two keyboard hints "g" and "?" as <kbd> elements', () => {
    render(<GotoIndicator visible={true} />);
    const keys = screen.getAllByText((_content, el) => el?.tagName === 'KBD');
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.textContent)).toEqual(['g', '?']);
  });

  it('marks the "+" separator as decorative (aria-hidden) so it is not announced', () => {
    render(<GotoIndicator visible={true} />);
    const separator = screen.getByText('+');
    expect(separator).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the localized prompt from the dedicated gotoPrompt key', () => {
    render(<GotoIndicator visible={true} />);
    const expected = i18n.t('shortcuts.gotoPrompt', 'Go to…');
    expect(screen.getByTestId('goto-indicator')).toHaveTextContent(expected);
    expect(expected).toContain('Go to');
  });

  it('does NOT leak the cheat-sheet label placeholder (regression for key collision)', () => {
    render(<GotoIndicator visible={true} />);
    const text = screen.getByTestId('goto-indicator').textContent ?? '';
    // The old code reused `shortcuts.goto` ("Go to {{label}}") without a
    // `label`, rendering the raw placeholder. The dedicated key must not.
    expect(text).not.toContain('{{label}}');
    expect(text).not.toContain('label');
    expect(i18n.t('shortcuts.gotoPrompt')).not.toBe(i18n.t('shortcuts.goto'));
  });

  it('mounts and unmounts as the visible prop toggles', () => {
    const { rerender } = render(<GotoIndicator visible={true} />);
    expect(screen.getByTestId('goto-indicator')).toBeInTheDocument();

    rerender(<GotoIndicator visible={false} />);
    expect(screen.queryByTestId('goto-indicator')).not.toBeInTheDocument();

    rerender(<GotoIndicator visible={true} />);
    expect(screen.getByTestId('goto-indicator')).toBeInTheDocument();
  });
});
