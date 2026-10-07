import { type ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToggleCommandTile } from './ToggleCommandTile';
import type { CommandDef, VehicleState } from '../commands';

// Deterministic i18n: echo the provided fallback so text/label assertions do
// not depend on the runtime translation catalogue (mirrors the repo's
// CommandTile / CollapsibleCommandGroup test convention).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

// Distinct stand-ins for the on/off lucide glyphs so we can tell which icon the
// tile chose (and separate them from the Loader2 spinner and favorite Star).
function OnIcon(props: Record<string, unknown>) {
  return <svg data-testid="cmd-icon-on" {...props} />;
}
function OffIcon(props: Record<string, unknown>) {
  return <svg data-testid="cmd-icon-off" {...props} />;
}

function makeDef(overrides: Partial<CommandDef> = {}): CommandDef {
  return {
    id: 'climate',
    command: 'auto_conditioning_start',
    commandOff: 'auto_conditioning_stop',
    labelKey: 'commands.climate.toggle',
    labelFallback: 'Climate',
    icon: OnIcon as unknown as CommandDef['icon'],
    iconOff: OffIcon as unknown as CommandDef['icon'],
    category: 'climate',
    type: 'toggle',
    stateField: 'is_climate_on',
    ...overrides,
  };
}

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    battery_level: 80,
    rated_range: 300,
    is_locked: true,
    is_charging: false,
    is_climate_on: false,
    sentry_mode: false,
    inside_temp: 21,
    speed: 0,
    ...overrides,
  };
}

type Props = ComponentProps<typeof ToggleCommandTile>;

