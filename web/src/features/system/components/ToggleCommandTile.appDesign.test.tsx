import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { Car } from 'lucide-react';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { CommandDef, VehicleState } from '../commands';
import { ToggleCommandTile } from './ToggleCommandTile';

const controls = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'controls.css'), 'utf8'));
const def: CommandDef = {
  id: 'climate', category: 'climate', type: 'toggle',
  command: 'auto_conditioning_start', commandOff: 'auto_conditioning_stop',
  labelKey: 'commands.climate.toggle', labelFallback: 'Climate', icon: Car,
  stateField: 'is_climate_on',
};

describe('ToggleCommandTile native control adoption', () => {
  it.each(PACK_IDS)('%s composes the actual tile, retains unknown/current/stale truth and isolates every physical intent', pack => {
    const execute = vi.fn();
    const favorite = vi.fn();
    const props = {
      def, state: null, onExecute: execute, onRequestDialog: vi.fn(),
      loading: false, isFavorite: false, onToggleFavorite: favorite,
      stateTrust: { observedAt: Date.now(), freshness: 'fresh', verifiedFields: ['is_climate_on'] } as const,
    };
    const tree = (state: VehicleState | null, loading = false, disabled = false) => (
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <ToggleCommandTile {...props} state={state} loading={loading} disabled={disabled} />
      </div>
    );
    const view = render(tree(null));
    const release = observeAppDesignScopes(view.container);
    try {
      const tile = screen.getByRole('button', { name: 'Climate' });
      expect(tile).toHaveAttribute('data-app-part', 'panel button');
      expect(tile).toHaveAttribute('data-surface-variant', 'standalone');
      expect(tile).toHaveAttribute('data-app-variant', 'secondary');
      const matching: string[] = [];
      controls.walkRules(rule => {
        matching.push(...rule.selectors.filter(selector =>
          selector.includes(`[data-app-controls="${APPLICATION_DESIGNS[pack].controls}"]`)
            && selector.includes('[data-app-part~="button"]') && tile.matches(selector)));
      });
      expect(matching.length).toBeGreaterThan(0);
      expect(tile).not.toHaveAttribute('aria-pressed');
      fireEvent.click(tile);
      expect(execute).not.toHaveBeenCalled();
      const on = within(tile).getByRole('button', { name: 'ON' });
      fireEvent.click(on);
      expect(execute).toHaveBeenLastCalledWith(def.command, undefined);
      execute.mockClear();
      const state = { is_climate_on: true } as VehicleState;
      view.rerender(tree(state));
      expect(tile).toHaveAttribute('aria-pressed', 'true');
      expect(tile).toHaveClass('bg-theme-accent/5', 'min-h-[116px]');
      fireEvent.keyDown(tile, { key: 'Enter' });
      fireEvent.keyDown(tile, { key: ' ' });
      expect(execute.mock.calls).toEqual([[def.commandOff], [def.commandOff]]);
      execute.mockClear();
      const fav = within(tile).getByRole('button', { name: 'Toggle favorite' });
      fireEvent.keyDown(fav, { key: 'Enter' });
      fireEvent.keyDown(on, { key: ' ' });
      fireEvent.click(fav);
      expect(favorite).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
      view.rerender(tree(state, true));
      expect(tile).toHaveAttribute('aria-busy', 'true');
      expect(tile).toHaveAttribute('aria-disabled', 'true');
      expect(on).toBeDisabled();
      fireEvent.click(tile);
      fireEvent.keyDown(tile, { key: 'Enter' });
      expect(execute).not.toHaveBeenCalled();
      view.rerender(tree(state, false, true));
      expect(tile).toHaveAttribute('tabindex', '-1');
      expect(on).toBeDisabled();
      expect(state.is_climate_on).toBe(true);
    } finally {
      release();
      view.unmount();
    }
  });
});
