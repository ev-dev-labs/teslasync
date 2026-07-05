import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FavoritesBar } from './FavoritesBar';
import type { CommandDef } from '../commands';
import type { LucideIcon } from '@/lib/icons';

// Mock react-i18next so the bar renders its fallback strings without booting
// the full i18n runtime. Mirrors the convention in CommandInputDialog.test.tsx.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const StubIcon = ((props: { className?: string }) => (
  <svg data-testid="tile-glyph" className={props.className} aria-hidden="true" />
)) as unknown as LucideIcon;

// ── Fixtures ────────────────────────────────────────────────────────────────
function cmd(id: string, labelFallback = id): CommandDef {
  return {
    id,
    command: `do_${id}`,
    labelKey: `commands.${id}`,
    labelFallback,
    icon: StubIcon,
    category: 'security',
    type: 'action',
  };
}

const wake = cmd('wake', 'Wake Up');
const lock = cmd('lock', 'Lock');
const climate = cmd('climate', 'Climate');
const ALL: CommandDef[] = [wake, lock, climate];

// A renderTile stub that yields a real, interactive tile so the tests can prove
// the bar renders live command tiles (not static markup) and forwards clicks.
function makeRenderTile(onActivate?: (id: string) => void) {
  return vi.fn((c: CommandDef) => (
    <button
      key={c.id}
      type="button"
      data-testid={`tile-${c.id}`}
      onClick={() => onActivate?.(c.id)}
    >
      {c.labelFallback}
    </button>
  ));
}

afterEach(() => cleanup());

describe('FavoritesBar', () => {
  it('renders nothing when there are no favourites', () => {
    const renderTile = makeRenderTile();
    const { container } = render(
      <FavoritesBar favorites={[]} commands={ALL} renderTile={renderTile} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Quick Actions')).toBeNull();
    expect(renderTile).not.toHaveBeenCalled();
  });

  it('renders nothing when favourites reference ids that do not exist', () => {
    const { container } = render(
      <FavoritesBar favorites={['ghost', 'phantom']} commands={ALL} renderTile={makeRenderTile()} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders only the favourited tiles and skips the rest', () => {
    const renderTile = makeRenderTile();
    render(
      <FavoritesBar favorites={['wake', 'climate']} commands={ALL} renderTile={renderTile} />,
    );

    expect(screen.getByTestId('tile-wake')).toBeInTheDocument();
    expect(screen.getByTestId('tile-climate')).toBeInTheDocument();
    expect(screen.queryByTestId('tile-lock')).toBeNull();

    // renderTile is invoked once per favourited command — and never for others.
    expect(renderTile).toHaveBeenCalledTimes(2);
    expect(renderTile).toHaveBeenCalledWith(wake);
    expect(renderTile).toHaveBeenCalledWith(climate);
    expect(renderTile).not.toHaveBeenCalledWith(lock);
  });

  it('preserves command order regardless of the favourites order', () => {
    // Favourites listed climate-first, but the grid must follow command order.
    render(
      <FavoritesBar favorites={['climate', 'wake']} commands={ALL} renderTile={makeRenderTile()} />,
    );

    const order = screen.getAllByTestId(/^tile-(wake|lock|climate)$/).map(el =>
      el.getAttribute('data-testid'),
    );
    expect(order).toEqual(['tile-wake', 'tile-climate']);
  });

  it('exposes a labelled region, a heading and a favourite count', () => {
    render(
      <FavoritesBar favorites={['wake', 'lock']} commands={ALL} renderTile={makeRenderTile()} />,
    );

    const region = screen.getByRole('region', { name: 'Quick Actions' });
    expect(region).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('marks the leading star icon as decorative (aria-hidden)', () => {
    render(
      <FavoritesBar favorites={['wake']} commands={ALL} renderTile={makeRenderTile()} />,
    );

    const region = screen.getByRole('region', { name: 'Quick Actions' });
    const star = region.querySelector('.text-neon-amber');
    expect(star).not.toBeNull();
    expect(star).toHaveAttribute('aria-hidden', 'true');
    // Decorative icon must not surface as an accessible image.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders live tiles that forward user interaction', () => {
    const onActivate = vi.fn();
    render(
      <FavoritesBar favorites={['wake']} commands={ALL} renderTile={makeRenderTile(onActivate)} />,
    );

    fireEvent.click(screen.getByTestId('tile-wake'));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith('wake');
  });

  it('deduplicates repeated favourite ids', () => {
    const renderTile = makeRenderTile();
    render(
      <FavoritesBar favorites={['wake', 'wake']} commands={ALL} renderTile={renderTile} />,
    );

    expect(screen.getAllByTestId('tile-wake')).toHaveLength(1);
    expect(screen.getByText('(1)')).toBeInTheDocument();
    expect(renderTile).toHaveBeenCalledTimes(1);
  });

  it('degrades to nothing (no throw) when props are undefined or malformed', () => {
    const renderTile = makeRenderTile();

    // Simulate a corrupt localStorage payload / not-yet-loaded props. The
    // component must guard `.filter`/`.includes` rather than crash.
    const { container: c1 } = render(
      <FavoritesBar
        favorites={undefined as unknown as string[]}
        commands={undefined as unknown as CommandDef[]}
        renderTile={renderTile}
      />,
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <FavoritesBar
        favorites={{} as unknown as string[]}
        commands={ALL}
        renderTile={renderTile}
      />,
    );
    expect(c2.firstChild).toBeNull();
    expect(renderTile).not.toHaveBeenCalled();
  });
});
