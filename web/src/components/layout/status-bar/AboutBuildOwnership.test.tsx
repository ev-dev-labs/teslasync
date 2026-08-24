import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutBuildModal } from './AboutBuildModal';
import { HelpSegment } from './HelpSegment';
import { StatusBarProvider } from './StatusBarContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
      Object.entries(options ?? {}).reduce(
        (value, [key, replacement]) =>
          value.replace(`{{${key}}}`, String(replacement)),
        fallback ?? _key,
      ),
  }),
}));

vi.mock('@/api/hooks/useSettings', () => ({
  useVersionInfo: () => ({
    data: {
      app_version: '2.3.4',
      uptime_seconds: 3_600,
    },
  }),
  useUpdateCheck: () => ({
    data: {
      current: '2.3.4',
      latest: '2.3.4',
      update_available: false,
    },
  }),
}));

vi.mock('@/hooks/useChangelog', () => ({
  useChangelog: () => ({
    hasUnseen: false,
    newEntries: [],
  }),
  openChangelogModal: vi.fn(),
}));

vi.mock('@/lib/tourRegistry', () => ({
  dispatchTourLauncherOpen: vi.fn(),
}));

function PersistentAboutHarness() {
  const [open, setOpen] = useState(false);
  return (
    <StatusBarProvider announcementLabel="Status announcements">
      <HelpSegment onOpenAbout={() => setOpen(true)} />
      {open && (
        <AboutBuildModal
          open
          onClose={() => setOpen(false)}
        />
      )}
    </StatusBarProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('persistent About modal ownership', () => {
  it('keeps modal actions mounted after the Help popover closes', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<PersistentAboutHarness />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Open help and about' }),
    );
    fireEvent.click(screen.getByTestId('status-bar-about-trigger'));

    expect(
      screen.queryByRole('dialog', { name: 'Help & support' }),
    ).toBeNull();
    const about = screen.getByRole('dialog', { name: 'About this build' });
    const releaseNotes = screen.getByRole('button', {
      name: 'Release notes',
    });

    fireEvent.pointerDown(releaseNotes);
    expect(about).toBeInTheDocument();
    fireEvent.click(releaseNotes);

    expect(openWindow).toHaveBeenCalledWith(
      'https://github.com/ev-dev-labs/teslasync/releases',
      '_blank',
      'noopener,noreferrer',
    );
    expect(
      screen.getByRole('dialog', { name: 'About this build' }),
    ).toBeInTheDocument();
  });
});
