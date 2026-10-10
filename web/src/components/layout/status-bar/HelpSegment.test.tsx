import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { severityTokens } from '@/lib/tokens';

const mocks = vi.hoisted(() => ({
  dispatchTourLauncherOpen: vi.fn(),
  onOpenAbout: vi.fn(),
  updateAvailable: false,
  hasUnseen: false,
}));

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

import { HelpSegment } from './HelpSegment';

beforeEach(() => {
  mocks.updateAvailable = false;
  mocks.hasUnseen = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openHelp() {
  fireEvent.click(screen.getByRole('button', { name: 'Open help and about' }));
}

describe('HelpSegment', () => {
  it('uses the exact named Help menu width without changing its popover geometry', () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    openHelp();

    const dialog = screen.getByRole('dialog', { name: 'Help & support' });
    expect(dialog).toHaveClass('w-help-menu');
    expect(dialog).not.toHaveClass('w-[min(92vw,260px)]');
  });

  it('renders one coordinated Help/About trigger', () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);

    const trigger = screen.getByRole('button', { name: 'Open help and about' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Help');
  });

  it('opens a menu containing help actions and About TeslaSync', () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    openHelp();

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

  it('dispatches the shortcuts event and closes the menu', () => {
    const listener = vi.fn();
    window.addEventListener('toggle-keyboard-shortcuts', listener);
    try {
      render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
      openHelp();
      fireEvent.click(
        screen.getByRole('button', { name: 'Open keyboard shortcuts' }),
      );

      expect(listener).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Help & support' })).toBeNull();
    } finally {
      window.removeEventListener('toggle-keyboard-shortcuts', listener);
    }
  });

  it('dispatches the feedback event and tour launcher', () => {
    const listener = vi.fn();
    window.addEventListener('open-feedback-modal', listener);
    try {
      const { rerender } = render(
        <HelpSegment onOpenAbout={mocks.onOpenAbout} />,
      );
      openHelp();
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Open feedback / bug report form',
        }),
      );
      expect(listener).toHaveBeenCalledTimes(1);

      rerender(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
      openHelp();
      fireEvent.click(screen.getByRole('button', { name: 'Open tour launcher' }));
      expect(mocks.dispatchTourLauncherOpen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('open-feedback-modal', listener);
    }
  });

  it('keeps action integration attributes in the menu', () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    openHelp();

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

  it('renders menu content directly when embedded in More', () => {
    render(
      <HelpSegment
        embedded
        onOpenAbout={mocks.onOpenAbout}
      />,
    );

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

  it('closes the menu before handing About to its persistent owner', () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    openHelp();

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

  it.each([false, true])('sizes each owned menu action for mobile and restores desktop when embedded=%s', (embedded) => {
    render(<HelpSegment embedded={embedded} onOpenAbout={mocks.onOpenAbout} />);
    if (!embedded) openHelp();

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

  it('announces unseen release notes without an update and retains its semantic dot', () => {
    mocks.hasUnseen = true;
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);

    const trigger = screen.getByRole('button', {
      name: 'Open help and about. Update or release notes available',
    });
    expect(trigger.querySelector('span[aria-hidden]')).toHaveClass(severityTokens.warn.dot);
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Help & support' })).toBeInTheDocument();
  });

  it('calls the embedded action owner before forwarding its native action', () => {
    const order: string[] = [];
    render(
      <HelpSegment
        embedded
        onOpenAbout={() => order.push('about')}
        onAction={() => order.push('owner')}
      />,
    );
    fireEvent.click(screen.getByTestId('status-bar-about-trigger'));
    expect(order).toEqual(['owner', 'about']);
  });

  it('closes on Escape and restores focus to the original trigger', () => {
    render(<HelpSegment onOpenAbout={mocks.onOpenAbout} />);
    const trigger = screen.getByRole('button', { name: 'Open help and about' });
    trigger.focus();
    openHelp();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help & support' })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
