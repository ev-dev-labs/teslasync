/**
 * GDPRLookupPanel — behaviour + hardening coverage.
 *
 * A controlled, presentational artifact-ID lookup form. It owns no data of its
 * own; its whole contract is (a) reflect the `idInput` prop, (b) forward edits
 * through `onIdChange`, and (c) request a lookup through `onLookup` — but ONLY
 * when there is a non-empty, non-whitespace id. That "is there something to
 * look up?" guard drives BOTH activation paths (the Look-up button's disabled
 * state and the Enter-key shortcut), so this suite pins them to the same rule.
 *
 * The suite exercises the single exported component across every facet:
 *   - structure: title, labelled input, placeholder, button, hint + blurb.
 *   - the controlled contract: value reflection + onIdChange forwarding.
 *   - button gating: empty / whitespace-only → disabled, content → enabled,
 *     and a disabled click never fires onLookup.
 *   - the Enter-key shortcut: fires on a real id, and — the bug this suite
 *     fixes — stays silent for empty / whitespace ids (previously Enter fired
 *     even while the button was disabled) and ignores non-Enter keys.
 *   - accessibility: the input is bound to its visible label, and the icon-only
 *     glyphs are decorative so the button's accessible name is just "Look up".
 *   - null-safety: an undefined id must not throw and must fail closed
 *     (disabled button, empty controlled value, silent Enter).
 *
 * i18n is mocked to resolve the English fallback (2nd arg of `t`) so the
 * assertions read on copy, mirroring the sibling GasPriceTrendChart / StatusBadge
 * tests in this feature. No network is touched — the component makes no calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState, type ReactNode } from 'react';

// ── i18n: t(key, fallback) → fallback so label/copy assertions are stable. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

import { GDPRLookupPanel } from './GDPRLookupPanel';

interface SetupOverrides {
  idInput?: string;
  onIdChange?: (value: string) => void;
  onLookup?: () => void;
}

function setup(over: SetupOverrides = {}) {
  const onIdChange = over.onIdChange ?? vi.fn();
  const onLookup = over.onLookup ?? vi.fn();
  const utils = render(
    <GDPRLookupPanel idInput={over.idInput ?? ''} onIdChange={onIdChange} onLookup={onLookup} />,
  );
  const input = screen.getByLabelText('Artifact ID') as HTMLInputElement;
  const button = screen.getByRole('button', { name: /look up/i });
  return { ...utils, input, button, onIdChange, onLookup };
}

/**
 * Stateful parent so a `fireEvent.change` on the controlled input actually
 * updates the rendered value — exercising the real controlled round-trip
 * (child edit → parent state → child value) rather than a static prop.
 */
function StatefulHarness({ onLookup, initial = '' }: { onLookup: () => void; initial?: string }) {
  const [id, setId] = useState(initial);
  return <GDPRLookupPanel idInput={id} onIdChange={setId} onLookup={onLookup} />;
}

describe('GDPRLookupPanel — structure', () => {
  it('renders the title, labelled input, placeholder, button, hint and blurb', () => {
    const { input, button } = setup();
    expect(screen.getByText('Lookup artifact')).toBeInTheDocument();
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'e.g. 8f4c…');
    expect(button).toBeInTheDocument();
    expect(screen.getByText(/IDs come from the GDPR export queue/i)).toBeInTheDocument();
    expect(screen.getByText(/Bundles are streamed straight from the backend/i)).toBeInTheDocument();
  });

  it('reflects the idInput prop as the input value', () => {
    const { input } = setup({ idInput: '8f4c-4242' });
    expect(input).toHaveValue('8f4c-4242');
  });
});

