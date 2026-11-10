import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppDesignBridge } from './AppDesignBridge';

const selection = vi.hoisted(() => ({ packId: 'brutal', appWide: false, isReady: true }));
vi.mock('@/hooks/useWidgetDesignPack', () => ({ useWidgetDesignPack: () => selection }));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-app-design-pack');
  Object.assign(selection, { packId: 'brutal', appWide: false, isReady: true });
});

describe('application design scope lifecycle', () => {
  it('requires explicit verified opt-in and clears portal-wide styling on revocation and unmount', () => {
    const root = document.documentElement;
    const view = render(<AppDesignBridge />);
    expect(root).not.toHaveAttribute('data-app-design-pack');
    selection.appWide = true;
    view.rerender(<AppDesignBridge />);
    expect(root).toHaveAttribute('data-app-design-pack', 'brutal');
    selection.isReady = false;
    view.rerender(<AppDesignBridge />);
    expect(root).not.toHaveAttribute('data-app-design-pack');
    selection.isReady = true;
    selection.packId = 'material';
    view.rerender(<AppDesignBridge />);
    expect(root).toHaveAttribute('data-app-design-pack', 'material');
    view.unmount();
    expect(root).not.toHaveAttribute('data-app-design-pack');
  });

  it('removes the app layer for widget-only scope and Classic without changing display preferences', () => {
    const root = document.documentElement;
    root.style.setProperty('--font-scale', '1.2');
    root.style.setProperty('--theme-accent', '#123456');
    selection.appWide = true;
    const view = render(<AppDesignBridge />);
    selection.appWide = false;
    view.rerender(<AppDesignBridge />);
    expect(root).not.toHaveAttribute('data-app-design-pack');
    selection.appWide = true;
    selection.packId = 'classic';
    view.rerender(<AppDesignBridge />);
    expect(root).not.toHaveAttribute('data-app-design-pack');
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.2');
    expect(root.style.getPropertyValue('--theme-accent')).toBe('#123456');
    root.style.removeProperty('--font-scale');
    root.style.removeProperty('--theme-accent');
  });
});
