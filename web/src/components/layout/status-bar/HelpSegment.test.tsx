import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { severityTokens } from '@/lib/tokens';

const mocks = vi.hoisted(() => ({
  dispatchTourLauncherOpen: vi.fn(),
  onOpenAbout: vi.fn(),
  updateAvailable: false,
  hasUnseen: false,
  reported: vi.fn(),
}));

vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: mocks.reported }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/lib/tourRegistry', () => ({
  dispatchTourLauncherOpen: mocks.dispatchTourLauncherOpen,
}));

vi.mock('@/api/hooks/useSettings', () => ({
  useUpdateCheck: () => ({
    data: { update_available: mocks.updateAvailable },
  }),
}));

vi.mock('@/hooks/useChangelogStatus', () => ({
  useChangelogStatus: () => ({ hasUnseen: mocks.hasUnseen }),
}));

vi.mock('./VersionSegment', async () => {
  const { Button } = await vi.importActual<typeof import('@/components/ui')>(
    '@/components/ui',
  );

  return {
    VersionSegment: ({
      onOpenAbout,
    }: {
      onOpenAbout?: () => void;
    }) => (
      <Button
        type="button"
        data-testid="status-bar-about-trigger"
        onClick={onOpenAbout}
      >
        About TeslaSync
      </Button>
    ),
  };
});

let HelpSegment: typeof import('./HelpSegment')['HelpSegment'];

beforeEach(async () => {
  vi.resetModules();
  HelpSegment = (await import('./HelpSegment')).HelpSegment;
  mocks.updateAvailable = false;
  mocks.hasUnseen = false;
});

afterEach(() => {
  cleanup();
  vi.doUnmock('./HelpMenuContent');
  vi.clearAllMocks();
});

async function openHelp() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open help and about' }));
    await vi.dynamicImportSettled();
  });
  await screen.findByRole('button', { name: 'Open keyboard shortcuts' });
}

