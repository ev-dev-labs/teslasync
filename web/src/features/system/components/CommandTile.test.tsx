import { type ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandTile } from './CommandTile';
import type { CommandDef } from '../commands';

// Deterministic i18n: echo the provided fallback so text/label assertions do
// not depend on the runtime translation catalogue (mirrors the repo's
// CollapsibleCommandGroup / status-card test convention).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

// A stand-in for a lucide icon so we can distinguish the command glyph from the
// Loader2 spinner and the favorite Star. Spreads props so `aria-hidden` /
// `className` flow through exactly as the real icons receive them.
function TestIcon(props: Record<string, unknown>) {
  return <svg data-testid="cmd-icon" {...props} />;
}

function makeDef(overrides: Partial<CommandDef> = {}): CommandDef {
  return {
    id: 'wake',
    command: 'wake_up',
    labelKey: 'commands.security.wakeUp',
    labelFallback: 'Wake Up',
    icon: TestIcon as unknown as CommandDef['icon'],
    category: 'security',
    type: 'action',
    ...overrides,
  };
}

type Props = ComponentProps<typeof CommandTile>;

function renderTile(overrides: Partial<Props> = {}) {
  const props: Props = {
    def: makeDef(),
    onExecute: vi.fn(),
    onRequestDialog: vi.fn(),
    loading: false,
    isFavorite: false,
    onToggleFavorite: vi.fn(),
    ...overrides,
  };
  const utils = render(<CommandTile {...props} />);
  const tile = () => screen.getByRole('button', { name: props.def.labelFallback });
  const favorite = () => screen.getByRole('button', { name: /toggle favorite/i });
  return { ...utils, props, tile, favorite };
}

const hiddenIcons = (container: HTMLElement) =>
  container.querySelectorAll('svg[aria-hidden="true"]');

afterEach(() => {
  vi.clearAllMocks();
});