function renderTile(overrides: Partial<Props> = {}) {
  const props: Props = {
    def: makeDef(),
    state: null,
    onExecute: vi.fn(),
    onRequestDialog: vi.fn(),
    loading: false,
    isFavorite: false,
    onToggleFavorite: vi.fn(),
    ...overrides,
  };
  const utils = render(<ToggleCommandTile {...props} />);
  const tile = () => screen.getByRole('button', { name: props.def.labelFallback });
  const favorite = () => screen.getByRole('button', { name: /toggle favorite/i });
  return { ...utils, props, tile, favorite };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ToggleCommandTile', () => {
  it('renders an accessible toggle button that is OFF by default, showing the off glyph (not a spinner) and no busy state', () => {
    const { container, tile } = renderTile();

    const el = tile();
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('aria-pressed', 'false');
    expect(el).toHaveAttribute('tabindex', '0');
    // Idle → aria-busy/aria-disabled are omitted rather than rendered "false".
    expect(el).not.toHaveAttribute('aria-busy');
    expect(el).not.toHaveAttribute('aria-disabled');
    // OFF sublabel + off glyph, no loading spinner.
    expect(screen.getByText('OFF')).toBeInTheDocument();
    expect(screen.queryByText('ON')).toBeNull();
    expect(screen.getByTestId('cmd-icon-off')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
    // Visible label renders in addition to the accessible name.
    expect(screen.getByText('Climate')).toBeInTheDocument();
  });

  it('derives the ON state from the vehicle state field, flipping the glyph, sublabel, aria-pressed, and panel styling', () => {
    const { tile } = renderTile({ state: makeState({ is_climate_on: true }) });

    const el = tile();
    expect(el).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('ON')).toBeInTheDocument();
    expect(screen.getByTestId('cmd-icon-on')).toBeInTheDocument();
    // Default variant "on" panel colour.
    expect(el.className).toContain('bg-neon-cyan/5');
  });

  it('executes the ON command with its params when clicked while off (state-driven), without opening a dialog or flipping local state', () => {
    const def = makeDef({ command: 'auto_conditioning_start', params: { temp: 21 } });
    const { props, tile } = renderTile({ def, state: makeState({ is_climate_on: false }) });

    fireEvent.click(tile());

    expect(props.onExecute).toHaveBeenCalledTimes(1);
    expect(props.onExecute).toHaveBeenCalledWith('auto_conditioning_start', { temp: 21 });
    expect(props.onRequestDialog).not.toHaveBeenCalled();
    // State-driven tile: no optimistic local flip.
    expect(tile()).toHaveAttribute('aria-pressed', 'false');
  });

  it('executes the OFF command (no params) when clicked while on (state-driven)', () => {
    const def = makeDef({ commandOff: 'auto_conditioning_stop' });
    const { props, tile } = renderTile({ def, state: makeState({ is_climate_on: true }) });

    fireEvent.click(tile());

    expect(props.onExecute).toHaveBeenCalledTimes(1);
    expect(props.onExecute).toHaveBeenCalledWith('auto_conditioning_stop');
    expect(props.onRequestDialog).not.toHaveBeenCalled();
  });

  it('does NOT dispatch an undefined command when it is on but declares no commandOff (regression guard)', () => {
    const def = makeDef({ commandOff: undefined });
    const { props, tile } = renderTile({ def, state: makeState({ is_climate_on: true }) });

    expect(tile()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tile());

    expect(props.onExecute).not.toHaveBeenCalled();
    expect(props.onRequestDialog).not.toHaveBeenCalled();
  });

  it('optimistically flips its own ON/OFF state and dispatches both commands when it has no stateField', () => {
    const def = makeDef({ stateField: undefined, command: 'x_on', commandOff: 'x_off', iconOff: undefined });
    const { props, tile } = renderTile({ def, state: null });

    // Starts off.
    expect(tile()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('OFF')).toBeInTheDocument();

    // off → on
    fireEvent.click(tile());
    expect(props.onExecute).toHaveBeenNthCalledWith(1, 'x_on', undefined);
    expect(tile()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('ON')).toBeInTheDocument();

    // on → off
    fireEvent.click(tile());
    expect(props.onExecute).toHaveBeenNthCalledWith(2, 'x_off');
    expect(tile()).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens the input/confirmation dialog instead of executing when off and an inputConfig is present, without flipping state', () => {
    const inputConfig: CommandDef['inputConfig'] = {
      promptKey: 'commands.pin.prompt',
      promptFallback: 'Enter PIN',
      paramName: 'pin',
    };
    const def = makeDef({ stateField: undefined, inputConfig });
    const { props, tile } = renderTile({ def, state: null });

    fireEvent.click(tile());

    expect(props.onRequestDialog).toHaveBeenCalledTimes(1);
    expect(props.onRequestDialog).toHaveBeenCalledWith(def);
    expect(props.onExecute).not.toHaveBeenCalled();
    expect(tile()).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a spinner, marks itself busy/disabled/unfocusable, and ignores clicks and keypresses while loading', () => {
    const { container, props, tile } = renderTile({ loading: true, state: makeState({ is_climate_on: false }) });

    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByTestId('cmd-icon-on')).toBeNull();
    expect(screen.queryByTestId('cmd-icon-off')).toBeNull();

    const el = tile();
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveAttribute('tabindex', '-1');

    fireEvent.click(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(props.onExecute).not.toHaveBeenCalled();
    expect(props.onRequestDialog).not.toHaveBeenCalled();
  });

  it('activates on Enter and Space when the tile itself is focused, but ignores other keys', () => {
    const def = makeDef({ command: 'auto_conditioning_start', params: { temp: 20 } });
    const { props, tile } = renderTile({ def, state: makeState({ is_climate_on: false }) });
    const el = tile();

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(props.onExecute).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(el, { key: ' ' });
    expect(props.onExecute).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(el, { key: 'a' });
    expect(props.onExecute).toHaveBeenCalledTimes(2);
    expect(props.onExecute).toHaveBeenLastCalledWith('auto_conditioning_start', { temp: 20 });
  });

  it('does NOT activate the tile when a key press bubbles up from the nested favorite button', () => {
    const { props, favorite } = renderTile({ state: makeState({ is_climate_on: false }) });
    const fav = favorite();

    fireEvent.keyDown(fav, { key: 'Enter' });
    fireEvent.keyDown(fav, { key: ' ' });

    // The guard (e.target !== e.currentTarget) prevents the tile from firing.
    expect(props.onExecute).not.toHaveBeenCalled();
    expect(props.onRequestDialog).not.toHaveBeenCalled();
  });

  it('toggles the favorite without activating the tile, and exposes the pressed state via aria-pressed + fill', () => {
    const { props, rerender, favorite } = renderTile({ isFavorite: false });

    const fav = favorite();
    expect(fav).toHaveAttribute('aria-pressed', 'false');
    expect(fav.querySelector('svg')).not.toHaveClass('fill-current');

    fireEvent.click(fav);
    expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
    // stopPropagation keeps the tile's own onClick from firing.
    expect(props.onExecute).not.toHaveBeenCalled();
    expect(props.onRequestDialog).not.toHaveBeenCalled();

    rerender(<ToggleCommandTile {...props} isFavorite />);
    const favActive = favorite();
    expect(favActive).toHaveAttribute('aria-pressed', 'true');
    expect(favActive.querySelector('svg')).toHaveClass('fill-current');
  });

  it('colours a success status emerald and a failure status rose, and omits the row when status is absent', () => {
    const { rerender, props } = renderTile({ lastStatus: '✓ Sent' });

    const ok = screen.getByText('✓ Sent');
    expect(ok).toHaveClass('text-emerald-300');
    expect(ok).not.toHaveClass('text-rose-300');

    rerender(<ToggleCommandTile {...props} lastStatus="✗ Failed" />);
    expect(screen.getByText('✗ Failed')).toHaveClass('text-rose-300');

    rerender(<ToggleCommandTile {...props} lastStatus={undefined} />);
    expect(screen.queryByText('✗ Failed')).toBeNull();
  });

  it('falls back to the default palette for an unknown variant instead of crashing on styles lookup', () => {
    const def = makeDef({ variant: 'plaid' as unknown as CommandDef['variant'] });
    const { tile } = renderTile({ def, state: makeState({ is_climate_on: true }) });

    const el = tile();
    // Default "on" panel colour — proves onStyles[variant] ?? onStyles.default.
    expect(el.className).toContain('bg-neon-cyan/5');
    expect(screen.getByText('ON')).toBeInTheDocument();
  });
});