describe('HelpSegment', () => {
  it('uses the exact named Help menu width without changing its popover geometry', async () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    await openHelp();

    const dialog = screen.getByRole('dialog', { name: 'Help & support' });
    expect(dialog).toHaveClass('w-help-menu');
    expect(dialog).not.toHaveClass('w-[min(92vw,260px)]');
  });

  describe('HelpSegment delayed menu presentation', () => {
    type MenuModule = typeof import('./HelpMenuContent');
    let resolveModule: (module: MenuModule) => void;
    let rejectModule: (error: Error) => void;
    let load: ReturnType<typeof vi.fn<() => Promise<MenuModule>>>;
    const releases: Array<() => void> = [];
    const fixtures: HTMLElement[] = [];

    beforeEach(() => {
      const pending = new Promise<MenuModule>((resolve, reject) => {
        resolveModule = resolve;
        rejectModule = reject;
      });
      load = vi.fn(() => pending);
      vi.doMock('./HelpMenuContent', load);
    });

    afterEach(() => {
      cleanup();
      for (const release of releases.splice(0)) release();
      for (const fixture of fixtures.splice(0)) fixture.remove();
    });

    async function finishLoading() {
      await act(async () => {
        const module = await vi.importActual<MenuModule>('./HelpMenuContent');
        resolveModule(module);
        await vi.dynamicImportSettled();
      });
    }

    it('does not request an unused menu or suspend the existing trigger and eager build-news state', () => {
      mocks.updateAvailable = true;
      render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
      expect(load).not.toHaveBeenCalled();
      expect(screen.getByRole('button', {
        name: 'Open help and about. Update or release notes available',
      })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('status')).toBeNull();
    });

    it.each(['Escape', 'outside', 'trigger'] as const)(
      'keeps the original Popover usable while loading and ignores completion after %s closes it',
      async method => {
        render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
        const trigger = screen.getByRole('button', { name: 'Open help and about' });
        trigger.focus();
        fireEvent.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'Help & support' });
        expect(dialog).toHaveClass('w-help-menu');
        expect(dialog).toHaveAttribute('data-shell-portal');
        expect(screen.getByRole('status')).toHaveTextContent('Loading');
        expect(trigger).toHaveFocus();
        await waitFor(() => expect(load).toHaveBeenCalledOnce());
        if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
        else if (method === 'outside') fireEvent.pointerDown(document.body);
        else fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();
        await finishLoading();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('status-bar-help-menu')).toBeNull();
        expect(mocks.onOpenAbout).not.toHaveBeenCalled();
        expect(mocks.reported).not.toHaveBeenCalled();
      },
    );

    it.each(['detached', 'reparented', 'incomplete', 'default', 'widget-only'] as const)(
      'establishes the original %s boundary and locale before awaiting the cold body',
      async kind => {
        const { getAppDesignAttributes, observeAppDesignScopes } = await import('@/components/ui/app-designs/designs');
        const fixture = document.createElement('section');
        fixture.setAttribute('dir', 'rtl');
        fixture.setAttribute('lang', 'ar');
        const preview = document.createElement('section');
        const container = document.createElement('div');
        if (kind !== 'default' && kind !== 'widget-only') {
          preview.setAttribute('data-app-design-preview', '');
          for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) preview.setAttribute(name, value);
          if (kind === 'incomplete') preview.removeAttribute('data-app-controls');
        }
        if (kind === 'widget-only') preview.setAttribute('data-widget-design', 'bauhaus');
        preview.append(container);
        fixture.append(preview);
        const other = document.createElement('section');
        other.setAttribute('data-app-design-preview', '');
        other.setAttribute('dir', 'ltr');
        other.setAttribute('lang', 'en');
        for (const [name, value] of Object.entries(getAppDesignAttributes('bauhaus'))) other.setAttribute(name, value);
        fixture.append(other);
        document.body.append(fixture);
        fixtures.push(fixture);
        releases.push(observeAppDesignScopes(document.documentElement));
        render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />, { container });
        const trigger = screen.getByRole('button', { name: 'Open help and about' });
        trigger.focus();
        fireEvent.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'Help & support' });
        const portal = dialog.closest('[data-app-design-portal]');
        expect(portal).toHaveAttribute('dir', 'rtl');
        expect(portal).toHaveAttribute('lang', 'ar');
        if (kind === 'detached' || kind === 'reparented') {
          expect(portal).toHaveAttribute('data-app-design-pack', 'editorial');
        } else {
          expect(portal).not.toHaveAttribute('data-app-design-pack');
        }
        await waitFor(() => expect(load).toHaveBeenCalledOnce());
        if (kind === 'detached') preview.remove();
        else other.append(container);
        await finishLoading();
        expect(portal).toHaveAttribute('dir', 'rtl');
        expect(portal).toHaveAttribute('lang', 'ar');
        if (kind === 'detached' || kind === 'reparented') {
          expect(portal).toHaveAttribute('data-app-design-pack', 'editorial');
          await waitFor(() => expect(screen.getByRole('button', { name: 'Open keyboard shortcuts' }))
            .toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial')));
        } else {
          expect(portal).not.toHaveAttribute('data-app-design-pack');
          expect(screen.getByRole('button', { name: 'Open keyboard shortcuts' })).not.toHaveAttribute('data-app-design-owner');
        }
      },
    );

    it.each([false, true])('retries within the same Popover without stealing external focus=%s', async moveFocus => {
      render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
      const trigger = screen.getByRole('button', { name: 'Open help and about' });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: 'Help & support' });
      await waitFor(() => expect(load).toHaveBeenCalledOnce());
      const error = new Error('Failed to fetch dynamically imported module');
      await act(async () => { rejectModule(error); await vi.dynamicImportSettled(); });
      expect(mocks.reported).toHaveBeenCalledWith(expect.objectContaining({ cause: error }), 'react');
      expect(screen.getByRole('alert')).toHaveTextContent('Component failed to load');
      const retry = screen.getByRole('button', { name: 'Retry' });
      const module = await vi.importActual<MenuModule>('./HelpMenuContent');
      let resolveRetry!: (module: MenuModule) => void;
      vi.doMock('./HelpMenuContent', () => new Promise<MenuModule>(resolve => { resolveRetry = resolve; }));
      retry.focus();
      fireEvent.click(retry);
      await waitFor(() => expect(resolveRetry).toBeTypeOf('function'));
      const outside = document.createElement('button');
      document.body.append(outside);
      fixtures.push(outside);
      if (moveFocus) outside.focus();
      await act(async () => { resolveRetry(module); await vi.dynamicImportSettled(); });
      expect(screen.getByRole('dialog', { name: 'Help & support' })).toBe(dialog);
      const first = screen.getByRole('button', { name: 'Open keyboard shortcuts' });
      expect(moveFocus ? outside : first).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(moveFocus ? outside : trigger).toHaveFocus();
    });

    it('ignores a rejected import after the route or responsive host unmounts', async () => {
      const view = render(<HelpSegment embedded onOpenAbout={mocks.onOpenAbout} />);
      expect(screen.getByTestId('status-bar-help-embedded')).toContainElement(screen.getByRole('status'));
      await waitFor(() => expect(load).toHaveBeenCalledOnce());
      view.unmount();
      await act(async () => { rejectModule(new Error('Late import failure')); await vi.dynamicImportSettled(); });
      expect(mocks.reported).not.toHaveBeenCalled();
      expect(screen.queryByTestId('status-bar-help-menu')).toBeNull();
    });

    it('retains the latest owner callbacks while language and props update during a delayed embedded open', async () => {
      const order: string[] = [];
      const view = render(<HelpSegment embedded onOpenAbout={() => order.push('stale')} />);
      const oldLanguage = document.documentElement.getAttribute('lang');
      try {
        document.documentElement.lang = 'de';
        view.rerender(<HelpSegment embedded onAction={() => order.push('owner')} onOpenAbout={() => order.push('about')} />);
        await finishLoading();
        expect(load).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByTestId('status-bar-about-trigger'));
        expect(order).toEqual(['owner', 'about']);
      } finally {
        if (oldLanguage === null) document.documentElement.removeAttribute('lang');
        else document.documentElement.setAttribute('lang', oldLanguage);
      }
    });

    it('opens the actual body through StrictMode replay without moving focus off its original trigger', async () => {
      render(<StrictMode><HelpSegment onOpenAbout={mocks.onOpenAbout} /></StrictMode>);
      const trigger = screen.getByRole('button', { name: 'Open help and about' });
      trigger.focus();
      fireEvent.click(trigger);
      await finishLoading();
      expect(screen.getByTestId('status-bar-help-menu')).toBeInTheDocument();
      expect(trigger).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(trigger).toHaveFocus();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('renders one coordinated Help/About trigger', () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);

    const trigger = screen.getByRole('button', { name: 'Open help and about' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Help');
  });

  it('opens a menu containing help actions and About TeslaSync', async () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    await openHelp();

    expect(screen.getByRole('dialog', { name: 'Help & support' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open tour launcher' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open feedback / bug report form' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('status-bar-about-trigger')).toHaveTextContent(
      'About TeslaSync',
    );
  });

  it('dispatches the shortcuts event and closes the menu', async () => {
    const listener = vi.fn();
    window.addEventListener('toggle-keyboard-shortcuts', listener);
    try {
      render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
      await openHelp();
      fireEvent.click(
        screen.getByRole('button', { name: 'Open keyboard shortcuts' }),
      );

      expect(listener).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Help & support' })).toBeNull();
    } finally {
      window.removeEventListener('toggle-keyboard-shortcuts', listener);
    }
  });

  it('dispatches the feedback event and tour launcher', async () => {
    const listener = vi.fn();
    window.addEventListener('open-feedback-modal', listener);
    try {
      const { rerender } = render(
        <HelpSegment onOpenAbout={mocks.onOpenAbout} />,
      );
      await openHelp();
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Open feedback / bug report form',
        }),
      );
      expect(listener).toHaveBeenCalledTimes(1);

      rerender(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
      await openHelp();
      fireEvent.click(screen.getByRole('button', { name: 'Open tour launcher' }));
      expect(mocks.dispatchTourLauncherOpen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('open-feedback-modal', listener);
    }
  });

  it('keeps action integration attributes in the menu', async () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    await openHelp();

    expect(
      screen.getByRole('button', { name: 'Open keyboard shortcuts' }),
    ).not.toHaveAttribute('data-tour');
    expect(
      screen.getByRole('button', { name: 'Open help and about' }),
    ).toHaveAttribute('data-tour', 'keyboard-hint');
    expect(screen.getByRole('button', { name: 'Open tour launcher' })).toHaveAttribute(
      'data-tour-launcher-trigger',
    );
    expect(screen.getByTestId('status-bar-feedback-trigger')).toBeInTheDocument();
  });

  it('supports icon-only mode without losing its accessible name', () => {
    render(
      <HelpSegment
        iconOnly
        onOpenAbout={mocks.onOpenAbout}
      />,
    );

    expect(screen.queryByText('Help')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open help and about' }),
    ).toBeInTheDocument();
  });

  it('renders menu content directly when embedded in More', async () => {
    render(
      <HelpSegment
        embedded
        onOpenAbout={mocks.onOpenAbout}
      />,
    );

    await screen.findByTestId('status-bar-help-menu');
    expect(screen.queryByRole('button', { name: 'Open help and about' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByTestId('status-bar-about-trigger')).toBeInTheDocument();
  });

  it('shows a build-news indicator for updates or unseen release notes', () => {
    mocks.updateAvailable = true;
    const { container } = render(
      <HelpSegment onOpenAbout={mocks.onOpenAbout} />,
    );

    expect(
      Array.from(container.querySelectorAll('span')).some((span) =>
        span.classList.contains(severityTokens.warn.dot),
      ),
    ).toBe(true);
    expect(
      screen.getByRole('button', {
        name: 'Open help and about. Update or release notes available',
      }),
    ).toBeInTheDocument();
  });

  it('closes the menu before handing About to its persistent owner', async () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    await openHelp();

    fireEvent.click(screen.getByTestId('status-bar-about-trigger'));

    expect(mocks.onOpenAbout).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('dialog', { name: 'Help & support' }),
    ).toBeNull();
  });

  it.each([false, true])('retains a mobile target with desktop density when iconOnly=%s', (iconOnly) => {
    render(<HelpSegment iconOnly={iconOnly} onOpenAbout={mocks.onOpenAbout} />);

    expect(screen.getByRole('button', { name: 'Open help and about' })).toHaveClass(
      'h-11', 'min-h-11', 'min-w-11', 'shrink-0',
      'md:h-5', 'md:min-h-0', 'md:min-w-0',
      'focus-visible:outline-2', 'focus-visible:outline-offset-2',
    );
  });

  it.each([false, true])('sizes each owned menu action for mobile and restores desktop when embedded=%s', async (embedded) => {
    render(<HelpSegment embedded={embedded} onOpenAbout={mocks.onOpenAbout} />);
    if (!embedded) await openHelp();
    else await screen.findByTestId('status-bar-help-menu');

    for (const name of [
      'Open keyboard shortcuts',
      'Open tour launcher',
      'Open feedback / bug report form',
    ]) {
      expect(screen.getByRole('button', { name })).toHaveClass(
        'h-auto', 'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0',
        'whitespace-normal', 'max-w-full',
      );
    }
  });

  it('announces unseen release notes without an update and retains its semantic dot', async () => {
    mocks.hasUnseen = true;
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);

    const trigger = screen.getByRole('button', {
      name: 'Open help and about. Update or release notes available',
    });
    expect(trigger.querySelector('span[aria-hidden]')).toHaveClass(severityTokens.warn.dot);
    fireEvent.click(trigger);
    await screen.findByTestId('status-bar-help-menu');
    expect(screen.getByRole('dialog', { name: 'Help & support' })).toBeInTheDocument();
  });

  it('calls the embedded action owner before forwarding its native action', async () => {
    const order: string[] = [];
    render(
      <HelpSegment
        embedded
        onOpenAbout={() => order.push('about')}
        onAction={() => order.push('owner')}
      />,
    );
    fireEvent.click(await screen.findByTestId('status-bar-about-trigger'));
    expect(order).toEqual(['owner', 'about']);
  });

  it('closes on Escape and restores focus to the original trigger', async () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    const trigger = screen.getByRole('button', { name: 'Open help and about' });
    trigger.focus();
    await openHelp();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help & support' })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