describe('CommandTile', () => {
  it('renders an accessible button tile with the translated label, the command icon (not a spinner), and no busy state when idle', () => {
    const { container, tile } = renderTile();

    const el = tile();
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('tabindex', '0');
    // Idle → aria-busy/aria-disabled are omitted rather than rendered "false".
    expect(el).not.toHaveAttribute('aria-busy');
    expect(el).not.toHaveAttribute('aria-disabled');
    // The command glyph is shown; the loading spinner is not.
    expect(screen.getByTestId('cmd-icon')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
    // Visible label text renders in addition to the accessible name.
    expect(screen.getByText('Wake Up')).toBeInTheDocument();
  });

  it('executes the command with its params on click for a non-dangerous action, without opening a dialog', () => {
    const { props, tile } = renderTile({
      def: makeDef({ command: 'honk_horn', params: { volume: 3 } }),
    });

    fireEvent.click(tile());

    expect(props.onExecute).toHaveBeenCalledTimes(1);
    expect(props.onExecute).toHaveBeenCalledWith('honk_horn', { volume: 3 });
    expect(props.onRequestDialog).not.toHaveBeenCalled();
  });

  it('opens the confirmation dialog instead of executing when the command is dangerous, and shows the extra warning glyph', () => {
    const def = makeDef({ dangerous: true });
    const { props, tile, container } = renderTile({ def });

    // Star + command icon + AlertTriangle are all decorative.
    expect(hiddenIcons(container)).toHaveLength(3);

    fireEvent.click(tile());

    expect(props.onRequestDialog).toHaveBeenCalledTimes(1);
    expect(props.onRequestDialog).toHaveBeenCalledWith(def);
    expect(props.onExecute).not.toHaveBeenCalled();
  });

  it('shows a spinner, marks itself busy/disabled/unfocusable, and ignores clicks while loading', () => {
    const { container, props, tile } = renderTile({ loading: true });

    expect(screen.queryByTestId('cmd-icon')).toBeNull();
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    const el = tile();
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveAttribute('tabindex', '-1');

    fireEvent.click(el);
    expect(props.onExecute).not.toHaveBeenCalled();
    expect(props.onRequestDialog).not.toHaveBeenCalled();
  });

  it('activates on Enter and Space when the tile itself is focused, but ignores other keys', () => {
    const { props, tile } = renderTile();
    const el = tile();

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(props.onExecute).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(el, { key: ' ' });
    expect(props.onExecute).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(el, { key: 'a' });
    expect(props.onExecute).toHaveBeenCalledTimes(2);
    expect(props.onExecute).toHaveBeenLastCalledWith('wake_up', undefined);
  });

  it('routes keyboard activation to the dialog (not execute) for a dangerous command', () => {
    const def = makeDef({ dangerous: true });
    const { props, tile } = renderTile({ def });

    fireEvent.keyDown(tile(), { key: 'Enter' });

    expect(props.onRequestDialog).toHaveBeenCalledWith(def);
    expect(props.onExecute).not.toHaveBeenCalled();
  });

  it('does NOT execute the command when a key press bubbles up from the nested favorite button', () => {
    const { props, favorite } = renderTile();
    const fav = favorite();

    fireEvent.keyDown(fav, { key: 'Enter' });
    fireEvent.keyDown(fav, { key: ' ' });

    // The guard (e.target !== e.currentTarget) prevents the tile from firing.
    expect(props.onExecute).not.toHaveBeenCalled();
    expect(props.onRequestDialog).not.toHaveBeenCalled();
  });

  it('toggles the favorite without activating the tile, and exposes the pressed state via aria-pressed', () => {
    const { props, rerender, favorite } = renderTile({ isFavorite: false });

    const fav = favorite();
    expect(fav).toHaveAttribute('aria-pressed', 'false');
    expect(fav.querySelector('svg')).not.toHaveClass('fill-current');

    fireEvent.click(fav);
    expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
    // stopPropagation keeps the tile's own onClick from firing.
    expect(props.onExecute).not.toHaveBeenCalled();
    expect(props.onRequestDialog).not.toHaveBeenCalled();

    rerender(<CommandTile {...props} isFavorite />);
    const favActive = favorite();
    expect(favActive).toHaveAttribute('aria-pressed', 'true');
    expect(favActive.querySelector('svg')).toHaveClass('fill-current');
  });

  it('renders the optional sublabel and colours a success status green', () => {
    renderTile({
      def: makeDef({ sublabelKey: 'commands.security.wakeVehicle', sublabelFallback: 'Wake vehicle' }),
      lastStatus: '✓ Sent',
    });

    expect(screen.getByText('Wake vehicle')).toBeInTheDocument();
    const status = screen.getByText('✓ Sent');
    expect(status).toHaveClass('text-emerald-300');
    expect(status).not.toHaveClass('text-rose-300');
  });

  it('colours a non-success status red and omits the optional rows when sublabel/status are absent', () => {
    const { rerender, props } = renderTile({ lastStatus: '✗ Failed' });

    expect(screen.getByText('✗ Failed')).toHaveClass('text-rose-300');

    rerender(<CommandTile {...props} lastStatus={undefined} />);
    expect(screen.queryByText('✗ Failed')).toBeNull();
    // No sublabel was supplied → the sublabel row never renders.
    expect(screen.queryByText('Wake vehicle')).toBeNull();
  });

  it('applies the per-variant hover border and falls back to the default for an unknown variant', () => {
    const danger = renderTile({ def: makeDef({ variant: 'danger' }) });
    expect(danger.tile().className).toContain('hover:border-neon-red/30');
    danger.unmount();

    const success = renderTile({ def: makeDef({ variant: 'success' }) });
    expect(success.tile().className).toContain('hover:border-neon-green/30');
    success.unmount();

    // An unexpected runtime variant (e.g. from an API-driven command list)
    // must not drop the hover affordance — it falls back to the default.
    const unknown = renderTile({
      def: makeDef({ variant: 'plaid' as unknown as CommandDef['variant'] }),
    });
    expect(unknown.tile().className).toContain('hover:border-neon-cyan/30');
  });
});
