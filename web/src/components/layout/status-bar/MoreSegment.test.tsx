import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BackgroundJob,
  UseBackgroundJobsResult,
} from '@/hooks/useBackgroundJobs';
import { neonColorMap, typography } from '@/lib/tokens';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const buildNews = vi.hoisted(() => ({ current: false }));
const motionPreference = vi.hoisted(() => ({ reduce: false }));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({
    reduce: motionPreference.reduce,
    durationMs: motionPreference.reduce ? 0 : 250,
  }),
}));

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
  motionPreference.reduce = false;
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
    expect(trigger.className).toContain(neonColorMap.amber.text);
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
    expect(trigger.className).toContain(neonColorMap.red.text);
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
    expect(trigger.className).toContain(neonColorMap.amber.text);
    expect(container.getElementsByClassName(neonColorMap.amber.dot)[0]).not.toBeNull();
  });
});

describe('MoreSegment owned accessibility and state preservation', () => {
  it('uses exact named geometry and scroll ownership with real mobile target classes', () => {
    render(<MoreSegment backgroundJobs={backgroundJobs()} onOpenAbout={openAbout} />);
    const trigger = screen.getByRole('button', { name: 'Open more status options' });
    expect(trigger).toHaveClass('min-h-11', 'min-w-11', 'shrink-0', 'md:h-5', 'md:min-h-0');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'More' })).toHaveClass(
      'max-h-more-menu', 'w-connection-diagnostics', 'overflow-y-auto',
    );
    expect(screen.getByRole('dialog', { name: 'More' })).toHaveAttribute('aria-modal', 'false');
  });

  it('closes on Escape and restores the real trigger without replacing the shared focus owner', () => {
    render(<MoreSegment backgroundJobs={backgroundJobs()} onOpenAbout={openAbout} />);
    const trigger = screen.getByRole('button', { name: 'Open more status options' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not steal focus already transferred to an external overlay control', () => {
    render(<MoreSegment backgroundJobs={backgroundJobs()} onOpenAbout={openAbout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open more status options' }));
    const external = document.createElement('button');
    document.body.append(external);
    try {
      external.focus();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
      expect(external).toHaveFocus();
    } finally {
      external.remove();
    }
  });

  it('keeps completed work above build news while retaining its separate marker and summary', () => {
    buildNews.current = true;
    render(<MoreSegment backgroundJobs={backgroundJobs([job({ status: 'success' })])} onOpenAbout={openAbout} />);
    const trigger = screen.getByRole('button', {
      name: 'Open more status options. Background work completed: Saving… · Update or release notes available',
    });
    expect(trigger).toHaveClass(neonColorMap.green.text);
    expect(trigger.querySelector('.lucide-circle-check')).toBeTruthy();
    expect(trigger.getElementsByClassName(neonColorMap.amber.dot)).toHaveLength(1);
  });

  it('retains error over running and build news with multiple-task source counts', () => {
    buildNews.current = true;
    render(<MoreSegment backgroundJobs={backgroundJobs([job(), job({ id: 'failed', status: 'error' })])} onOpenAbout={openAbout} />);
    const trigger = screen.getByRole('button', {
      name: 'Open more status options. Background work needs attention: {{count}} tasks · Update or release notes available',
    });
    expect(trigger).toHaveClass(neonColorMap.red.text);
    expect(trigger.querySelector('.lucide-triangle-alert')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByTestId('more-background')).toHaveAttribute('data-count', '2');
  });

  it('stops running animation through the shared reduced-motion or low-bandwidth preference', () => {
    motionPreference.reduce = true;
    render(<MoreSegment backgroundJobs={backgroundJobs([job()])} onOpenAbout={openAbout} />);
    const trigger = screen.getByRole('button', {
      name: 'Open more status options. Background work in progress: Saving…',
    });
    expect(trigger).toHaveClass(neonColorMap.amber.text);
    expect(trigger.querySelector('.lucide-loader-circle')).not.toHaveClass('animate-spin');
  });

  it('keeps full long job labels and logical marker placement in an RTL container', () => {
    const label = 'مهمة طويلة '.repeat(100);
    buildNews.current = true;
    render(<div dir="rtl"><MoreSegment backgroundJobs={backgroundJobs([job({ label })])} onOpenAbout={openAbout} /></div>);
    const trigger = screen.getByTestId('status-bar-more-trigger');
    expect(trigger).toHaveAttribute('aria-label', `Open more status options. Background work in progress: ${label} · Update or release notes available`);
    expect(trigger.getElementsByClassName(neonColorMap.amber.dot)[0]).toHaveClass('end-0.5');
  });

  it('keeps the idle unknown-free state neutral and toggles closed without inventing work', () => {
    render(<MoreSegment backgroundJobs={backgroundJobs()} onOpenAbout={openAbout} />);
    const trigger = screen.getByRole('button', { name: 'Open more status options' });
    expect(trigger).toHaveClass(typography.color.muted);
    expect(trigger.querySelector('.lucide-ellipsis')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByTestId('more-background')).toHaveAttribute('data-count', '0');
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
  });
});
