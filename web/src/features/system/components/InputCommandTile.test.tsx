// Behavioural coverage for InputCommandTile — the "input" command tile that
// opens a parameter dialog when activated (used by VehicleCommandCenter for
// every `type: 'input'` command).
//
// These tests pin the load-bearing contract: the whole tile is a keyboard-
// operable button that requests the dialog, a nested favourite toggle that
// stops propagation, loading/status/variant facets, and the malformed-config
// hardening path (an undefined icon must not blank the grid).
//
// react-i18next is mocked (not the real runtime) so `t` returns the fallback
// deterministically AND we can assert the exact i18n key + fallback each label
// is wired to. Keyboard favorite regressions use user-event for native button
// activation; fireEvent also pins event cancellation. Nothing touches the network.

import type { ComponentProps, ReactNode } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputCommandTile } from './InputCommandTile';
import type { CommandDef } from '../commands';
import type { LucideIcon } from '@/lib/icons';

const { mockT } = vi.hoisted(() => ({
  // Mirror react-i18next's `t(key, fallback)` contract: return the fallback so
  // the rendered copy is the fixture's fallback, while recording the key so
  // tests can prove the i18n wiring.
  mockT: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// A stub Lucide icon that surfaces the className the tile forwards so tests can
// prove the glyph rendered (and is decorative).
const StubIcon = ((props: { className?: string }) => (
  <svg data-testid="cmd-glyph" className={props.className} />
)) as unknown as LucideIcon;

type Props = ComponentProps<typeof InputCommandTile>;

function makeDef(overrides: Partial<CommandDef> = {}): CommandDef {
  return {
    id: 'charge_limit',
    command: 'set_charge_limit',
    labelKey: 'commands.charging.chargeLimit',
    labelFallback: 'Charge Limit',
    sublabelKey: 'commands.charging.percent',
    sublabelFallback: 'Percent',
    icon: StubIcon,
    category: 'charging',
    type: 'input',
    inputConfig: {
      promptKey: 'commands.charging.enterLimit',
      promptFallback: 'Enter charge limit:',
      paramName: 'percent',
    },
    ...overrides,
  };
}

function renderTile(overrides: Partial<Props> = {}) {
  const onRequestDialog = overrides.onRequestDialog ?? vi.fn();
  const onToggleFavorite = overrides.onToggleFavorite ?? vi.fn();
  const def = overrides.def ?? makeDef();
  const utils = render(
    <InputCommandTile
      def={def}
      onRequestDialog={onRequestDialog}
      loading={overrides.loading ?? false}
      disabled={overrides.disabled}
      disabledReason={overrides.disabledReason}
      lastStatus={overrides.lastStatus}
      isFavorite={overrides.isFavorite ?? false}
      onToggleFavorite={onToggleFavorite}
    />,
  );
  return { ...utils, onRequestDialog, onToggleFavorite, def };
}

// The tile carries the command label as its accessible name; the nested toggle
// is the only other button and is named "Toggle favorite".
const tile = () => screen.getByRole('button', { name: 'Charge Limit' });
const favorite = () => screen.getByRole('button', { name: 'Toggle favorite' });

afterEach(() => {
  cleanup();
  mockT.mockClear();
});

describe('InputCommandTile', () => {
  it('renders the label, sublabel and glyph through i18n with the exact keys + fallbacks', () => {
    renderTile();

    expect(screen.getByText('Charge Limit')).toBeInTheDocument();
    expect(screen.getByText('Percent')).toBeInTheDocument();
    expect(screen.getByTestId('cmd-glyph')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('commands.charging.chargeLimit', 'Charge Limit');
    expect(mockT).toHaveBeenCalledWith('commands.charging.percent', 'Percent');
    expect(mockT).toHaveBeenCalledWith('commands.toggleFavorite', 'Toggle favorite');
  });

  it('exposes the tile as a keyboard-focusable button named after the command', () => {
    renderTile();

    const el = tile();
    expect(el).toHaveAttribute('role', 'button');
    expect(el).toHaveAttribute('tabindex', '0');
    el.focus();
    expect(el).toHaveFocus();
  });

  it('opens the input dialog with the command def when clicked', () => {
    const { onRequestDialog, def } = renderTile();

    fireEvent.click(tile());

    expect(onRequestDialog).toHaveBeenCalledTimes(1);
    expect(onRequestDialog).toHaveBeenCalledWith(def);
  });

  it('activates on Enter and Space (cancelling the key default) but ignores other keys', () => {
    const { onRequestDialog } = renderTile();
    const el = tile();

    // fireEvent.keyDown returns false when a handler called preventDefault.
    expect(fireEvent.keyDown(el, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(el, { key: ' ' })).toBe(false);
    expect(onRequestDialog).toHaveBeenCalledTimes(2);

    // A non-activating key must neither open the dialog nor cancel its default.
    expect(fireEvent.keyDown(el, { key: 'a' })).toBe(true);
    expect(onRequestDialog).toHaveBeenCalledTimes(2);
  });

  it.each(['Enter', ' '])('does not cancel favorite keydown %j or request the dialog', (key) => {
    const { onRequestDialog, onToggleFavorite } = renderTile();
    const fav = favorite();
    fav.focus();

    expect(fireEvent.keyDown(fav, { key })).toBe(true);
    expect(fav).toHaveFocus();
    expect(onRequestDialog).not.toHaveBeenCalled();
    expect(onToggleFavorite).not.toHaveBeenCalled();
  });

  it.each([
    ['Enter', '{Enter}', 'available', false, false],
    ['Space', ' ', 'available', false, false],
    ['Enter', '{Enter}', 'loading', true, false],
    ['Space', ' ', 'loading', true, false],
    ['Enter', '{Enter}', 'permission-disabled', false, true],
    ['Space', ' ', 'permission-disabled', false, true],
  ] as const)(
    'toggles favorites with %s (%s) while %s without opening the dialog',
    async (_key, keyboardInput, _state, loading, disabled) => {
      const user = userEvent.setup();
      const { onRequestDialog, onToggleFavorite, def, rerender } = renderTile({ loading, disabled });

      await user.tab();
      if (!loading && !disabled) {
        expect(tile()).toHaveFocus();
        await user.tab();
      }
      const fav = favorite();
      expect(fav).toHaveFocus();
      expect(fav).toHaveAttribute('aria-pressed', 'false');

      await user.keyboard(keyboardInput);
      expect(onToggleFavorite).toHaveBeenCalledTimes(1);
      expect(onRequestDialog).not.toHaveBeenCalled();
      expect(fav).toHaveFocus();

      rerender(
        <InputCommandTile
          def={def}
          onRequestDialog={onRequestDialog}
          loading={loading}
          disabled={disabled}
          isFavorite
          onToggleFavorite={onToggleFavorite}
        />,
      );
      expect(fav).toHaveAttribute('aria-pressed', 'true');
      await user.keyboard(keyboardInput);
      expect(onToggleFavorite).toHaveBeenCalledTimes(2);
      expect(onRequestDialog).not.toHaveBeenCalled();
      expect(fav).toHaveFocus();
    },
  );

  it('blocks mouse and tile keyboard activation when permission-disabled', () => {
    const { onRequestDialog } = renderTile({ disabled: true, disabledReason: 'Read-only mode' });
    const el = tile();

    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveAttribute('tabindex', '-1');
    expect(el).toHaveAttribute('title', 'Read-only mode');
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyDown(el, { key: ' ' });
    expect(onRequestDialog).not.toHaveBeenCalled();
  });

  it('shows a spinner and blocks activation while loading', () => {
    const { onRequestDialog, container } = renderTile({ loading: true });
    const el = tile();

    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByTestId('cmd-glyph')).toBeNull();
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveAttribute('tabindex', '-1');
    expect(el.className).toContain('opacity-50');

    fireEvent.click(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onRequestDialog).not.toHaveBeenCalled();
  });

  it('reflects the favourite state and toggles it without opening the dialog', () => {
    const { onRequestDialog, onToggleFavorite } = renderTile({ isFavorite: true });

    const fav = favorite();
    expect(fav).toHaveAttribute('aria-pressed', 'true');
    expect(fav.querySelector('svg')?.getAttribute('class')).toContain('fill-current');

    fireEvent.click(fav);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    // stopPropagation must keep the favourite click from bubbling to the tile.
    expect(onRequestDialog).not.toHaveBeenCalled();
  });

  it('marks the favourite control unpressed and the star unfilled when not a favourite', () => {
    renderTile({ isFavorite: false });

    const fav = favorite();
    expect(fav).toHaveAttribute('aria-pressed', 'false');
    expect(fav.querySelector('svg')?.getAttribute('class') ?? '').not.toContain('fill-current');
  });

  it('colours a successful status green and a failed status red (announced politely)', () => {
    const ok = renderTile({ lastStatus: '✓ Sent' });
    const okEl = screen.getByText('✓ Sent');
    expect(okEl.className).toContain('text-emerald-300');
    expect(okEl).toHaveAttribute('aria-live', 'polite');
    ok.unmount();

    renderTile({ lastStatus: 'Command failed' });
    const badEl = screen.getByText('Command failed');
    expect(badEl.className).toContain('text-rose-300');
    expect(badEl.className).not.toContain('text-emerald-300');
  });

  it('applies the variant-specific hover accent and falls back to default for unknown variants', () => {
    const danger = renderTile({ def: makeDef({ variant: 'danger' }) });
    expect(tile().className).toContain('hover:border-neon-red/30');
    danger.unmount();

    const success = renderTile({ def: makeDef({ variant: 'success' }) });
    expect(tile().className).toContain('hover:border-neon-green/30');
    success.unmount();

    // A malformed config with an out-of-union variant must not blank the accent.
    renderTile({ def: makeDef({ variant: 'wat' as unknown as CommandDef['variant'] }) });
    expect(tile().className).toContain('hover:border-neon-cyan/30');
  });

  it('omits the sublabel when the command has none', () => {
    renderTile({ def: makeDef({ sublabelKey: undefined, sublabelFallback: undefined }) });

    expect(screen.getByText('Charge Limit')).toBeInTheDocument();
    expect(screen.queryByText('Percent')).toBeNull();
  });

  it('degrades gracefully when the icon reference is missing (malformed config)', () => {
    // A config-driven CommandDef could arrive with an undefined icon. The tile
    // must skip the glyph rather than throw "Element type is invalid" and blank
    // the whole command grid.
    expect(() =>
      renderTile({ def: makeDef({ icon: undefined as unknown as LucideIcon }) }),
    ).not.toThrow();

    expect(screen.getByText('Charge Limit')).toBeInTheDocument();
    expect(screen.queryByTestId('cmd-glyph')).toBeNull();
    // Not loading, so no spinner stands in for the missing glyph either.
    expect(document.querySelector('.animate-spin')).toBeNull();
  });
});
