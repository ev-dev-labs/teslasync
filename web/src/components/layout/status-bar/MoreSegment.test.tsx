import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BackgroundJob,
  UseBackgroundJobsResult,
} from '@/hooks/useBackgroundJobs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const buildNews = vi.hoisted(() => ({ current: false }));

vi.mock('./useAboutBuild', () => ({
  useBuildNews: () => ({ hasBuildNews: buildNews.current }),
}));

vi.mock('./BackgroundWorkSegment', () => ({
  BackgroundWorkSegment: ({
    embedded,
    backgroundJobs,
  }: {
    embedded?: boolean;
    backgroundJobs: UseBackgroundJobsResult;
  }) => (
    <div
      data-testid="more-background"
      data-embedded={String(embedded)}
      data-count={backgroundJobs.count}
    />
  ),
}));

vi.mock('./ActiveVehicleSegment', () => ({
  ActiveVehicleSegment: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="more-vehicle" data-embedded={String(embedded)} />
  ),
}));

vi.mock('./HelpSegment', () => ({
  HelpSegment: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="more-help" data-embedded={String(embedded)} />
  ),
}));

vi.mock('./PresentationModeSegment', () => ({
  PresentationModeSegment: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="more-presentation" data-embedded={String(embedded)} />
  ),
}));

import { MoreSegment } from './MoreSegment';

afterEach(() => cleanup());

const openAbout = vi.fn();

beforeEach(() => {
  buildNews.current = false;
});

function backgroundJobs(
  jobs: BackgroundJob[] = [],
): UseBackgroundJobsResult {
  return {
    jobs,
    hasJobs: jobs.length > 0,
    count: jobs.length,
  };
}

function job(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'mutation',
    label: 'Saving…',
    kind: 'mutation',
    status: 'running',
    startedAt: '2026-07-05T12:00:00.000Z',
    ...overrides,
  };
}

describe('MoreSegment', () => {
  it('opens lower-priority status tools in one overflow popover', () => {
    render(
      <MoreSegment
        backgroundJobs={backgroundJobs()}
        onOpenAbout={openAbout}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'Open more status options',
    });
    expect(trigger).toHaveTextContent('More');
    expect(trigger).toHaveAttribute('data-tour', 'keyboard-hint');
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument();
    expect(screen.getByTestId('more-background')).toHaveAttribute(
      'data-embedded',
      'true',
    );
    expect(screen.getByTestId('more-background')).toHaveAttribute(
      'data-count',
      '0',
    );
    expect(screen.getByTestId('more-vehicle')).toHaveAttribute(
      'data-embedded',
      'true',
    );
    expect(screen.getByTestId('more-help')).toHaveAttribute(
      'data-embedded',
      'true',
    );
    expect(screen.getByTestId('more-presentation')).toHaveAttribute(
      'data-embedded',
      'true',
    );
  });

  it('can collapse to an icon-only trigger', () => {
    render(
      <MoreSegment
        backgroundJobs={backgroundJobs()}
        iconOnly
        onOpenAbout={openAbout}
      />,
    );

    expect(screen.queryByText('More')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open more status options' }),
    ).toBeInTheDocument();
  });

  it('surfaces running work on the always-mounted overflow trigger', () => {
    render(
      <MoreSegment
        backgroundJobs={backgroundJobs([job()])}
        onOpenAbout={openAbout}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'Open more status options. Background work in progress: Saving…',
    });
    expect(trigger.className).toContain('text-amber-300');
    expect(trigger.querySelector('.lucide-loader-circle')).toHaveClass(
      'animate-spin',
    );
  });

  it('prioritizes a background failure on the overflow trigger', () => {
    render(
      <MoreSegment
        backgroundJobs={backgroundJobs([
          job({ label: 'Sync failed', status: 'error' }),
        ])}
        onOpenAbout={openAbout}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'Open more status options. Background work needs attention: Sync failed',
    });
    expect(trigger.className).toContain('text-rose-300');
    expect(trigger.querySelector('.lucide-triangle-alert')).toBeTruthy();
  });

  it('surfaces build news on the constrained-width trigger', () => {
    buildNews.current = true;
    const { container } = render(
      <MoreSegment
        backgroundJobs={backgroundJobs()}
        onOpenAbout={openAbout}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'Open more status options. Update or release notes available',
    });
    expect(trigger.className).toContain('text-amber-300');
    expect(container.querySelector('.bg-amber-400')).not.toBeNull();
  });
});
