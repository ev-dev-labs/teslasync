import { lazy, StrictMode, Suspense } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppDesignPortal } from './AppDesignPortal';
import { appDesignPortalScope, captureAppDesignOrigin } from './appDesignOrigin';
import { getAppDesignAttributes, observeAppDesignScopes } from './app-designs/designs';
import { Button } from './Button';
import { Modal } from './Modal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

const connect = appDesignPortalScope.connect;
const releases: Array<() => void> = [];

afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  appDesignPortalScope.connect = connect;
  for (const name of Object.keys(getAppDesignAttributes('classic'))) document.documentElement.removeAttribute(name);
  vi.restoreAllMocks();
});

function invocation() {
  const fixture = document.createElement('section');
  const locale = document.createElement('section');
  locale.setAttribute('dir', 'rtl');
  locale.setAttribute('lang', 'ar');
  const preview = document.createElement('section');
  preview.setAttribute('data-app-design-preview', '');
  for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) preview.setAttribute(name, value);
  const origin = document.createElement('a');
  origin.href = '#original';
  preview.append(origin);
  locale.append(preview);
  fixture.append(locale);
  document.body.append(fixture);
  const release = observeAppDesignScopes(preview);
  releases.push(() => { release(); fixture.remove(); });
  return { fixture, preview, origin, snapshot: captureAppDesignOrigin(origin) };
}

describe('AppDesignPortal lazy-boundary ownership', () => {
  it('renders default/public/widget-only content synchronously without loading a design binding or observing', () => {
    appDesignPortalScope.connect = undefined;
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe');
    const view = render(<StrictMode><AppDesignPortal><Button>Neutral action</Button></AppDesignPortal></StrictMode>);
    const action = screen.getByRole('button', { name: 'Neutral action' });
    const boundary = action.closest('[data-app-design-portal]');
    expect(boundary?.parentElement).toBe(document.body);
    expect(boundary).not.toHaveAttribute('data-app-design-preview');
    expect(action).not.toHaveAttribute('data-app-design-owner');
    expect(observe).not.toHaveBeenCalled();
    action.focus();
    view.rerender(<StrictMode><AppDesignPortal><Button>Neutral action</Button></AppDesignPortal></StrictMode>);
    expect(screen.getByRole('button', { name: 'Neutral action' })).toBe(action);
    expect(action).toHaveFocus();
    view.unmount();
    expect(observe).not.toHaveBeenCalled();
  });

  it('keeps a neutral captured boundary around nested portals before the canonical module is needed', () => {
    appDesignPortalScope.connect = undefined;
    const snapshot = captureAppDesignOrigin(null);
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe');
    render(<AppDesignPortal inline originSnapshot={snapshot}>
      <AppDesignPortal><Button>Nested neutral action</Button></AppDesignPortal>
    </AppDesignPortal>);
    const boundary = screen.getByRole('button', { name: 'Nested neutral action' }).closest('[data-app-design-portal]');
    expect(boundary).toHaveAttribute('data-app-design-preview');
    expect(boundary).not.toHaveAttribute('data-app-design-pack');
    expect(observe).not.toHaveBeenCalled();
  });

  it.each(['detached', 'reparented'] as const)(
    'uses the original complete profile and locale when the invocation is %s during lazy loading',
    async mutation => {
      const { fixture, preview, origin, snapshot } = invocation();
      let finish!: () => void;
      const pending = new Promise<void>(resolve => { finish = resolve; });
      const DeferredPortal = lazy(async () => { await pending; return { default: AppDesignPortal }; });
      const view = render(<StrictMode><Suspense fallback={null}>
        <DeferredPortal inline origin={origin} originSnapshot={snapshot}>
          <Modal open onClose={() => {}} title="Retained design">
            <Button>Retained action</Button><svg><path data-testid="vendor" d="M0 0h1" /></svg>
          </Modal>
        </DeferredPortal>
      </Suspense></StrictMode>);
      expect(screen.queryByRole('dialog')).toBeNull();
      const other = document.createElement('section');
      other.setAttribute('data-app-design-preview', '');
      other.setAttribute('dir', 'ltr');
      other.setAttribute('lang', 'en');
      for (const [name, value] of Object.entries(getAppDesignAttributes('bauhaus'))) other.setAttribute(name, value);
      fixture.append(other);
      if (mutation === 'detached') preview.remove();
      else {
        other.append(preview, origin);
        for (const [name, value] of Object.entries(getAppDesignAttributes('bauhaus'))) preview.setAttribute(name, value);
      }
      await act(async () => { finish(); await pending; });
      const dialog = screen.getByRole('dialog', { name: 'Retained design' });
      const boundary = dialog.closest('[data-app-design-portal]');
      expect(boundary?.parentElement).toBe(document.body);
      expect(boundary).toHaveAttribute('dir', 'rtl');
      expect(boundary).toHaveAttribute('lang', 'ar');
      for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) expect(boundary).toHaveAttribute(name, value);
      for (const target of [dialog, screen.getByTestId('vendor')]) {
        expect(target).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial'));
      }
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      const inserted = document.createElement('span');
      dialog.append(inserted);
      await waitFor(() => expect(inserted).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial')));
      view.unmount();
      await waitFor(() => {
        expect(dialog).not.toHaveAttribute('data-app-design-owner');
        expect(inserted).not.toHaveAttribute('data-app-design-owner');
      });
    },
  );

  it('does not attach a cancelled lazy portal or acquire a scope after unmount', async () => {
    const { origin, snapshot } = invocation();
    const binding = vi.fn(connect);
    appDesignPortalScope.connect = binding;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const DeferredPortal = lazy(async () => { await pending; return { default: AppDesignPortal }; });
    const view = render(<Suspense fallback={null}>
      <DeferredPortal origin={origin} originSnapshot={snapshot}><Button>Cancelled action</Button></DeferredPortal>
    </Suspense>);
    view.unmount();
    await act(async () => { finish(); await pending; });
    expect(binding).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cancelled action' })).toBeNull();
    expect(document.querySelector('[data-app-design-portal]')).toBeNull();
  });
});
