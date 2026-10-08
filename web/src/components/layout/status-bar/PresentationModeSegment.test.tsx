import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  enterReport: vi.fn(),
  enterKiosk: vi.fn().mockResolvedValue(undefined),
  copyPresentationLink: vi.fn().mockResolvedValue(undefined),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/components/feedback/Toast', () => ({
  useOptionalToast: () => ({
    success: actions.success,
    error: actions.error,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/usePresentationMode', () => ({
  usePresentationMode: () => ({
    enterReport: actions.enterReport,
    enterKiosk: actions.enterKiosk,
  }),
  copyPresentationLink: actions.copyPresentationLink,
}));

import { PresentationModeSegment } from './PresentationModeSegment';

beforeEach(() => {
  actions.enterReport.mockReset();
  actions.enterKiosk.mockReset();
  actions.enterKiosk.mockResolvedValue(undefined);
  actions.copyPresentationLink.mockReset();
  actions.copyPresentationLink.mockResolvedValue(undefined);
  actions.success.mockReset();
  actions.error.mockReset();
});

describe('PresentationModeSegment', () => {
  it('offers report, share, and kiosk actions in the embedded status menu', async () => {
    const onAction = vi.fn();
    render(<PresentationModeSegment embedded onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: /Open report view/i }));
    expect(actions.enterReport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Copy report link/i }));
    await waitFor(() =>
      expect(actions.copyPresentationLink).toHaveBeenCalledWith('report'),
    );

    fireEvent.click(screen.getByRole('button', { name: /Open kiosk view/i }));
    expect(actions.enterKiosk).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(3);
  });

  it('collapses the direct status-line trigger to an icon', () => {
    render(<PresentationModeSegment iconOnly />);

    expect(
      screen.getByRole('button', { name: 'Open presentation options' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Present')).toBeNull();
  });

  it('restores trigger focus after keyboard dismissal with Escape', async () => {
    render(<PresentationModeSegment />);
    const trigger = screen.getByRole('button', {
      name: 'Open presentation options',
    });

    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Presentation' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Presentation' }))
      .toHaveClass('w-presentation-menu');
    expect(screen.getByRole('dialog', { name: 'Presentation' }))
      .toHaveStyle({ zIndex: 60 });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Presentation' })).toBeNull(),
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes the direct menu before running a native presentation action', () => {
    const onAction = vi.fn();
    render(<PresentationModeSegment onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open presentation options',
    }));
    fireEvent.click(screen.getByRole('button', { name: /Open kiosk view/i }));

    expect(screen.queryByRole('dialog', { name: 'Presentation' })).toBeNull();
    expect(actions.enterKiosk).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('keeps complete descriptions and wrapping logical-alignment action controls', () => {
    render(<PresentationModeSegment embedded />);

    expect(screen.getByText(
      'Clean navigation-free layout for printing and review.',
    )).toBeVisible();
    expect(screen.getByText(
      'Preserves the current route and filter query.',
    )).toBeVisible();
    expect(screen.getByText(
      'Fullscreen monitoring with idle cursor and screen dimming.',
    )).toBeVisible();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveClass('whitespace-normal', 'text-start', 'min-h-11');
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('reports a successful copy only after the original report-link action resolves', async () => {
    render(<PresentationModeSegment embedded />);
    fireEvent.click(screen.getByRole('button', { name: /Copy report link/i }));

    await waitFor(() =>
      expect(actions.success).toHaveBeenCalledWith('Report link copied'),
    );
    expect(actions.copyPresentationLink).toHaveBeenCalledWith('report');
    expect(actions.error).not.toHaveBeenCalled();
  });

  it('reports copy failure without claiming success or changing the requested mode', async () => {
    actions.copyPresentationLink.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    const onAction = vi.fn();
    render(<PresentationModeSegment embedded onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy report link/i }));

    await waitFor(() =>
      expect(actions.error).toHaveBeenCalledWith('Could not copy report link'),
    );
    expect(actions.copyPresentationLink).toHaveBeenCalledWith('report');
    expect(actions.success).not.toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
