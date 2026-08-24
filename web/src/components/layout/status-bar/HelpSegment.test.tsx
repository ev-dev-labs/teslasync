import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

vi.mock('@/hooks/useChangelog', () => ({
  useChangelog: () => ({ hasUnseen: mocks.hasUnseen }),
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

    expect(container.querySelector('.bg-amber-400')).not.toBeNull();
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
});
