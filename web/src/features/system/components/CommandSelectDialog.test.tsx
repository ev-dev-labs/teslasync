import type { ComponentProps } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Icons } from '@/lib/icons';
import type { CommandDef, SelectOption } from '../commands';
import { CommandSelectDialog } from './CommandSelectDialog';

// Deterministic i18n: echo the inline English fallback so accessible names /
// labels are stable regardless of the (uninitialised) i18n store. Mirrors the
// convention in the sibling ChatMessageItem.test.tsx.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

// Mirrors the real `cop_temp` command config in ../commands.ts. The last
// option intentionally omits `description` to exercise the optional-caption
// branch.
const OPTIONS: SelectOption[] = [
  { value: '0', labelKey: 'commands.climate.copLow', labelFallback: 'Low', description: '90°F / 30°C' },
  { value: '1', labelKey: 'commands.climate.copMedium', labelFallback: 'Medium', description: '95°F / 35°C' },
  { value: '2', labelKey: 'commands.climate.copHigh', labelFallback: 'High' },
];

function makeDef(overrides: Partial<CommandDef> = {}): CommandDef {
  return {
    id: 'cop_temp',
    command: 'set_cop_temp',
    labelKey: 'commands.climate.copTemp',
    labelFallback: 'Cabin Overheat Protection',
    icon: Icons.climate,
    category: 'climate',
    type: 'input',
    selectConfig: { paramName: 'cop_temp', options: OPTIONS },
    ...overrides,
  };
}

function renderDialog(
  props: Partial<ComponentProps<typeof CommandSelectDialog>> = {},
) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <CommandSelectDialog
      open
      onClose={onClose}
      onSelect={onSelect}
      def={makeDef()}
      {...props}
    />,
  );
  return { onClose, onSelect, ...utils };
}

describe('CommandSelectDialog', () => {
  it('renders a named dialog with one button per option, descriptions, a decorative icon and Cancel', () => {
    renderDialog();

    // The dialog carries an explicit accessible name (there is no visible
    // Modal `title`), and the visible heading is a real <h2>.
    expect(
      screen.getByRole('dialog', { name: 'Cabin Overheat Protection' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Cabin Overheat Protection' }),
    ).toBeInTheDocument();

    // One selectable button per option, plus the Cancel affordance.
    expect(screen.getByRole('button', { name: /Low/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Medium/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /High/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    // Descriptions render for the options that define one.
    expect(screen.getByText('90°F / 30°C')).toBeInTheDocument();
    expect(screen.getByText('95°F / 35°C')).toBeInTheDocument();

    // The leading command glyph is decorative and hidden from assistive tech.
    // (<Modal> portals to document.body, so query the document, not the
    // render container.)
    expect(document.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders nothing when open is false', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Low/ })).toBeNull();
  });

  it('forwards the selected option value via onSelect without closing itself', () => {
    const { onSelect, onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /Medium/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('1');
    // Selecting delegates closing to the parent — the dialog must not self-close.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes via the Cancel button without selecting anything', () => {
    const { onSelect, onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables every option while loading so a click cannot fire onSelect, yet Cancel stays usable', () => {
    const { onSelect, onClose } = renderDialog({ loading: true });

    const low = screen.getByRole('button', { name: /Low/ });
    expect(low).toBeDisabled();
    fireEvent.click(low);
    expect(onSelect).not.toHaveBeenCalled();

    // Cancel is never gated on `loading` — the user can always back out.
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).not.toBeDisabled();
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state (and no option buttons) when the command exposes no options', () => {
    const { onSelect } = renderDialog({
      def: makeDef({ selectConfig: { paramName: 'cop_temp', options: [] } }),
    });

    expect(screen.getByText('No options available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Low/ })).toBeNull();
    // Only the Cancel affordance remains.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('tolerates a malformed definition with no selectConfig and renders the empty state instead of crashing', () => {
    renderDialog({ def: makeDef({ selectConfig: undefined }) });

    expect(screen.getByText('No options available')).toBeInTheDocument();
    // The dialog itself still renders with its accessible name intact.
    expect(
      screen.getByRole('dialog', { name: 'Cabin Overheat Protection' }),
    ).toBeInTheDocument();
  });

  it('omits the description caption for options that do not define one', () => {
    renderDialog();

    // "High" has no `description`, so its button must not carry a temperature
    // caption (every seeded description contains a degree sign).
    const high = screen.getByRole('button', { name: /High/ });
    expect(within(high).queryByText(/°/)).toBeNull();
  });

  it('closes when Escape is pressed inside the dialog', () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
