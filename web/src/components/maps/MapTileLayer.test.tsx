import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  config: undefined as { provider: string; api_key?: string } | undefined,
  richMapTiles: true,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: state.config }),
}));
vi.mock('@/api/settings', () => ({ getMapConfig: vi.fn() }));
vi.mock('@/hooks/useLowBandwidthMode', () => ({
  useDataSaverPolicy: () => ({ richMapTiles: state.richMapTiles }),
}));
vi.mock('@/components/ui/FullscreenButton', () => ({ FullscreenButton: () => null }));
vi.mock('react-leaflet', () => ({
  useMap: vi.fn(),
  TileLayer: (props: { url: string; attribution: string; className?: string; updateWhenIdle?: boolean }) =>
    <div data-testid="tiles" data-url={props.url} data-attribution={props.attribution}
      className={props.className} data-idle={String(props.updateWhenIdle)} />,
}));

import { MapTileLayer } from './MapTileLayer';

beforeEach(() => {
  state.config = undefined;
  state.richMapTiles = true;
});

describe('MapTileLayer', () => {
  it('renders a genuinely key-free dark street layer with correct attribution', () => {
    render(<MapTileLayer />);
    const tiles = screen.getByTestId('tiles');
    expect(tiles).toHaveAttribute('data-url', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(tiles.getAttribute('data-attribution')).toContain('OpenStreetMap');
    expect(tiles.getAttribute('data-attribution')).not.toContain('CARTO');
    expect(tiles).toHaveClass('[filter:invert(1)_hue-rotate(180deg)_brightness(0.85)]');
  });

  it('does not darken free street, satellite or terrain imagery', () => {
    const view = render(<MapTileLayer style="streets" />);
    expect(screen.getByTestId('tiles').className).toBe('');
    view.rerender(<MapTileLayer style="satellite" />);
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-url', expect.stringContaining('World_Imagery'));
    expect(screen.getByTestId('tiles').className).toBe('');
    view.rerender(<MapTileLayer style="terrain" />);
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-url', expect.stringContaining('opentopomap'));
    expect(screen.getByTestId('tiles').className).toBe('');
  });

  it.each(['azure', 'google'])('preserves the configured %s provider without a raster filter', provider => {
    state.config = { provider, api_key: 'test-map-key' };
    render(<MapTileLayer />);
    expect(screen.getByTestId('tiles').getAttribute('data-url')).toContain('test-map-key');
    expect(screen.getByTestId('tiles').className).toBe('');
  });

  it('keeps the low-bandwidth policy on a key-free idle-updating dark layer', () => {
    state.richMapTiles = false;
    render(<MapTileLayer style="satellite" />);
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-url', expect.stringContaining('openstreetmap'));
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-idle', 'true');
  });

  it.each(['azure', 'google'])('keeps %s provider identity under low bandwidth', provider => {
    state.config = { provider, api_key: 'test-map-key' };
    state.richMapTiles = false;
    render(<MapTileLayer style="satellite" />);
    const tiles = screen.getByTestId('tiles');
    expect(tiles.getAttribute('data-url')).toContain('test-map-key');
    expect(tiles).toHaveAttribute('data-idle', 'true');
    expect(tiles.className).toBe('');
    expect(tiles.getAttribute('data-url')).toContain(
      provider === 'azure' ? 'microsoft.base.darkgrey' : 'lyrs=r',
    );
  });

  it.each(['azure', 'google', 'unknown'])('keeps anonymous free fallback for %s without a key', provider => {
    state.config = { provider };
    render(<MapTileLayer />);
    expect(screen.getByTestId('tiles')).toHaveAttribute(
      'data-url', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-idle', 'false');
  });
});