describe('GDPRLookupPanel — lookup button gating', () => {
  it('disables the button when the id is empty', () => {
    const { button } = setup({ idInput: '' });
    expect(button).toBeDisabled();
  });

  it('disables the button when the id is whitespace-only (trim guard)', () => {
    const { button } = setup({ idInput: '   \t ' });
    expect(button).toBeDisabled();
  });

  it('enables the button once the id has non-whitespace content', () => {
    const { button } = setup({ idInput: ' 8f4c ' });
    expect(button).toBeEnabled();
  });

  it('calls onLookup exactly once when the enabled button is clicked', () => {
    const onLookup = vi.fn();
    const { button } = setup({ idInput: '8f4c', onLookup });
    fireEvent.click(button);
    expect(onLookup).toHaveBeenCalledTimes(1);
  });

  it('never fires onLookup when the disabled button is clicked', () => {
    const onLookup = vi.fn();
    const { button } = setup({ idInput: '', onLookup });
    fireEvent.click(button);
    expect(onLookup).not.toHaveBeenCalled();
  });
});

describe('GDPRLookupPanel — change handling', () => {
  it('forwards the new value to onIdChange on input change', () => {
    const onIdChange = vi.fn();
    const { input } = setup({ idInput: '', onIdChange });
    fireEvent.change(input, { target: { value: '8f4c-99' } });
    expect(onIdChange).toHaveBeenCalledTimes(1);
    expect(onIdChange).toHaveBeenCalledWith('8f4c-99');
  });

  it('rounds edits through a stateful parent and re-enables the button', () => {
    const onLookup = vi.fn();
    render(<StatefulHarness onLookup={onLookup} />);
    const input = screen.getByLabelText('Artifact ID') as HTMLInputElement;
    const button = screen.getByRole('button', { name: /look up/i });

    // Starts empty → disabled.
    expect(input).toHaveValue('');
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input).toHaveValue('abc');
    expect(button).toBeEnabled();
  });
});

describe('GDPRLookupPanel — Enter-key shortcut (guard consistency)', () => {
  it('triggers onLookup when Enter is pressed with a non-empty id', () => {
    const onLookup = vi.fn();
    const { input } = setup({ idInput: '8f4c', onLookup });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onLookup).toHaveBeenCalledTimes(1);
  });

  it('stays silent on Enter when the id is empty (matches the disabled button)', () => {
    const onLookup = vi.fn();
    const { input } = setup({ idInput: '', onLookup });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onLookup).not.toHaveBeenCalled();
  });

  it('stays silent on Enter when the id is whitespace-only', () => {
    const onLookup = vi.fn();
    const { input } = setup({ idInput: '   ', onLookup });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onLookup).not.toHaveBeenCalled();
  });

  it('ignores non-Enter keys', () => {
    const onLookup = vi.fn();
    const { input } = setup({ idInput: '8f4c', onLookup });
    fireEvent.keyDown(input, { key: 'a' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onLookup).not.toHaveBeenCalled();
  });
});

describe('GDPRLookupPanel — accessibility', () => {
  it('binds the input to its visible "Artifact ID" label', () => {
    const { input } = setup();
    expect(input.tagName).toBe('INPUT');
    // getByLabelText only resolves when the <label> is correctly associated.
    expect(screen.getByLabelText('Artifact ID')).toBe(input);
  });

  it('exposes the button by its "Look up" text with a decorative icon', () => {
    const { button } = setup({ idInput: '8f4c' });
    const svg = button.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(button).toHaveAccessibleName('Look up');
  });

  it('marks every decorative glyph aria-hidden so none pollute the a11y tree', () => {
    const { container } = setup({ idInput: '8f4c' });
    const svgs = container.querySelectorAll('svg');
    // The search glyph (button) + the info glyph (blurb).
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    svgs.forEach((svg) => expect(svg.getAttribute('aria-hidden')).toBe('true'));
  });
});

describe('GDPRLookupPanel — null-safety', () => {
  it('does not throw and fails closed when idInput is undefined', () => {
    const onLookup = vi.fn();
    expect(() =>
      render(
        <GDPRLookupPanel
          idInput={undefined as unknown as string}
          onIdChange={vi.fn()}
          onLookup={onLookup}
        />,
      ),
    ).not.toThrow();

    const input = screen.getByLabelText('Artifact ID') as HTMLInputElement;
    const button = screen.getByRole('button', { name: /look up/i });
    // `?? ''` keeps the control controlled + empty rather than uncontrolled.
    expect(input).toHaveValue('');
    expect(button).toBeDisabled();
    // And the Enter guard holds even without a real value.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onLookup).not.toHaveBeenCalled();
  });
});
