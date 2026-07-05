import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveControls, type LiveControlsProps } from '../LiveControls';

// Mirror the sibling state-machine tests: echo the English default copy and
// interpolate `{{token}}` placeholders so assertions read against real,
// user-visible strings. `@testing-library/user-event` is not installed in this
// repo, so interactions use `fireEvent` (matching StateTimeline/SnapshotInspector).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts) {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) {
            s = s.replace(`{{${k}}}`, String(v));
          }
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
  }),
}));

function setup(overrides: Partial<LiveControlsProps> = {}) {
  const props: LiveControlsProps = {
    isLive: true,
    onToggleLive: vi.fn(),
    onStepPrev: vi.fn(),
    onStepNext: vi.fn(),
    windowMinutes: 10,
    onWindowChange: vi.fn(),
    onClearBuffer: vi.fn(),
    ...overrides,
  };
  const utils = render(<LiveControls {...props} />);
  return { props, ...utils };
}

const windowSelect = () =>
  screen.getByRole('combobox', { name: 'Window' }) as HTMLSelectElement;

describe('LiveControls — live/freeze toggling', () => {
  it('reflects the live state via aria-pressed and freezes on Freeze', () => {
    const { props } = setup({ isLive: true });

    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Freeze' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Freeze' }));
    expect(props.onToggleLive).toHaveBeenCalledTimes(1);
    expect(props.onToggleLive).toHaveBeenCalledWith(false);
  });

  it('reflects the frozen state and resumes streaming on Live', () => {
    const { props } = setup({ isLive: false });

    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Freeze' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(props.onToggleLive).toHaveBeenCalledWith(true);
  });
});

describe('LiveControls — stepping', () => {
  it('disables both step controls by default and labels them for a11y', () => {
    setup();

    const prev = screen.getByRole('button', {
      name: 'Step to previous transition',
    });
    const next = screen.getByRole('button', { name: 'Step to next transition' });

    expect(prev).toBeDisabled();
    expect(next).toBeDisabled();
    // Icon-only controls must expose an accessible name (not just the glyph).
    expect(prev).toHaveAttribute('aria-label', 'Step to previous transition');
    expect(next).toHaveAttribute('aria-label', 'Step to next transition');
  });

  it('invokes step handlers only when the direction is enabled', () => {
    const { props } = setup({
      isLive: false,
      canStepPrev: true,
      canStepNext: true,
    });

    const prev = screen.getByRole('button', {
      name: 'Step to previous transition',
    });
    const next = screen.getByRole('button', { name: 'Step to next transition' });

    expect(prev).toBeEnabled();
    expect(next).toBeEnabled();

    fireEvent.click(prev);
    fireEvent.click(next);
    expect(props.onStepPrev).toHaveBeenCalledTimes(1);
    expect(props.onStepNext).toHaveBeenCalledTimes(1);
  });
});

describe('LiveControls — window dropdown', () => {
  it('lists the presets, reflects the active window, and reports numeric changes', () => {
    const { props } = setup({ windowMinutes: 10 });

    const select = windowSelect();
    expect(select.value).toBe('10');
    // Labels follow the existing "N min" / "N h" convention.
    expect(screen.getByRole('option', { name: '5 min' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '30 min' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2 h' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: '30' } });
    // The component parses the value to a number before invoking the callback.
    expect(props.onWindowChange).toHaveBeenCalledWith(30);
  });

  it('injects a 6 h option when the page widens the window to 360 min (regression)', () => {
    setup({ windowMinutes: 360 });

    const select = windowSelect();
    // Without the on-demand injection this select would be stuck on "5 min".
    expect(select.value).toBe('360');
    const widened = screen.getByRole('option', { name: '6 h' }) as HTMLOptionElement;
    expect(widened.selected).toBe(true);
  });

  it('injects a 24 h option when the page widens the window to 1440 min (regression)', () => {
    setup({ windowMinutes: 1440 });

    const select = windowSelect();
    expect(select.value).toBe('1440');
    const widened = screen.getByRole('option', {
      name: '24 h',
    }) as HTMLOptionElement;
    expect(widened.selected).toBe(true);
  });

  it('clears the buffer when the Clear button is pressed', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear buffer' }));
    expect(props.onClearBuffer).toHaveBeenCalledTimes(1);
  });
});

describe('LiveControls — buffered counter', () => {
  it('shows the dual window/24 h scope and explains the gap in the tooltip', () => {
    setup({ windowMinutes: 10, windowCount: 3, totalCount: 23 });

    const counter = screen.getByTestId('live-controls-counter');
    expect(counter.textContent).toContain('3 in window · 23 in 24 h');

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('10-minute');
    // 23 total − 3 in-window = 20 outside the active window.
    expect(tooltip.textContent).toContain('20 more');
  });

  it('collapses to the single "buffered" copy when everything is inside the window', () => {
    setup({ windowCount: 5, totalCount: 5 });

    const counter = screen.getByTestId('live-controls-counter');
    expect(counter.textContent).toContain('5 buffered');
    expect(counter.textContent).not.toContain('in window');
  });

  it('falls back to the deprecated bufferCount scalar when new counts are absent', () => {
    setup({ bufferCount: 23 });

    const counter = screen.getByTestId('live-controls-counter');
    expect(counter.textContent).toContain('23 buffered');
    expect(counter.textContent).not.toContain('in window');
  });

  it('renders a safe zero count when no count props are supplied', () => {
    setup();
    expect(screen.getByTestId('live-controls-counter').textContent).toContain(
      '0 buffered',
    );
  });
});

describe('LiveControls — layout', () => {
  it('forwards a custom className onto the toolbar container', () => {
    setup({ className: 'my-extra-class' });
    expect(screen.getByTestId('live-controls')).toHaveClass('my-extra-class');
  });
});
