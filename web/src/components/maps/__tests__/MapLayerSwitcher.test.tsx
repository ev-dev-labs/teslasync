/**
 * Unit tests for `<MapLayerSwitcher>`.
 *
 * The component is a pure presentational set of map-style toggle buttons.
 * We mock `react-i18next` with a fallback-aware, spyable `t` (mirroring the
 * sibling `RoutePlayback.test.tsx` convention) so we can assert both the
 * rendered copy AND that the component looks strings up by key with English
 * fallbacks. No network is involved.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const i18n = vi.hoisted(() => {
  const translations: Record<string, string> = {};
  const t = vi.fn((key: string, fallback?: string) => translations[key] ?? fallback ?? key);
  return { translations, t };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: i18n.t, i18n: { language: 'en' } }),
}));

import { MapLayerSwitcher } from '../MapLayerSwitcher';
import type { MapStyle } from '../MapTileLayer';

beforeEach(() => {
  i18n.t.mockClear();
  for (const key of Object.keys(i18n.translations)) delete i18n.translations[key];
});

describe('MapLayerSwitcher', () => {
  it('renders one labelled toggle button per map style inside a "Map style" group', () => {
    render(<MapLayerSwitcher current="dark" onChange={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Map style' })).toBeInTheDocument();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Satellite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Streets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terrain' })).toBeInTheDocument();
  });

  it('marks only the active style as aria-pressed and updates when current changes', () => {
    const { rerender } = render(<MapLayerSwitcher current="streets" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Streets' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Satellite' })).toHaveAttribute('aria-pressed', 'false');

    rerender(<MapLayerSwitcher current="terrain" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Terrain' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Streets' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies distinct active vs inactive styling to cover both className branches', () => {
    render(<MapLayerSwitcher current="satellite" onChange={vi.fn()} />);

    const active = screen.getByRole('button', { name: 'Satellite' });
    expect(active.className).toContain('bg-[var(--surface-2)]');
    expect(active.className).toContain('shadow-sm');
    expect(active.className).not.toContain('text-[var(--text-secondary)]');

    const inactive = screen.getByRole('button', { name: 'Dark' });
    expect(inactive.className).toContain('hover:bg-[var(--surface-2)]');
    expect(inactive.className).not.toContain('shadow-sm');
  });

  it('calls onChange with the selected style id on click (user interaction)', () => {
    const onChange = vi.fn();
    render(<MapLayerSwitcher current="dark" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('satellite');

    fireEvent.click(screen.getByRole('button', { name: 'Terrain' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('terrain');
  });

  it('renders translated copy from i18n, looking keys up with English fallbacks', () => {
    i18n.translations['maps.layerSwitcher.label'] = 'Kartenstil';
    i18n.translations['maps.layerSwitcher.dark'] = 'Nachtmodus';

    render(<MapLayerSwitcher current="dark" onChange={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Kartenstil' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nachtmodus' })).toBeInTheDocument();
    // Keys without an override fall back to the English default.
    expect(screen.getByRole('button', { name: 'Streets' })).toBeInTheDocument();

    expect(i18n.t).toHaveBeenCalledWith('maps.layerSwitcher.label', 'Map style');
    expect(i18n.t).toHaveBeenCalledWith('maps.layerSwitcher.dark', 'Dark');
  });

  it('hides the decorative emoji from assistive tech and never submits a form', () => {
    render(<MapLayerSwitcher current="dark" onChange={vi.fn()} />);

    const darkBtn = screen.getByRole('button', { name: 'Dark' });
    expect(darkBtn).toHaveAttribute('type', 'button');

    const icon = darkBtn.querySelector('span[aria-hidden="true"]');
    expect(icon).not.toBeNull();
    expect(icon?.textContent).toBe('🌑');
  });

  it('renders every style unpressed when current matches no known layer (edge case)', () => {
    render(<MapLayerSwitcher current={'unknown' as MapStyle} onChange={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });
});
