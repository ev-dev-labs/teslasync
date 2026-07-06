/**
 * PlaybackControls — behaviour, branch, a11y and hardening suite.
 *
 * Exercises the full public contract of the trip-replay transport bar:
 *   - the transport buttons (reset / play-pause / stop) and their accessible
 *     labels, including the isPlaying label + icon swap,
 *   - the speed menu wiring (click cycles forward, right-click cycles back),
 *   - the pre-formatted time readout and its null-safety fallback,
 *   - the opt-in global keyboard shortcuts: play/pause, seek-by-seconds (with
 *     the onSeekBy fast-path AND the durationMs fallback + clamping), J/K/L,
 *     number-key percent jumps, Home/End, frame stepping, and speed stepping
 *     (relative fast-path AND the shiftSpeed fallback),
 *   - the guards (typing target, non-Shift modifiers, shortcuts-off default),
 *   - the inline shortcut toast (appearance, i18n label, auto-dismiss),
 *   - listener teardown on unmount, and scrubber wiring (onSeek + markers).
 *
 * `import '@/i18n'` boots the real English bundle so `t(key, default)` resolves
 * exactly as it does in production (mirrors the sibling BulkActionsToolbar
 * suite). `fireEvent` / raw `dispatchEvent` are the repo's interaction
 * primitives — @testing-library/user-event is not a dependency here.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/i18n';
import { PlaybackControls } from './PlaybackControls';
import { _resetShortcutRegistry } from '@/hooks/useShortcutRegistry';

type Props = ComponentProps<typeof PlaybackControls>;

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    isPlaying: false,
    speed: 1,
    progress: 0,
    elapsed: '0:00',
    total: '5:00',
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onStop: vi.fn(),
    onSpeedChange: vi.fn(),
    onSeek: vi.fn(),
    ...overrides,
  };
}

/** Dispatch a global keydown (the component listens on `window`). */
function pressKey(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

beforeEach(() => {
  // jsdom has no matchMedia; framer-motion's useReducedMotion (via the
  // scrubber) reads it. Default to "motion allowed" for deterministic renders.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  _resetShortcutRegistry();
});

describe('PlaybackControls — transport controls (render + a11y)', () => {
  it('renders reset, play, stop, speed and the time readout when paused', () => {
    const { container } = render(<PlaybackControls {...makeProps()} />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Playback speed:/ })).toHaveTextContent('1x');
    // Pre-formatted "elapsed / total" readout.
    expect(container).toHaveTextContent('0:00 / 5:00');
    // No Pause control while paused.
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('swaps the toggle button to Pause while playing', () => {
    render(<PlaybackControls {...makeProps({ isPlaying: true })} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('reflects the current speed in the speed menu label', () => {
    const { rerender } = render(<PlaybackControls {...makeProps({ speed: 25 })} />);
    expect(screen.getByRole('button', { name: /Playback speed:/ })).toHaveTextContent('25x');
    rerender(<PlaybackControls {...makeProps({ speed: 100 })} />);
    expect(screen.getByRole('button', { name: /Playback speed:/ })).toHaveTextContent('100x');
  });

  it('falls back to an em-dash when the pre-formatted times are missing', () => {
    const { container } = render(
      <PlaybackControls
        {...makeProps()}
        elapsed={undefined as unknown as string}
        total={undefined as unknown as string}
      />,
    );
    expect(container).toHaveTextContent('— / —');
  });

  it('hides the keyboard-help button unless shortcuts are enabled', () => {
    const { rerender } = render(<PlaybackControls {...makeProps()} />);
    expect(
      screen.queryByRole('button', { name: 'Show keyboard shortcuts' }),
    ).not.toBeInTheDocument();

    rerender(<PlaybackControls {...makeProps({ enableKeyboardShortcuts: true })} />);
    expect(
      screen.getByRole('button', { name: 'Show keyboard shortcuts' }),
    ).toBeInTheDocument();
  });
});

describe('PlaybackControls — pointer interactions', () => {
  it('invokes onPlay when paused and onPause when playing', () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const { rerender } = render(
      <PlaybackControls {...makeProps({ onPlay, onPause })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();

    rerender(<PlaybackControls {...makeProps({ isPlaying: true, onPlay, onPause })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('invokes onStop from both the reset and stop buttons', () => {
    const onStop = vi.fn();
    render(<PlaybackControls {...makeProps({ onStop })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('cycles the speed forward on click and backward on right-click', () => {
    const onSpeedChange = vi.fn();
    render(<PlaybackControls {...makeProps({ speed: 10, onSpeedChange })} />);
    const speedBtn = screen.getByRole('button', { name: /Playback speed:/ });

    fireEvent.click(speedBtn);
    expect(onSpeedChange).toHaveBeenLastCalledWith(25); // next-fastest after 10

    fireEvent.contextMenu(speedBtn);
    expect(onSpeedChange).toHaveBeenLastCalledWith(1); // one slot slower than 10
  });
});

describe('PlaybackControls — keyboard shortcuts are opt-in', () => {
  it('ignores global keys when shortcuts are disabled (the default)', () => {
    const onPlay = vi.fn();
    const onSeek = vi.fn();
    render(<PlaybackControls {...makeProps({ onPlay, onSeek })} />);

    pressKey(' ');
    pressKey('ArrowRight');
    pressKey('Home');
    expect(onPlay).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });
});

describe('PlaybackControls — keyboard shortcuts (enabled)', () => {
  it('toggles play/pause on Space and on K', () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();

    const { unmount } = render(
      <PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onPlay, onPause })} />,
    );
    pressKey(' ');
    expect(onPlay).toHaveBeenCalledTimes(1);
    pressKey('k');
    expect(onPlay).toHaveBeenCalledTimes(2);
    unmount();

    render(
      <PlaybackControls
        {...makeProps({ isPlaying: true, enableKeyboardShortcuts: true, onPlay, onPause })}
      />,
    );
    pressKey(' ');
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('seeks by seconds through onSeekBy for arrows (Shift widens the step)', () => {
    const onSeekBy = vi.fn();
    render(
      <PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onSeekBy })} />,
    );

    pressKey('ArrowRight');
    expect(onSeekBy).toHaveBeenLastCalledWith(5);
    pressKey('ArrowLeft');
    expect(onSeekBy).toHaveBeenLastCalledWith(-5);
    pressKey('ArrowRight', { shiftKey: true });
    expect(onSeekBy).toHaveBeenLastCalledWith(30);
    pressKey('ArrowLeft', { shiftKey: true });
    expect(onSeekBy).toHaveBeenLastCalledWith(-30);
  });

  it('maps J and L to ∓10s seeks', () => {
    const onSeekBy = vi.fn();
    render(
      <PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onSeekBy })} />,
    );
    pressKey('j');
    expect(onSeekBy).toHaveBeenLastCalledWith(-10);
    pressKey('l');
    expect(onSeekBy).toHaveBeenLastCalledWith(10);
  });

  it('falls back to durationMs-derived onSeek when onSeekBy is absent, and clamps', () => {
    const onSeek = vi.fn();
    render(
      <PlaybackControls
        {...makeProps({
          enableKeyboardShortcuts: true,
          progress: 0,
          durationMs: 10_000, // 10s → +5s == +0.5 progress
          onSeek,
        })}
      />,
    );
    pressKey('ArrowRight');
    expect(onSeek).toHaveBeenLastCalledWith(0.5);
    // Seeking back past the start clamps to 0 rather than going negative.
    pressKey('ArrowLeft');
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it('jumps to N×10% on number keys and to the ends on Home/End', () => {
    const onSeek = vi.fn();
    render(<PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onSeek })} />);

    pressKey('5');
    expect(onSeek).toHaveBeenLastCalledWith(0.5);
    pressKey('0');
    expect(onSeek).toHaveBeenLastCalledWith(0);
    pressKey('End');
    expect(onSeek).toHaveBeenLastCalledWith(1);
    pressKey('Home');
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it('steps frames with , and . only when onStepFrame is provided', () => {
    const onStepFrame = vi.fn();
    const { rerender } = render(
      <PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onStepFrame })} />,
    );
    pressKey(',');
    expect(onStepFrame).toHaveBeenLastCalledWith(-1);
    pressKey('.');
    expect(onStepFrame).toHaveBeenLastCalledWith(1);

    // Without the handler the keys are inert (and must not throw).
    rerender(<PlaybackControls {...makeProps({ enableKeyboardShortcuts: true })} />);
    expect(() => pressKey(',')).not.toThrow();
  });

  it('steps speed relatively when onSpeedRelative is provided', () => {
    const onSpeedRelative = vi.fn();
    const onSpeedChange = vi.fn();
    render(
      <PlaybackControls
        {...makeProps({ enableKeyboardShortcuts: true, onSpeedRelative, onSpeedChange })}
      />,
    );
    pressKey('+');
    expect(onSpeedRelative).toHaveBeenLastCalledWith(1);
    pressKey('-');
    expect(onSpeedRelative).toHaveBeenLastCalledWith(-1);
    // The relative fast-path is preferred over the absolute onSpeedChange.
    expect(onSpeedChange).not.toHaveBeenCalled();
  });

  it('falls back to shiftSpeed(onSpeedChange) when onSpeedRelative is absent', () => {
    const onSpeedChange = vi.fn();
    render(
      <PlaybackControls
        {...makeProps({ enableKeyboardShortcuts: true, speed: 1, onSpeedChange })}
      />,
    );
    pressKey('+');
    expect(onSpeedChange).toHaveBeenLastCalledWith(10); // one slot faster than 1×
  });

  it('does not hijack keys typed into form fields', () => {
    const onPlay = vi.fn();
    render(<PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onPlay })} />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });
    expect(onPlay).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('ignores keys chorded with Ctrl/Meta/Alt (leaves them for the app)', () => {
    const onPlay = vi.fn();
    const onSeek = vi.fn();
    render(
      <PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onPlay, onSeek })} />,
    );
    pressKey(' ', { ctrlKey: true });
    pressKey('ArrowRight', { metaKey: true });
    expect(onPlay).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('removes the global listener on unmount', () => {
    const onPlay = vi.fn();
    const { unmount } = render(
      <PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onPlay })} />,
    );
    unmount();
    pressKey(' ');
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('PlaybackControls — shortcut toast', () => {
  it('surfaces an i18n seek label in the live region', () => {
    render(
      <PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onSeekBy: vi.fn() })} />,
    );
    pressKey('ArrowRight');
    expect(screen.getByText(/\+5s/)).toBeInTheDocument();

    pressKey('ArrowRight', { shiftKey: true });
    expect(screen.getByText(/\+30s/)).toBeInTheDocument();
  });

  it('auto-dismisses the toast after its timeout', () => {
    vi.useFakeTimers();
    render(
      <PlaybackControls {...makeProps({ enableKeyboardShortcuts: true, onSeekBy: vi.fn() })} />,
    );
    pressKey('ArrowRight');
    expect(screen.getByText(/\+5s/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText(/\+5s/)).not.toBeInTheDocument();
  });
});

describe('PlaybackControls — scrubber wiring', () => {
  it('forwards scrubber seeks to onSeek', () => {
    const onSeek = vi.fn();
    render(<PlaybackControls {...makeProps({ onSeek, durationMs: 300_000 })} />);
    fireEvent.click(screen.getByRole('slider', { name: 'Playback progress' }));
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('renders marker ticks passed through to the scrubber', () => {
    render(
      <PlaybackControls
        {...makeProps({
          durationMs: 300_000,
          markers: [{ at: 0.5, kind: 'charge-start', label: 'Charge start' }],
        })}
      />,
    );
    expect(
      screen.getByRole('button', { name: /charge start/i }),
    ).toBeInTheDocument();
  });
});
