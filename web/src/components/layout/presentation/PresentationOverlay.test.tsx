import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRESENTATION_DISPLAY_CONFIG,
} from '@/hooks/usePresentationMode';
import { PresentationOverlay } from './PresentationOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: () => '12:00',
    formatDateWithDay: () => 'Monday, January 1',
  }),
}));

vi.mock('@/components/layout/CopyLinkButton', () => ({
  CopyLinkButton: () => <button type="button">Copy link</button>,
}));

const baseProps = {
  config: DEFAULT_PRESENTATION_DISPLAY_CONFIG,
  isDimmed: false,
  isCursorHidden: false,
  onExit: vi.fn(),
};

describe('PresentationOverlay', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders no chrome in standard mode', () => {
    const { container } = render(
      <PresentationOverlay mode="standard" {...baseProps} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a print-excluded report toolbar with exit control', () => {
    const onExit = vi.fn();
    render(
      <PresentationOverlay
        mode="report"
        {...baseProps}
        onExit={onExit}
      />,
    );

    const toolbar = screen.getByText('Report view').closest(
      '[data-role="presentation-toolbar"]',
    );
    expect(toolbar).toHaveAttribute('data-print-hide');
    expect(toolbar).toHaveClass('z-presentation-controls');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Exit presentation mode' }),
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('keeps report controls native and the exit target reachable on mobile', () => {
    render(<PresentationOverlay mode="report" {...baseProps} />);
    const exit = screen.getByRole('button', { name: 'Exit presentation mode' });
    expect(exit).toHaveAttribute('type', 'button');
    expect(exit).toHaveClass('min-h-11', 'min-w-11');
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    expect(exit.closest('[data-role="presentation-toolbar"]')).toHaveClass(
      'end-4', 'flex-wrap', 'shadow-e2',
    );
  });

  it('preserves kiosk dimming, cursor scope, clock placement and rotation identity', () => {
    const { rerender } = render(
      <PresentationOverlay
        {...baseProps}
        mode="kiosk"
        config={{ ...baseProps.config, showClock: true, clockPosition: 'bottom-left', dimLevel: 0.25 }}
        isDimmed
        isCursorHidden
        dashboardCount={3}
        currentIndex={1}
      />,
    );
    expect(screen.getByTestId('kiosk-dim-overlay')).toHaveStyle({ opacity: '0.75' });
    expect(screen.getByTestId('kiosk-dim-overlay')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('kiosk-dim-overlay')).toHaveClass(
      'pointer-events-none', 'fixed', 'inset-0', 'z-presentation-dimmer',
      'motion-reduce:transition-none',
    );
    expect(screen.getByTestId('kiosk-cursor-style')).toHaveClass(
      'pointer-events-none', 'fixed', 'inset-0', 'z-presentation-cursor',
    );
    expect(screen.getByTestId('kiosk-cursor-style')).toHaveTextContent(
      '[data-presentation-mode="kiosk"]',
    );
    expect(screen.getByTestId('kiosk-clock')).toHaveClass('bottom-4', 'left-4');
    expect(screen.getByTestId('kiosk-clock')).toHaveClass(
      'pointer-events-none', 'z-presentation-controls',
    );
    expect(screen.getByTestId('kiosk-rotation-dots')).toHaveClass(
      'pointer-events-none', 'z-presentation-controls',
    );
    expect(screen.getByText('12:00')).toBeInTheDocument();
    expect(screen.getByText('Monday, January 1')).toBeInTheDocument();
    const dots = screen.getByTestId('kiosk-rotation-dots').children;
    expect(dots).toHaveLength(3);
    expect(dots[1]).toHaveClass('w-6');
    expect(dots[0]).toHaveClass('w-1.5');

    rerender(
      <PresentationOverlay {...baseProps} mode="kiosk" showRotation={false} dashboardCount={3} />,
    );
    expect(screen.queryByTestId('kiosk-dim-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kiosk-cursor-style')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kiosk-rotation-dots')).not.toBeInTheDocument();
  });

  it('retains dim bounds and unknown fallback instead of inventing a level', () => {
    const { rerender } = render(
      <PresentationOverlay {...baseProps} mode="kiosk" isDimmed config={{ ...baseProps.config, dimLevel: 2 }} />,
    );
    expect(screen.getByTestId('kiosk-dim-overlay')).toHaveStyle({ opacity: '0' });
    rerender(
      <PresentationOverlay {...baseProps} mode="kiosk" isDimmed config={{ ...baseProps.config, dimLevel: Number.NaN }} />,
    );
    expect(screen.getByTestId('kiosk-dim-overlay')).toHaveStyle({ opacity: '0.5' });
  });

  it('preserves activity timeout, keyboard focus reveal and native exit activation', () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const { unmount } = render(
      <PresentationOverlay {...baseProps} mode="kiosk" config={{ ...baseProps.config, showClock: false }} onExit={onExit} />,
    );
    const exit = screen.getByRole('button', { name: 'Exit kiosk mode' });
    expect(exit).toHaveAttribute('type', 'button');
    expect(exit).toHaveClass('min-h-11', 'min-w-11');
    expect(exit.parentElement).toHaveClass('opacity-0', 'focus-within:opacity-100');
    expect(exit.parentElement).toHaveClass(
      'z-presentation-controls', 'end-3', 'motion-reduce:transition-none',
    );
    fireEvent.mouseMove(window);
    expect(exit.parentElement).toHaveClass('opacity-100');
    act(() => vi.advanceTimersByTime(3000));
    expect(exit.parentElement).toHaveClass('opacity-0');
    fireEvent.touchStart(window);
    expect(exit.parentElement).toHaveClass('opacity-100');
    fireEvent.click(exit);
    expect(onExit).toHaveBeenCalledTimes(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
