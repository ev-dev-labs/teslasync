import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  config: undefined as { provider: string; api_key?: string } | undefined,
  richMapTiles: true,
  container: null as unknown as HTMLElement,
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
  useMap: () => ({ getContainer: () => state.container }),
  TileLayer: (props: { url: string; attribution: string; updateWhenIdle?: boolean }) =>
    <div data-testid="tiles" data-url={props.url} data-attribution={props.attribution}
      data-idle={String(props.updateWhenIdle)} />,
}));

import { MapTileLayer } from './MapTileLayer';

beforeEach(() => {
  state.config = undefined;
  state.richMapTiles = true;
  state.container = document.createElement('div');
  state.container.className = 'leaflet-container';
});

describe('MapTileLayer', () => {
  it('renders a genuinely key-free dark street layer with correct attribution', () => {
    render(<MapTileLayer />);
    const tiles = screen.getByTestId('tiles');
    expect(tiles).toHaveAttribute('data-url', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(tiles.getAttribute('data-attribution')).toContain('OpenStreetMap');
    expect(tiles.getAttribute('data-attribution')).not.toContain('CARTO');
    // L.TileLayer ignores `className`, so darkening is a container marker
    // (index.css darkens the tile pane when it is present).
    expect(state.container.classList.contains('map-style-dark')).toBe(true);
  });

  it('does not darken free street, satellite or terrain imagery', () => {
    const view = render(<MapTileLayer style="streets" />);
    expect(state.container.classList.contains('map-style-dark')).toBe(false);
    view.rerender(<MapTileLayer style="satellite" />);
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-url', expect.stringContaining('World_Imagery'));
    expect(state.container.classList.contains('map-style-dark')).toBe(false);
    view.rerender(<MapTileLayer style="terrain" />);
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-url', expect.stringContaining('opentopomap'));
    expect(state.container.classList.contains('map-style-dark')).toBe(false);
  });

  it('tracks style switches on the same container', () => {
    const view = render(<MapTileLayer style="streets" />);
    expect(state.container.classList.contains('map-style-dark')).toBe(false);
    view.rerender(<MapTileLayer style="dark" />);
    expect(state.container.classList.contains('map-style-dark')).toBe(true);
    view.rerender(<MapTileLayer style="satellite" />);
    expect(state.container.classList.contains('map-style-dark')).toBe(false);
  });

  it('removes the marker on unmount', () => {
    const view = render(<MapTileLayer />);
    expect(state.container.classList.contains('map-style-dark')).toBe(true);
    view.unmount();
    expect(state.container.classList.contains('map-style-dark')).toBe(false);
  });

  it.each(['azure', 'google'])('preserves the configured %s provider without a raster filter', provider => {
    state.config = { provider, api_key: 'test-map-key' };
    render(<MapTileLayer />);
    expect(screen.getByTestId('tiles').getAttribute('data-url')).toContain('test-map-key');
    // Native dark tiles need no CSS darkening.
    expect(state.container.classList.contains('map-style-dark')).toBe(false);
  });

  it('keeps the low-bandwidth policy on a key-free idle-updating dark layer', () => {
    state.richMapTiles = false;
    render(<MapTileLayer style="satellite" />);
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-url', expect.stringContaining('openstreetmap'));
    expect(screen.getByTestId('tiles')).toHaveAttribute('data-idle', 'true');
    // Effective style is dark, so the shown tiles are darkened to match.
    expect(state.container.classList.contains('map-style-dark')).toBe(true);
  });

  it.each(['azure', 'google'])('keeps %s provider identity under low bandwidth', provider => {
    state.config = { provider, api_key: 'test-map-key' };
    state.richMapTiles = false;
    render(<MapTileLayer style="satellite" />);
    const tiles = screen.getByTestId('tiles');
    expect(tiles.getAttribute('data-url')).toContain('test-map-key');
    expect(tiles).toHaveAttribute('data-idle', 'true');
    expect(state.container.classList.contains('map-style-dark')).toBe(false);
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
    expect(state.container.classList.contains('map-style-dark')).toBe(true);
  });
});
